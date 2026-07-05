import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import {
  clienteAuthMiddleware,
  requireResponsavel,
  requirePermission,
  podeAcessarDispositivo,
  whereDispositivosDoCliente,
  ClienteRequest,
} from '../middleware/cliente-auth.middleware';
import { query, param } from '../utils/params';
import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';
import {
  traccarGetDevices,
  traccarGetDeviceByImei,
  traccarGetPositions,
  traccarUpdateDeviceAccumulators,
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
  traccarUpdateGeofence,
  traccarDeleteGeofence,
  traccarLinkGeofenceToDevice,
  traccarUnlinkGeofenceFromDevice,
  normalizeAttributes,
  EVENT_TYPE_LABELS,
} from '../services/traccar.service';
import NotificationService from '../services/notification.service';
import {
  DISPOSITIVO_MEDIDORES_SELECT,
  sincronizarDispositivosComPosicoes,
  decorarPosicaoComMedidores,
  aplicarResumoComMedidores,
  aplicarViagensComMedidores,
  aplicarParadasComMedidores,
  calcularOciosidade,
} from '../services/medidores.service';
import { CLIENTE_UPLOADS_DIR, UPLOADS_DIR } from '../utils/upload-paths';

const router = Router();
router.use(clienteAuthMiddleware);

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

function parseDeviceIdsParam(deviceIds: string[] | string): string[] {
  const valores = Array.isArray(deviceIds) ? deviceIds : [deviceIds];
  return [...new Set(valores.flatMap(valor => String(valor).split(',')).map(valor => valor.trim()).filter(Boolean))];
}

