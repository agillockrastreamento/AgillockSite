import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireMonitoramentoAccess, requireRoles } from '../middleware/roles.middleware';
import { param, query } from '../utils/params';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import {
  traccarGetDevices,
  traccarGetDeviceByImei,
  traccarGetPositions,
  traccarGetPositionHistory,
  traccarGetTrips,
  traccarGetStops,
  traccarGetEvents,
  traccarGetSummary,
  traccarSendCommand,
  traccarUpdateDeviceAccumulators,
  traccarGetCommandTypes,
  traccarGetGeofences,
  traccarCreateGeofence,
  traccarUpdateGeofence,
  traccarDeleteGeofence,
  traccarLinkGeofenceToDevice,
  traccarUnlinkGeofenceFromDevice,
  traccarGetServerLog,
  normalizeAttributes,
  cartaoDaPosicao,
  EVENT_TYPE_LABELS,
} from '../services/traccar.service';
import {
  coletarDadosRelatorio,
  gerarRelatorioXlsx,
  gerarRelatorioPdf,
  TipoRelatorio,
} from '../services/relatorio-export.service';
import {
  DISPOSITIVO_MEDIDORES_SELECT,
  sincronizarDispositivosComPosicoes,
  decorarPosicaoComMedidores,
  aplicarResumoComMedidores,
  aplicarViagensComMedidores,
  aplicarParadasComMedidores,
  calcularOciosidade,
  reancorarRecorrenciasSeOdometroMenor,
} from '../services/medidores.service';
import {
  carregarResolvedorMotoristas,
  cartaoDaViagem,
  cartaoAntesDe,
} from '../services/motoristas.service';
import { reverseGeocode } from '../utils/reverse-geocode';

const router = Router();
router.use(authMiddleware);
router.use(requireMonitoramentoAccess);

function parseDataInicioSaoPaulo(dataInicio?: string): Date | null {
  if (!dataInicio) return null;
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(dataInicio) ? dataInicio : `${dataInicio}:00-03:00`);
}

type RelatorioPosicaoBasica = {
  id: number;
  deviceId: number;
  fixTime: string;
  latitude: number;
  longitude: number;
  address: string | null;
};

function posicaoMaisProxima(
  posicoes: RelatorioPosicaoBasica[],
  deviceId: number,
  iso?: string | null,
): RelatorioPosicaoBasica | null {
  if (!iso) return null;
  const alvo = new Date(iso).getTime();
  if (!Number.isFinite(alvo)) return null;
  let melhor: RelatorioPosicaoBasica | null = null;
  let menorDelta = Number.POSITIVE_INFINITY;
  for (const posicao of posicoes) {
    if (posicao.deviceId !== deviceId) continue;
    const tempo = new Date(posicao.fixTime).getTime();
    if (!Number.isFinite(tempo)) continue;
    const delta = Math.abs(tempo - alvo);
    if (delta < menorDelta) {
      melhor = posicao;
      menorDelta = delta;
    }
  }
  return melhor;
}

function temEndereco(valor?: string | null): valor is string {
  return !!(valor && valor.trim() && valor.trim() !== '0.00000, 0.00000');
}

function parseDeviceIdsParam(deviceIds: string[] | string): number[] {
  const valores = Array.isArray(deviceIds) ? deviceIds : [deviceIds];
  return valores
    .flatMap(valor => String(valor).split(','))
    .map(valor => Number(valor.trim()))
    .filter(id => Number.isInteger(id) && id > 0);
}

