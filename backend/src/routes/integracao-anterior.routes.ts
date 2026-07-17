import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import {
  integracaoAnteriorConfigurada,
  consultarCliente,
  reapontarDispositivos,
  gerarPlanilhaReaponte,
  normalizarNome,
  ReaponteItem,
} from '../services/reaponte-anterior.service';

/**
 * Rotas do painel admin para a tela "Trazer Dispositivos do Sistema Anterior".
 * Montadas em /api/integracao/anterior. Fazem o proxy para a API do sistema
 * antigo (monitorando.me) — a credencial fica só no servidor (.env) — e
 * registram o histórico de cada envio (auditoria).
 */
const router = Router();
router.use(authMiddleware);
router.use(requireRoles('ADMIN', 'COLABORADOR'));

function parseLista(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

// Casa o nome do cliente do sistema antigo com um Cliente cadastrado aqui.
// Retorna o melhor match (exato antes de parcial), ou null.
async function casarClienteLocal(nomeAntigo: string) {
  const alvo = normalizarNome(nomeAntigo);
  if (!alvo) return null;
  const clientes = await prisma.cliente.findMany({
    select: { id: true, nome: true, telefone: true, status: true },
  });
  let exato: (typeof clientes)[number] | null = null;
  let parcial: (typeof clientes)[number] | null = null;
  for (const c of clientes) {
    const n = normalizarNome(c.nome);
    if (n === alvo) { exato = c; break; }
    if (!parcial && (n.includes(alvo) || alvo.includes(n))) parcial = c;
  }
  return exato || parcial;
}

// Status da integração (a tela usa para avisar se falta configurar credencial).
router.get('/status', (_req: AuthRequest, res: Response) => {
  res.json({ configurado: integracaoAnteriorConfigurada() });
});

// Consulta (dry-run) — lista os dispositivos do cliente no sistema anterior.
// GET /api/integracao/anterior/consultar?cliente=NOME&digitos=15&placa=ABC1234
router.get('/consultar', async (req: AuthRequest, res: Response) => {
  const clientes = parseLista(req.query.cliente);
  if (!clientes.length) {
    res.status(400).json({ error: 'Informe ao menos um cliente (parâmetro cliente).' });
    return;
  }
  const placas = parseLista(req.query.placa);
  const digitos = req.query.digitos !== undefined ? Number(req.query.digitos) : undefined;
  if (digitos !== undefined && (Number.isNaN(digitos) || digitos < 0)) {
    res.status(400).json({ error: 'Parâmetro digitos inválido.' });
    return;
  }

  try {
    const resultado = await consultarCliente(clientes, { digitos, placas });

    // Cruzamento por IMEI: marca cada dispositivo que já existe como Dispositivo aqui.
    const imeis = resultado.alvos.map((a) => a.uniqueId).filter((v): v is string => !!v);
    if (imeis.length) {
      const existentes = await prisma.dispositivo.findMany({
        where: { identificador: { in: imeis } },
        select: { identificador: true },
      });
      const setExistentes = new Set(existentes.map((d) => d.identificador));
      for (const a of resultado.alvos) {
        a.existeAqui = a.uniqueId ? setExistentes.has(a.uniqueId) : false;
      }
    }

    // Enriquecimento: casa cada cliente do sistema antigo com o cadastro daqui
    // (para o botão do WhatsApp e o "existe aqui") e informa o último reaponte.
    const nomesUnicos = [...new Set(resultado.alvos.map((a) => a.cliente))];
    const locais = await Promise.all(
      nomesUnicos.map(async (nome) => {
        const local = await casarClienteLocal(nome);
        const ultimo = await prisma.reaponteHistorico.findFirst({
          where: { clienteNome: { equals: nome, mode: 'insensitive' } },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, ok: true, erro: true, total: true },
        });
        let loginEmail: string | null = null;
        let dispositivosLocais = 0;
        if (local) {
          const login = await prisma.clienteLogin.findFirst({
            where: { clienteId: local.id, tipo: 'responsavel' },
            select: { email: true },
          });
          loginEmail = login?.email ?? null;
          dispositivosLocais = await prisma.dispositivo.count({ where: { clienteId: local.id } });
        }
        return {
          nome,
          clienteId: local?.id ?? null,
          telefone: local?.telefone ?? null,
          statusCliente: local?.status ?? null,
          loginEmail,
          dispositivosLocais,
          ultimoReaponte: ultimo,
        };
      }),
    );

    res.json({ ...resultado, clientesLocais: locais });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao consultar o sistema anterior.';
    const status = /não configurada/i.test(msg) ? 503 : 502;
    res.status(status).json({ error: msg });
  }
});