function formatarEnderecoNominatim(address: Record<string, unknown> = {}): string {
  const partes: string[] = [];
  const texto = (valor: unknown) => typeof valor === 'string' && valor.trim() ? valor.trim() : '';
  const amenity = texto(address.amenity);
  const road = texto(address.road);
  const houseNumber = texto(address.house_number);
  const bairro = texto(address.suburb) || texto(address.neighbourhood) || texto(address.quarter);
  const cidade = texto(address.city) || texto(address.town) || texto(address.village) || texto(address.municipality);
  const state = texto(address.state);
  const postcode = texto(address.postcode);
  const country = texto(address.country);
  if (amenity) partes.push(amenity);
  if (road) partes.push(houseNumber ? `${road}, ${houseNumber}` : road);
  if (bairro) partes.push(bairro);
  if (cidade) partes.push(cidade);
  if (state) partes.push(state);
  if (postcode) partes.push(postcode);
  if (country) partes.push(country);
  return partes.join(', ');
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('Coordenadas inválidas.');
  }
  const googleKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_JS_API_KEY;
  if (googleKey) {
    try {
      const googleParams = new URLSearchParams({
        latlng: `${lat},${lon}`,
        language: 'pt-BR',
        key: googleKey,
      });
      const googleRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${googleParams.toString()}`);
      if (googleRes.ok) {
        const googleData = await googleRes.json() as { status?: string; results?: Array<{ formatted_address?: string }> };
        const enderecoGoogle = googleData.status === 'OK' ? googleData.results?.[0]?.formatted_address : '';
        if (enderecoGoogle) return enderecoGoogle;
      }
    } catch {
      // fallback abaixo
    }
  }
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    'accept-language': 'pt-BR',
  });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        'User-Agent': 'AgilLockRastreamento/1.0 (https://agillock.com.br)',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return '';
    const data = await res.json() as { display_name?: string; address?: Record<string, unknown> };
    return formatarEnderecoNominatim(data.address) || data.display_name || '';
  } catch {
    return '';
  }
}

async function responderReverseGeocode(req: ClienteRequest, res: Response): Promise<void> {
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

async function resolverDispositivosCliente(req: ClienteRequest, idsParam: string[] | string) {
  const ids = parseDeviceIdsParam(idsParam);
  if (!ids.length) return { dispositivos: [], traccarDevices: [], traccarIds: [] as number[] };
  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      id: { in: ids },
      ativo: true,
      ...whereDispositivosDoCliente(req),
    },
    select: { id: true, nome: true, placa: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivos.length) return { dispositivos: [], traccarDevices: [], traccarIds: [] as number[] };
  const traccarDevices = await traccarGetDevices();
  const traccarByImei = new Map(traccarDevices.map(d => [d.uniqueId, d]));
  const vinculados = dispositivos
    .map(dispositivo => ({ dispositivo, traccar: traccarByImei.get(dispositivo.identificador) }))
    .filter((item): item is { dispositivo: typeof dispositivos[number]; traccar: typeof traccarDevices[number] } => !!item.traccar);
  return {
    dispositivos: vinculados.map(item => item.dispositivo),
    traccarDevices: vinculados.map(item => item.traccar),
    traccarIds: vinculados.map(item => item.traccar.id),
  };
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
router.get('/rastreamento/geocode/reverse', responderReverseGeocode);

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

// ── GET e POST /api/cliente/rastreamento/prefs ──────────────────────────────
router.get('/rastreamento/prefs', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const row = await prisma.clienteLogin.findUnique({ where: { id: req.cliente!.sub } });
    res.json({ prefs: (row?.prefs as any) ?? {} });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter preferências.' });
  }
});

router.post('/rastreamento/prefs', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const { prefs } = req.body;
    if (!prefs || typeof prefs !== 'object') {
      res.status(400).json({ error: 'Payload inválido.' });
      return;
    }
    await prisma.clienteLogin.update({
      where: { id: req.cliente!.sub },
      data: { prefs },
    });
    res.json({ message: 'Preferências salvas com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar preferências.' });
  }
});

router.post('/rastreamento/prefs/merge', async (req: ClienteRequest, res: Response): Promise<void> => {
  try {
    const { prefs: partialPrefs } = req.body;
    if (!partialPrefs || typeof partialPrefs !== 'object') {
      res.status(400).json({ error: 'Payload inválido.' });
      return;
    }
    const row = await prisma.clienteLogin.findUnique({ where: { id: req.cliente!.sub } });
    const currentPrefs = (row?.prefs as any) || {};
    const newPrefs = { ...currentPrefs, ...partialPrefs };

    await prisma.clienteLogin.update({
      where: { id: req.cliente!.sub },
      data: { prefs: newPrefs },
    });
    res.json({ message: 'Preferências salvas com sucesso!', prefs: newPrefs });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar preferências.' });
  }
});

// ── GET /api/cliente/rastreamento/posicoes ────────────────────────────────────
router.get('/rastreamento/posicoes', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;

  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }

  // Permissão (definida pelo admin) de o cliente editar odômetro/horímetro.
  const clienteAtual = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { podeEditarMedidores: true },
  });
  const podeEditarMedidores = clienteAtual?.podeEditarMedidores === true;

  // Busca dispositivos do cliente (responsável direto + vinculados)
  const [dispoResult, traccarResult] = await Promise.allSettled([
    prisma.dispositivo.findMany({
      where: {
        ativo: true,
        ...whereDispositivosDoCliente(req),
      },
      select: {
        id: true, nome: true, identificador: true, placa: true,
        categoria: true, marca: true, modeloVeiculo: true, cor: true,
        limiteVelocidade: true, imagemUrlCliente: true, apelidoCliente: true, clienteId: true, manutencaoAtiva: true,
        mapa: true,
        ...DISPOSITIVO_MEDIDORES_SELECT,
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
    const motorista = d.motoristasVinculados && d.motoristasVinculados.length > 0 ? d.motoristasVinculados[0].motorista : null;

    return {
      dispositivoId: d.id,
      nome: d.nome,
      placa: d.placa,
      categoria: d.categoria,
      motorista: motorista,
      imagemUrlCliente: d.imagemUrlCliente,
      apelidoCliente: d.apelidoCliente,
      marca: d.marca,
      modeloVeiculo: d.modeloVeiculo,
      cor: d.cor,
      limiteVelocidade: d.limiteVelocidade,
      mapa: d.mapa,
      podeGerenciarManutencao: d.clienteId === clienteId,
      // Só o cliente titular (responsável) do dispositivo pode editar os medidores,
      // e apenas quando o admin habilitou a permissão para este cliente.
      podeEditarMedidores: podeEditarMedidores && d.clienteId === clienteId,
      manutencaoAtiva: d.manutencaoAtiva,
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
      ...whereDispositivosDoCliente(req),
    },
    select: { id: true, nome: true, identificador: true, placa: true, categoria: true, ...DISPOSITIVO_MEDIDORES_SELECT },
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

  // Segmentos ociosos (motor ligado + parado) para marcar os pontos no mapa do relatório.
  const ociosos = calcularOciosidade(historico).segmentos.map(s => ({
    deviceId: traccarDevice.id,
    inicio: s.inicio,
    fim: s.fim,
    latitude: s.latitude,
    longitude: s.longitude,
    duracaoMin: Math.round(s.duracaoMs / 60000),
  }));

  res.json({
    dispositivo: { id: dispositivo.id, nome: dispositivo.nome, placa: dispositivo.placa, categoria: dispositivo.categoria },
    total: historico.length,
    posicoes: historico.map(p => decorarPosicaoComMedidores(dispositivo, p)),
    ociosos,
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
      ...whereDispositivosDoCliente(req),
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
      ...whereDispositivosDoCliente(req),
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
// Aceita rastreamento.verEventos (painel do mapa) OU relatorio.ver (aba Eventos do relatório).
router.get('/rastreamento/dispositivos/:id/eventos', async (req: ClienteRequest, res: Response, next): Promise<void> => {
  const perms = req.cliente!.permissoes;
  if (!perms.rastreamento.verEventos && !perms.relatorio.ver) {
    res.status(403).json({ error: 'Sem permissão para esta ação.' });
    return;
  }
  next();
}, async (req: ClienteRequest, res: Response): Promise<void> => {
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
      ...whereDispositivosDoCliente(req),
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

  const allowedGeocercas = await prisma.geocerca.findMany({
    where: {
      ativa: true,
      AND: [{ OR: [{ dataInicio: null }, { dataInicio: { lte: new Date() } }] }],
      OR: [
        { origemTipo: 'CLIENTE', clienteId },
        { origemTipo: 'ADMIN', visivelCliente: true, dispositivos: { some: { dispositivoId: dispositivo.id } } },
      ],
    },
    select: { traccarId: true },
  });
  const allowedSet = new Set(allowedGeocercas.map(g => g.traccarId));

  res.json(eventos
    .filter(e => !(e.type === 'geofenceEnter' || e.type === 'geofenceExit') || allowedSet.has(e.geofenceId))
    .map(e => ({
      id: e.id,
      tipo: e.type,
      tipoLabel: EVENT_TYPE_LABELS[e.type] ?? e.type,
      hora: e.eventTime,
      posicaoId: e.positionId,
      atributos: e.attributes,
      geofenceId: e.geofenceId,
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
      ...whereDispositivosDoCliente(req),
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

// ── GET /api/cliente/rastreamento/dispositivos/:id/ocioso ────────────────────
// Tempo de motor ocioso (ligado com o veículo parado) no período.
router.get('/rastreamento/dispositivos/:id/ocioso', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'id');
  const from = query(req.query.from);
  const to = query(req.query.to);

  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: { id: dispositivoId, ativo: true, ...whereDispositivosDoCliente(req) },
    select: { id: true, identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado.' }); return; }

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

router.get('/rastreamento/relatorios/batch/historico', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const { from, to } = req.query as { from?: string; to?: string };
  const deviceIds = req.query.deviceId as string[] | string;
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }
  try {
    const { dispositivos, traccarDevices, traccarIds } = await resolverDispositivosCliente(req, deviceIds);
    if (!traccarIds.length) { res.status(404).json({ error: 'Nenhum dispositivo sincronizado.' }); return; }
    const localPorIdentificador = new Map(dispositivos.map(d => [d.identificador, d]));
    const identificadorPorTraccarId = new Map(traccarDevices.map(d => [d.id, d.uniqueId]));
    const historico = await traccarGetPositionHistory(traccarIds, new Date(from), new Date(to));

    // Segmentos ociosos (motor ligado + parado) por dispositivo, para marcar no mapa do relatório.
    const ociosos = traccarIds.flatMap(deviceId =>
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
      dispositivos,
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao buscar histórico: ${msg}` });
  }
});

