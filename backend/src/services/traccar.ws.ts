import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage, Server } from 'http';
import prisma from '../utils/prisma';
import {
  traccarGetSessionCookie,
  normalizeAttributes,
  EVENT_TYPE_LABELS,
  traccarGetDevices,
  traccarGetGeofences,
} from './traccar.service';
import {
  DISPOSITIVO_MEDIDORES_SELECT,
  sincronizarDispositivosComPosicoes,
  decorarPosicaoComMedidores,
} from './medidores.service';
import NotificationService from './notification.service';
import { reverseGeocode } from '../utils/reverse-geocode';

const TRACCAR_URL = process.env.TRACCAR_URL || 'http://traccar:8082';
const WS_TRACCAR_URL = TRACCAR_URL.replace('http://', 'ws://').replace('https://', 'wss://');

// Clientes frontend conectados ao backend
const frontendClients = new Set<WebSocket>();

let traccarWs: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
const traccarIdToUniqueId = new Map<number, string>();
const lastGeofenceState = new Map<number, string[]>();
const geofenceCache = new Map<number, { at: number; items: Array<{ id: number; area: string }> }>();
const geofenceMetaCache = new Map<number, {
  at: number;
  meta: {
    origemId: string;
    origemTipo: string;
    clienteId: string | null;
    notificarCliente: boolean;
    visivelCliente: boolean;
  } | null;
}>();
const GEOFENCE_CACHE_TTL_MS = 30_000;
const eventAddressCache = new Map<string, string>();

export function broadcastTrackingEvents(events: any[]) {
  if (!events.length) return;
  const outgoing = JSON.stringify({ events });
  frontendClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(outgoing);
  });
}

async function getGeofenceMeta(traccarId?: number | null) {
  if (traccarId == null) return null;
  const cached = geofenceMetaCache.get(traccarId);
  if (cached && Date.now() - cached.at < GEOFENCE_CACHE_TTL_MS) return cached.meta;
  const geocerca = await prisma.geocerca.findUnique({
    where: { traccarId },
    select: {
      id: true,
      origemTipo: true,
      clienteId: true,
      notificarCliente: true,
      visivelCliente: true,
    },
  }).catch(() => null);
  const meta = geocerca ? {
    origemId: geocerca.id,
    origemTipo: geocerca.origemTipo,
    clienteId: geocerca.clienteId,
    notificarCliente: geocerca.notificarCliente,
    visivelCliente: geocerca.visivelCliente,
  } : null;
  geofenceMetaCache.set(traccarId, { at: Date.now(), meta });
  return meta;
}

// ── Iniciar o servidor WebSocket para o frontend ──────────────────────────────

export function initTraccarWebSocket(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/rastreamento' });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    frontendClients.add(ws);
    console.log(`[WS] Frontend conectado. Total: ${frontendClients.size}`);

    ws.on('close', () => {
      frontendClients.delete(ws);
      console.log(`[WS] Frontend desconectado. Total: ${frontendClients.size}`);
    });

    ws.on('error', () => frontendClients.delete(ws));
  });

  connectToTraccar();

  return wss;
}

// ── Conectar ao WebSocket do Traccar ─────────────────────────────────────────