async function responderReverseGeocode(req: AuthRequest, res: Response): Promise<void> {
  const lat = Number(query(req.query.lat));
  const lon = Number(query(req.query.lon));
  try {
    const endereco = await reverseGeocode(lat, lon);
    res.json({ endereco });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
}

// ── GET /api/rastreamento/posicoes ────────────────────────────────────────────
// Snapshot inicial: todos os dispositivos ativos com última posição conhecida.
// Após esse carregamento inicial, o frontend recebe atualizações via WebSocket.
router.get('/geocode/reverse', requireRoles('ADMIN', 'COLABORADOR'), responderReverseGeocode);

router.get('/posicoes', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  // Prisma e Traccar em paralelo — economiza uma viagem de rede
  const [dispoResult, traccarResult] = await Promise.allSettled([
    prisma.dispositivo.findMany({
      where: { ativo: true },
      select: {
        id: true, nome: true, identificador: true, placa: true,
        categoria: true, marca: true, modeloVeiculo: true, cor: true, limiteVelocidade: true, imagemUrl: true,
        telefoneRastreador: true, operadora: true, mapa: true,
        ...DISPOSITIVO_MEDIDORES_SELECT,
        cliente: { select: { id: true, nome: true, logins: { where: { tipo: 'responsavel', ativo: true }, select: { id: true }, take: 1 } } },
        motoristasVinculados: {
          include: { motorista: { select: { id: true, nome: true } } }
        },
      },
    }),
    traccarGetDevices(),
  ]);

  if (dispoResult.status === 'rejected') {
    res.status(500).json({ error: 'Erro ao buscar dispositivos.' });
    return;
  }
  const dispositivos = dispoResult.value;
  if (!dispositivos.length) { res.json([]); return; }

  if (traccarResult.status === 'rejected') {
    res.status(502).json({ error: 'Servidor de rastreamento indisponível.' });
    return;
  }
  const traccarDevices = traccarResult.value;

  const traccarByImei = new Map(traccarDevices.map(d => [d.uniqueId, d]));

  // Busca TODAS as posições (sem filtro por deviceId) para capturar
  // a última localização conhecida mesmo de dispositivos offline.
  let posicoes: Awaited<ReturnType<typeof traccarGetPositions>> = [];
  try { posicoes = await traccarGetPositions(); } catch { /* sem posições */ }

  const posicaoPorDeviceId = new Map(posicoes.map(p => [p.deviceId, p]));
  const posicaoPorIdentificador = new Map<string, Awaited<ReturnType<typeof traccarGetPositions>>[number]>();
  for (const dispositivo of dispositivos) {
    const traccar = traccarByImei.get(dispositivo.identificador);
    const posicao = traccar ? posicaoPorDeviceId.get(traccar.id) : undefined;
    if (posicao) posicaoPorIdentificador.set(dispositivo.identificador, posicao);
  }
  const estadosAtualizados = await sincronizarDispositivosComPosicoes(dispositivos, posicaoPorIdentificador);
  const resolverMotorista = await carregarResolvedorMotoristas();

  const resultado = dispositivos.map(d => {
    const traccar = traccarByImei.get(d.identificador);
    const posicao = traccar ? posicaoPorDeviceId.get(traccar.id) : undefined;
    const estado = estadosAtualizados.get(d.identificador) ?? d;
    // Prioriza o motorista que passou o cartão RFID (última posição); só cai no
    // primeiro vínculo do veículo quando não há leitura de cartão identificada.
    const motoristaVinculado = d.motoristasVinculados && d.motoristasVinculados.length > 0 ? d.motoristasVinculados[0].motorista : null;
    const motorista = resolverMotorista(cartaoDaPosicao(posicao?.attributes)?.cartao) ?? motoristaVinculado;

    return {
      dispositivoId: d.id,
      nome: d.nome,
      placa: d.placa,
      identificador: d.identificador,
      categoria: d.categoria,
      imagemUrl: d.imagemUrl,
      marca: d.marca,
      modeloVeiculo: d.modeloVeiculo,
      cor: d.cor,
      telefoneRastreador: d.telefoneRastreador,
      operadora: d.operadora,
      limiteVelocidade: d.limiteVelocidade,
      mapa: d.mapa,
      cliente: d.cliente ? { id: d.cliente.id, nome: d.cliente.nome } : null,
      clienteLoginId: d.cliente?.logins?.[0]?.id ?? null,
      motorista: motorista,
      traccarId: traccar?.id ?? null,
      status: traccar?.status ?? 'unknown',
      lastUpdate: traccar?.lastUpdate ?? null,
      posicao: posicao ? decorarPosicaoComMedidores(estado, posicao) : null,
    };
  });

  res.json(resultado);
});

// ── GET /api/rastreamento/dispositivos/:id/historico ──────────────────────────
router.get('/dispositivos/:id/historico', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, nome: true, identificador: true, placa: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const historico = await traccarGetPositionHistory([traccarDevice.id], fromDate, toDate);

  // Segmentos ociosos (motor ligado + parado) para marcar os pontos no mapa do histórico.
  const ociosos = calcularOciosidade(historico).segmentos.map(s => ({
    deviceId: traccarDevice.id,
    inicio: s.inicio,
    fim: s.fim,
    latitude: s.latitude,
    longitude: s.longitude,
    duracaoMin: Math.round(s.duracaoMs / 60000),
  }));

  res.json({
    dispositivo: { id: dispositivo.id, nome: dispositivo.nome, placa: dispositivo.placa },
    total: historico.length,
    posicoes: historico.map(p => decorarPosicaoComMedidores(dispositivo, p)),
    ociosos,
  });
});

// ── GET /api/rastreamento/dispositivos/:id/viagens ────────────────────────────
router.get('/dispositivos/:id/viagens', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, nome: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const viagens = await traccarGetTrips([traccarDevice.id], fromDate, toDate);
  const historico = await traccarGetPositionHistory([traccarDevice.id], fromDate, toDate).catch(() => []);
  const viagensComMedidores = aplicarViagensComMedidores(dispositivo, viagens, historico);
  const resolverMotorista = await carregarResolvedorMotoristas();

  res.json(viagensComMedidores.map(v => {
    const driverId = cartaoDaViagem(v, historico);
    return {
      inicio: v.startTime,
      fim: v.endTime,
      origem: v.startAddress,
      destino: v.endAddress,
      origemLat: v.startLat,
      origemLng: v.startLon,
      destinoLat: v.endLat,
      destinoLng: v.endLon,
      distancia: Math.round(v.distance / 100) / 10,
      velocidadeMedia: Math.round(v.averageSpeed * 1.852),
      velocidadeMaxima: Math.round(v.maxSpeed * 1.852),
      duracao: Math.round(v.duration / 60000),
      motorista: resolverMotorista(driverId),
      motorista_id: driverId,
    };
  }));
});

// ── GET /api/rastreamento/dispositivos/:id/paradas ────────────────────────────
router.get('/dispositivos/:id/paradas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, nome: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const paradas = await traccarGetStops([traccarDevice.id], fromDate, toDate);
  const historico = await traccarGetPositionHistory([traccarDevice.id], fromDate, toDate).catch(() => []);
  const paradasComMedidores = aplicarParadasComMedidores(paradas, historico);
  const historicoPorId = new Map(historico.map(p => [p.id, p]));

  res.json(paradasComMedidores.map(p => {
    const posicao = historicoPorId.get(p.positionId)
      || posicaoMaisProxima(historico, traccarDevice.id, p.startTime)
      || posicaoMaisProxima(historico, traccarDevice.id, p.endTime);
    return {
      inicio: p.startTime,
      fim: p.endTime,
      endereco: temEndereco(p.address) ? p.address : posicao?.address || null,
      latitude: p.lat || posicao?.latitude || 0,
      longitude: p.lon || posicao?.longitude || 0,
      duracao: Math.round(p.duration / 60000),
      horasMotor: Math.round((p.engineHours || 0) / 3600000 * 10) / 10,
    };
  }));
});