router.get('/rastreamento/relatorios/batch/viagens', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const { from, to } = req.query as { from?: string; to?: string };
  const deviceIds = req.query.deviceId as string[] | string;
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }
  try {
    const { dispositivos, traccarDevices, traccarIds } = await resolverDispositivosCliente(req, deviceIds);
    if (!traccarIds.length) { res.status(404).json({ error: 'Nenhum dispositivo sincronizado.' }); return; }
    const localPorTraccarId = new Map(traccarDevices.map(device => [device.id, dispositivos.find(local => local.identificador === device.uniqueId)]));
    const [viagens, historico] = await Promise.all([
      traccarGetTrips(traccarIds, new Date(from), new Date(to)),
      traccarGetPositionHistory(traccarIds, new Date(from), new Date(to)).catch(() => []),
    ]);
    res.json(viagens.map(viagem => {
      const dispositivo = localPorTraccarId.get(viagem.deviceId);
      const viagemComMedidores = dispositivo ? aplicarViagensComMedidores(dispositivo, [viagem], historico)[0] : viagem;
      const posInicio = posicaoMaisProxima(historico, viagem.deviceId, viagem.startTime);
      const posFim = posicaoMaisProxima(historico, viagem.deviceId, viagem.endTime);
      return {
        ...viagemComMedidores,
        startAddress: temEndereco(viagemComMedidores.startAddress) ? viagemComMedidores.startAddress : posInicio?.address ?? viagemComMedidores.startAddress,
        startLat: viagemComMedidores.startLat || posInicio?.latitude || 0,
        startLon: viagemComMedidores.startLon || posInicio?.longitude || 0,
        endAddress: temEndereco(viagemComMedidores.endAddress) ? viagemComMedidores.endAddress : posFim?.address ?? viagemComMedidores.endAddress,
        endLat: viagemComMedidores.endLat || posFim?.latitude || 0,
        endLon: viagemComMedidores.endLon || posFim?.longitude || 0,
      };
    }));
  } catch { res.status(502).json({ error: 'Erro ao buscar viagens.' }); }
});

