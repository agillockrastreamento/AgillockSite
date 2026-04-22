import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import { param, query } from '../utils/params';
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
  traccarGetCommandTypes,
  traccarGetGeofences,
  traccarCreateGeofence,
  traccarDeleteGeofence,
  traccarLinkGeofenceToDevice,
  traccarUnlinkGeofenceFromDevice,
  traccarGetServerLog,
  normalizeAttributes,
  EVENT_TYPE_LABELS,
} from '../services/traccar.service';

const router = Router();
router.use(authMiddleware);

// ── GET /api/rastreamento/posicoes ────────────────────────────────────────────
// Snapshot inicial: todos os dispositivos ativos com última posição conhecida.
// Após esse carregamento inicial, o frontend recebe atualizações via WebSocket.
router.get('/posicoes', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  // Prisma e Traccar em paralelo — economiza uma viagem de rede
  const [dispoResult, traccarResult] = await Promise.allSettled([
    prisma.dispositivo.findMany({
      where: { ativo: true },
      select: {
        id: true, nome: true, identificador: true, placa: true,
        categoria: true, marca: true, modeloVeiculo: true, cor: true, limiteVelocidade: true, imagemUrl: true,
        cliente: { select: { id: true, nome: true } },
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

  const resultado = dispositivos.map(d => {
    const traccar = traccarByImei.get(d.identificador);
    const posicao = traccar ? posicaoPorDeviceId.get(traccar.id) : undefined;
    const motorista = d.motoristasVinculados && d.motoristasVinculados.length > 0 ? d.motoristasVinculados[0].motorista : null;

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
      limiteVelocidade: d.limiteVelocidade,
      cliente: d.cliente,
      motorista: motorista,
      traccarId: traccar?.id ?? null,
      status: traccar?.status ?? 'unknown',
      lastUpdate: traccar?.lastUpdate ?? null,
      posicao: posicao ? {
        latitude: posicao.latitude,
        longitude: posicao.longitude,
        velocidade: Math.round(posicao.speed * 1.852),
        curso: posicao.course,
        altitude: posicao.altitude,
        fixTime: posicao.fixTime,
        deviceTime: posicao.deviceTime,
        serverTime: posicao.serverTime,
        valida: posicao.valid,
        endereco: posicao.address,
        ...normalizeAttributes(posicao.attributes),
      } : null,
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
    select: { id: true, nome: true, identificador: true, placa: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const historico = await traccarGetPositionHistory(traccarDevice.id, fromDate, toDate);

  res.json({
    dispositivo: { id: dispositivo.id, nome: dispositivo.nome, placa: dispositivo.placa },
    total: historico.length,
    posicoes: historico.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
      velocidade: Math.round(p.speed * 1.852),
      curso: p.course,
      altitude: p.altitude,
      fixTime: p.fixTime,
      valida: p.valid,
      ...normalizeAttributes(p.attributes),
    })),
  });
});

// ── GET /api/rastreamento/dispositivos/:id/viagens ────────────────────────────
router.get('/dispositivos/:id/viagens', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, nome: true, identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const viagens = await traccarGetTrips(traccarDevice.id, fromDate, toDate);

  res.json(viagens.map(v => ({
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
  })));
});

// ── GET /api/rastreamento/dispositivos/:id/paradas ────────────────────────────
router.get('/dispositivos/:id/paradas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, nome: true, identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const paradas = await traccarGetStops(traccarDevice.id, fromDate, toDate);

  res.json(paradas.map(p => ({
    inicio: p.startTime,
    fim: p.endTime,
    endereco: p.address,
    latitude: p.lat,
    longitude: p.lon,
    duracao: Math.round(p.duration / 60000),
    horasMotor: Math.round((p.engineHours || 0) / 3600000),
  })));
});

// ── GET /api/rastreamento/dispositivos/:id/eventos ────────────────────────────
router.get('/dispositivos/:id/eventos', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { id: true, nome: true, identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const eventos = await traccarGetEvents(traccarDevice.id, fromDate, toDate);

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
    select: { id: true, nome: true, identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' }); return; }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const resumos = await traccarGetSummary(traccarDevice.id, fromDate, toDate);

  if (!resumos.length) { res.json(null); return; }
  const r = resumos[0];
  res.json({
    distancia: Math.round(r.distance / 100) / 10,
    velocidadeMedia: Math.round(r.averageSpeed * 1.852),
    velocidadeMaxima: Math.round(r.maxSpeed * 1.852),
    horasMotor: Math.round((r.engineHours || 0) / 3600000 * 10) / 10,
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

// ── GET /api/rastreamento/dispositivos/:id/detalhe ────────────────────────────
router.get('/dispositivos/:id/detalhe', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: {
      id: true, nome: true, identificador: true, placa: true, categoria: true,
      marca: true, modeloVeiculo: true, cor: true, limiteVelocidade: true,
      ativo: true, imagemUrl: true,
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

  const attrs = posicao?.attributes ?? {};
  const motorista = dispositivo.motoristasVinculados && dispositivo.motoristasVinculados.length > 0 
    ? dispositivo.motoristasVinculados[0].motorista 
    : null;

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
      latitude: posicao.latitude,
      longitude: posicao.longitude,
      altitude: posicao.altitude,
      velocidade: Math.round(posicao.speed * 1.852),
      curso: posicao.course,
      fixTime: posicao.fixTime,
      deviceTime: posicao.deviceTime,
      serverTime: posicao.serverTime,
      valida: posicao.valid,
      endereco: posicao.address,
      atributos: attrs,
      ...normalizeAttributes(attrs),
    } : null,
  });
});

// ── GET /api/rastreamento/cercas ──────────────────────────────────────────────
router.get('/cercas', requireRoles('ADMIN', 'COLABORADOR'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cercas = await traccarGetGeofences();
    res.json(cercas);
  } catch {
    res.json([]);
  }
});

// ── GET /api/rastreamento/dispositivos/:id/cercas ─────────────────────────────
router.get('/dispositivos/:id/cercas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = param(req, 'id');
  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id },
    select: { identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.json([]); return; }

  try {
    const cercas = await traccarGetGeofences(traccarDevice.id);
    res.json(cercas);
  } catch {
    res.json([]);
  }
});

// ── POST /api/rastreamento/cercas ─────────────────────────────────────────────
router.post('/cercas', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { nome, area, dispositivoId } = req.body as { nome: string; area: string; dispositivoId?: string };

  if (!nome || !area) { res.status(400).json({ error: 'Campos "nome" e "area" são obrigatórios.' }); return; }

  try {
    const cerca = await traccarCreateGeofence(nome, area);

    if (dispositivoId) {
      const dispositivo = await prisma.dispositivo.findUnique({
        where: { id: dispositivoId },
        select: { identificador: true },
      });
      if (dispositivo) {
        const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
        if (traccarDevice) {
          await traccarLinkGeofenceToDevice(cerca.id, traccarDevice.id).catch(() => {});
        }
      }
    }

    res.json(cerca);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao criar cerca: ${msg}` });
  }
});

// ── DELETE /api/rastreamento/cercas/:id ───────────────────────────────────────
router.delete('/cercas/:id', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(param(req, 'id'));
  if (isNaN(id)) { res.status(400).json({ error: 'ID inválido.' }); return; }

  try {
    await traccarDeleteGeofence(id);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao remover cerca: ${msg}` });
  }
});

// ── DELETE /api/rastreamento/cercas/:id/dispositivos/:dispositivoId ───────────
router.delete('/cercas/:id/dispositivos/:dispositivoId', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const geofenceId = parseInt(param(req, 'id'));
  const dispositivoId = param(req, 'dispositivoId');
  if (isNaN(geofenceId)) { res.status(400).json({ error: 'ID inválido.' }); return; }

  const dispositivo = await prisma.dispositivo.findUnique({
    where: { id: dispositivoId },
    select: { identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (traccarDevice) {
    await traccarUnlinkGeofenceFromDevice(geofenceId, traccarDevice.id).catch(() => {});
  }

  res.json({ ok: true });
});

// ── GET /api/rastreamento/logs ─────────────────────────────────────────────────
// Retorna as últimas linhas do log do servidor Traccar.
// O frontend pode filtrar por identificador/IMEI do dispositivo.
router.get('/logs', requireRoles('ADMIN'), async (_req: AuthRequest, res: Response): Promise<void> => {
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

export default router;
