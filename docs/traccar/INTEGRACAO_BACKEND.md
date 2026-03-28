# Integração Traccar — Backend Node.js/Express

## Contexto do projeto

O AgilLock já possui o modelo `Dispositivo` com o campo `identificador` que armazena o **IMEI** do aparelho GPS. Esse campo é o elo entre os dois sistemas:

```
Dispositivo (AgilLock/Prisma)   tc_devices (Traccar/PostgreSQL)
─────────────────────────────   ───────────────────────────────
id            → cuid            id        → integer (autoincrement)
identificador → IMEI    ←→      uniqueId  → IMEI (string)
nome
clienteId
```

A vinculação é feita pelo **IMEI** — ao precisar de dados de rastreamento, o backend busca o dispositivo no Traccar via `GET /api/devices?uniqueId=IMEI`. Não é necessário nenhum campo adicional no schema Prisma.

---

## Arquitetura de tempo real (WebSocket)

O sistema usa **dois WebSockets encadeados**:

```
[Dispositivo GT06]
      │ TCP porta 5023
      ▼
[Traccar Server]  ← armazena posição no PostgreSQL
      │ WebSocket ws://traccar:8082/api/socket
      ▼
[Backend Node.js] ← recebe posição em ~1s
      │ WebSocket ws://api.agillock.com.br/ws
      ▼
[Frontend AgillockSite] ← atualiza marcador no mapa em tempo real
```

O backend mantém **uma única conexão** WebSocket aberta com o Traccar e redistribui as atualizações para todos os clientes frontend conectados via `ws`.

---

## Instalar dependências

```bash
cd backend
npm install ws
npm install --save-dev @types/ws
```

---

## Módulo de serviço: `traccar.service.ts`

Criar `backend/src/services/traccar.service.ts`:

```typescript
// backend/src/services/traccar.service.ts

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
  return res.json();
}

export async function traccarGetDeviceByImei(imei: string): Promise<TraccarDevice | null> {
  const res = await fetch(`${TRACCAR_URL}/api/devices?uniqueId=${encodeURIComponent(imei)}`, {
    headers: defaultHeaders,
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}`);
  const devices: TraccarDevice[] = await res.json();
  return devices[0] ?? null;
}