router.get('/rastreamento/relatorios/batch/paradas', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const { from, to } = req.query as { from?: string; to?: string };
  const deviceIds = req.query.deviceId as string[] | string;
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }
  try {
    const { traccarIds } = await resolverDispositivosCliente(req, deviceIds);
    if (!traccarIds.length) { res.status(404).json({ error: 'Nenhum dispositivo sincronizado.' }); return; }
    const [paradas, historico] = await Promise.all([
      traccarGetStops(traccarIds, new Date(from), new Date(to)),
      traccarGetPositionHistory(traccarIds, new Date(from), new Date(to)).catch(() => []),
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
  } catch { res.status(502).json({ error: 'Erro ao buscar paradas.' }); }
});

// Eventos no contexto do RELATÓRIO — não exige permissão de "ver eventos no mapa".
// O acesso à tela de relatório já é controlado pelo frontend via `relatorio.ver`.
router.get('/rastreamento/relatorios/batch/eventos', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const { from, to } = req.query as { from?: string; to?: string };
  const deviceIds = req.query.deviceId as string[] | string;
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }
  try {
    const { traccarIds } = await resolverDispositivosCliente(req, deviceIds);
    if (!traccarIds.length) { res.status(404).json({ error: 'Nenhum dispositivo sincronizado.' }); return; }
    const eventos = await traccarGetEvents(traccarIds, new Date(from), new Date(to));
    res.json(eventos.map(e => ({ id: e.id, deviceId: e.deviceId, tipo: e.type, tipoLabel: EVENT_TYPE_LABELS[e.type] ?? e.type, hora: e.eventTime, atributos: e.attributes })));
  } catch { res.status(502).json({ error: 'Erro ao buscar eventos.' }); }
});

