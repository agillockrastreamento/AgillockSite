import fs from 'fs';

const TRACCAR_URL = process.env.TRACCAR_URL || 'http://traccar:8082';
const TRACCAR_USER = process.env.TRACCAR_USER!;
const TRACCAR_PASSWORD = process.env.TRACCAR_PASSWORD!;

const authHeader = 'Basic ' + Buffer.from(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`).toString('base64');

const defaultHeaders = {
  'Authorization': authHeader,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

// ── Cache curto + coalescência para relatórios pesados ───────────────────────
// As telas de relatório disparam 5 chamadas simultâneas (histórico, viagens,
// paradas, eventos, resumo) que compartilham o MESMO route report (~25 MB, ~19s
// num período de 30 dias) e, logo depois, a exportação repete route+trips+stops.
// Sem coalescência, o Traccar recalcula os mesmos relatórios 5-6× ao mesmo tempo,
// contende na CPU e estoura o tempo do proxy. Aqui uma chamada em voo é
// reaproveitada por todas as demais com a mesma (deviceIds, from, to), e o
// resultado fica em cache por um curto período para a exportação reusar.
const REPORT_CACHE_TTL_MS = 90_000;
const reportCache = new Map<string, { at: number; promise: Promise<unknown> }>();

function reportCacheKey(tipo: string, deviceIds: number[], from: Date, to: Date, extra = ''): string {
  return `${tipo}|${[...deviceIds].sort((a, b) => a - b).join(',')}|${from.toISOString()}|${to.toISOString()}|${extra}`;
}

function cachedReport<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const agora = Date.now();
  for (const [k, v] of reportCache) if (agora - v.at >= REPORT_CACHE_TTL_MS) reportCache.delete(k);
  const hit = reportCache.get(key);
  if (hit && agora - hit.at < REPORT_CACHE_TTL_MS) return hit.promise as Promise<T>;
  // Se a busca falhar, remove do cache para não fixar o erro pelo TTL inteiro.
  const promise = fetcher().catch(err => { reportCache.delete(key); throw err; });
  reportCache.set(key, { at: agora, promise });
  return promise;
}

// ── Dispositivos ─────────────────────────────────────────────────────────────

export async function traccarGetDevices(): Promise<TraccarDevice[]> {
  const res = await fetch(`${TRACCAR_URL}/api/devices`, { headers: defaultHeaders });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json() as Promise<TraccarDevice[]>;
}

export async function traccarGetDeviceByImei(imei: string): Promise<TraccarDevice | null> {
  const res = await fetch(`${TRACCAR_URL}/api/devices?uniqueId=${encodeURIComponent(imei)}`, {
    headers: defaultHeaders,
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  const devices = await res.json() as TraccarDevice[];
  return devices[0] ?? null;
}

export type TraccarDeviceSyncData = {
  name: string;
  uniqueId: string;
  category?: string | null;
  model?: string | null;
  phone?: string | null;
  attributes?: Record<string, unknown>;
};

function buildTraccarDevicePayload(data: TraccarDeviceSyncData, id?: number, currentAttributes?: Record<string, unknown>) {
  return {
    ...(id !== undefined ? { id } : {}),
    name: data.name,
    uniqueId: data.uniqueId,
    category: data.category || 'car',
    model: data.model || null,
    phone: data.phone || null,
    attributes: {
      ...(currentAttributes || {}),
      ...(data.attributes || {}),
    },
  };
}

export async function traccarUpdateDeviceAccumulators(
  traccarId: number,
  totalDistanceMeters: number,
  hoursMilliseconds?: number | null,
): Promise<void> {
  const body = {
    deviceId: traccarId,
    totalDistance: Math.max(0, Math.round(totalDistanceMeters)),
    ...(typeof hoursMilliseconds === 'number' && Number.isFinite(hoursMilliseconds)
      ? { hours: Math.max(0, Math.round(hoursMilliseconds)) }
      : {}),
  };

  const res = await fetch(`${TRACCAR_URL}/api/devices/${traccarId}/accumulators`, {
    method: 'PUT',
    headers: defaultHeaders,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
}

export async function traccarCreateDevice(data: TraccarDeviceSyncData): Promise<TraccarDevice> {
  const res = await fetch(`${TRACCAR_URL}/api/devices`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify(buildTraccarDevicePayload(data)),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json() as Promise<TraccarDevice>;
}

export async function traccarUpdateDevice(
  traccarId: number,
  data: TraccarDeviceSyncData,
  currentAttributes?: Record<string, unknown>,
): Promise<TraccarDevice> {
  const res = await fetch(`${TRACCAR_URL}/api/devices/${traccarId}`, {
    method: 'PUT',
    headers: defaultHeaders,
    body: JSON.stringify(buildTraccarDevicePayload(data, traccarId, currentAttributes)),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json() as Promise<TraccarDevice>;
}

export async function traccarDeleteDevice(traccarId: number): Promise<void> {
  const res = await fetch(`${TRACCAR_URL}/api/devices/${traccarId}`, {
    method: 'DELETE',
    headers: defaultHeaders,
  });
  if (!res.ok && res.status !== 404) throw new Error(`Traccar ${res.status}`);
}

// ── Posições ──────────────────────────────────────────────────────────────────

export async function traccarGetPositions(deviceIds?: number[]): Promise<TraccarPosition[]> {
  let url = `${TRACCAR_URL}/api/positions`;
  if (deviceIds?.length) {
    url += '?' + deviceIds.map(id => `deviceId=${id}`).join('&');
  }
  const res = await fetch(url, { headers: defaultHeaders });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  return res.json() as Promise<TraccarPosition[]>;
}

export async function traccarGetPositionHistory(
  deviceIds: number[],
  from: Date,
  to: Date,
): Promise<TraccarPosition[]> {
  return cachedReport(reportCacheKey('route', deviceIds, from, to), async () => {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    deviceIds.forEach(id => params.append('deviceId', String(id)));
    const res = await fetch(`${TRACCAR_URL}/api/reports/route?${params}`, { headers: defaultHeaders });
    if (!res.ok) throw new Error(`Traccar ${res.status}`);
    return res.json() as Promise<TraccarPosition[]>;
  });
}

// ── Relatórios ────────────────────────────────────────────────────────────────

export async function traccarGetTrips(
  deviceIds: number[],
  from: Date,
  to: Date,
): Promise<TraccarTrip[]> {
  return cachedReport(reportCacheKey('trips', deviceIds, from, to), async () => {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    deviceIds.forEach(id => params.append('deviceId', String(id)));
    const res = await fetch(`${TRACCAR_URL}/api/reports/trips?${params}`, { headers: defaultHeaders });
    if (!res.ok) throw new Error(`Traccar ${res.status}`);
    return res.json() as Promise<TraccarTrip[]>;
  });
}

export async function traccarGetEvents(
  deviceIds: number[],
  from: Date,
  to: Date,
  types?: string[],
): Promise<TraccarEvent[]> {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return cachedReport(reportCacheKey('events', deviceIds, from, to, (types || []).join(',')), async () => {
    deviceIds.forEach(id => params.append('deviceId', String(id)));
    if (types?.length) types.forEach(t => params.append('type', t));
    const res = await fetch(`${TRACCAR_URL}/api/reports/events?${params}`, { headers: defaultHeaders });
    if (!res.ok) throw new Error(`Traccar ${res.status}`);
    return res.json() as Promise<TraccarEvent[]>;
  });
}

export async function traccarGetSummary(
  deviceIds: number[],
  from: Date,
  to: Date,
): Promise<TraccarSummary[]> {
  return cachedReport(reportCacheKey('summary', deviceIds, from, to), async () => {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    deviceIds.forEach(id => params.append('deviceId', String(id)));
    const res = await fetch(`${TRACCAR_URL}/api/reports/summary?${params}`, { headers: defaultHeaders });
    if (!res.ok) throw new Error(`Traccar ${res.status}`);
    return res.json() as Promise<TraccarSummary[]>;
  });
}

export async function traccarSendCommand(
  deviceId: number,
  type: string,
  attributes: Record<string, unknown> = {},
): Promise<void> {
  const res = await fetch(`${TRACCAR_URL}/api/commands/send`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ deviceId, type, attributes }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
}

export async function traccarGetCommandTypes(deviceId: number): Promise<string[]> {
  const res = await fetch(`${TRACCAR_URL}/api/commands/types?deviceId=${deviceId}`, { headers: defaultHeaders });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  return res.json() as Promise<string[]>;
}

export async function traccarGetStops(
  deviceIds: number[],
  from: Date,
  to: Date,
): Promise<TraccarStop[]> {
  return cachedReport(reportCacheKey('stops', deviceIds, from, to), async () => {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    deviceIds.forEach(id => params.append('deviceId', String(id)));
    const res = await fetch(`${TRACCAR_URL}/api/reports/stops?${params}`, { headers: defaultHeaders });
    if (!res.ok) throw new Error(`Traccar ${res.status}`);
    return res.json() as Promise<TraccarStop[]>;
  });
}

export async function traccarExportReport(
  type: 'route' | 'events' | 'trips' | 'stops' | 'summary',
  deviceIds: number[],
  from: string,
  to: string,
): Promise<Response> {
  // Traccar sempre exibe Period em UTC; substituir o offset pelo Z faz o horário
  // local aparecer diretamente como UTC no cabeçalho do Excel.
  const semFuso = (s: string) => s.replace(/[+-]\d{2}:\d{2}$/, 'Z');
  const params = new URLSearchParams({ from: semFuso(from), to: semFuso(to) });
  deviceIds.forEach(id => params.append('deviceId', String(id)));
  
  const res = await fetch(`${TRACCAR_URL}/api/reports/${type}?${params}`, {
    headers: {
      ...defaultHeaders,
      'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });
  if (!res.ok) throw new Error(`Traccar export ${res.status}`);
  return res;
}

// ── Logs do servidor ──────────────────────────────────────────────────────────

export async function traccarGetServerLog(): Promise<string> {
  // Tenta ler o arquivo diretamente se o volume estiver montado (mais confiável)
  const localLogPath = '/opt/traccar/logs/tracker-server.log';
  if (fs.existsSync(localLogPath)) {
    try {
      const stats = fs.statSync(localLogPath);
      const start = Math.max(0, stats.size - 100 * 1024); // Pega os últimos 100KB
      const stream = fs.createReadStream(localLogPath, { start });
      
      return new Promise((resolve, reject) => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
        stream.on('error', err => reject(err));
      });
    } catch (err) {
      console.warn('[Logs] Falha ao ler arquivo local, tentando API...', err);
    }
  }

  // Fallback para API do Traccar
  const res = await fetch(`${TRACCAR_URL}/api/server/log`, { headers: defaultHeaders });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  return res.text();
}

// ── Autenticação WebSocket (precisa de cookie de sessão) ─────────────────────

export async function traccarGetSessionCookie(): Promise<string> {
  const body = new URLSearchParams({
    email: TRACCAR_USER,
    password: TRACCAR_PASSWORD,
  });
  const res = await fetch(`${TRACCAR_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Traccar login falhou: ${res.status}`);
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('Traccar não retornou cookie de sessão');
  const match = cookie.match(/JSESSIONID=[^;]+/);
  if (!match) throw new Error('JSESSIONID não encontrado no cookie');
  return match[0];
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status: 'online' | 'offline' | 'unknown';
  lastUpdate: string;
  positionId: number;
  groupId: number;
  category: string;
  model?: string | null;
  phone?: string | null;
  disabled: boolean;
  attributes: Record<string, unknown>;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  deviceTime: string;
  fixTime: string;
  serverTime: string;
  outdated: boolean;
  valid: boolean;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;        // knots — converter: km/h = speed * 1.852
  course: number;       // graus 0-360
  address: string | null;
  accuracy: number;
  attributes: {
    // Estado básico (presente na maioria dos protocolos)
    ignition?: boolean;
    motion?: boolean;
    alarm?: string;
    blocked?: boolean;
    charge?: boolean;
    // Sinal e GPS
    rssi?: number;
    sat?: number;
    // Energia
    power?: number;         // tensão externa/veículo (V)
    battery?: number;       // tensão bateria interna (V)
    batteryLevel?: number;  // nível de bateria (0–100 %)
    // Odômetro e motor
    distance?: number;      // distância deste segmento (metros)
    totalDistance?: number; // odômetro total (metros)
    hours?: number;         // horas de motor (ms)
    // Combustível
    fuel?: number;
    fuelUsed?: number;
    // I/O digitais
    input?: number;
    output?: number;
    // Motorista
    driverUniqueId?: string;
    [key: string]: unknown;
  };
}

// Rótulos em português para tipos de alarme enviados pelos dispositivos.
// Universais — funcionam para qualquer protocolo suportado pelo Traccar.
export const ALARM_LABELS: Record<string, string> = {
  general: 'Alerta Genérico',
  sos: 'SOS / Pânico',
  powerCut: 'Corte de energia',
  vibration: 'Vibração',
  movement: 'Movimento detectado',
  overspeed: 'Excesso de velocidade',
  fallDown: 'Queda detectada',
  lowPower: 'Bateria baixa',
  lowBattery: 'Bateria interna baixa',
  fault: 'Falha no dispositivo',
  powerOff: 'Alimentação cortada',
  powerOn: 'Alimentação restaurada',
  door: 'Porta aberta',
  lock: 'Travado',
  unlock: 'Destravado',
  geofenceEnter: 'Entrou na cerca',
  geofenceExit: 'Saiu da cerca',
  gpsAntennaCut: 'Antena GPS cortada',
  hardAcceleration: 'Aceleração brusca',
  hardBraking: 'Freada brusca',
  hardCornering: 'Curva brusca',
  laneChange: 'Mudança de faixa',
  fatigueDriving: 'Fadiga ao volante',
  riskDriving: 'Direção de risco',
  temperature: 'Temperatura anormal',
  parking: 'Estacionamento detectado',
  bonnet: 'Capô aberto',
  fuelLeak: 'Vazamento de combustível',
  tampering: 'Adulteração detectada',
  removing: 'Dispositivo removido',
};

// Rótulos em português para tipos de evento do Traccar.
export const EVENT_TYPE_LABELS: Record<string, string> = {
  deviceOnline: 'Dispositivo online',
  deviceOffline: 'Dispositivo offline',
  deviceUnknown: 'Status desconhecido',
  deviceMoving: 'Em movimento',
  deviceStopped: 'Parado',
  deviceOverspeed: 'Excesso de velocidade',
  deviceFuelDrop: 'Queda de combustível',
  commandResult: 'Resultado de comando',
  geofenceEnter: 'Entrou na cerca',
  geofenceExit: 'Saiu da cerca',
  alarm: 'Alarme',
  ignitionOn: 'Ignição ligada',
  ignitionOff: 'Ignição desligada',
  maintenance: 'Manutenção pendente',
  textMessage: 'Mensagem recebida',
  driverChanged: 'Motorista alterado',
  media: 'Mídia recebida',
  veiculoMovimento: 'Veículo em movimento',
  motorOcioso: 'Motor ocioso',
  semAtualizacao: 'Veículo sem atualização',
};

// Alarmes ignorados — removidos silenciosamente antes de atingir notificações,
// mapas ou qualquer outra parte do sistema.
const IGNORED_ALARMS = new Set(['parking']);

// Número do cartão RFID do motorista a partir dos atributos de uma posição.
// O leitor SGBRAS ligado por RS232/TTL envia a string bruta no atributo `serial`
// (ex.: "SGBT|6|1|0|3105176557|1|"): o número do cartão é o penúltimo campo e o
// último indica a jornada (1/3 = início/login, 2 = fim/logout). Rastreadores
// ligados por 1-wire usam `driverUniqueId` — usado como fallback quando não-zerado.
// (Nesses Suntech o slot 1-wire vem sempre "0000000000000", por isso é ignorado.)
export function cartaoDaPosicao(
  attr: TraccarPosition['attributes'] | undefined | null,
): { cartao: string; inicio: boolean } | null {
  if (!attr) return null;
  const serial = typeof attr.serial === 'string' ? attr.serial.trim() : null;
  if (serial && /^SGB/i.test(serial)) {
    const campos = serial.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (campos.length >= 3) {
      const cartao = campos[campos.length - 2];
      const status = campos[campos.length - 1];
      if (/^\d{3,}$/.test(cartao) && !/^0+$/.test(cartao)) {
        return { cartao, inicio: status === '1' || status === '3' };
      }
    }
  }
  const dui = typeof attr.driverUniqueId === 'string' ? attr.driverUniqueId.trim() : null;
  if (dui && !/^0+$/.test(dui)) return { cartao: dui, inicio: true };
  return null;
}

// Normaliza os attributes de uma posição para um formato consistente,
// independente do protocolo/fabricante do dispositivo.
export function normalizeAttributes(attr: TraccarPosition['attributes']) {
  // Filtra alarmes ignorados (ex.: parking) antes de processar
  const alarmeRaw = attr.alarm ?? null;
  const alarme_codigo = alarmeRaw
    ? alarmeRaw.split(',').map(a => a.trim()).filter(a => !IGNORED_ALARMS.has(a)).join(',') || null
    : null;
  const horas_ms = attr.hours ?? null;
  return {
    ignicao: attr.ignition ?? null,
    emMovimento: attr.motion ?? null,
    alarme_codigo,
    alarme: alarme_codigo
      ? [...new Set(alarme_codigo.split(',').map(a => ALARM_LABELS[a.trim()] ?? a.trim()))].join(', ')
      : null,
    sinal: attr.rssi ?? null,
    satelites: attr.sat ?? null,
    tensao: attr.power ?? null,
    bateria_tensao: attr.battery ?? null,
    bateria_nivel: attr.batteryLevel ?? null,
    carregando: attr.charge ?? null,
    odometro: attr.totalDistance ?? null,
    distancia_segmento: attr.distance ?? null,
    horas_motor: horas_ms !== null ? Math.round(horas_ms / 3_600_000 * 10) / 10 : null,
    combustivel: attr.fuel ?? null,
    combustivel_gasto: attr.fuelUsed ?? null,
    bloqueado: attr.blocked ?? null,
    entrada_digital: attr.input ?? null,
    saida_digital: attr.output ?? null,
    motorista_id: cartaoDaPosicao(attr)?.cartao ?? null,
  };
}

export interface TraccarEvent {
  id: number;
  deviceId: number;
  type: string;
  eventTime: string;
  positionId: number;
  geofenceId: number;
  maintenanceId: number;
  attributes: Record<string, unknown>;
}

export interface TraccarSummary {
  deviceId: number;
  deviceName: string;
  distance: number;
  averageSpeed: number;
  maxSpeed: number;
  engineHours: number;
  spentFuel: number;
}

export interface TraccarTrip {
  deviceId: number;
  deviceName: string;
  startTime: string;
  startAddress: string;
  startLat: number;
  startLon: number;
  endTime: string;
  endAddress: string;
  endLat: number;
  endLon: number;
  distance: number;
  averageSpeed: number;
  maxSpeed: number;
  duration: number;
  driverUniqueId?: string; // cartão RFID do motorista (posição inicial da viagem)
}

export interface TraccarStop {
  deviceId: number;
  deviceName: string;
  startTime: string;
  endTime: string;
  positionId: number;
  address: string | null;
  lat: number;
  lon: number;
  duration: number;
  engineHours: number;
  spentFuel: number;
}

export interface TraccarGeofence {
  id: number;
  name: string;
  description?: string;
  area: string; // WKT: "CIRCLE (lat lon, radius)" ou "POLYGON ((lon lat, ...))"
  calendarId?: number;
  attributes?: Record<string, unknown>;
}

export interface TraccarDriver {
  id: number;
  name: string;
  uniqueId: string;
  attributes?: Record<string, unknown>;
}

// ── Geofences ─────────────────────────────────────────────────────────────────

export async function traccarGetGeofences(deviceId?: number): Promise<TraccarGeofence[]> {
  const url = deviceId
    ? `${TRACCAR_URL}/api/geofences?deviceId=${deviceId}`
    : `${TRACCAR_URL}/api/geofences`;
  const res = await fetch(url, { headers: defaultHeaders });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  return res.json() as Promise<TraccarGeofence[]>;
}

export async function traccarCreateGeofence(name: string, area: string): Promise<TraccarGeofence> {
  const res = await fetch(`${TRACCAR_URL}/api/geofences`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ name, area }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json() as Promise<TraccarGeofence>;
}

export async function traccarUpdateGeofence(id: number, name: string, area: string, description?: string): Promise<TraccarGeofence> {
  const res = await fetch(`${TRACCAR_URL}/api/geofences/${id}`, {
    method: 'PUT',
    headers: defaultHeaders,
    body: JSON.stringify({ id, name, area, description: description ?? '' }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json() as Promise<TraccarGeofence>;
}

export async function traccarDeleteGeofence(id: number): Promise<void> {
  const res = await fetch(`${TRACCAR_URL}/api/geofences/${id}`, {
    method: 'DELETE',
    headers: defaultHeaders,
  });
  if (!res.ok && res.status !== 404) throw new Error(`Traccar ${res.status}`);
}

export async function traccarLinkGeofenceToDevice(geofenceId: number, deviceId: number): Promise<void> {
  const res = await fetch(`${TRACCAR_URL}/api/permissions`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ deviceId, geofenceId }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
}

export async function traccarUnlinkGeofenceFromDevice(geofenceId: number, deviceId: number): Promise<void> {
  const res = await fetch(`${TRACCAR_URL}/api/permissions`, {
    method: 'DELETE',
    headers: defaultHeaders,
    body: JSON.stringify({ deviceId, geofenceId }),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Traccar ${res.status}`);
}

