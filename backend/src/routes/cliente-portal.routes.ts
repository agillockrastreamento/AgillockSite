import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { clienteAuthMiddleware, requireResponsavel, ClienteRequest } from '../middleware/cliente-auth.middleware';
import { query } from '../utils/params';
import prisma from '../utils/prisma';
import {
  traccarGetDevices,
  traccarGetPositions,
  traccarGetPositionHistory,
  traccarGetTrips,
} from '../services/traccar.service';

const router = Router();
router.use(clienteAuthMiddleware);

// ── Upload de foto do veículo ─────────────────────────────────────────────────

const uploadCliente = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.resolve(process.cwd(), 'uploads/cliente');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
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

  const resultado = dispositivos.map(d => {
    const traccar = traccarByImei.get(d.identificador);
    const posicao = traccar ? posicaoPorDeviceId.get(traccar.id) : undefined;

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

// ── GET /api/cliente/rastreamento/dispositivos/:id/historico ─────────────────
router.get('/rastreamento/dispositivos/:id/historico', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = req.params.id;
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
    select: { id: true, nome: true, identificador: true, placa: true },
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

// ── GET /api/cliente/rastreamento/dispositivos/:id/viagens ───────────────────
router.get('/rastreamento/dispositivos/:id/viagens', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = req.params.id;
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
    select: { id: true, identificador: true },
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

// ── GET /api/cliente/boletos ──────────────────────────────────────────────────
router.get('/boletos', requireResponsavel, async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const { status, dataVencDe, dataVencAte, placaId } = req.query as Record<string, string>;

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
    const { dispositivoId } = req.params;

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
      const oldPath = path.resolve(process.cwd(), dispositivo.imagemUrlCliente.replace(/^\//, ''));
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
  const { dispositivoId } = req.params;

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

  const filePath = path.resolve(process.cwd(), dispositivo.imagemUrlCliente.replace(/^\//, ''));
  fs.unlink(filePath, () => {});

  await prisma.dispositivo.update({
    where: { id: dispositivoId },
    data: { imagemUrlCliente: null },
  });

  res.status(204).send();
});

export default router;