router.get('/rastreamento/relatorios/batch/resumo', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const { from, to } = req.query as { from?: string; to?: string };
  const deviceIds = req.query.deviceId as string[] | string;
  if (!from || !to || !deviceIds) { res.status(400).json({ error: 'Parâmetros incompletos.' }); return; }
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }
  try {
    const { dispositivos, traccarDevices, traccarIds } = await resolverDispositivosCliente(req, deviceIds);
    if (!traccarIds.length) { res.status(404).json({ error: 'Nenhum dispositivo sincronizado.' }); return; }
    const localPorTraccarId = new Map(traccarDevices.map(device => [device.id, dispositivos.find(local => local.identificador === device.uniqueId)]));
    const [resumo, historico] = await Promise.all([
      traccarGetSummary(traccarIds, new Date(from), new Date(to)),
      traccarGetPositionHistory(traccarIds, new Date(from), new Date(to)).catch(() => []),
    ]);
    res.json(resumo.map(item => {
      const dispositivo = localPorTraccarId.get(item.deviceId);
      return dispositivo ? aplicarResumoComMedidores(dispositivo, item, historico.filter(posicao => posicao.deviceId === item.deviceId)) : item;
    }));
  } catch { res.status(502).json({ error: 'Erro ao buscar resumo.' }); }
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
      ...whereDispositivosDoCliente(req),
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
    const response = await traccarExportReport(type as 'route' | 'events' | 'trips' | 'stops' | 'summary', [traccarDevice.id], from, to);
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio_${type}.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro na exportação: ${msg}` });
  }
});

router.get('/rastreamento/relatorios/exportar', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const from = query(req.query.from);
  const to = query(req.query.to);
  const type = query(req.query.type) || 'route';
  const deviceIds = req.query.deviceId as string[] | string;
  if (!from || !to || !deviceIds || !['route', 'events', 'trips', 'stops', 'summary'].includes(type)) {
    res.status(400).json({ error: 'Parâmetros incompletos.' });
    return;
  }
  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }
  try {
    const { traccarIds } = await resolverDispositivosCliente(req, deviceIds);
    if (!traccarIds.length) { res.status(404).json({ error: 'Nenhum dispositivo sincronizado.' }); return; }
    const response = await traccarExportReport(type as 'route' | 'events' | 'trips' | 'stops' | 'summary', traccarIds, from, to);
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
  // Boletos cancelados nunca são exibidos ao cliente
  if (status === 'aberto') {
    where.status = { in: ['PENDENTE', 'ATRASADO'] };
  } else if (status && status !== 'CANCELADO') {
    where.status = status;
  } else {
    where.status = { not: 'CANCELADO' };
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
  requirePermission('rastreamento.uploadFoto'),
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
        ...whereDispositivosDoCliente(req),
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

// ── PATCH /api/cliente/dispositivos/:id/apelido ───────────────────────────────
router.patch('/dispositivos/:dispositivoId/apelido', requirePermission('rastreamento.editarIdentificacao'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'dispositivoId');
  const apelidoCliente = String(req.body?.apelidoCliente || '').trim().slice(0, 40);

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      ativo: true,
      ...whereDispositivosDoCliente(req),
    },
    select: { id: true },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' });
    return;
  }

  await prisma.dispositivo.update({
    where: { id: dispositivoId },
    data: { apelidoCliente: apelidoCliente || null },
  });

  res.json({ apelidoCliente: apelidoCliente || null });
});

// ── PATCH /api/cliente/dispositivos/:dispositivoId/medidores ──────────────────
// Cliente edita odômetro/horímetro do próprio dispositivo (mesma lógica do admin),
// desde que o admin tenha habilitado a permissão (cliente.podeEditarMedidores).
router.patch('/dispositivos/:dispositivoId/medidores', async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'dispositivoId');
  const { odometro, horimetro } = req.body as { odometro?: number | null; horimetro?: number | null };

  if (await verificarBloqueio(clienteId)) {
    res.status(403).json({ error: 'acesso_bloqueado' });
    return;
  }

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { podeEditarMedidores: true },
  });
  if (!cliente?.podeEditarMedidores) {
    res.status(403).json({ error: 'Sem permissão para editar os medidores.' });
    return;
  }

  // Só o titular do dispositivo (responsável) pode editar — medidores são globais.
  const dispositivo = await prisma.dispositivo.findFirst({
    where: { id: dispositivoId, clienteId, ...whereDispositivosDoCliente(req) },
    select: { id: true, identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  if (!dispositivo) {
    res.status(404).json({ error: 'Dispositivo não encontrado ou sem permissão.' });
    return;
  }

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
    where: { id: dispositivoId },
    data,
    select: { id: true, odometroSistemaMetros: true, horimetroSistemaSegundos: true },
  });

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

// ── DELETE /api/cliente/dispositivos/:id/foto ─────────────────────────────────
router.delete('/dispositivos/:dispositivoId/foto', requirePermission('rastreamento.uploadFoto'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'dispositivoId');

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      ...whereDispositivosDoCliente(req),
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
      ...whereDispositivosDoCliente(req),
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

  // Permissões: engineStop=bloquear, engineResume=desbloquear.
  // Outros comandos seguem 'bloquear' como permissão padrão (mesma criticidade).
  const perms = req.cliente!.permissoes.rastreamento;
  if (tipo === 'engineStop' && !perms.bloquear) {
    res.status(403).json({ error: 'Sem permissão para bloquear o veículo.' });
    return;
  }
  if (tipo === 'engineResume' && !perms.desbloquear) {
    res.status(403).json({ error: 'Sem permissão para desbloquear o veículo.' });
    return;
  }
  if (tipo !== 'engineStop' && tipo !== 'engineResume' && !perms.bloquear) {
    res.status(403).json({ error: 'Sem permissão para enviar comandos a este dispositivo.' });
    return;
  }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: {
      id: dispositivoId,
      ...whereDispositivosDoCliente(req),
    },
    select: { identificador: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
  if (!traccarDevice) { res.status(404).json({ error: 'Dispositivo não sincronizado.' }); return; }

  try {
    await traccarSendCommand(traccarDevice.id, tipo, atributos || {});

    if (tipo === 'engineStop' || tipo === 'engineResume') {
      const evtTipo = tipo === 'engineStop' ? 'deviceLocked' : 'deviceUnlocked';
      NotificationService.processarEvento(dispositivo.identificador, evtTipo, {
        latitude: null, longitude: null, velocidade: null, endereco: null,
      }).catch(err => console.error('[Notificações] Erro notif comando:', err.message));
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao enviar comando.' });
  }
});

// ── GET /api/cliente/rastreamento/cercas ─────────────────────────────────────
// Returns: client's own geofences + admin geofences marked visivelCliente=true
router.get('/rastreamento/cercas', requirePermission('rastreamento.verCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const dispositivosIds = (await prisma.dispositivo.findMany({
    where: { ...whereDispositivosDoCliente(req) },
    select: { id: true },
  })).map(d => d.id);

  const geocercas = await prisma.geocerca.findMany({
    where: {
      ativa: true,
      AND: [{ OR: [{ dataInicio: null }, { dataInicio: { lte: new Date() } }] }],
      OR: [
        { origemTipo: 'CLIENTE', clienteId },
        { origemTipo: 'ADMIN', visivelCliente: true, dispositivos: { some: { dispositivoId: { in: dispositivosIds } } } },
      ],
    },
    select: {
      traccarId: true, nome: true, descricao: true, area: true, criadaNoMapa: true,
      // Mapas (1/2) dos dispositivos do cliente vinculados à cerca, para o
      // frontend exibir a cerca apenas no mapa ativo correspondente.
      dispositivos: {
        where: { dispositivoId: { in: dispositivosIds } },
        select: { dispositivo: { select: { mapa: true } } },
      },
    },
  });

  res.json(geocercas.map(g => ({
    id: g.traccarId,
    name: g.nome,
    description: g.descricao ?? '',
    area: g.area,
    criadaNoMapa: g.criadaNoMapa,
    mapas: [...new Set(g.dispositivos.map(d => (Number(d.dispositivo?.mapa) === 2 ? 2 : 1)))],
  })));
});

router.get('/rastreamento/dispositivos/:dispositivoId/cercas', requirePermission('rastreamento.verCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  const dispositivoId = param(req, 'dispositivoId');
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const dispositivo = await prisma.dispositivo.findFirst({
    where: { id: dispositivoId, ...whereDispositivosDoCliente(req) },
    select: { id: true },
  });
  if (!dispositivo) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }

  // Apenas as cercas individuais que o próprio cliente criou no mapa controlam o
  // botão "Cerca" do veículo focado. Cercas da tela de Geocercas (criadaNoMapa=false)
  // e cercas ADMIN não ativam o botão — assim o cliente ainda consegue criar uma
  // cerca individual mesmo com uma geocerca abrangente ativa.
  const geocercas = await prisma.geocerca.findMany({
    where: {
      ativa: true,
      origemTipo: 'CLIENTE',
      clienteId,
      criadaNoMapa: true,
      dispositivos: { some: { dispositivoId } },
    },
    select: { traccarId: true, nome: true, descricao: true, area: true },
  });

  res.json(geocercas.map(g => ({ id: g.traccarId, name: g.nome, description: g.descricao ?? '', area: g.area })));
});

// ── POST /api/cliente/rastreamento/cercas ─────────────────────────────────────
router.post('/rastreamento/cercas', requirePermission('rastreamento.criarCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const { nome, area, dispositivoId } = req.body as { nome: string; area: string; dispositivoId?: string };
  if (!nome || !area) { res.status(400).json({ error: 'Campos "nome" e "area" são obrigatórios.' }); return; }

  if (dispositivoId) {
    const dispositivo = await prisma.dispositivo.findFirst({
      where: { id: dispositivoId, ...whereDispositivosDoCliente(req) },
      select: { id: true, identificador: true },
    });
    if (!dispositivo) { res.status(403).json({ error: 'Dispositivo não autorizado.' }); return; }

    try {
      const cerca = await traccarCreateGeofence(nome, area);
      const traccarDevice = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
      if (traccarDevice) await traccarLinkGeofenceToDevice(cerca.id, traccarDevice.id).catch(() => {});

      const geocerca = await prisma.geocerca.create({
        data: {
          traccarId: cerca.id, nome, area,
          tipo: area.toUpperCase().startsWith('CIRCLE') ? 'circulo' : 'poligono',
          origemTipo: 'CLIENTE', clienteId, criadaNoMapa: true,
          visivelCliente: false, notificarCliente: false,
        },
      });
      await prisma.geocercaDispositivo.create({ data: { geocercaId: geocerca.id, dispositivoId: dispositivo.id } }).catch(() => {});
      res.json(cerca);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Erro ao criar cerca: ${msg}` });
    }
    return;
  }

  try {
    const cerca = await traccarCreateGeofence(nome, area);
    await prisma.geocerca.create({
      data: {
        traccarId: cerca.id, nome, area,
        tipo: area.toUpperCase().startsWith('CIRCLE') ? 'circulo' : 'poligono',
        origemTipo: 'CLIENTE', clienteId, criadaNoMapa: true,
        visivelCliente: false, notificarCliente: false,
      },
    });
    res.json(cerca);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao criar cerca: ${msg}` });
  }
});

// ── DELETE /api/cliente/rastreamento/cercas/:id ──────────────────────────────
router.delete('/rastreamento/cercas/:id', requirePermission('rastreamento.criarCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const geofenceId = parseInt(param(req, 'id'));
  if (isNaN(geofenceId)) { res.status(400).json({ error: 'ID inválido.' }); return; }

  // Only allow deleting client's own geofences
  const geocerca = await prisma.geocerca.findFirst({ where: { traccarId: geofenceId, origemTipo: 'CLIENTE', clienteId } });
  if (!geocerca) { res.status(403).json({ error: 'Não autorizado a remover esta cerca.' }); return; }

  try {
    await traccarDeleteGeofence(geofenceId);
    await prisma.geocerca.delete({ where: { id: geocerca.id } });
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao remover cerca: ${msg}` });
  }
});

