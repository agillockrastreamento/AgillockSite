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
} from '../services/traccar.service';

const router = Router();
router.use(authMiddleware);

// ── GET /api/rastreamento/posicoes ────────────────────────────────────────────
// Snapshot inicial: todos os dispositivos ativos com última posição conhecida.
// Após esse carregamento inicial, o frontend recebe atualizações via WebSocket.
router.get('/posicoes', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const dispositivos = await prisma.dispositivo.findMany({
    where: { ativo: true },
    select: {
      id: true, nome: true, identificador: true, placa: true,
      categoria: true, marca: true, modeloVeiculo: true, cor: true, limiteVelocidade: true, imagemUrl: true,
      cliente: { select: { id: true, nome: true } },
    },
  });

  if (!dispositivos.length) { res.json([]); return; }

  let traccarDevices;
  try {
    traccarDevices = await traccarGetDevices();
  } catch {
    res.status(502).json({ error: 'Servidor de rastreamento indisponível.' });
    return;
  }

  const traccarByImei = new Map(traccarDevices.map(d => [d.uniqueId, d]));

  const traccarIds = dispositivos
    .map(d => traccarByImei.get(d.identificador)?.id)
    .filter((id): id is number => id !== undefined);

  let posicoes: Awaited<ReturnType<typeof traccarGetPositions>> = [];
  if (traccarIds.length) {
    try { posicoes = await traccarGetPositions(traccarIds); } catch { /* sem posições */ }
  }

  const posicaoPorDeviceId = new Map(posicoes.map(p => [p.deviceId, p]));

  const resultado = dispositivos.map(d => {
    const traccar = traccarByImei.get(d.identificador);
    const posicao = traccar ? posicaoPorDeviceId.get(traccar.id) : undefined;

    return {
      dispositivoId: d.id,
      nome: d.nome,
      placa: d.placa,
      categoria: d.categoria,
      imagemUrl: d.imagemUrl,
      marca: d.marca,
      modeloVeiculo: d.modeloVeiculo,
      cor: d.cor,
      limiteVelocidade: d.limiteVelocidade,
      cliente: d.cliente,
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
        valida: posicao.valid,
        ignition: posicao.attributes.ignition ?? null,
        motion: posicao.attributes.motion ?? null,
        endereco: posicao.address,
        sat: posicao.attributes.sat ?? null,
        bateria: posicao.attributes.batteryLevel ?? null,
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
      fixTime: p.fixTime,
      valida: p.valid,
      ignition: p.attributes.ignition ?? null,
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

export default router;
