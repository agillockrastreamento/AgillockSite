import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import {
  integracaoAnteriorConfigurada,
  consultarCliente,
  reapontarDispositivos,
  gerarPlanilhaReaponte,
  listarClientesAnteriores,
  normalizarNome,
  mapaOdometros,
  ReaponteItem,
} from '../services/reaponte-anterior.service';
import { buildTraccarDeviceSyncData, syncTraccarAccumulators } from '../utils/dispositivo-sync';
import { traccarCreateDevice } from '../services/traccar.service';
import { planejarAjuste } from '../utils/normalizar-dispositivo';

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

// Nomes de clientes do sistema anterior (autocomplete do campo de busca).
// GET /api/integracao/anterior/clientes
router.get('/clientes', async (_req: AuthRequest, res: Response) => {
  try {
    const nomes = await listarClientesAnteriores();
    res.json(nomes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao listar clientes do sistema anterior.';
    const status = /não configurada/i.test(msg) ? 503 : 502;
    res.status(status).json({ error: msg });
  }
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

// Importa cliente/dispositivos do sistema anterior para a AgilLock (cadastra o
// que ainda é "Novo"). Cria o Cliente (se não existir aqui, casando por nome) e
// cada Dispositivo cujo IMEI ainda não existe — vinculado ao cliente e
// registrado no Traccar (best-effort, igual ao CRUD normal de dispositivos).
// POST /api/integracao/anterior/importar
// body: { alvos: [{ id, name?, uniqueId, status?, cliente, contact? }], criarClientes? }
router.post('/importar', async (req: AuthRequest, res: Response) => {
  if (req.user!.role === 'COLABORADOR' && !req.user!.podeCriarDispositivo) {
    res.status(403).json({ error: 'Sem permissão para criar dispositivos.' });
    return;
  }
  const alvos = Array.isArray(req.body?.alvos) ? req.body.alvos : [];
  if (!alvos.length) {
    res.status(400).json({ error: 'Nenhum dispositivo informado em alvos.' });
    return;
  }
  const criarClientes = req.body?.criarClientes !== false; // default: cria o cliente se faltar

  // Agrupa os alvos por nome de cliente do sistema antigo.
  const porCliente = new Map<string, typeof alvos>();
  for (const a of alvos) {
    const chave = (a?.cliente && String(a.cliente).trim()) || '(sem cliente)';
    if (!porCliente.has(chave)) porCliente.set(chave, []);
    porCliente.get(chave)!.push(a);
  }

  const resumo = {
    clientesCriados: 0,
    clientesExistentes: 0,
    dispositivosCriados: 0,
    dispositivosVinculados: 0,
    dispositivosExistentes: 0,
    odometrosPreenchidos: 0,
    erros: 0,
    itens: [] as Array<{ imei: string | null; nome: string | null; cliente: string; status: string; detalhe?: string }>,
  };

  // Odômetro (km) de cada dispositivo do sistema anterior (metros), p/ trazer junto.
  const odom = await mapaOdometros().catch(() => new Map<number, number>());
  const odometroMetrosDe = (id: unknown): number | null => {
    const m = typeof id === 'number' ? odom.get(id) : undefined;
    return typeof m === 'number' ? Math.round(m) : null;
  };

  try {
    for (const [nome, itens] of porCliente) {
      // 1) Cliente: casa pelo nome; cria se não existir aqui (e for permitido).
      let local = await casarClienteLocal(nome);
      if (!local) {
        if (!criarClientes) {
          for (const a of itens) {
            resumo.itens.push({ imei: a.uniqueId ?? null, nome: a.name ?? null, cliente: nome, status: 'ignorado', detalhe: 'Cliente sem cadastro aqui.' });
          }
          continue;
        }
        const criado = await prisma.cliente.create({
          data: { nome: nome === '(sem cliente)' ? 'Cliente sem nome' : nome, criadoPorId: req.user!.userId },
          select: { id: true, nome: true, telefone: true, status: true },
        });
        local = criado;
        resumo.clientesCriados++;
      } else {
        resumo.clientesExistentes++;
      }

      // 2) Dispositivos: cria os que ainda não existem; vincula os órfãos.
      for (const a of itens) {
        const identificador = a?.uniqueId ? String(a.uniqueId).trim() : '';
        if (!identificador) {
          resumo.erros++;
          resumo.itens.push({ imei: null, nome: a?.name ?? null, cliente: nome, status: 'erro', detalhe: 'Dispositivo sem IMEI.' });
          continue;
        }

        const odomMetros = odometroMetrosDe(a?.id);

        const existente = await prisma.dispositivo.findUnique({
          where: { identificador },
          select: { id: true, clienteId: true, odometroSistemaMetros: true, traccarId: true },
        });

        if (existente) {
          // Já existe: se estiver sem dono, vincula a este cliente; senão só reporta.
          if (!existente.clienteId) {
            await prisma.dispositivo.update({ where: { id: existente.id }, data: { clienteId: local.id } });
            resumo.dispositivosVinculados++;
            resumo.itens.push({ imei: identificador, nome: a?.name ?? null, cliente: nome, status: 'vinculado', detalhe: 'IMEI já existia; vinculado ao cliente.' });
          } else {
            resumo.dispositivosExistentes++;
            resumo.itens.push({ imei: identificador, nome: a?.name ?? null, cliente: nome, status: 'existente', detalhe: 'IMEI já cadastrado.' });
          }
          // Preenche o km (odômetro) se ainda estiver vazio aqui — traz do sistema anterior.
          if (existente.odometroSistemaMetros == null && odomMetros != null) {
            await prisma.dispositivo.update({ where: { id: existente.id }, data: { odometroSistemaMetros: odomMetros } });
            resumo.odometrosPreenchidos++;
            if (existente.traccarId != null) {
              syncTraccarAccumulators(existente.traccarId, { odometroSistemaMetros: odomMetros })
                .catch((err) => console.error('[Traccar] Falha ao sincronizar odômetro:', err.message));
            }
          }
          continue;
        }

        // Novo: cadastra o dispositivo já no padrão do sistema atual
        // (categoria pt-BR, nome sem placa, placa/marca/modelo separados) —
        // mesma normalização do ajuste em lote (utils/normalizar-dispositivo).
        const catAnterior = a?.category ?? a?.categoria ?? 'car';
        const norm = planejarAjuste({
          identificador,
          nome: a?.name ?? null,
          categoria: catAnterior ? String(catAnterior) : 'car',
          placa: null,
          marca: null,
          modeloVeiculo: null,
        }).depois;
        const dispositivo = await prisma.dispositivo.create({
          data: {
            nome: norm.nome || identificador,
            identificador,
            categoria: norm.categoria || 'carro',
            contato: a?.contact ? String(a.contact) : null,
            placa: norm.placa,
            marca: norm.marca,
            modeloVeiculo: norm.modeloVeiculo,
            odometroSistemaMetros: odomMetros, // km trazido do sistema anterior
            clienteId: local.id,
            criadoPorId: req.user!.userId,
          },
        });
        resumo.dispositivosCriados++;
        if (odomMetros != null) resumo.odometrosPreenchidos++;
        resumo.itens.push({ imei: identificador, nome: dispositivo.nome, cliente: nome, status: 'criado' });

        // Traccar (best-effort — não bloqueia a importação).
        traccarCreateDevice(buildTraccarDeviceSyncData(dispositivo))
          .then((td) => syncTraccarAccumulators(td.id, dispositivo))
          .catch((err) => console.error('[Traccar] Falha ao criar dispositivo importado:', err.message));
      }
    }

    res.json(resumo);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Erro ao importar do sistema anterior.' });
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

// Baixar a planilha (.xlsx) de um registro do histórico (rever item a item com cores).
// GET /api/integracao/anterior/historico/:id/planilha
router.get('/historico/:id/planilha', async (req: AuthRequest, res: Response) => {
  const registro = await prisma.reaponteHistorico.findUnique({ where: { id: String(req.params.id) } });
  if (!registro) {
    res.status(404).json({ error: 'Registro não encontrado.' });
    return;
  }
  const itens = Array.isArray(registro.itens) ? (registro.itens as unknown as ReaponteItem[]) : [];
  if (!itens.length) {
    res.status(400).json({ error: 'Este registro não tem itens para exportar.' });
    return;
  }
  try {
    const buffer = await gerarPlanilhaReaponte(itens, {
      clienteNome: registro.clienteNome,
      comando: registro.comando,
    });
    const data = registro.createdAt.toISOString().slice(0, 10);
    const base = normalizarNome(registro.clienteNome || 'reapontamento').replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reaponte_${base || 'resultado'}_${data}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Erro ao gerar planilha.' });
  }
});

export default router;