// Reaponta os dispositivos escolhidos (envia o comando — o padrão de troca de
// servidor OU um comando personalizado). Registra o histórico.
// POST /api/integracao/anterior/reapontar
// body: { alvos: [{ id, name?, uniqueId?, status?, cliente? }], comando? }
router.post('/reapontar', async (req: AuthRequest, res: Response) => {
  const alvos = Array.isArray(req.body?.alvos) ? req.body.alvos : [];
  if (!alvos.length) {
    res.status(400).json({ error: 'Nenhum dispositivo informado em alvos.' });
    return;
  }
  const invalido = alvos.find((a: unknown) => !a || typeof (a as { id?: unknown }).id !== 'number');
  if (invalido) {
    res.status(400).json({ error: 'Cada alvo precisa de um id numérico do sistema anterior.' });
    return;
  }
  const comando = typeof req.body?.comando === 'string' && req.body.comando.trim() ? req.body.comando : undefined;

  try {
    const resultado = await reapontarDispositivos(alvos, { comando });

    // Registra um histórico por cliente presente no lote (auditoria + "já reapontado").
    const porCliente = new Map<string, ReaponteItem[]>();
    for (const i of resultado.itens) {
      const chave = i.cliente || '(sem cliente)';
      if (!porCliente.has(chave)) porCliente.set(chave, []);
      porCliente.get(chave)!.push(i);
    }
    for (const [nome, itens] of porCliente) {
      const local = await casarClienteLocal(nome);
      const ok = itens.filter((i) => i.ok).length;
      await prisma.reaponteHistorico.create({
        data: {
          clienteNome: nome,
          clienteId: local?.id ?? null,
          comando: resultado.comando,
          total: itens.length,
          ok,
          erro: itens.length - ok,
          itens: itens as unknown as object[],
          criadoPorId: req.user!.userId,
        },
      });
    }

    res.json(resultado);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao reapontar dispositivos.';
    const status = /não configurada/i.test(msg) ? 503 : 502;
    res.status(status).json({ error: msg });
  }
});

// Baixar a planilha (.xlsx) de um resultado de envio.
// POST /api/integracao/anterior/planilha  body: { itens: ReaponteItem[], clienteNome?, comando? }
router.post('/planilha', async (req: AuthRequest, res: Response) => {
  const itens = Array.isArray(req.body?.itens) ? (req.body.itens as ReaponteItem[]) : [];
  if (!itens.length) {
    res.status(400).json({ error: 'Nada para exportar (itens vazio).' });
    return;
  }
  try {
    const buffer = await gerarPlanilhaReaponte(itens, {
      clienteNome: req.body?.clienteNome,
      comando: req.body?.comando,
    });
    const base = normalizarNome(req.body?.clienteNome || 'reapontamento').replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reaponte_${base || 'resultado'}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Erro ao gerar planilha.' });
  }
});

// Histórico de reapontamentos (auditoria). Opcional filtrar por cliente (nome).
// GET /api/integracao/anterior/historico?cliente=NOME&limite=50
router.get('/historico', async (req: AuthRequest, res: Response) => {
  const cliente = typeof req.query.cliente === 'string' ? req.query.cliente.trim() : '';
  const limite = Math.min(Number(req.query.limite) || 50, 200);
  const registros = await prisma.reaponteHistorico.findMany({
    where: cliente ? { clienteNome: { equals: cliente, mode: 'insensitive' } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limite,
    select: {
      id: true, clienteNome: true, clienteId: true, comando: true,
      total: true, ok: true, erro: true, createdAt: true,
      criadoPor: { select: { nome: true } },
    },
  });
  res.json(registros);
});

// Detalhe de um registro do histórico (com o log item a item, para rever/baixar).
router.get('/historico/:id', async (req: AuthRequest, res: Response) => {
  const registro = await prisma.reaponteHistorico.findUnique({ where: { id: String(req.params.id) } });
  if (!registro) {
    res.status(404).json({ error: 'Registro não encontrado.' });
    return;
  }
  res.json(registro);
});

export default router;
