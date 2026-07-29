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
  listarUsuariosAnteriores,
  detalharClienteAnterior,
  excluirDispositivoAnterior,
  excluirMotoristaAnterior,
  excluirGeocercaAnterior,
  excluirUsuarioAnterior,
  invalidarCacheAnterior,
  ExclusaoItem,
} from '../services/reaponte-anterior.service';
import { buildTraccarDeviceSyncData, syncTraccarAccumulators } from '../utils/dispositivo-sync';
import { traccarCreateDevice, traccarGetDevices } from '../services/traccar.service';
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

// ─── Limpeza: apagar dados do sistema anterior ──────────────────────────────
// Depois que os rastreadores de um cliente já estão reportando para a AgilLock,
// o cadastro dele continua ocupando espaço no painel antigo. Esta parte da tela
// apaga esses dados LÁ — de forma irreversível — com uma trava dura: só sai o
// dispositivo que já foi apontado para cá (existe aqui E já mandou posição).

const MODOS_LIMPEZA = [
  'dispositivos',
  'cliente_dispositivos',
  'cliente_dispositivos_motoristas',
  'motoristas',
  'tudo',
] as const;
type ModoLimpeza = (typeof MODOS_LIMPEZA)[number];

/** Modos que apagam dispositivos (e por isso passam pela trava do "apontado"). */
const MODOS_COM_DISPOSITIVOS: ModoLimpeza[] = ['dispositivos', 'cliente_dispositivos', 'cliente_dispositivos_motoristas', 'tudo'];
/** Modos que apagam a própria conta do cliente no sistema anterior. */
const MODOS_COM_CLIENTE: ModoLimpeza[] = ['cliente_dispositivos', 'cliente_dispositivos_motoristas', 'tudo'];
/** Modos que apagam motoristas. */
const MODOS_COM_MOTORISTAS: ModoLimpeza[] = ['motoristas', 'cliente_dispositivos_motoristas', 'tudo'];

const JANELA_HORAS_PADRAO = 48;

interface DispositivoLimpeza {
  id: number;
  nome: string | null;
  uniqueId: string | null;
  statusAntigo: string | null;
  ultimaAtualizacaoAntiga: string | null;
  existeAqui: boolean;
  dispositivoLocalId: string | null;
  ultimaAtualizacaoNova: string | null;
  sinalNovo: boolean;   // já está mandando posição para a AgilLock
  sinalAntigo: boolean; // ainda está mandando posição para o sistema antigo
  apontado: boolean;    // liberado para excluir lá
  motivo: string | null; // por que NÃO pode ser excluído
}

/**
 * Monta a foto do cliente no sistema anterior cruzada com o cadastro daqui.
 * `janelaHoras` define o que conta como "está enviando sinal" nos dois lados.
 */
async function montarLimpeza(userId: number, janelaHoras: number) {
  const detalhe = await detalharClienteAnterior(userId);
  const corte = Date.now() - janelaHoras * 3600_000;
  const recente = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= corte;
  };

  // Cadastro daqui (casa pelo nome da conta antiga).
  const clienteLocal = await casarClienteLocal(detalhe.usuario.name);

  // Dispositivos daqui com os IMEIs do sistema anterior.
  const imeis = detalhe.dispositivos.map((d) => d.uniqueId).filter((v): v is string => !!v);
  const locais = imeis.length
    ? await prisma.dispositivo.findMany({
        where: { identificador: { in: imeis } },
        select: { id: true, identificador: true, traccarId: true, telemetriaUltimaPosicaoEm: true },
      })
    : [];
  const porImei = new Map(locais.map((d) => [d.identificador, d]));

  // Último contato no NOSSO Traccar (fonte mais confiável que a telemetria salva).
  const nossoTraccar = new Map<string, string>();
  try {
    for (const d of await traccarGetDevices()) {
      if (d.uniqueId && d.lastUpdate) nossoTraccar.set(d.uniqueId, d.lastUpdate);
    }
  } catch {
    // sem Traccar, cai para telemetriaUltimaPosicaoEm
  }

  const dispositivos: DispositivoLimpeza[] = detalhe.dispositivos.map((d) => {
    const local = d.uniqueId ? porImei.get(d.uniqueId) : undefined;
    const ultimaNova =
      (d.uniqueId ? nossoTraccar.get(d.uniqueId) : undefined) ??
      (local?.telemetriaUltimaPosicaoEm ? local.telemetriaUltimaPosicaoEm.toISOString() : null);
    const existeAqui = !!local;
    const sinalNovo = existeAqui && recente(ultimaNova);
    const apontado = existeAqui && sinalNovo;
    return {
      id: d.id,
      nome: d.name,
      uniqueId: d.uniqueId,
      statusAntigo: d.status,
      ultimaAtualizacaoAntiga: d.lastUpdate,
      existeAqui,
      dispositivoLocalId: local?.id ?? null,
      ultimaAtualizacaoNova: ultimaNova ?? null,
      sinalNovo,
      sinalAntigo: recente(d.lastUpdate),
      apontado,
      motivo: apontado
        ? null
        : !existeAqui
          ? 'Ainda não foi trazido para a AgilLock (IMEI não cadastrado aqui).'
          : `Cadastrado aqui, mas sem posição na AgilLock nas últimas ${janelaHoras}h — não foi apontado.`,
    };
  });

  // Dispositivos que o cliente já tem aqui e não existem mais no sistema antigo.
  const dispositivosSoAqui = clienteLocal
    ? await prisma.dispositivo.findMany({
        where: { clienteId: clienteLocal.id, identificador: { notIn: imeis.length ? imeis : ['—'] } },
        select: { id: true, nome: true, identificador: true, placa: true },
        orderBy: { nome: 'asc' },
      })
    : [];

  const jaNoNovo = dispositivos.filter((d) => d.existeAqui).length;
  const contadores = {
    anteriorTotal: dispositivos.length,
    jaNoNovo,
    faltamNoNovo: dispositivos.length - jaNoNovo,
    sinalNovo: dispositivos.filter((d) => d.sinalNovo).length,
    sinalAntigo: dispositivos.filter((d) => d.sinalAntigo).length,
    semSinalNenhum: dispositivos.filter((d) => !d.sinalNovo && !d.sinalAntigo).length,
    liberadosParaExcluir: dispositivos.filter((d) => d.apontado).length,
    bloqueados: dispositivos.filter((d) => !d.apontado).length,
    soAqui: dispositivosSoAqui.length,
    motoristas: detalhe.motoristas.length,
    geocercas: detalhe.geocercas.length,
  };

  return {
    usuario: detalhe.usuario,
    janelaHoras,
    clienteLocal: clienteLocal
      ? { id: clienteLocal.id, nome: clienteLocal.nome, telefone: clienteLocal.telefone, status: clienteLocal.status }
      : null,
    contadores,
    dispositivos,
    dispositivosSoAqui,
    motoristas: detalhe.motoristas,
    geocercas: detalhe.geocercas,
  };
}

