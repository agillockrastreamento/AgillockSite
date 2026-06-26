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
import { verifyClienteToken, verifyToken } from '../utils/jwt';

const TRACCAR_URL = process.env.TRACCAR_URL || 'http://traccar:8082';
const WS_TRACCAR_URL = TRACCAR_URL.replace('http://', 'ws://').replace('https://', 'wss://');

// Contexto por conexão de cliente frontend. Quando `dispositivoIdsPermitidos === null`,
// não há filtro (admin/colaborador/vendedor ou cliente sem auth via WS — compat). Quando
// é um array, filtra mensagens para conter apenas esses ids.
interface FrontendClientContext {
  dispositivoIdsPermitidos: Set<string> | null;
  filtraBoletos: boolean; // vinculados não veem boletos
  // Preferências de notificação web do admin (mapa tipoEvento → habilitado).
  // Presente só quando o admin desabilitou ao menos um tipo; aí os eventos cujo
  // tipo está marcado como `false` não são enviados a essa conexão.
  adminPrefs?: Record<string, boolean>;
}
const frontendClients = new Map<WebSocket, FrontendClientContext>();

// Mapeia o tipo bruto do evento (vindo do Traccar/sintético) para a chave da
// preferência do admin. Cobre divergências (deviceOverspeed→overspeed) e os
// grupos de manutenção/recorrência por data.
export function tipoEventoParaPrefAdmin(tipo: string): string {
  if (tipo === 'deviceOverspeed') return 'overspeed';
  if (tipo === 'manutencaoAlerta' || tipo === 'manutencaoAtrasada' || tipo === 'manutencaoFeita') return 'manutencao';
  if (tipo === 'recorrenciaDataAlerta' || tipo === 'recorrenciaDataNaoFeita' || tipo === 'recorrenciaDataFeita') return 'recorrenciaData';
  return tipo;
}

// O admin não recebe o evento quando desabilitou explicitamente esse tipo
// (pref === false). Tipos sem preferência salva continuam sendo enviados.
export function adminIgnoraEvento(adminPrefs: Record<string, boolean>, tipo: string): boolean {
  return adminPrefs[tipoEventoParaPrefAdmin(tipo)] === false;
}

// Cache traccarDeviceId → ClienteLogin.dispositivoId (uuid no DB). Reutilizado para filtrar
// mensagens de saída sem ir ao DB a cada broadcast.
const traccarIdToDispositivoId = new Map<number, string>();

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

// Filtra um array de itens (positions/devices/events) pelas permissões do cliente.
// Recebe um getter de traccarId para suportar ambos formatos.
function filtrarPorContexto<T>(
  itens: T[],
  ctx: FrontendClientContext,
  getTraccarId: (item: T) => number | null | undefined,
): T[] {
  if (ctx.dispositivoIdsPermitidos === null) return itens;
  return itens.filter((item) => {
    const traccarId = getTraccarId(item);
    if (traccarId == null) return false;
    const dispositivoId = traccarIdToDispositivoId.get(traccarId);
    return !!dispositivoId && ctx.dispositivoIdsPermitidos!.has(dispositivoId);
  });
}

function payloadParaContexto(payload: Record<string, unknown>, ctx: FrontendClientContext): Record<string, unknown> | null {
  if (ctx.dispositivoIdsPermitidos === null && !ctx.filtraBoletos && !ctx.adminPrefs) return payload;
  const result: Record<string, unknown> = {};
  if (Array.isArray(payload.positions)) {
    const f = filtrarPorContexto(payload.positions as Array<{ deviceId?: number }>, ctx, (p) => p.deviceId ?? null);
    if (f.length) result.positions = f;
  }
  if (Array.isArray(payload.devices)) {
    const f = filtrarPorContexto(payload.devices as Array<{ traccarId?: number }>, ctx, (d) => d.traccarId ?? null);
    if (f.length) result.devices = f;
  }
  if (Array.isArray(payload.events)) {
    let evts = payload.events as Array<{ deviceId?: number; type?: string; tipo?: string }>;
    
    if (ctx.adminPrefs) {
      evts = evts.filter((e) => {
        const t = (e.type || e.tipo || '').toString();
        return !adminIgnoraEvento(ctx.adminPrefs!, t);
      });
    }

    if (ctx.filtraBoletos) {
      // Eventos com prefixo 'boleto' (boletoAtrasado, boletoVencendoHoje, etc) não são para vinculados.
      evts = evts.filter((e) => {
        const t = (e.type || e.tipo || '').toString().toLowerCase();
        return !t.includes('boleto') && !t.includes('financeira');
      });
    }
    const f = filtrarPorContexto(evts, ctx, (e) => e.deviceId ?? null);
    if (f.length) result.events = f;
  }
  return Object.keys(result).length ? result : null;
}

function enviarPayload(payload: Record<string, unknown>): void {
  frontendClients.forEach((ctx, client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const filtrado = payloadParaContexto(payload, ctx);
    if (filtrado) client.send(JSON.stringify(filtrado));
  });
}

export function broadcastTrackingEvents(events: any[]) {
  if (!events.length) return;
  enviarPayload({ events });
}

async function getGeofenceMeta(traccarId?: number | null) {
  if (traccarId == null) return null;
  const cached = geofenceMetaCache.get(traccarId);
  if (cached && Date.now() - cached.at < GEOFENCE_CACHE_TTL_MS) return cached.meta;
  const geocerca = await prisma.geocerca.findUnique({
    where: { traccarId },
    select: {
      id: true,
      nome: true,
      origemTipo: true,
      clienteId: true,
      notificarCliente: true,
      visivelCliente: true,
    },
  }).catch(() => null);
  const meta = geocerca ? {
    origemId: geocerca.id,
    geofenceNome: geocerca.nome,
    origemTipo: geocerca.origemTipo,
    clienteId: geocerca.clienteId,
    notificarCliente: geocerca.notificarCliente,
    visivelCliente: geocerca.visivelCliente,
  } : null;
  geofenceMetaCache.set(traccarId, { at: Date.now(), meta });
  return meta;
}