async function connectToTraccar() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  let cookie: string;
  try {
    cookie = await traccarGetSessionCookie();
  } catch (err) {
    console.error('[WS Traccar] Falha ao obter sessão, tentando em 10s...', err);
    reconnectTimer = setTimeout(connectToTraccar, 10_000);
    return;
  }

  console.log('[WS Traccar] Conectando...');
  try {
    const devices = await traccarGetDevices();
    traccarIdToUniqueId.clear();
    devices.forEach(device => traccarIdToUniqueId.set(device.id, device.uniqueId));
    console.log(`[WS Traccar] Cache de dispositivos atualizado: ${devices.length} dispositivos.`);
  } catch (err) {
    console.warn('[WS Traccar] Falha ao atualizar cache de dispositivos.', err);
  }
  traccarWs = new WebSocket(`${WS_TRACCAR_URL}/api/socket`, {
    headers: { Cookie: cookie },
  });

  traccarWs.on('open', () => {
    console.log('[WS Traccar] Conectado ao servidor.');
  });

  traccarWs.on('message', async (data: Buffer) => {
    const raw = data.toString();

    if (raw === '{}' || raw.trim() === '') return;
    
    // Log para debug de volume (pode ser removido depois)
    // console.log(`[WS Traccar] Dados brutos recebidos: ${raw.substring(0, 100)}...`);

    let msg: TraccarWsMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    let payload: object | null;
    try {
      payload = await transformTraccarMessage(msg);
    } catch (err: any) {
      console.error('[WS Traccar] Erro ao processar mensagem:', err?.message || err);
      return;
    }
    if (!payload) return;

    const outgoing = JSON.stringify(payload);
    frontendClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(outgoing);
      }
    });
  });

  traccarWs.on('close', () => {
    console.warn('[WS Traccar] Conexão fechada. Reconectando em 5s...');
    traccarWs = null;
    reconnectTimer = setTimeout(connectToTraccar, 5_000);
  });

  traccarWs.on('error', (err) => {
    console.error('[WS Traccar] Erro:', err.message);
    traccarWs?.terminate();
  });
}

// ── Transformar mensagem do Traccar para o formato do frontend ────────────────