// ── GET /api/rastreamento/dispositivos/:id/eventos ────────────────────────────
router.get('/dispositivos/:id/eventos', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, nome: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const eventos = await traccarGetEvents([traccarDevice.id], fromDate, toDate);


  res.json(eventos.map(e => ({
    id: e.id,
    tipo: e.type,
    tipoLabel: EVENT_TYPE_LABELS[e.type] ?? e.type,
    hora: e.eventTime,
    atributos: e.attributes,
  })));
});

// ── GET /api/rastreamento/dispositivos/:id/resumo ─────────────────────────────
router.get('/dispositivos/:id/resumo', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, nome: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const resumos = await traccarGetSummary([traccarDevice.id], fromDate, toDate);
  const historico = await traccarGetPositionHistory([traccarDevice.id], fromDate, toDate).catch(() => []);

  if (!resumos.length) { res.json(null); return; }
  const r = aplicarResumoComMedidores(dispositivo, resumos[0], historico);
  res.json({
    distancia: Math.round(r.distance / 100) / 10,
    velocidadeMedia: Math.round(r.averageSpeed * 1.852),
    velocidadeMaxima: Math.round(r.maxSpeed * 1.852),
    horasMotor: Math.round((r.engineHours || 0) / 3600000 * 10) / 10,
  });
});

// ── GET /api/rastreamento/dispositivos/:id/ocioso ─────────────────────────────
// Tempo de motor ocioso (ligado com o veículo parado) no período.
router.get('/dispositivos/:id/ocioso', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const historico = await traccarGetPositionHistory([traccarDevice.id], fromDate, toDate).catch(() => []);
  const { totalMs, segmentos } = calcularOciosidade(historico);

  res.json({
    totalMinutos: Math.round(totalMs / 60000),
    segmentos: segmentos.map(s => ({
      inicio: s.inicio,
      fim: s.fim,
      latitude: s.latitude,
      longitude: s.longitude,
      duracaoMin: Math.round(s.duracaoMs / 60000),
    })),
  });
});

// ── GET /api/rastreamento/dispositivos/:id/tipos-comandos ─────────────────────
router.get('/dispositivos/:id/tipos-comandos', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado.' }); return; }

  try {
    const tipos = await traccarGetCommandTypes(traccarDevice.id);
    res.json(tipos);
  } catch {
    res.json([]); // retorna vazio se Traccar não suportar
  }
});