// ── GET /api/cliente/rastreamento/geocercas ───────────────────────────────────
// Full-data list for the geocercas management page (only client's own)
router.get('/rastreamento/geocercas/dispositivos', requirePermission('rastreamento.verCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      ativo: true,
      ...whereDispositivosDoCliente(req),
    },
    select: { id: true, nome: true, placa: true, identificador: true },
    orderBy: [{ nome: 'asc' }, { placa: 'asc' }],
  });

  res.json(dispositivos.map(d => ({
    id: d.id,
    dispositivoId: d.id,
    nome: d.nome,
    placa: d.placa,
    identificador: d.identificador,
  })));
});

router.get('/rastreamento/geocercas', requirePermission('rastreamento.verCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const geocercas = await prisma.geocerca.findMany({
    where: { origemTipo: 'CLIENTE', clienteId },
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
    notificarCliente: g.notificarCliente,
    sistemasNotif: g.sistemasNotif,
    dataInicio: g.dataInicio,
    ativa: g.ativa,
    createdAt: g.createdAt,
    dispositivos: g.dispositivos.map(d => d.dispositivo),
  })));
});

// ── GET /api/cliente/rastreamento/geocercas/:id ───────────────────────────────
router.get('/rastreamento/geocercas/:id', requirePermission('rastreamento.verCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const id = param(req, 'id');
  const g = await prisma.geocerca.findFirst({
    where: { id, origemTipo: 'CLIENTE', clienteId },
    include: {
      dispositivos: {
        include: { dispositivo: { select: { id: true, nome: true, placa: true, identificador: true } } },
      },
    },
  });
  if (!g) { res.status(404).json({ error: 'Geocerca não encontrada.' }); return; }

  res.json({
    id: g.id,
    traccarId: g.traccarId,
    nome: g.nome,
    descricao: g.descricao,
    area: g.area,
    tipo: g.tipo,
    notificarCliente: g.notificarCliente,
    sistemasNotif: g.sistemasNotif,
    dataInicio: g.dataInicio,
    ativa: g.ativa,
    createdAt: g.createdAt,
    dispositivos: g.dispositivos.map(d => d.dispositivo),
  });
});

