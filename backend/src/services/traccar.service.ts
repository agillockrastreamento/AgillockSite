const TRACCAR_URL = process.env.TRACCAR_URL || 'http://traccar:8082';
const TRACCAR_USER = process.env.TRACCAR_USER!;
const TRACCAR_PASSWORD = process.env.TRACCAR_PASSWORD!;

const authHeader = 'Basic ' + Buffer.from(`${TRACCAR_USER}:${TRACCAR_PASSWORD}`).toString('base64');

const defaultHeaders = {
  'Authorization': authHeader,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

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

export async function traccarCreateDevice(name: string, imei: string): Promise<TraccarDevice> {
  const res = await fetch(`${TRACCAR_URL}/api/devices`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ name, uniqueId: imei, category: 'car' }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json() as Promise<TraccarDevice>;
}

export async function traccarUpdateDevice(traccarId: number, name: string, imei: string): Promise<TraccarDevice> {
  const res = await fetch(`${TRACCAR_URL}/api/devices/${traccarId}`, {
    method: 'PUT',
    headers: defaultHeaders,
    body: JSON.stringify({ id: traccarId, name, uniqueId: imei, category: 'car' }),
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
  deviceId: number,
  from: Date,
  to: Date,
): Promise<TraccarPosition[]> {
  const params = new URLSearchParams({
    deviceId: String(deviceId),
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const res = await fetch(`${TRACCAR_URL}/api/positions?${params}`, { headers: defaultHeaders });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  return res.json() as Promise<TraccarPosition[]>;
}

// ── Relatórios ────────────────────────────────────────────────────────────────

export async function traccarGetTrips(
  deviceId: number,
  from: Date,
  to: Date,
): Promise<TraccarTrip[]> {
  const params = new URLSearchParams({
    deviceId: String(deviceId),
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const res = await fetch(`${TRACCAR_URL}/api/reports/trips?${params}`, { headers: defaultHeaders });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  return res.json() as Promise<TraccarTrip[]>;
}

export async function traccarGetStops(
  deviceId: number,
  from: Date,
  to: Date,
): Promise<TraccarStop[]> {
  const params = new URLSearchParams({
    deviceId: String(deviceId),
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const res = await fetch(`${TRACCAR_URL}/api/reports/stops?${params}`, { headers: defaultHeaders });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  return res.json() as Promise<TraccarStop[]>;
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
    ignition?: boolean;
    motion?: boolean;
    rssi?: number;
    sat?: number;
    distance?: number;
    totalDistance?: number;
    hours?: number;
    power?: number;
    alarm?: string;
    [key: string]: unknown;
  };
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