// Contas do sistema anterior (alimenta o select com busca da aba de limpeza).
// GET /api/integracao/anterior/limpeza/clientes
router.get('/limpeza/clientes', async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await listarUsuariosAnteriores());
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao listar contas do sistema anterior.';
    res.status(/não configurada/i.test(msg) ? 503 : 502).json({ error: msg });
  }
});

// Foto do cliente nos dois sistemas (contadores + listas).
// GET /api/integracao/anterior/limpeza/detalhe?userId=123&horas=48
router.get('/limpeza/detalhe', async (req: AuthRequest, res: Response) => {
  const userId = Number(req.query.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: 'Informe o userId da conta no sistema anterior.' });
    return;
  }
  const horas = req.query.horas !== undefined ? Number(req.query.horas) : JANELA_HORAS_PADRAO;
  if (!Number.isFinite(horas) || horas <= 0 || horas > 24 * 90) {
    res.status(400).json({ error: 'Parâmetro horas inválido (1 a 2160).' });
    return;
  }
  try {
    res.json(await montarLimpeza(userId, horas));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao consultar o sistema anterior.';
    const status = /não configurada/i.test(msg) ? 503 : /não encontrada/i.test(msg) ? 404 : 502;
    res.status(status).json({ error: msg });
  }
});