async function transformTraccarMessage(msg: TraccarWsMessage): Promise<object | null> {
  const result: Record<string, unknown> = {};
  const syntheticEvents: Array<{
    deviceId: number;
    type: string;
    tipoLabel: string;
    serverTime: string;
    positionId?: number;
    geofenceId?: number;
  }> = [];

  if (msg.devices?.length) {
    msg.devices.forEach(device => traccarIdToUniqueId.set(device.id, device.uniqueId));
  }

  const identificadores = Array.from(new Set(
    (msg.positions || [])
      .map(position => traccarIdToUniqueId.get(position.deviceId))
      .filter((value): value is string => !!value),
  ));
  const dispositivos = identificadores.length
    ? await prisma.dispositivo.findMany({
      where: { identificador: { in: identificadores } },
      select: { 
        identificador: true, 
        id: true, 
        ...DISPOSITIVO_MEDIDORES_SELECT,
        cliente: { include: { login: true } },
        clientesVinculados: { include: { cliente: { include: { login: true } } } },
      },
    })
    : [];
  const localPorIdentificador = new Map(dispositivos.map(dispositivo => [dispositivo.identificador, dispositivo]));

  if (msg.positions?.length) {
    const posicaoPorIdentificador = new Map<string, {
      deviceId: number;
      latitude: number;
      longitude: number;
      altitude: number;
      speed: number;
      course: number;
      fixTime: string;
      deviceTime: string;
      serverTime: string;
      valid: boolean;
      address: string | null;
      attributes: Record<string, unknown>;
    }>();
    msg.positions.forEach(position => {
      const identificador = traccarIdToUniqueId.get(position.deviceId);
      if (identificador) posicaoPorIdentificador.set(identificador, position);
    });

    // Mapeia o estado ANTERIOR dos dispositivos para comparação de alertas (ignição)
    const estadoAnteriorMap = new Map(dispositivos.map(d => [d.identificador, { ...d }]));

    const atualizados = await sincronizarDispositivosComPosicoes(
      dispositivos,
      posicaoPorIdentificador as unknown as Map<string, any>,
    );

    console.log(`[WS Traccar] Processadas ${atualizados.size} posições.`);

    atualizados.forEach((dispositivo, identificador) => {
      // Tentar preservar campos que o Traccar omite em alguns pacotes
      const anterior = estadoAnteriorMap.get(identificador);
      if (anterior) {
        if (dispositivo.odometroSistemaMetros == null) {
          dispositivo.odometroSistemaMetros = (anterior as any).odometroSistemaMetros;
        }
      }
      localPorIdentificador.set(identificador, dispositivo);

      // Verificação proativa de alertas usando o estado ANTERIOR para comparação
      const pos = posicaoPorIdentificador.get(identificador);
      if (pos && anterior) {
        const norm = normalizeAttributes(pos.attributes ?? {});
        const hasNativeIgnition = (msg.events || []).some(e =>
          e.deviceId === pos.deviceId &&
          (e.type === 'ignitionOn' || e.type === 'ignitionOff'),
        );
        const hasNativeAlarm = (msg.events || []).some(e =>
          e.deviceId === pos.deviceId && e.type === 'alarm',
        );
        const dados = {
          traccarDeviceId: pos.deviceId,
          latitude: pos.latitude,
          longitude: pos.longitude,
          velocidade: Math.round(pos.speed * 1.852),
          endereco: pos.address,
          ignicao: norm.ignicao,
          alarme: norm.alarme,
          _skipIgnition: hasNativeIgnition,
          _skipAlarm: hasNativeAlarm,
        };

        NotificationService.verificarEventosPosicao(identificador, anterior, dados)
          .then(evts => {
            if (evts && evts.length > 0) {
              const payload = { events: evts };
              broadcastTrackingEvents(payload.events);
            }
          })
          .catch(err => console.error(`[Notif] Erro na verificação proativa (${identificador}):`, err.message));
      }
    });

    for (const [identificador, disp] of atualizados) {
      if (disp.odometroSistemaMetros != null) {
        NotificationService.verificarKmNotificacoes(identificador, disp.odometroSistemaMetros)
          .then(evts => {
            if (evts && evts.length > 0) {
              broadcastTrackingEvents(evts);
            }
          })
          .catch(err => console.error('[KM Notif] Erro:', err.message));
      }
    }
  }

  if (msg.positions?.length) {
    result.positions = msg.positions.map(p => ({
      deviceId: p.deviceId,
      ...(() => {
        const identificador = traccarIdToUniqueId.get(p.deviceId);
        const dispositivo = identificador ? localPorIdentificador.get(identificador) : null;
        if (!dispositivo) {
          return {
            latitude: p.latitude,
            longitude: p.longitude,
            velocidade: Math.round(p.speed * 1.852),
            curso: p.course,
            altitude: p.altitude,
            fixTime: p.fixTime,
            deviceTime: p.deviceTime,
            serverTime: p.serverTime,
            valida: p.valid,
            endereco: p.address,
            ...normalizeAttributes(p.attributes ?? {}),
          };
        }
        return decorarPosicaoComMedidores(dispositivo, p as any);
      })(),
    }));

    for (const position of msg.positions) {
      const currentGeofences = await detectPositionGeofences(position);
      const previousGeofences = lastGeofenceState.get(position.deviceId);
      lastGeofenceState.set(position.deviceId, currentGeofences);
      if (!previousGeofences) continue;

      const currentSet = new Set(currentGeofences);
      const previousSet = new Set(previousGeofences);
      const eventTime = position.fixTime || position.deviceTime || position.serverTime;
      const positionId = position.id;
      const hasActualEnter = !!msg.events?.some(e =>
        e.deviceId === position.deviceId
        && e.positionId === positionId
        && e.type === 'geofenceEnter'
      );
      const hasActualExit = !!msg.events?.some(e =>
        e.deviceId === position.deviceId
        && e.positionId === positionId
        && e.type === 'geofenceExit'
      );

      for (const geofenceKey of currentGeofences) {
        if (!previousSet.has(geofenceKey) && !hasActualEnter) {
          syntheticEvents.push({
            deviceId: position.deviceId,
            type: 'geofenceEnter',
            tipoLabel: EVENT_TYPE_LABELS.geofenceEnter ?? 'geofenceEnter',
            serverTime: eventTime,
            positionId,
            geofenceId: parseInt(geofenceKey, 10),
          });
        }
      }

      for (const geofenceKey of previousGeofences) {
        if (!currentSet.has(geofenceKey) && !hasActualExit) {
          syntheticEvents.push({
            deviceId: position.deviceId,
            type: 'geofenceExit',
            tipoLabel: EVENT_TYPE_LABELS.geofenceExit ?? 'geofenceExit',
            serverTime: eventTime,
            positionId,
            geofenceId: parseInt(geofenceKey, 10),
          });
        }
      }
    }
  }

  if (msg.devices?.length) {
    result.devices = msg.devices.map(d => ({
      traccarId: d.id,
      imei: d.uniqueId,
      status: d.status,
      lastUpdate: d.lastUpdate,
    }));
  }

  if (msg.events?.length || syntheticEvents.length) {
    const realtimeEvents: Array<{
      deviceId: number;
      type: string;
      tipoLabel: string;
      serverTime: string;
      positionId?: number;
      geofenceId?: number;
      lat?: number | null;
      lng?: number | null;
      endereco?: string | null;
    }> = (msg.events || []).map(e => ({
      deviceId: e.deviceId,
      type: e.type,
      tipoLabel: EVENT_TYPE_LABELS[e.type] ?? e.type,
      serverTime: e.eventTime || e.serverTime,
      positionId: e.positionId,
      geofenceId: e.geofenceId,
    }));
    const eventosComLocal = await Promise.all(realtimeEvents.concat(syntheticEvents).map(async (evt) => {
      if ((evt.type === 'geofenceEnter' || evt.type === 'geofenceExit') && evt.geofenceId) {
        const meta = await getGeofenceMeta(evt.geofenceId);
        if (meta) return { ...evt, ...meta };
      }
      return evt;
    }));

    // Disparar notificações para cada evento (fire-and-forget)
    type TraccarPos = NonNullable<TraccarWsMessage['positions']>[number];
    const posicaoPorDeviceId = new Map<number, TraccarPos>();
    const posicaoPorPositionId = new Map<number, TraccarPos>();
    (msg.positions || []).forEach(p => {
      posicaoPorDeviceId.set(p.deviceId, p);
      if (p.id != null) posicaoPorPositionId.set(p.id, p);
    });

    for (const evt of eventosComLocal) {
      const identificador = traccarIdToUniqueId.get(evt.deviceId);
      if (!identificador) {
        console.warn(`[WS Traccar] Evento "${evt.type}" recebido para deviceId ${evt.deviceId}, mas identificador não encontrado no cache.`);
        continue;
      }
      const pos = (evt.positionId != null ? posicaoPorPositionId.get(evt.positionId) : undefined) ?? posicaoPorDeviceId.get(evt.deviceId);
      const enderecoEvento = await resolverEnderecoEvento(pos);
      evt.lat = pos?.latitude ?? null;
      evt.lng = pos?.longitude ?? null;
      evt.endereco = enderecoEvento;
      const norm = pos ? normalizeAttributes(pos.attributes ?? {}) : {};
      const dados = {
        traccarDeviceId: evt.deviceId,
        latitude: pos?.latitude ?? null,
        longitude: pos?.longitude ?? null,
        velocidade: pos != null ? Math.round(pos.speed * 1.852) : null,
        endereco: enderecoEvento,
        alarme: (norm as any).alarme ?? null,
        geofenceId: evt.geofenceId ?? null,
        origemTipo: (evt as any).origemTipo ?? null,
        origemId: (evt as any).origemId ?? null,
        clienteId: (evt as any).clienteId ?? null,
        notificarCliente: (evt as any).notificarCliente,
      };
      NotificationService.processarEvento(identificador, evt.type, dados).catch(err => {
        console.error('[Notificações] Erro ao processar evento:', err.message);
      });
    }
    result.events = eventosComLocal;
  }

  if (Object.keys(result).length === 0) return null;
  return result;
}