// ── POST /api/rastreamento/dispositivos/:id/comandos ──────────────────────────
router.post('/dispositivos/:id/comandos', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { tipo, atributos } = req.body as { tipo: string; atributos?: Record<string, unknown> };

  if (!tipo) { res.status(400).json({ error: 'Campo "tipo" é obrigatório.' }); return; }

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado.' }); return; }

  try {
    await traccarSendCommand(traccarDevice.id, tipo, atributos || {});
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao enviar comando: ${msg}` });
  }
});

// ── POST /api/rastreamento/comandos/lote ──────────────────────────────────────
// Envia o mesmo comando para vários dispositivos de uma vez.
// Retorna um resultado por dispositivo (ok/erro) — sucesso parcial é normal.
router.post('/comandos/lote', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { dispositivoIds, tipo, atributos } = req.body as {
    dispositivoIds: string[]; tipo: string; atributos?: Record<string, unknown>;
  };

  if (!tipo) { res.status(400).json({ error: 'Campo "tipo" é obrigatório.' }); return; }
  if (!Array.isArray(dispositivoIds) || dispositivoIds.length === 0) {
    res.status(400).json({ error: 'Informe ao menos um dispositivo.' });
    return;
  }

  const dispositivos = await prisma.dispositivo.findMany({
    where: { id: { in: dispositivoIds } },
    select: { id: true, nome: true, placa: true, identificador: true },
  });

  // Uma única busca de dispositivos no Traccar para mapear IMEI → traccarId,
  // evitando uma requisição por dispositivo.
  const traccarDevices = await traccarGetDevices().catch(() => null);
  if (!traccarDevices) { res.status(502).json({ error: 'Servidor de rastreamento indisponível.' }); return; }
  const traccarByImei = new Map(traccarDevices.map(d => [d.uniqueId, d]));

  const nomeDispositivo = (d: { nome: string; placa: string | null }) =>
    d.nome + (d.placa ? ` (${d.placa})` : '');

  type ResultadoLote = { dispositivoId: string; nome: string; ok: boolean; erro?: string };

  async function enviarUm(d: typeof dispositivos[number]): Promise<ResultadoLote> {
    const nome = nomeDispositivo(d);
    const td = traccarByImei.get(d.identificador);
    if (!td) return { dispositivoId: d.id, nome, ok: false, erro: 'Não sincronizado com o rastreador.' };
    try {
      await traccarSendCommand(td.id, tipo, atributos || {});
      return { dispositivoId: d.id, nome, ok: true };
    } catch (err: unknown) {
      return { dispositivoId: d.id, nome, ok: false, erro: err instanceof Error ? err.message : String(err) };
    }
  }

  // Envia em blocos para não disparar centenas de requisições simultâneas ao Traccar.
  const LOTE = 10;
  const resultados: ResultadoLote[] = [];
  for (let i = 0; i < dispositivos.length; i += LOTE) {
    const bloco = dispositivos.slice(i, i + LOTE);
    resultados.push(...await Promise.all(bloco.map(enviarUm)));
  }

  res.json({
    total: resultados.length,
    sucesso: resultados.filter(r => r.ok).length,
    falha: resultados.filter(r => !r.ok).length,
    resultados,
  });
});

// ── GET /api/rastreamento/dispositivos/:id/detalhe ────────────────────────────
router.patch('/dispositivos/:id/medidores', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { odometro, horimetro } = req.body as { odometro?: number | null; horimetro?: number | null };

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (traccarDevice) {
    try {
      const posicoes = await traccarGetPositions([traccarDevice.id]);
      const atual = posicoes[0];
      if (atual) {
        const atualizados = await sincronizarDispositivosComPosicoes([dispositivo], new Map([[dispositivo.identificador, atual]]));
        Object.assign(dispositivo, atualizados.get(dispositivo.identificador) ?? dispositivo);
      }
    } catch {
      // mantém o estado persistido
    }
  }

  const data: Record<string, unknown> = {};
  if (odometro !== undefined) {
    data.odometroSistemaMetros = odometro == null ? null : Math.round(Number(odometro) * 1000);
  }
  if (horimetro !== undefined) {
    data.horimetroSistemaSegundos = horimetro == null ? 0 : Math.max(0, Math.round(Number(horimetro) * 3600));
  }

  const atualizado = await prisma.dispositivo.update({
    where: { id },
    data,
    select: {
      id: true,
      odometroSistemaMetros: true,
      horimetroSistemaSegundos: true,
    },
  });

  // Se o odômetro foi corrigido para baixo, re-ancora as recorrências para não
  // exibirem "km percorrido" negativo.
  if (odometro !== undefined) {
    await reancorarRecorrenciasSeOdometroMenor(id, atualizado.odometroSistemaMetros);
  }

  if (traccarDevice && atualizado.odometroSistemaMetros != null) {
    traccarUpdateDeviceAccumulators(
      traccarDevice.id,
      atualizado.odometroSistemaMetros,
      atualizado.horimetroSistemaSegundos * 1000,
    ).catch(err => console.error('[Traccar] Falha ao sincronizar acumuladores:', err.message));
  }

  res.json({
    id: atualizado.id,
    odometro: atualizado.odometroSistemaMetros != null ? Math.round(atualizado.odometroSistemaMetros) / 1000 : null,
    horimetro: Math.round((atualizado.horimetroSistemaSegundos / 3600) * 10) / 10,
  });
});

router.get('/dispositivos/:id/detalhe', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: {
      id: true, nome: true, identificador: true, placa: true, categoria: true,
      marca: true, modeloVeiculo: true, cor: true, limiteVelocidade: true,
      ativo: true, imagemUrl: true, telefoneRastreador: true, operadora: true,
      ...DISPOSITIVO_MEDIDORES_SELECT,
      cliente: { select: { id: true, nome: true } },
      motoristasVinculados: {
        include: { motorista: { select: { id: true, nome: true } } }
      },
    },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);

  let posicao: Awaited<ReturnType<typeof traccarGetPositions>>[number] | undefined;
  if (traccarDevice) {
    try {
      const posicoes = await traccarGetPositions([traccarDevice.id]);
      posicao = posicoes[0];
    } catch { /* sem posição */ }
  }

  if (posicao) {
    const atualizados = await sincronizarDispositivosComPosicoes([dispositivo], new Map([[dispositivo.identificador, posicao]]));
    Object.assign(dispositivo, atualizados.get(dispositivo.identificador) ?? dispositivo);
  }

  const attrs = posicao?.attributes ?? {};
  const resolverMotorista = await carregarResolvedorMotoristas();
  // Prioriza o motorista que passou o cartão RFID (última posição); só cai no
  // primeiro vínculo do veículo quando não há leitura de cartão identificada.
  const motoristaVinculado = dispositivo.motoristasVinculados && dispositivo.motoristasVinculados.length > 0
    ? dispositivo.motoristasVinculados[0].motorista
    : null;
  const motorista = resolverMotorista(cartaoDaPosicao(attrs)?.cartao) ?? motoristaVinculado;

  res.json({
    dispositivo: {
      id: dispositivo.id,
      nome: dispositivo.nome,
      identificador: dispositivo.identificador,
      placa: dispositivo.placa,
      categoria: dispositivo.categoria,
      marca: dispositivo.marca,
      modeloVeiculo: dispositivo.modeloVeiculo,
      cor: dispositivo.cor,
      limiteVelocidade: dispositivo.limiteVelocidade,
      ativo: dispositivo.ativo,
      imagemUrl: dispositivo.imagemUrl,
      telefoneRastreador: dispositivo.telefoneRastreador,
      operadora: dispositivo.operadora,
      cliente: dispositivo.cliente,
      motorista: motorista,
    },
    traccar: traccarDevice ? {
      id: traccarDevice.id,
      status: traccarDevice.status,
      lastUpdate: traccarDevice.lastUpdate,
      positionId: traccarDevice.positionId,
      groupId: traccarDevice.groupId,
      disabled: traccarDevice.disabled,
      attributes: traccarDevice.attributes,
    } : null,
    posicao: posicao ? {
      ...decorarPosicaoComMedidores(dispositivo, posicao),
      atributos: attrs,
    } : null,
  });
});

// ── GET /api/rastreamento/cercas ─────────────────────────────────────────────
// Returns only ADMIN-owned geofences (for the rastreamento map view)
router.get('/cercas', requireRoles('ADMIN', 'COLABORADOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const geocercas = await prisma.geocerca.findMany({
      where: { origemTipo: 'ADMIN', ativa: true, OR: [{ dataInicio: null }, { dataInicio: { lte: new Date() } }] },
      select: { id: true, traccarId: true, nome: true, descricao: true, area: true, criadaNoMapa: true },
    });
    res.json(geocercas.map(g => ({
      id: g.traccarId,
      geocercaLocalId: g.id,
      name: g.nome,
      description: g.descricao ?? '',
      area: g.area,
      criadaNoMapa: g.criadaNoMapa,
    })));
  } catch {
    res.json([]);
  }
});

// ── GET /api/rastreamento/dispositivos/:id/cercas ─────────────────────────────
router.get('/dispositivos/:id/cercas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  try {
    const geocercas = await prisma.geocerca.findMany({
      where: {
        origemTipo: 'ADMIN',
        ativa: true,
        // Somente cercas individuais criadas no mapa controlam o botão "Cerca"
        // do veículo focado; as da tela de Geocercas não ativam o botão.
        criadaNoMapa: true,
        OR: [{ dataInicio: null }, { dataInicio: { lte: new Date() } }],
        dispositivos: { some: { dispositivoId: id } },
      },
      select: { traccarId: true, nome: true, descricao: true, area: true },
    });
    res.json(geocercas.map(g => ({ id: g.traccarId, name: g.nome, description: g.descricao ?? '', area: g.area })));
  } catch {
    res.json([]);
  }
});

// ── POST /api/rastreamento/cercas ─────────────────────────────────────────────
// Quick cerca creation from the rastreamento map (single device, circle only)
router.post('/cercas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { nome, area, dispositivoId } = req.body as { nome: string; area: string; dispositivoId?: string };
  if (!nome || !area) { res.status(400).json({ error: 'Campos "nome" e "area" são obrigatórios.' }); return; }

  try {
    const cerca = await traccarCreateGeofence(nome, area);

    // Persist locally as ADMIN geofence
    const geocerca = await prisma.geocerca.create({
      data: {
        traccarId: cerca.id,
        nome,
        area,
        tipo: area.toUpperCase().startsWith('CIRCLE') ? 'circulo' : area.toUpperCase().startsWith('POLYGON') ? 'poligono' : 'linha',
        origemTipo: 'ADMIN',
        criadaNoMapa: true,
        visivelCliente: false,
        notificarCliente: false,
      },
    });

    if (dispositivoId) {
      const dispositivo = await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { identificador: true } });
      if (dispositivo) {
        const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
        if (traccarDevice) {
          await traccarLinkGeofenceToDevice(cerca.id, traccarDevice.id).catch(() => {});
        }
        await prisma.geocercaDispositivo.create({ data: { geocercaId: geocerca.id, dispositivoId } }).catch(() => {});
      }
    }

    res.json({ ...cerca, geocercaLocalId: geocerca.id, criadaNoMapa: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao criar cerca: ${msg}` });
  }
});