// Executa a exclusão no sistema anterior (IRREVERSÍVEL — só ADMIN).
// POST /api/integracao/anterior/limpeza/executar
// body: { userId, modo, deviceIds?, driverIds?, horas?, confirmacao: 'EXCLUIR' }
router.post('/limpeza/executar', async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'ADMIN') {
    res.status(403).json({ error: 'Somente ADMIN pode apagar dados do sistema anterior.' });
    return;
  }
  if (String(req.body?.confirmacao || '').trim().toUpperCase() !== 'EXCLUIR') {
    res.status(400).json({ error: 'Confirmação inválida — digite EXCLUIR para confirmar.' });
    return;
  }
  const userId = Number(req.body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: 'Informe o userId da conta no sistema anterior.' });
    return;
  }
  const modo = String(req.body?.modo || '') as ModoLimpeza;
  if (!MODOS_LIMPEZA.includes(modo)) {
    res.status(400).json({ error: 'Modo de exclusão inválido.' });
    return;
  }
  const horas = req.body?.horas !== undefined ? Number(req.body.horas) : JANELA_HORAS_PADRAO;
  if (!Number.isFinite(horas) || horas <= 0 || horas > 24 * 90) {
    res.status(400).json({ error: 'Parâmetro horas inválido (1 a 2160).' });
    return;
  }

  try {
    // Refaz a foto no servidor — a trava nunca depende do que veio do navegador.
    const foto = await montarLimpeza(userId, horas);

    // 1) Quais dispositivos entram nesta operação.
    let dispositivosAlvo: DispositivoLimpeza[] = [];
    if (MODOS_COM_DISPOSITIVOS.includes(modo)) {
      if (modo === 'dispositivos') {
        const escolhidos = new Set(
          (Array.isArray(req.body?.deviceIds) ? req.body.deviceIds : []).map((x: unknown) => Number(x)),
        );
        if (!escolhidos.size) {
          res.status(400).json({ error: 'Selecione ao menos um dispositivo para excluir.' });
          return;
        }
        dispositivosAlvo = foto.dispositivos.filter((d) => escolhidos.has(d.id));
        const desconhecidos = [...escolhidos].filter((id) => !foto.dispositivos.some((d) => d.id === id));
        if (desconhecidos.length) {
          res.status(400).json({ error: `Dispositivo(s) fora desta conta: ${desconhecidos.join(', ')}.` });
          return;
        }
      } else {
        dispositivosAlvo = foto.dispositivos;
      }

      // TRAVA: nada que não tenha sido apontado para a AgilLock é apagado lá.
      const bloqueados = dispositivosAlvo.filter((d) => !d.apontado);
      if (bloqueados.length) {
        res.status(409).json({
          error:
            `${bloqueados.length} dispositivo(s) ainda não foram apontados para a AgilLock. ` +
            'Reaponte-os (ou tire-os da seleção) antes de excluir.',
          bloqueados: bloqueados.map((d) => ({ id: d.id, nome: d.nome, uniqueId: d.uniqueId, motivo: d.motivo })),
        });
        return;
      }
    }

    // 2) Quais motoristas entram.
    let motoristasAlvo = MODOS_COM_MOTORISTAS.includes(modo) ? foto.motoristas : [];
    if (motoristasAlvo.length && Array.isArray(req.body?.driverIds)) {
      const escolhidos = new Set(req.body.driverIds.map((x: unknown) => Number(x)));
      motoristasAlvo = motoristasAlvo.filter((m) => escolhidos.has(m.id));
    }

    // 3) Executa na ordem segura: dispositivos → motoristas → geocercas → conta.
    const itens: ExclusaoItem[] = [];
    for (const d of dispositivosAlvo) {
      itens.push(await excluirDispositivoAnterior(d.id, d.nome, d.uniqueId));
    }
    for (const m of motoristasAlvo) {
      itens.push(await excluirMotoristaAnterior(m.id, m.name, m.uniqueId));
    }
    if (modo === 'tudo') {
      for (const g of foto.geocercas) {
        itens.push(await excluirGeocercaAnterior(g.id, g.name));
      }
    }

    // A conta só cai se tudo o que dependia dela saiu — senão sobra órfão lá.
    let usuarioExcluido = false;
    const falhasAntes = itens.filter((i) => !i.ok).length;
    if (MODOS_COM_CLIENTE.includes(modo)) {
      if (falhasAntes) {
        itens.push({
          tipo: 'cliente',
          id: foto.usuario.id,
          nome: foto.usuario.name,
          uniqueId: null,
          ok: false,
          http: null,
          resp: 'Conta mantida: houve falha ao excluir itens dela.',
        });
      } else {
        const r = await excluirUsuarioAnterior(foto.usuario.id, foto.usuario.name);
        itens.push(r);
        usuarioExcluido = r.ok;
      }
    }

    invalidarCacheAnterior();

    const resumo = {
      modo,
      usuario: foto.usuario,
      dispositivos: itens.filter((i) => i.tipo === 'dispositivo' && i.ok).length,
      motoristas: itens.filter((i) => i.tipo === 'motorista' && i.ok).length,
      geocercas: itens.filter((i) => i.tipo === 'geocerca' && i.ok).length,
      usuarioExcluido,
      erro: itens.filter((i) => !i.ok).length,
      total: itens.length,
      itens,
    };

    await prisma.limpezaAnteriorHistorico.create({
      data: {
        usuarioAnteriorId: foto.usuario.id,
        clienteNome: foto.usuario.name,
        clienteId: foto.clienteLocal?.id ?? null,
        modo,
        dispositivos: resumo.dispositivos,
        motoristas: resumo.motoristas,
        geocercas: resumo.geocercas,
        usuarioExcluido,
        erro: resumo.erro,
        itens: itens as unknown as object[],
        criadoPorId: req.user!.userId,
      },
    });

    res.json(resumo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao apagar dados do sistema anterior.';
    const status = /não configurada/i.test(msg) ? 503 : /não encontrada/i.test(msg) ? 404 : 502;
    res.status(status).json({ error: msg });
  }
});

// Histórico das exclusões feitas no sistema anterior (auditoria).
// GET /api/integracao/anterior/limpeza/historico?limite=50
router.get('/limpeza/historico', async (req: AuthRequest, res: Response) => {
  const limite = Math.min(Number(req.query.limite) || 50, 200);
  const registros = await prisma.limpezaAnteriorHistorico.findMany({
    orderBy: { createdAt: 'desc' },
    take: limite,
    select: {
      id: true, clienteNome: true, usuarioAnteriorId: true, modo: true,
      dispositivos: true, motoristas: true, geocercas: true,
      usuarioExcluido: true, erro: true, createdAt: true,
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