// ── Tipos internos ────────────────────────────────────────────────────────────

interface TraccarWsMessage {
  positions?: Array<{
    id?: number;
    deviceId: number;
    latitude: number;
    longitude: number;
    altitude: number;
    speed: number;
    course: number;
    fixTime: string;
    deviceTime: string;
    serverTime: string;
    valid: boolean;
    address: string | null;
    attributes: Record<string, unknown>;
  }>;
  devices?: Array<{
    id: number;
    uniqueId: string;
    status: string;
    lastUpdate: string;
  }>;
  events?: Array<{
    deviceId: number;
    positionId: number;
    type: string;
    eventTime?: string;
    serverTime: string;
    geofenceId?: number;
  }>;
}

async function detectPositionGeofences(position: {
  deviceId: number;
  latitude: number;
  longitude: number;
  attributes?: Record<string, unknown>;
}): Promise<string[]> {
  const fromAttributes = extractGeofenceKeys(position.attributes);
  if (fromAttributes.length) return fromAttributes;

  const geofences = await getDeviceGeofences(position.deviceId);
  if (!geofences.length) return [];

  return geofences
    .filter(geofence => pointInsideGeofence(position.latitude, position.longitude, geofence.area))
    .map(geofence => String(geofence.id));
}

async function resolverEnderecoEvento(pos?: { latitude: number; longitude: number; address?: string | null }): Promise<string | null> {
  if (!pos) return null;
  if (pos.address) return pos.address;
  const lat = Number(pos.latitude);
  const lon = Number(pos.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (eventAddressCache.has(cacheKey)) return eventAddressCache.get(cacheKey) || null;
  const endereco = await reverseGeocode(lat, lon).catch(() => '');
  eventAddressCache.set(cacheKey, endereco);
  return endereco || null;
}

function extractGeofenceKeys(attributes: Record<string, unknown> | undefined): string[] {
  if (!attributes) return [];
  const values: string[] = [];
  const pushValue = (value: unknown) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    if (typeof value === 'string') {
      value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(item => values.push(item));
      return;
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      values.push(String(value));
    }
  };

  pushValue(attributes.geofenceIds);
  pushValue(attributes.geofenceId);
  pushValue(attributes.geofences);
  pushValue(attributes.geofence);

  return Array.from(new Set(values));
}