// ── DELETE /api/rastreamento/cercas/:id ──────────────────────────────────────
router.delete('/cercas/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const traccarId = parseInt(param(req, 'id'));
  if (isNaN(traccarId)) { res.status(400).json({ error: 'ID inválido.' }); return; }

  try {
    await traccarDeleteGeofence(traccarId);
    await prisma.geocerca.deleteMany({ where: { traccarId } });
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao remover cerca: ${msg}` });
  }
});

// ── DELETE /api/rastreamento/cercas/:id/dispositivos/:dispositivoId ──────────
router.delete('/cercas/:id/dispositivos/:dispositivoId', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const geofenceId = parseInt(param(req, 'id'));
  const dispositivoId = param(req, 'dispositivoId');
  if (isNaN(geofenceId)) { res.status(400).json({ error: 'ID inválido.' }); return; }

  const dispositivo = await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { identificador: true } });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (traccarDevice) await traccarUnlinkGeofenceFromDevice(geofenceId, traccarDevice.id).catch(() => {});

  const geocerca = await prisma.geocerca.findFirst({ where: { traccarId: geofenceId } });
  if (geocerca) await prisma.geocercaDispositivo.delete({ where: { geocercaId_dispositivoId: { geocercaId: geocerca.id, dispositivoId } } }).catch(() => {});

  res.json({ ok: true });
});

// ── GET /api/rastreamento/geocercas/:id ──────────────────────────────────────
router.get('/geocercas/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const g = await prisma.geocerca.findUnique({
    where: { id },
    include: {
      dispositivos: {
        include: { dispositivo: { select: { id: true, nome: true, placa: true, identificador: true } } },
      },
    },
  });
  if (!g) { res.status(404).json({ error: 'Geocerca não encontrada.' }); return; }
  res.json({
    id: g.id, traccarId: g.traccarId, nome: g.nome, descricao: g.descricao,
    area: g.area, tipo: g.tipo, visivelCliente: g.visivelCliente,
    notificarCliente: g.notificarCliente, sistemasNotif: g.sistemasNotif,
    dataInicio: g.dataInicio, ativa: g.ativa, createdAt: g.createdAt,
    dispositivos: g.dispositivos.map(d => d.dispositivo),
  });
});

// ── GET /api/rastreamento/geocercas ──────────────────────────────────────────
router.get('/geocercas', requireRoles('ADMIN', 'COLABORADOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  const geocercas = await prisma.geocerca.findMany({
    where: { origemTipo: 'ADMIN' },
    orderBy: { createdAt: 'desc' },
    include: {
      dispositivos: {
        include: { dispositivo: { select: { id: true, nome: true, placa: true, identificador: true } } },
      },
    },
  });
  res.json(geocercas.map(g => ({
    id: g.id,
    traccarId: g.traccarId,
    nome: g.nome,
    descricao: g.descricao,
    area: g.area,
    tipo: g.tipo,
    visivelCliente: g.visivelCliente,
    notificarCliente: g.notificarCliente,
    sistemasNotif: g.sistemasNotif,
    dataInicio: g.dataInicio,
    ativa: g.ativa,
    createdAt: g.createdAt,
    dispositivos: g.dispositivos.map(d => d.dispositivo),
  })));
});

// ── POST /api/rastreamento/geocercas ─────────────────────────────────────────
router.post('/geocercas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { nome, descricao, area, tipo, dispositivos: dispositivoIds, visivelCliente, notificarCliente, sistemasNotif, dataInicio } =
    req.body as {
      nome: string; descricao?: string; area: string; tipo?: string;
      dispositivos?: string[]; visivelCliente?: boolean; notificarCliente?: boolean;
      sistemasNotif?: Record<string, boolean>; dataInicio?: string;
    };

  if (!nome || !area) { res.status(400).json({ error: 'Nome e área são obrigatórios.' }); return; }

  try {
    const traccarGeofence = await traccarCreateGeofence(nome, area);

    const geocerca = await prisma.geocerca.create({
      data: {
        traccarId: traccarGeofence.id,
        nome,
        descricao: descricao ?? null,
        area,
        tipo: tipo ?? 'circulo',
        origemTipo: 'ADMIN',
        visivelCliente: !!visivelCliente,
        notificarCliente: !!notificarCliente,
        sistemasNotif: sistemasNotif ?? Prisma.JsonNull,
        dataInicio: parseDataInicioSaoPaulo(dataInicio),
      },
    });

    // Link to devices in Traccar and local DB
    if (Array.isArray(dispositivoIds) && dispositivoIds.length > 0) {
      const dispositivos = await prisma.dispositivo.findMany({
        where: { id: { in: dispositivoIds } },
        select: { id: true, identificador: true },
      });
      await Promise.all(
        dispositivos.map(async d => {
          const td = await traccarGetDeviceByImei(d.identificador).catch(() => null);
          if (td) await traccarLinkGeofenceToDevice(traccarGeofence.id, td.id).catch(() => {});
          await prisma.geocercaDispositivo.create({ data: { geocercaId: geocerca.id, dispositivoId: d.id } }).catch(() => {});
        }),
      );
    }

    res.json({ id: geocerca.id, traccarId: geocerca.traccarId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao criar geocerca: ${msg}` });
  }
});