// ── Iniciar o servidor WebSocket para o frontend ──────────────────────────────

async function resolveContexto(token: string | null): Promise<FrontendClientContext> {
  // Sem token: sem filtro (compat com clientes legados / admin via outras rotas).
  if (!token) return { dispositivoIdsPermitidos: null, filtraBoletos: false };
  // Tenta como token de admin/colaborador: passa tudo, mas aplica filtro das suas preferências.
  try {
    const decoded = verifyToken(token) as any;
    let adminPrefs: Record<string, boolean> | undefined;

    if (decoded && decoded.id) {
      const adminPref = await prisma.adminPreferencia.findUnique({
        where: { userId: decoded.id },
        select: { prefs: true },
      });
      if (adminPref && adminPref.prefs) {
        const prefs = adminPref.prefs as Record<string, unknown>;
        // Mantém apenas os pares booleanos (ignora chaves auxiliares como
        // semAtualizacaoHoras, al_last_notif_admin, etc). Só ativa o filtro
        // quando há ao menos um tipo desabilitado — assim quem nunca configurou
        // (ou habilitou tudo) continua recebendo todos os eventos.
        const apenasBool: Record<string, boolean> = {};
        let temFalse = false;
        for (const [chave, valor] of Object.entries(prefs)) {
          if (typeof valor === 'boolean') {
            apenasBool[chave] = valor;
            if (valor === false) temFalse = true;
          }
        }
        if (temFalse) adminPrefs = apenasBool;
      }
    }

    return {
      dispositivoIdsPermitidos: null,
      filtraBoletos: false,
      adminPrefs,
    };
  } catch {}
  // Tenta como token de cliente
  try {
    const decoded = verifyClienteToken(token);
    const login = await prisma.clienteLogin.findUnique({
      where: { id: decoded.sub },
      select: {
        ativo: true,
        tipo: true,
        cliente: { select: { status: true } },
        placasPermitidas: { select: { dispositivoId: true } },
      },
    });
    if (!login || !login.ativo || login.cliente.status !== 'ATIVO') {
      return { dispositivoIdsPermitidos: new Set(), filtraBoletos: true };
    }
    if (login.tipo === 'responsavel') {
      // Responsável: vê todos os seus veículos + boletos
      const dispositivos = await prisma.dispositivo.findMany({
        where: {
          OR: [
            { clienteId: decoded.clienteId },
            { clientesVinculados: { some: { clienteId: decoded.clienteId } } },
          ],
        },
        select: { id: true },
      });
      return {
        dispositivoIdsPermitidos: new Set(dispositivos.map((d) => d.id)),
        filtraBoletos: false,
      };
    }
    // Vinculado: lista explícita; nunca recebe eventos de boleto
    return {
      dispositivoIdsPermitidos: new Set(login.placasPermitidas.map((p) => p.dispositivoId)),
      filtraBoletos: true,
    };
  } catch {
    return { dispositivoIdsPermitidos: new Set(), filtraBoletos: true };
  }
}

export function initTraccarWebSocket(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/rastreamento' });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    // Token vem via query string: ?token=... (Authorization headers em WS não são portáveis no browser)
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token');
    const ctx = await resolveContexto(token);
    frontendClients.set(ws, ctx);
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
    enviarPayload(payload as Record<string, unknown>);
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
        cliente: { include: { logins: { where: { tipo: 'responsavel', ativo: true }, take: 1 } } },
        clientesVinculados: { include: { cliente: { include: { logins: { where: { tipo: 'responsavel', ativo: true }, take: 1 } } } } },
      },
    })
    : [];
  const localPorIdentificador = new Map(dispositivos.map(dispositivo => [dispositivo.identificador, dispositivo]));

  // Mantém o cache traccarId → dispositivoId para o filtro do broadcast.
  for (const dispositivo of dispositivos) {
    const identificador = dispositivo.identificador;
    for (const [traccarId, uniqueId] of traccarIdToUniqueId) {
      if (uniqueId === identificador) traccarIdToDispositivoId.set(traccarId, dispositivo.id);
    }
  }

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
          emMovimento: norm.emMovimento,
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
        geofenceNome: (evt as any).geofenceNome ?? null,
        origemTipo: (evt as any).origemTipo ?? null,
        origemId: (evt as any).origemId ?? null,
        clienteId: (evt as any).clienteId ?? null,
        notificarCliente: (evt as any).notificarCliente,
      };
      // Ignora eventos de alarme cujo tipo foi totalmente filtrado (ex.: parking)
      if (evt.type === 'alarm' && !dados.alarme) continue;
      NotificationService.processarEvento(identificador, evt.type, dados).catch(err => {
        console.error('[Notificações] Erro ao processar evento:', err.message);
      });
    }
    // Remove eventos de alarme cujo tipo foi totalmente filtrado (ex.: parking)
    // para que não apareçam nos mapas nem nas notificações do frontend.
    const eventosFiltrados = eventosComLocal.filter(evt => {
      if (evt.type !== 'alarm') return true;
      const pos = (evt.positionId != null ? posicaoPorPositionId.get(evt.positionId) : undefined) ?? posicaoPorDeviceId.get(evt.deviceId);
      if (!pos) return true;
      const norm = normalizeAttributes(pos.attributes ?? {});
      return !!norm.alarme;
    });
    result.events = eventosFiltrados;
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
