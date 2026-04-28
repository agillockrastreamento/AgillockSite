import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { signShareToken, verifyShareToken } from '../utils/jwt';
import prisma from '../utils/prisma';
import {
  traccarGetDevices,
  traccarGetDeviceByImei,
  traccarGetPositions,
  traccarGetPositionHistory,
} from '../services/traccar.service';
import { param, query } from '../utils/params';
import {
  decorarPosicaoComMedidores,
  DISPOSITIVO_MEDIDORES_SELECT,
} from '../services/medidores.service';

const router = Router();
const SECRET = process.env.JWT_SECRET!;

// POST /api/compartilhamento/gerar — qualquer usuário autenticado (admin, colaborador, cliente)
router.post('/gerar', async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }
  try {
    jwt.verify(authHeader.split(' ')[1], SECRET);
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
    return;
  }

  const dispositivoId = String(req.body?.dispositivoId || '').trim();
  if (!dispositivoId) {
    res.status(400).json({ error: 'dispositivoId é obrigatório.' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: { id: dispositivoId, ativo: true },
    select: { id: true, nome: true },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  const token = signShareToken(dispositivoId);
  res.json({ token });
});

// GET /api/compartilhamento/:token/dados — público
router.get('/:token/dados', async (req: Request, res: Response): Promise<void> => {
  let dispositivoId: string;
  try {
    ({ dispositivoId } = verifyShareToken(param(req, 'token')));
  } catch {
    res.status(401).json({ error: 'Link inválido ou expirado.' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: { id: dispositivoId, ativo: true },
    select: {
      id: true, nome: true, placa: true, categoria: true, cor: true,
      imagemUrl: true, limiteVelocidade: true, identificador: true,
      marca: true, modeloVeiculo: true,
      ...DISPOSITIVO_MEDIDORES_SELECT,
    },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  let posicao = null;
  let status = 'unknown';
  let lastUpdate: string | null = null;

  try {
    const traccarDevices = await traccarGetDevices();
    const traccarDevice = traccarDevices.find(d => d.uniqueId === dispositivo.identificador);
    if (traccarDevice) {
      status = traccarDevice.status;
      lastUpdate = traccarDevice.lastUpdate;
      const posicoes = await traccarGetPositions([traccarDevice.id]);
      const pos = posicoes[0];
      if (pos) posicao = decorarPosicaoComMedidores(dispositivo, pos);
    }
  } catch { /* sem posição disponível */ }

  res.json({
    dispositivoId: dispositivo.id,
    nome: dispositivo.nome,
    placa: dispositivo.placa,
    categoria: dispositivo.categoria,
    cor: dispositivo.cor,
    imagemUrl: dispositivo.imagemUrl,
    limiteVelocidade: dispositivo.limiteVelocidade,
    marca: dispositivo.marca,
    modeloVeiculo: dispositivo.modeloVeiculo,
    status,
    lastUpdate,
    posicao,
  });
});

// GET /api/compartilhamento/:token/historico — público
router.get('/:token/historico', async (req: Request, res: Response): Promise<void> => {
  let dispositivoId: string;
  try {
    ({ dispositivoId } = verifyShareToken(param(req, 'token')));
  } catch {
    res.status(401).json({ error: 'Link inválido ou expirado.' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: { id: dispositivoId, ativo: true },
    select: { id: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado.' });
    return;
  }

  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();

  try {
    const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
    if (!traccarDevice) { res.json({ posicoes: [] }); return; }
    const historico = await traccarGetPositionHistory([traccarDevice.id], from, to);
    res.json({ posicoes: historico.map(p => decorarPosicaoComMedidores(dispositivo, p)) });
  } catch {
    res.json({ posicoes: [] });
  }
});

// GET /api/compartilhamento/:token/geocode — público
router.get('/:token/geocode', async (req: Request, res: Response): Promise<void> => {
  try {
    verifyShareToken(param(req, 'token'));
  } catch {
    res.status(401).json({ error: 'Link inválido ou expirado.' });
    return;
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: 'Coordenadas inválidas.' });
    return;
  }

  try {
    const googleKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_JS_API_KEY;
    if (googleKey) {
      const params = new URLSearchParams({ latlng: `${lat},${lon}`, language: 'pt-BR', key: googleKey });
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
      if (r.ok) {
        const d = await r.json() as { status?: string; results?: Array<{ formatted_address?: string }> };
        if (d.status === 'OK' && d.results?.[0]?.formatted_address) {
          res.json({ endereco: d.results[0].formatted_address });
          return;
        }
      }
    }
    const params = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), 'accept-language': 'pt-BR' });
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'User-Agent': 'AgilLockRastreamento/1.0', 'Accept': 'application/json' },
    });
    if (r.ok) {
      const d = await r.json() as { display_name?: string };
      res.json({ endereco: d.display_name || '' });
    } else {
      res.json({ endereco: '' });
    }
  } catch {
    res.json({ endereco: '' });
  }
});

export default router;