// ── Motoristas (Drivers) ──────────────────────────────────────────────────────

export async function traccarGetDrivers(): Promise<TraccarDriver[]> {
  const res = await fetch(`${TRACCAR_URL}/api/drivers`, { headers: defaultHeaders });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  return res.json() as Promise<TraccarDriver[]>;
}

export async function traccarCreateDriver(name: string, uniqueId: string): Promise<TraccarDriver> {
  const res = await fetch(`${TRACCAR_URL}/api/drivers`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ name, uniqueId }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json() as Promise<TraccarDriver>;
}

export async function traccarUpdateDriver(traccarId: number, name: string, uniqueId: string): Promise<TraccarDriver> {
  const res = await fetch(`${TRACCAR_URL}/api/drivers/${traccarId}`, {
    method: 'PUT',
    headers: defaultHeaders,
    body: JSON.stringify({ id: traccarId, name, uniqueId }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json() as Promise<TraccarDriver>;
}

export async function traccarDeleteDriver(traccarId: number): Promise<void> {
  const res = await fetch(`${TRACCAR_URL}/api/drivers/${traccarId}`, {
    method: 'DELETE',
    headers: defaultHeaders,
  });
  if (!res.ok && res.status !== 404) throw new Error(`Traccar ${res.status}`);
}

export async function traccarLinkDriverToDevice(driverId: number, deviceId: number): Promise<void> {
  const res = await fetch(`${TRACCAR_URL}/api/permissions`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ deviceId, driverId }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
}

export async function traccarUnlinkDriverFromDevice(driverId: number, deviceId: number): Promise<void> {
  const res = await fetch(`${TRACCAR_URL}/api/permissions`, {
    method: 'DELETE',
    headers: defaultHeaders,
    body: JSON.stringify({ deviceId, driverId }),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Traccar ${res.status}`);
}