// ── POST /api/cliente/rastreamento/geocercas ──────────────────────────────────
router.post('/rastreamento/geocercas', requirePermission('rastreamento.criarCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const { nome, descricao, area, tipo, dispositivos: dispositivoIds, notificarCliente, sistemasNotif, dataInicio } =
    req.body as {
      nome: string; descricao?: string; area: string; tipo?: string;
      dispositivos?: string[]; notificarCliente?: boolean;
      sistemasNotif?: Record<string, boolean>; dataInicio?: string;
    };

  if (!nome || !area) { res.status(400).json({ error: 'Campos "nome" e "area" são obrigatórios.' }); return; }

  try {
    const cerca = await traccarCreateGeofence(nome, area);
    if (descricao) await traccarUpdateGeofence(cerca.id, nome, area, descricao).catch(() => {});

    const tipoForma = tipo || (area.toUpperCase().startsWith('CIRCLE') ? 'circulo' :
                      area.toUpperCase().startsWith('LINESTRING') ? 'linha' : 'poligono');

    const geocerca = await prisma.geocerca.create({
      data: {
        traccarId: cerca.id, nome, area,
        descricao: descricao ?? null,
        tipo: tipoForma,
        origemTipo: 'CLIENTE', clienteId,
        visivelCliente: false,
        notificarCliente: notificarCliente ?? false,
        sistemasNotif: sistemasNotif ?? Prisma.JsonNull,
        dataInicio: parseDataInicioSaoPaulo(dataInicio),
      },
    });

    // Vincular dispositivos
    if (Array.isArray(dispositivoIds) && dispositivoIds.length) {
      for (const dispositivoId of dispositivoIds) {
        const dispositivo = await prisma.dispositivo.findFirst({
          where: { id: dispositivoId, ...whereDispositivosDoCliente(req) },
          select: { id: true, identificador: true },
        });
        if (!dispositivo) continue;
        const td = await traccarGetDeviceByImei(dispositivo.identificador).catch(() => null);
        if (td) await traccarLinkGeofenceToDevice(cerca.id, td.id).catch(() => {});
        await prisma.geocercaDispositivo.create({ data: { geocercaId: geocerca.id, dispositivoId } }).catch(() => {});
      }
    }

    res.json({ id: geocerca.id, traccarId: geocerca.traccarId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao criar geocerca: ${msg}` });
  }
});

// ── PUT /api/cliente/rastreamento/geocercas/:id ───────────────────────────────
router.put('/rastreamento/geocercas/:id', requirePermission('rastreamento.criarCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const id = param(req, 'id');
  const geocerca = await prisma.geocerca.findFirst({ where: { id, origemTipo: 'CLIENTE', clienteId } });
  if (!geocerca) { res.status(404).json({ error: 'Geocerca não encontrada.' }); return; }

  const { nome, descricao, area, tipo, dispositivos: dispositivoIds, notificarCliente, sistemasNotif, dataInicio, ativa } =
    req.body as {
      nome?: string; descricao?: string; area?: string; tipo?: string;
      dispositivos?: string[]; notificarCliente?: boolean;
      sistemasNotif?: Record<string, boolean>; dataInicio?: string; ativa?: boolean;
    };

  try {
    const novoNome = nome ?? geocerca.nome;
    const novaArea = area ?? geocerca.area;

    await traccarUpdateGeofence(geocerca.traccarId, novoNome, novaArea, descricao ?? geocerca.descricao ?? undefined);

    const tipoForma = tipo ?? (novaArea.toUpperCase().startsWith('CIRCLE') ? 'circulo' :
                      novaArea.toUpperCase().startsWith('LINESTRING') ? 'linha' : 'poligono');

    await prisma.geocerca.update({
      where: { id },
      data: {
        nome: novoNome, area: novaArea,
        descricao: descricao !== undefined ? (descricao || null) : geocerca.descricao,
        tipo: tipoForma,
        notificarCliente: notificarCliente ?? geocerca.notificarCliente,
        sistemasNotif: sistemasNotif !== undefined ? (sistemasNotif ?? Prisma.JsonNull) : (geocerca.sistemasNotif ?? Prisma.JsonNull),
        dataInicio: dataInicio !== undefined ? parseDataInicioSaoPaulo(dataInicio) : geocerca.dataInicio,
        ativa: ativa !== undefined ? ativa : geocerca.ativa,
      },
    });

    // Reconciliar dispositivos
    if (Array.isArray(dispositivoIds)) {
      const atuais = await prisma.geocercaDispositivo.findMany({ where: { geocercaId: id }, select: { dispositivoId: true } });
      const idsAtuais = new Set(atuais.map(d => d.dispositivoId));
      const idsNovos = new Set(dispositivoIds);

      for (const dispositivoId of idsAtuais) {
        if (!idsNovos.has(dispositivoId)) {
          const d = await prisma.dispositivo.findUnique({ where: { id: dispositivoId }, select: { identificador: true } });
          if (d) { const td = await traccarGetDeviceByImei(d.identificador).catch(() => null); if (td) await traccarUnlinkGeofenceFromDevice(geocerca.traccarId, td.id).catch(() => {}); }
          await prisma.geocercaDispositivo.delete({ where: { geocercaId_dispositivoId: { geocercaId: id, dispositivoId } } }).catch(() => {});
        }
      }
      for (const dispositivoId of idsNovos) {
        if (!idsAtuais.has(dispositivoId)) {
          const d = await prisma.dispositivo.findFirst({ where: { id: dispositivoId, ...whereDispositivosDoCliente(req) }, select: { identificador: true } });
          if (!d) continue;
          const td = await traccarGetDeviceByImei(d.identificador).catch(() => null);
          if (td) await traccarLinkGeofenceToDevice(geocerca.traccarId, td.id).catch(() => {});
          await prisma.geocercaDispositivo.create({ data: { geocercaId: id, dispositivoId } }).catch(() => {});
        }
      }
    }

    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao atualizar geocerca: ${msg}` });
  }
});

// ── DELETE /api/cliente/rastreamento/geocercas/:id ────────────────────────────
router.delete('/rastreamento/geocercas/:id', requirePermission('rastreamento.criarCerca'), async (req: ClienteRequest, res: Response): Promise<void> => {
  const clienteId = req.cliente!.clienteId;
  if (await verificarBloqueio(clienteId)) { res.status(403).json({ error: 'acesso_bloqueado' }); return; }

  const id = param(req, 'id');
  const geocerca = await prisma.geocerca.findFirst({ where: { id, origemTipo: 'CLIENTE', clienteId } });
  if (!geocerca) { res.status(403).json({ error: 'Não autorizado a remover esta geocerca.' }); return; }

  try {
    await traccarDeleteGeofence(geocerca.traccarId);
    await prisma.geocerca.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Erro ao remover geocerca: ${msg}` });
  }
});

export default router;