// ── PUT /api/rastreamento/geocercas/:id ──────────────────────────────────────
router.put('/geocercas/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const { nome, descricao, area, tipo, dispositivos: dispositivoIds, visivelCliente, notificarCliente, sistemasNotif, dataInicio, ativa } =
    req.body as {
      nome?: string; descricao?: string; area?: string; tipo?: string;
      dispositivos?: string[]; visivelCliente?: boolean; notificarCliente?: boolean;
      sistemasNotif?: Record<string, boolean>; dataInicio?: string; ativa?: boolean;
    };

  const geocerca = await prisma.geocerca.findUnique({ where: { id } });
  if (!geocerca) { res.status(404).json({ error: 'Geocerca não encontrada.' }); return; }

  try {
    const novoNome = nome ?? geocerca.nome;
    const novaArea = area ?? geocerca.area;

    await traccarUpdateGeofence(geocerca.traccarId, novoNome, novaArea, descricao ?? geocerca.descricao ?? undefined);

    await prisma.geocerca.update({
      where: { id },
      data: {
        nome: novoNome,
        descricao: descricao !== undefined ? descricao : geocerca.descricao,
        area: novaArea,
        tipo: tipo ?? geocerca.tipo,
        visivelCliente: visivelCliente !== undefined ? visivelCliente : geocerca.visivelCliente,
        notificarCliente: notificarCliente !== undefined ? notificarCliente : geocerca.notificarCliente,
        sistemasNotif: sistemasNotif !== undefined ? (sistemasNotif ?? Prisma.JsonNull) : (geocerca.sistemasNotif ?? Prisma.JsonNull),
        dataInicio: dataInicio !== undefined ? parseDataInicioSaoPaulo(dataInicio) : geocerca.dataInicio,
        ativa: ativa !== undefined ? ativa : geocerca.ativa,
      },
    });

    // Sync devices if provided
    if (Array.isArray(dispositivoIds)) {
      const existentes = await prisma.geocercaDispositivo.findMany({ where: { geocercaId: id }, select: { dispositivoId: true } });
      const existentesIds = existentes.map(e => e.dispositivoId);

      const aRemover = existentesIds.filter(eid => !dispositivoIds.includes(eid));
      const aAdicionar = dispositivoIds.filter(did => !existentesIds.includes(did));

      for (const did of aRemover) {
        const d = await prisma.dispositivo.findUnique({ where: { id: did }, select: { identificador: true } });
        if (d) {
          const td = await traccarGetDeviceByImei(d.identificador).catch(() => null);
          if (td) await traccarUnlinkGeofenceFromDevice(geocerca.traccarId, td.id).catch(() => {});
        }
        await prisma.geocercaDispositivo.delete({ where: { geocercaId_dispositivoId: { geocercaId: id, dispositivoId: did } } }).catch(() => {});
      }

      const novosDispo = await prisma.dispositivo.findMany({ where: { id: { in: aAdicionar } }, select: { id: true, identificador: true } });
      for (const d of novosDispo) {
        const td = await traccarGetDeviceByImei(d.identificador).catch(() => null);
        if (td) await traccarLinkGeofenceToDevice(geocerca.traccarId, td.id).catch(() => {});
        await prisma.geocercaDispositivo.create({ data: { geocercaId: id, dispositivoId: d.id } }).catch(() => {});
      }
    }

    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao atualizar geocerca: ${msg}` });
  }
});

// ── DELETE /api/rastreamento/geocercas/:id ───────────────────────────────────
router.delete('/geocercas/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const geocerca = await prisma.geocerca.findUnique({ where: { id } });
  if (!geocerca) { res.status(404).json({ error: 'Geocerca não encontrada.' }); return; }

  try {
    await traccarDeleteGeofence(geocerca.traccarId);
  } catch { /* Traccar may already not have it */ }

  await prisma.geocerca.delete({ where: { id } });
  res.json({ ok: true });
});

// ── GET /api/rastreamento/logs ─────────────────────────────────────────────────
// Retorna as últimas linhas do log do servidor Traccar.
// O frontend pode filtrar por identificador/IMEI do dispositivo.
router.get('/logs', requireRoles('ADMIN', 'COLABORADOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const logText = await traccarGetServerLog();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(logText);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Logs] Erro ao buscar logs do Traccar:', msg);
    res.status(502).json({ error: `Erro ao buscar logs: ${msg}` });
  }
});

// ── GET /api/rastreamento/relatorios/batch/historico ───────────────────────────
router.get('/relatorios/batch/historico', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to } = req.query as { from: string; to: string };
  const deviceIds = (req.query.deviceId as string[] | string);
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }

  const ids = parseDeviceIdsParam(deviceIds);
  if (!ids.length) { res.status(400).json({ error: 'Nenhum dispositivo válido informado.' }); return; }
  const fromDate = new Date(from);
  const toDate = new Date(to);

  try {
    const traccarDevices = await traccarGetDevices();
    const dispositivosTraccar = traccarDevices.filter(d => ids.includes(d.id));
    const identificadorPorTraccarId = new Map(dispositivosTraccar.map(d => [d.id, d.uniqueId]));
    // Busca os nomes dos dispositivos para o frontend mapear
    const dispositivosLocal = await prisma.dispositivo.findMany({
      where: { identificador: { in: dispositivosTraccar.map(d => d.uniqueId) } },
      select: { id: true, nome: true, placa: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT }
    });
    const localPorIdentificador = new Map(dispositivosLocal.map(d => [d.identificador, d]));

    const historico = await traccarGetPositionHistory(ids, fromDate, toDate);

    // Segmentos ociosos (motor ligado + parado) por dispositivo, para marcar no mapa do relatório.
    const ociosos = ids.flatMap(deviceId =>
      calcularOciosidade(historico.filter(p => p.deviceId === deviceId)).segmentos.map(s => ({
        deviceId,
        inicio: s.inicio,
        fim: s.fim,
        latitude: s.latitude,
        longitude: s.longitude,
        duracaoMin: Math.round(s.duracaoMs / 60000),
      })),
    );

    res.json({
      dispositivos: dispositivosLocal,
      posicoes: historico.map(p => ({
        deviceId: p.deviceId,
        ...decorarPosicaoComMedidores(
          localPorIdentificador.get(identificadorPorTraccarId.get(p.deviceId) || '') || { ignorarOdometro: false, odometroSistemaMetros: null, horimetroSistemaSegundos: 0, telemetriaUltimaIgnicao: null },
          p,
        ),
      })),
      ociosos,
    });
  } catch (err: unknown) {
    res.status(502).json({ error: `Erro ao buscar histórico: ${err}` });
  }
});

// ── GET /api/rastreamento/relatorios/batch/viagens ─────────────────────────────
router.get('/relatorios/batch/viagens', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to } = req.query as { from: string; to: string };
  const deviceIds = (req.query.deviceId as string[] | string);
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }

  const ids = parseDeviceIdsParam(deviceIds);
  if (!ids.length) { res.status(400).json({ error: 'Nenhum dispositivo válido informado.' }); return; }
  try {
    const [viagens, traccarDevices, historico] = await Promise.all([
      traccarGetTrips(ids, new Date(from), new Date(to)),
      traccarGetDevices(),
      traccarGetPositionHistory(ids, new Date(from), new Date(to)).catch(() => []),
    ]);
    const dispositivosTraccar = traccarDevices.filter(d => ids.includes(d.id));
    const dispositivosLocal = await prisma.dispositivo.findMany({
      where: { identificador: { in: dispositivosTraccar.map(d => d.uniqueId) } },
      select: { identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
    });
    const localPorTraccarId = new Map(
      dispositivosTraccar.map(device => [device.id, dispositivosLocal.find(local => local.identificador === device.uniqueId)]),
    );
    const resolverMotorista = await carregarResolvedorMotoristas();
    res.json(viagens.map(viagem => {
      const dispositivo = localPorTraccarId.get(viagem.deviceId);
      const viagemComMedidores = dispositivo ? aplicarViagensComMedidores(dispositivo, [viagem], historico)[0] : viagem;
      const posInicio = posicaoMaisProxima(historico, viagem.deviceId, viagem.startTime);
      const posFim = posicaoMaisProxima(historico, viagem.deviceId, viagem.endTime);
      const driverId = cartaoDaViagem(viagem, historico.filter(p => p.deviceId === viagem.deviceId));
      return {
        ...viagemComMedidores,
        startAddress: temEndereco(viagemComMedidores.startAddress) ? viagemComMedidores.startAddress : posInicio?.address ?? viagemComMedidores.startAddress,
        startLat: viagemComMedidores.startLat || posInicio?.latitude || 0,
        startLon: viagemComMedidores.startLon || posInicio?.longitude || 0,
        endAddress: temEndereco(viagemComMedidores.endAddress) ? viagemComMedidores.endAddress : posFim?.address ?? viagemComMedidores.endAddress,
        endLat: viagemComMedidores.endLat || posFim?.latitude || 0,
        endLon: viagemComMedidores.endLon || posFim?.longitude || 0,
        motorista: resolverMotorista(driverId),
        motorista_id: driverId,
      };
    }));
  } catch (err: unknown) { res.status(502).json({ error: 'Erro ao buscar viagens.' }); }
});

// ── GET /api/rastreamento/relatorios/batch/paradas ─────────────────────────────
router.get('/relatorios/batch/paradas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to } = req.query as { from: string; to: string };
  const deviceIds = (req.query.deviceId as string[] | string);
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }

  const ids = parseDeviceIdsParam(deviceIds);
  if (!ids.length) { res.status(400).json({ error: 'Nenhum dispositivo válido informado.' }); return; }
  try {
    const [paradas, historico] = await Promise.all([
      traccarGetStops(ids, new Date(from), new Date(to)),
      traccarGetPositionHistory(ids, new Date(from), new Date(to)).catch(() => []),
    ]);
    const historicoPorId = new Map(historico.map(p => [p.id, p]));
    res.json(aplicarParadasComMedidores(paradas, historico).map(parada => {
      const posicao = historicoPorId.get(parada.positionId)
        || posicaoMaisProxima(historico, parada.deviceId, parada.startTime)
        || posicaoMaisProxima(historico, parada.deviceId, parada.endTime);
      return {
        ...parada,
        address: temEndereco(parada.address) ? parada.address : posicao?.address || null,
        lat: parada.lat || posicao?.latitude || 0,
        lon: parada.lon || posicao?.longitude || 0,
      };
    }));
  } catch (err: unknown) { res.status(502).json({ error: 'Erro ao buscar paradas.' }); }
});

// ── GET /api/rastreamento/relatorios/batch/eventos ─────────────────────────────
router.get('/relatorios/batch/eventos', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to } = req.query as { from: string; to: string };
  const deviceIds = (req.query.deviceId as string[] | string);
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }

  const ids = parseDeviceIdsParam(deviceIds);
  if (!ids.length) { res.status(400).json({ error: 'Nenhum dispositivo válido informado.' }); return; }
  try {
    const [eventos, historico, resolverMotorista] = await Promise.all([
      traccarGetEvents(ids, new Date(from), new Date(to)),
      traccarGetPositionHistory(ids, new Date(from), new Date(to)).catch(() => []),
      carregarResolvedorMotoristas(),
    ]);

    const allowedGeocercas = await prisma.geocerca.findMany({
      where: { origemTipo: 'ADMIN' },
      select: { traccarId: true },
    });
    const allowedSet = new Set(allowedGeocercas.map(g => g.traccarId));

    res.json(eventos
      .filter(e => !(e.type === 'geofenceEnter' || e.type === 'geofenceExit') || allowedSet.has(e.geofenceId))
      .map(e => {
        const cartao = cartaoAntesDe(historico.filter(p => p.deviceId === e.deviceId), new Date(e.eventTime).getTime());
        return {
          id: e.id,
          deviceId: e.deviceId,
          tipo: e.type,
          tipoLabel: EVENT_TYPE_LABELS[e.type] ?? e.type,
          hora: e.eventTime,
          atributos: e.attributes,
          geofenceId: e.geofenceId,
          motorista: resolverMotorista(cartao),
          motorista_id: cartao,
        };
      }));
  } catch (err: unknown) { res.status(502).json({ error: 'Erro ao buscar eventos.' }); }
});

// ── GET /api/rastreamento/relatorios/batch/resumo ──────────────────────────────
router.get('/relatorios/batch/resumo', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to } = req.query as { from: string; to: string };
  const deviceIds = (req.query.deviceId as string[] | string);
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }

  const ids = parseDeviceIdsParam(deviceIds);
  if (!ids.length) { res.status(400).json({ error: 'Nenhum dispositivo válido informado.' }); return; }
  try {
    const [resumo, traccarDevices, historico] = await Promise.all([
      traccarGetSummary(ids, new Date(from), new Date(to)),
      traccarGetDevices(),
      traccarGetPositionHistory(ids, new Date(from), new Date(to)).catch(() => []),
    ]);
    const dispositivosTraccar = traccarDevices.filter(d => ids.includes(d.id));
    const dispositivosLocal = await prisma.dispositivo.findMany({
      where: { identificador: { in: dispositivosTraccar.map(d => d.uniqueId) } },
      select: { identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
    });
    const localPorTraccarId = new Map(
      dispositivosTraccar.map(device => [device.id, dispositivosLocal.find(local => local.identificador === device.uniqueId)]),
    );
    res.json(resumo.map(item => {
      const dispositivo = localPorTraccarId.get(item.deviceId);
      if (!dispositivo) return item;
      return aplicarResumoComMedidores(
        dispositivo,
        item,
        historico.filter(posicao => posicao.deviceId === item.deviceId),
      );
    }));
  } catch (err: unknown) { res.status(502).json({ error: 'Erro ao buscar resumo.' }); }
});

// ── GET /api/rastreamento/relatorios/exportar ──────────────────────────────────
router.get('/relatorios/exportar', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { from, to, type } = req.query as { from: string; to: string; type: string };
  const deviceIds = (req.query.deviceId as string[] | string);
  
  if (!from || !to || !type || !deviceIds) {
    res.status(400).json({ error: 'Parâmetros incompletos.' });
    return;
  }

  const ids = parseDeviceIdsParam(deviceIds);
  if (!ids.length) { res.status(400).json({ error: 'Nenhum dispositivo válido informado.' }); return; }

  const formato = (req.query.formato as string) === 'pdf' ? 'pdf' : 'xlsx';
  const tiposValidos = ['route', 'events', 'trips', 'stops', 'summary', 'completo'];
  const tipo = (tiposValidos.includes(type) ? type : 'completo') as TipoRelatorio;

  try {
    const dados = await coletarDadosRelatorio(ids, from, to);
    if (formato === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=relatorio.pdf');
      res.send(await gerarRelatorioPdf(dados));
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=relatorio.xlsx');
      res.send(await gerarRelatorioXlsx(dados, tipo));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro na exportação: ${msg}` });
  }
});

export default router;
