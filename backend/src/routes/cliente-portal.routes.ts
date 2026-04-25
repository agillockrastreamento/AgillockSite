import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { clienteAuthMiddleware, requireResponsavel, ClienteRequest } from '../middleware/cliente-auth.middleware';
import { query, param } from '../utils/params';
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
  traccarExportReport,
  traccarGetCommandTypes,
  traccarSendCommand,
  traccarGetGeofences,
  traccarCreateGeofence,
  traccarDeleteGeofence,
  traccarLinkGeofenceToDevice,
  traccarUnlinkGeofenceFromDevice,
  normalizeAttributes,
  EVENT_TYPE_LABELS,
} from '../services/traccar.service';
import {
  DISPOSITIVO_MEDIDORES_SELECT,
  sincronizarDispositivosComPosicoes,
  decorarPosicaoComMedidores,
  aplicarResumoComMedidores,
  aplicarViagensComMedidores,
  aplicarParadasComMedidores,
} from '../services/medidores.service';
import { CLIENTE_UPLOADS_DIR, UPLOADS_DIR } from '../utils/upload-paths';

const router = Router();
router.use(clienteAuthMiddleware);

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

// ── Upload de foto do veículo ─────────────────────────────────────────────────

const uploadCliente = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = CLIENTE_UPLOADS_DIR;
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Formato não suportado. Use JPG, PNG ou WEBP.'));
  },
});

// ── GET /api/cliente/rastreamento/status-acesso ───────────────────────────────
router.get('/rastreamento/status-acesso', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;

  const hoje = new Date();
  const limite = new Date(hoje.getTime() - 10 * 24 * 60 * 60 * 1000);

  // Busca boletos atrasados do cliente (via carnês do cliente ou dispositivos vinculados)
  const boletosAtrasados = await prisma.boleto.findMany({
    where: {
      status: 'ATRASADO',
      vencimento: { lt: limite },
      carne: { clienteId },
    },
    select: { vencimento: true },
    take: 1,
  });

  if (boletosAtrasados.length === 0) {
    res.json({ bloqueado: false });
    return;
  }

  const diasAtraso = Math.floor(
    (hoje.getTime() - new Date(boletosAtrasados[0].vencimento).getTime()) / (24 * 60 * 60 * 1000),
  );
  res.json({ bloqueado: true, diasAtraso });
});

// ── Helper de verificação de bloqueio ─────────────────────────────────────────

async function verificarBloqueio(clienteId: string): Promise<boolean> {
  const limite = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const count = await prisma.boleto.count({
    where: { status: 'ATRASADO', vencimento: { lt: limite }, carne: { clienteId } },
  });
  return count > 0;
}

// ── GET /api/cliente/rastreamento/posicoes ────────────────────────────────────
router.get('/rastreamento/posicoes', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;

  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }

  // Busca dispositivos do cliente (responsável direto + vinculados)
  const [dispoResult, traccarResult] = await Promise.allSettled([
    prisma.dispositivo.findMany({
      where: {
        ativo: true,
        OR: [
          { clienteId },
          { clientesVinculados: { some: { clienteId } } },
        ],
      },
      select: {
        id: true, nome: true, identificador: true, placa: true,
        categoria: true, marca: true, modeloVeiculo: true, cor: true,
        limiteVelocidade: true, imagemUrlCliente: true,
        ...DISPOSITIVO_MEDIDORES_SELECT,
        cliente: { select: { id: true, nome: true } },
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

  const resultado = dispositivos.map(d => {
    const traccar = traccarByImei.get(d.identificador);
    const posicao = traccar ? posicaoPorDeviceId.get(traccar.id) : undefined;
    const estado = estadosAtualizados.get(d.identificador) ?? d;

    return {
      dispositivoId: d.id,
      nome: d.nome,
      placa: d.placa,
      categoria: d.categoria,
      imagemUrlCliente: d.imagemUrlCliente,
      marca: d.marca,
      modeloVeiculo: d.modeloVeiculo,
      cor: d.cor,
      limiteVelocidade: d.limiteVelocidade,
      cliente: d.cliente,
      traccarId: traccar?.id ?? null,
      status: traccar?.status ?? 'unknown',
      lastUpdate: traccar?.lastUpdate ?? null,
      posicao: posicao ? decorarPosicaoComMedidores(estado, posicao) : null,
    };
  });

  res.json(resultado);
});

// ── GET /api/cliente/rastreamento/dispositivos/:id/historico ─────────────────
router.get('/rastreamento/dispositivos/:id/historico', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      ativo: true,
      OR: [
        { clienteId },
        { clientesVinculados: { some: { clienteId } } },
      ],
    },
    select: { id: true, nome: true, identificador: true, placa: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });

  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' });
    return;
  }

  const { traccarGetDeviceByImei } = await import('../services/traccar.service');
  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) {
    res.status(404).json({ error: 'Dispositivo não sincronizado com o rastreador.' });
    return;
  }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  const historico = await traccarGetPositionHistory([traccarDevice.id], fromDate, toDate);

  res.json({
    dispositivo: { id: dispositivo.id, nome: dispositivo.nome, placa: dispositivo.placa },
    total: historico.length,
    posicoes: historico.map(p => decorarPosicaoComMedidores(dispositivo, p)),
  });
});