export async function traccarCreateDevice(name: string, imei: string): Promise<TraccarDevice> {
  const res = await fetch(`${TRACCAR_URL}/api/devices`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ name, uniqueId: imei, category: 'car' }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function traccarUpdateDevice(traccarId: number, name: string, imei: string): Promise<TraccarDevice> {
  const res = await fetch(`${TRACCAR_URL}/api/devices/${traccarId}`, {
    method: 'PUT',
    headers: defaultHeaders,
    body: JSON.stringify({ id: traccarId, name, uniqueId: imei, category: 'car' }),
  });
  if (!res.ok) throw new Error(`Traccar ${res.status}: ${await res.text()}`);
  return res.json();
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
  return res.json();
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
  return res.json();
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
  return res.json();
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
  return res.json();
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
  // Extrair apenas o JSESSIONID
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
```

---

## WebSocket Bridge: `traccar.ws.ts`

Criar `backend/src/services/traccar.ws.ts`.

Este módulo abre **uma conexão permanente** com o WebSocket do Traccar e repassa as atualizações para todos os clientes do frontend conectados.

```typescript
// backend/src/services/traccar.ws.ts
import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage, Server } from 'http';
import { traccarGetSessionCookie } from './traccar.service';

const TRACCAR_URL = process.env.TRACCAR_URL || 'http://traccar:8082';
const WS_TRACCAR_URL = TRACCAR_URL.replace('http://', 'ws://').replace('https://', 'wss://');

// Clientes frontend conectados ao backend
const frontendClients = new Set<WebSocket>();

let traccarWs: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

// ── Iniciar o servidor WebSocket para o frontend ──────────────────────────────

export function initTraccarWebSocket(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/rastreamento' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // TODO: validar JWT do frontend aqui se necessário
    frontendClients.add(ws);
    console.log(`[WS] Frontend conectado. Total: ${frontendClients.size}`);

    ws.on('close', () => {
      frontendClients.delete(ws);
      console.log(`[WS] Frontend desconectado. Total: ${frontendClients.size}`);
    });

    ws.on('error', () => frontendClients.delete(ws));
  });

  // Iniciar conexão com o Traccar
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
  traccarWs = new WebSocket(`${WS_TRACCAR_URL}/api/socket`, {
    headers: { Cookie: cookie },
  });

  traccarWs.on('open', () => {
    console.log('[WS Traccar] Conectado.');
  });

  traccarWs.on('message', (data: Buffer) => {
    const raw = data.toString();

    // Ignorar keepalives vazios do Traccar
    if (raw === '{}' || raw.trim() === '') return;

    let msg: TraccarWsMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Transformar e repassar para todos os clientes frontend conectados
    const payload = transformTraccarMessage(msg);
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

function transformTraccarMessage(msg: TraccarWsMessage): object | null {
  const result: Record<string, unknown> = {};

  if (msg.positions?.length) {
    result.positions = msg.positions.map(p => ({
      deviceId: p.deviceId,       // ID interno do Traccar (traccarId)
      latitude: p.latitude,
      longitude: p.longitude,
      velocidade: Math.round(p.speed * 1.852), // knots → km/h
      curso: p.course,
      altitude: p.altitude,
      fixTime: p.fixTime,
      valida: p.valid,
      ignition: p.attributes?.ignition ?? null,
      motion: p.attributes?.motion ?? null,
      sat: p.attributes?.sat ?? null,
      bateria: p.attributes?.power ?? null,
      endereco: p.address,
    }));
  }

  if (msg.devices?.length) {
    result.devices = msg.devices.map(d => ({
      traccarId: d.id,
      imei: d.uniqueId,
      status: d.status,
      lastUpdate: d.lastUpdate,
    }));
  }

  if (msg.events?.length) {
    result.events = msg.events.map(e => ({
      deviceId: e.deviceId,
      type: e.type,
      serverTime: e.serverTime,
      positionId: e.positionId,
    }));
  }

  if (Object.keys(result).length === 0) return null;
  return result;
}

// ── Tipos internos ────────────────────────────────────────────────────────────

interface TraccarWsMessage {
  positions?: Array<{
    deviceId: number;
    latitude: number;
    longitude: number;
    altitude: number;
    speed: number;
    course: number;
    fixTime: string;
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
    serverTime: string;
  }>;
}
```

---

## Registrar o WebSocket no `server.ts` / `index.ts`

O WebSocket precisa do servidor HTTP (não do `app` Express diretamente). Verificar como o servidor é iniciado no projeto e adaptar:

```typescript
// backend/src/server.ts (ou index.ts)
import http from 'http';
import app from './app';
import { initTraccarWebSocket } from './services/traccar.ws';

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);

// Iniciar WebSocket bridge com Traccar
initTraccarWebSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
```

---

## Rotas REST de rastreamento: `rastreamento.routes.ts`

Criar `backend/src/routes/rastreamento.routes.ts`:

```typescript
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import {
  traccarGetDevices,
  traccarGetDeviceByImei,
  traccarGetPositions,
  traccarGetPositionHistory,
  traccarGetTrips,
  traccarGetStops,
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
      marca: true, modeloVeiculo: true, cor: true, limiteVelocidade: true,
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
        bateria: posicao.attributes.power ?? null,
      } : null,
    };
  });

  res.json(resultado);
});

// ── GET /api/rastreamento/dispositivos/:id/historico ──────────────────────────
router.get('/dispositivos/:id/historico', requireRoles('ADMIN', 'COLABORADOR'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { from, to } = req.query as { from?: string; to?: string };

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
  const { id } = req.params;
  const { from, to } = req.query as { from?: string; to?: string };

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

export default router;
```

---

## Registrar a rota no `app.ts`

```typescript
// backend/src/app.ts — adicionar:
import rastreamentoRoutes from './routes/rastreamento.routes';

app.use('/api/rastreamento', rastreamentoRoutes);
```

---

## Sincronização automática ao cadastrar dispositivo

No `dispositivos.routes.ts`, após `prisma.dispositivo.create(...)`:

```typescript
import { traccarCreateDevice } from '../services/traccar.service';

try {
  await traccarCreateDevice(dispositivo.nome, dispositivo.identificador);
} catch (err) {
  // Não bloquear o cadastro se o Traccar estiver offline
  console.warn('[Traccar] Falha ao sincronizar dispositivo:', err);
}
```

---

## Endpoints REST criados

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/rastreamento/posicoes` | Snapshot inicial: todos os dispositivos + última posição |
| GET | `/api/rastreamento/dispositivos/:id/historico` | Histórico de posições (padrão: últimas 24h) |
| GET | `/api/rastreamento/dispositivos/:id/viagens` | Relatório de viagens (padrão: últimos 7 dias) |

**WebSocket:**
- `ws://api.agillock.com.br/ws/rastreamento` — recebe atualizações em tempo real

**Query params (historico e viagens):**
- `from` — data inicial ISO 8601
- `to` — data final ISO 8601