async function getDeviceGeofences(deviceId: number): Promise<Array<{ id: number; area: string }>> {
  const cached = geofenceCache.get(deviceId);
  const now = Date.now();
  if (cached && (now - cached.at) < GEOFENCE_CACHE_TTL_MS) {
    return cached.items;
  }

  try {
    const items = (await traccarGetGeofences(deviceId)).map(geofence => ({ id: geofence.id, area: geofence.area }));
    geofenceCache.set(deviceId, { at: now, items });
    return items;
  } catch {
    return cached?.items || [];
  }
}

function pointInsideGeofence(lat: number, lng: number, area: string): boolean {
  const circleMatch = area.match(/CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([\d.]+)\s*\)/i);
  if (circleMatch) {
    const centerLat = Number(circleMatch[1]);
    const centerLng = Number(circleMatch[2]);
    const radius = Number(circleMatch[3]);
    return haversineMeters(lat, lng, centerLat, centerLng) <= radius;
  }

  const polygonMatch = area.match(/POLYGON\s*\(\s*\(\s*(.+?)\s*\)\s*\)/i);
  if (polygonMatch) {
    const points = polygonMatch[1].split(',').map(point => {
      const [pointLng, pointLat] = point.trim().split(/\s+/).map(Number);
      return { lat: pointLat, lng: pointLng };
    });
    return pointInPolygon(lat, lng, points);
  }

  return false;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(lat: number, lng: number, points: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng;
    const yi = points[i].lat;
    const xj = points[j].lng;
    const yj = points[j].lat;
    const intersects = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}