// ── GET /api/cliente/rastreamento/dispositivos/:id/viagens ───────────────────
router.get('/rastreamento/dispositivos/:id/viagens', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      ativo: true,
      OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
    },
    select: { id: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' });
    return;
  }

  const { traccarGetDeviceByImei } = await import('../services/traccar.service');
  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) {
    res.status(404).json({ error: 'Dispositivo não sincronizado.' });
    return;
  }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  const viagens = await traccarGetTrips([traccarDevice.id], fromDate, toDate);
  const historico = await traccarGetPositionHistory([traccarDevice.id], fromDate, toDate).catch(() => []);
  const viagensComMedidores = aplicarViagensComMedidores(dispositivo, viagens, historico);

  res.json(viagensComMedidores.map(v => {
    const posInicio = posicaoMaisProxima(historico, traccarDevice.id, v.startTime);
    const posFim = posicaoMaisProxima(historico, traccarDevice.id, v.endTime);
    return {
      inicio: v.startTime,
      fim: v.endTime,
      origem: temEndereco(v.startAddress) ? v.startAddress : posInicio?.address || null,
      destino: temEndereco(v.endAddress) ? v.endAddress : posFim?.address || null,
      origemLat: v.startLat || posInicio?.latitude || 0,
      origemLng: v.startLon || posInicio?.longitude || 0,
      destinoLat: v.endLat || posFim?.latitude || 0,
      destinoLng: v.endLon || posFim?.longitude || 0,
      distancia: Math.round(v.distance / 100) / 10,
      velocidadeMedia: Math.round(v.averageSpeed * 1.852),
      velocidadeMaxima: Math.round(v.maxSpeed * 1.852),
      duracao: Math.round(v.duration / 60000),
    };
  }));
});

// ── GET /api/cliente/rastreamento/dispositivos/:id/paradas ───────────────────
router.get('/rastreamento/dispositivos/:id/paradas', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      ativo: true,
      OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
    },
    select: { id: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' });
    return;
  }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) {
    res.status(404).json({ error: 'Dispositivo não sincronizado.' });
    return;
  }

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
      duracao: Math.round(p.duration / 60000),
      latitude: p.lat || posicao?.latitude || 0,
      longitude: p.lon || posicao?.longitude || 0,
      endereco: temEndereco(p.address) ? p.address : posicao?.address || null,
    };
  }));
});

// ── GET /api/cliente/rastreamento/dispositivos/:id/eventos ───────────────────
router.get('/rastreamento/dispositivos/:id/eventos', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      ativo: true,
      OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
    },
    select: { id: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' });
    return;
  }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) {
    res.status(404).json({ error: 'Dispositivo não sincronizado.' });
    return;
  }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  const eventos = await traccarGetEvents([traccarDevice.id], fromDate, toDate);

  res.json(eventos.map(e => ({
    id: e.id,
    tipo: e.type,
    tipoLabel: EVENT_TYPE_LABELS[e.type] ?? e.type,
    hora: e.eventTime,
    posicaoId: e.positionId,
    atributos: e.attributes,
  })));
});

// ── GET /api/cliente/rastreamento/dispositivos/:id/resumo ────────────────────
router.get('/rastreamento/dispositivos/:id/resumo', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      ativo: true,
      OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
    },
    select: { id: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' });
    return;
  }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) {
    res.status(404).json({ error: 'Dispositivo não sincronizado.' });
    return;
  }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  const resumos = await traccarGetSummary([traccarDevice.id], fromDate, toDate);
  const historico = await traccarGetPositionHistory([traccarDevice.id], fromDate, toDate).catch(() => []);

  if (!resumos.length) {
    res.json({
      distancia: 0,
      velocidadeMedia: 0,
      velocidadeMaxima: 0,
      consumoCombustivel: 0,
      horasMotor: 0,
    });
    return;
  }

  const r = aplicarResumoComMedidores(dispositivo, resumos[0], historico);
  res.json({
    distancia: Math.round(r.distance / 100) / 10,
    velocidadeMedia: Math.round(r.averageSpeed * 1.852),
    velocidadeMaxima: Math.round(r.maxSpeed * 1.852),
    consumoCombustivel: r.spentFuel,
    horasMotor: Math.round(r.engineHours / 360000) / 10, // ms para horas com 1 decimal
  });
});

router.get('/rastreamento/dispositivos/:id/exportar', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);
  const type = query(req.query.type) || 'route';

  if (!from || !to || !['route', 'events', 'trips', 'stops', 'summary'].includes(type)) {
    res.status(400).json({ error: 'Parâmetros incompletos.' });
    return;
  }

  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      ativo: true,
      OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
    },
    select: { id: true, identificador: true },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' });
    return;
  }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) {
    res.status(404).json({ error: 'Dispositivo não sincronizado.' });
    return;
  }

  try {
    const response = await traccarExportReport(type as 'route' | 'events' | 'trips' | 'stops' | 'summary', [traccarDevice.id], new Date(from), new Date(to));
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio_${type}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro na exportação: ${msg}` });
  }
});

// ── GET /api/cliente/boletos ──────────────────────────────────────────────────
router.get('/boletos', requireResponsavel, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const status = query(req.query.status);
  const dataVencDe = query(req.query.dataVencDe);
  const dataVencAte = query(req.query.dataVencAte);
  const placaId = query(req.query.placaId);

  const where: Record<string, unknown> = {
    carne: { clienteId },
  };
  if (status === 'aberto') {
    where.status = { in: ['PENDENTE', 'ATRASADO'] };
  } else if (status) {
    where.status = status;
  }
  if (dataVencDe || dataVencAte) {
    const venc: Record<string, Date> = {};
    if (dataVencDe) venc.gte = new Date(dataVencDe);
    if (dataVencAte) venc.lte = new Date(dataVencAte + 'T23:59:59');
    where.vencimento = venc;
  }
  if (placaId) where.placaId = placaId;

  const boletos = await prisma.boleto.findMany({
    where,
    orderBy: [{ vencimento: 'asc' }, { numeroParcela: 'asc' }],
    select: {
      id: true,
      numeroParcela: true,
      valor: true,
      vencimento: true,
      status: true,
      dataPagamento: true,
      valorPago: true,
      linkBoleto: true,
      placa: { select: { id: true, placa: true } },
      dispositivo: { select: { id: true, nome: true, placa: true } },
      carne: { select: { tipo: true, numeroParcelas: true } },
    },
    take: 200,
  });

  res.json(boletos);
});

// ── POST /api/cliente/dispositivos/:id/foto ───────────────────────────────────
router.post(
  '/dispositivos/:dispositivoId/foto',
  uploadCliente.single('foto'),
  async (req: ClienteRequest, res: Response): Promise<void> => {
    const clienteId = req.cliente!.clienteId;
    const dispositivoId = param(req, 'dispositivoId');

    if (!req.file) {
      res.status(400).json({ error: 'Arquivo não enviado.' });
      return;
    }

    const dispositivo = await prisma.dispositivo.findFirst({
      where: {
        id: dispositivoId,
        ativo: true,
        OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
      },
      select: { id: true, imagemUrlCliente: true },
    });
    if (!dispositivo) {
      res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' });
      return;
    }

    // Remove foto anterior se existir
    if (dispositivo.imagemUrlCliente) {
      const oldPath = path.join(UPLOADS_DIR, dispositivo.imagemUrlCliente.replace(/^\/uploads\//, ''));
      fs.unlink(oldPath, () => {});
    }

    const imagemUrlCliente = `/uploads/cliente/${req.file.filename}`;
    await prisma.dispositivo.update({
      where: { id: dispositivoId },
      data: { imagemUrlCliente },
    });

    res.json({ imagemUrlCliente });
  },
);

// ── DELETE /api/cliente/dispositivos/:id/foto ─────────────────────────────────
router.delete('/dispositivos/:dispositivoId/foto', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'dispositivoId');

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
    },
    select: { id: true, imagemUrlCliente: true },
  });
  if (!dispositivo || !dispositivo.imagemUrlCliente) {
    res.status(404).json({ error: 'Foto não encontrada.' });
    return;
  }

  const filePath = path.join(UPLOADS_DIR, dispositivo.imagemUrlCliente.replace(/^\/uploads\//, ''));
  fs.unlink(filePath, () => {});

  await prisma.dispositivo.update({
    where: { id: dispositivoId },
    data: { imagemUrlCliente: null },
  });

  res.status(204).send();
});

// ── GET /api/cliente/dispositivos/:dispositivoId/tipos-comandos ───────────────
router.get('/dispositivos/:dispositivoId/tipos-comandos', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'dispositivoId');

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
    },
    select: { identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado.' }); return; }

  try {
    const tipos = await traccarGetCommandTypes(traccarDevice.id);
    res.json(tipos);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao buscar tipos de comando.' });
  }
});

// ── POST /api/cliente/dispositivos/:dispositivoId/comandos ────────────────────
router.post('/dispositivos/:dispositivoId/comandos', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'dispositivoId');
  const { tipo, atributos } = req.body as { tipo: string; atributos?: Record<string, any> };

  if (!tipo) { res.status(400).json({ error: 'Tipo de comando é obrigatório.' }); return; }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      OR: [{ clienteId }, { clientesVinculados: { some: { clienteId } } }],
    },
    select: { identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado.' }); return; }

  try {
    await traccarSendCommand(traccarDevice.id, tipo, atributos || {});
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao enviar comando.' });
  }
});

// ── GET /api/cliente/rastreamento/cercas ──────────────────────────────────────
// Retorna cercas vinculadas a dispositivos deste cliente
router.get('/rastreamento/cercas', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;

  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      OR: [
        { clienteId: clienteId },
        { clientesVinculados: { some: { clienteId: clienteId } } }
      ]
    },
    select: { identificador: true },
  });

  const todasCercas: unknown[] = [];
  const vistos = new Set<number>();

  for (const d of dispositivos) {
    const td = await traccarGetDeviceByImei(d.identificador).catch(() => null);
    if (!td) continue;
    const cercas = await traccarGetGeofences(td.id).catch(() => []);
    for (const c of cercas) {
      if (!vistos.has(c.id)) {
        vistos.add(c.id);
        todasCercas.push(c);
      }
    }
  }

  res.json(todasCercas);
});

// ── POST /api/cliente/rastreamento/cercas ─────────────────────────────────────
router.post('/rastreamento/cercas', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;

  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const { nome, area, dispositivoId } = req.body as { nome: string; area: string; dispositivoId?: string };
  if (!nome || !area) { res.status(400).json({ error: 'Campos "nome" e "area" são obrigatórios.' }); return; }

  // Verifica que o dispositivo pertence ao cliente (direta ou indiretamente)
  if (dispositivoId) {
    const dispositivo = await prisma.dispositivo.findFirst({
      where: {
        id: dispositivoId,
        OR: [
          { clienteId: clienteId },
          { clientesVinculados: { some: { clienteId: clienteId } } }
        ]
      },
      select: { identificador: true },
    });
    if (!dispositivo) { res.status(403).json({ error: 'Dispositivo não autorizado.' }); return; }

    try {
      const cerca = await traccarCreateGeofence(nome, area);
      const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
      if (traccarDevice) {
        await traccarLinkGeofenceToDevice(cerca.id, traccarDevice.id).catch(() => {});
      }
      res.json(cerca);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Erro ao criar cerca: ${msg}` });
    }
    return;
  }

  try {
    const cerca = await traccarCreateGeofence(nome, area);
    res.json(cerca);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao criar cerca: ${msg}` });
  }
});

// ── DELETE /api/cliente/rastreamento/cercas/:id ───────────────────────────────
router.delete('/rastreamento/cercas/:id', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;

  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const geofenceId = parseInt(param(req, 'id'));
  if (isNaN(geofenceId)) { res.status(400).json({ error: 'ID inválido.' }); return; }

  try {
    await traccarDeleteGeofence(geofenceId);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao remover cerca: ${msg}` });
  }
});

export default router;
