# API de Rastreamento — AgilLock

Este documento cobre dois níveis de API:
1. **API do Backend AgilLock** (`/api/rastreamento/*`) — consumida pelo frontend
2. **API REST do Traccar** — consumida internamente pelo backend

---

## 1. API do Backend AgilLock

Base URL: `https://api.agillock.com.br/api/rastreamento`

Todas as rotas requerem autenticação JWT (`Authorization: Bearer <token>`) e papel `ADMIN` ou `COLABORADOR`.

---

### GET /api/rastreamento/posicoes

Snapshot inicial: todos os dispositivos ativos com última posição conhecida. O frontend chama isso uma vez ao abrir a tela; atualizações subsequentes chegam via WebSocket.

Paralela internamente: busca dispositivos no Prisma e posições no Traccar simultaneamente.

**Response:**
```json
[
  {
    "dispositivoId": "clxxx...",
    "nome": "Fiat Uno — João Silva",
    "placa": "ABC-1234",
    "categoria": "carro",
    "imagemUrl": "/uploads/...",
    "marca": "Fiat",
    "modeloVeiculo": "Uno",
    "cor": "Branco",
    "limiteVelocidade": 80,
    "cliente": { "id": "clyyy...", "nome": "João Silva" },
    "traccarId": 1,
    "status": "online",
    "lastUpdate": "2026-04-17T10:00:00.000Z",
    "posicao": {
      "latitude": -23.5505,
      "longitude": -46.6333,
      "velocidade": 42,
      "curso": 180,
      "altitude": 760,
      "fixTime": "2026-04-17T10:00:00.000Z",
      "deviceTime": "2026-04-17T10:00:00.000Z",
      "serverTime": "2026-04-17T10:00:01.000Z",
      "valida": true,
      "ignition": true,
      "motion": true,
      "endereco": "Av. Paulista, 1000, São Paulo",
      "sat": 8,
      "bateria": 85
    }
  }
]
```

> `posicao` é `null` quando o dispositivo nunca enviou uma posição.
> `velocidade` já está em **km/h** (convertido de knots: `speed * 1.852`).
> `status`: `"online"` | `"offline"` | `"unknown"` — vindo do Traccar.

---

### GET /api/rastreamento/dispositivos/:id/historico

Histórico de posições de um dispositivo no período. Usado pela tela de detalhe para desenhar o polyline do rastro.

**Query params:**
- `from` — ISO 8601 com fuso (ex: `2026-04-17T00:00:00-03:00`)
- `to` — ISO 8601 com fuso (ex: `2026-04-17T23:59:59-03:00`)

**Response:**
```json
{
  "dispositivo": { "id": "clxxx...", "nome": "Fiat Uno", "placa": "ABC-1234" },
  "total": 1440,
  "posicoes": [
    {
      "latitude": -23.5505,
      "longitude": -46.6333,
      "velocidade": 42,
      "curso": 180,
      "fixTime": "2026-04-17T08:00:00.000Z",
      "valida": true,
      "ignition": true
    }
  ]
}
```

---

### GET /api/rastreamento/dispositivos/:id/viagens

Relatório de viagens do período. Calcula início/fim de cada viagem, distância, duração e velocidades.

**Query params:** `from`, `to` (mesmo formato acima)

**Response:**
```json
[
  {
    "inicio": "2026-04-17T08:00:00.000Z",
    "fim": "2026-04-17T09:30:00.000Z",
    "origem": "Rua A, 100, São Paulo",
    "destino": "Rua B, 200, São Paulo",
    "origemLat": -23.5505,
    "origemLng": -46.6333,
    "destinoLat": -23.5600,
    "destinoLng": -46.6400,
    "distancia": 15.2,
    "velocidadeMedia": 38,
    "velocidadeMaxima": 80,
    "duracao": 90
  }
]
```

> `distancia` em **km**, `velocidade*` em **km/h**, `duracao` em **minutos**.

---

### GET /api/rastreamento/dispositivos/:id/paradas

Paradas do período (veículo ligado mas parado, ou ignição desligada).

**Response:**
```json
[
  {
    "inicio": "2026-04-17T09:30:00.000Z",
    "fim": "2026-04-17T10:00:00.000Z",
    "endereco": "Rua B, 200, São Paulo",
    "latitude": -23.5600,
    "longitude": -46.6400,
    "duracao": 30,
    "horasMotor": 0
  }
]
```

---

### GET /api/rastreamento/dispositivos/:id/eventos

Eventos do período (ignição ligada/desligada, alarmes, geofences, etc.).

**Response:**
```json
[
  {
    "id": 11,
    "tipo": "ignitionOff",
    "hora": "2026-04-17T10:00:00.000Z",
    "atributos": {}
  }
]
```

Tipos comuns de evento Traccar: `ignitionOn`, `ignitionOff`, `alarm`, `geofenceEnter`, `geofenceExit`, `deviceOnline`, `deviceOffline`, `deviceMoving`, `deviceStopped`.

---

### GET /api/rastreamento/dispositivos/:id/resumo

Resumo agregado do período (distância total, velocidade máxima, horas motor).

**Response:**
```json
{
  "distancia": 120.5,
  "velocidadeMedia": 45,
  "velocidadeMaxima": 110,
  "horasMotor": 3.5
}
```

Retorna `null` quando não há dados no período.

---

### GET /api/rastreamento/dispositivos/:id/tipos-comandos

Lista os tipos de comandos suportados pelo dispositivo. Retorna `[]` se o Traccar não souber quais tipos o dispositivo aceita.

---

### POST /api/rastreamento/dispositivos/:id/comandos

Envia um comando para o dispositivo via Traccar.

**Body:**
```json
{
  "tipo": "engineStop",
  "atributos": {}
}
```

Tipos comuns: `positionSingle`, `positionPeriodic`, `positionStop`, `engineStop`, `engineResume`, `alarmArm`, `alarmDisarm`.

---

## 2. WebSocket — Atualizações em tempo real

**Endpoint:** `ws://api.agillock.com.br/ws/rastreamento`

Autenticação via query param: `?token=<jwt>`

O backend mantém uma conexão com o WebSocket do Traccar e repassa as mensagens transformadas para todos os clientes frontend conectados.

**Formato das mensagens (frontend recebe):**

```json
{
  "positions": [
    {
      "deviceId": 1,
      "latitude": -23.5510,
      "longitude": -46.6340,
      "velocidade": 45,
      "curso": 90,
      "altitude": 760,
      "fixTime": "2026-04-17T10:01:00.000Z",
      "deviceTime": "2026-04-17T10:01:00.000Z",
      "serverTime": "2026-04-17T10:01:01.000Z",
      "valida": true,
      "ignition": true,
      "motion": true,
      "sat": 8,
      "bateria": 84,
      "endereco": null
    }
  ]
}
```

```json
{
  "devices": [
    {
      "traccarId": 1,
      "imei": "123456789012345",
      "status": "offline",
      "lastUpdate": "2026-04-17T10:01:00.000Z"
    }
  ]
}
```

```json
{
  "events": [
    {
      "deviceId": 1,
      "type": "ignitionOff",
      "serverTime": "2026-04-17T10:01:00.000Z",
      "positionId": 43
    }
  ]
}
```

- `deviceId` no WebSocket é o **`traccarId`** (ID interno do Traccar), **não** o `dispositivoId` do AgilLock. O frontend usa o mapa `traccarIdParaDispositivoId` para relacionar.
- Mensagens vazias `{}` (keepalive do Traccar a cada 55s) são descartadas pelo backend antes de repassar.

---

## 3. API REST do Traccar (interna ao backend)

Usada apenas pelo `traccar.service.ts`. O frontend nunca acessa o Traccar diretamente.

**Base URL (interno):** `http://traccar:8082/api` (Docker network)
**Autenticação:** Basic Auth (`TRACCAR_USER` + `TRACCAR_PASSWORD` do `.env`)

### Endpoints usados pelo backend

| Método | Endpoint | Uso |
|---|---|---|
| GET | `/api/devices` | Lista todos os dispositivos |
| GET | `/api/devices?uniqueId=IMEI` | Busca dispositivo pelo IMEI |
| POST | `/api/devices` | Cadastra novo dispositivo |
| PUT | `/api/devices/:id` | Atualiza dispositivo |
| DELETE | `/api/devices/:id` | Remove dispositivo |
| GET | `/api/positions` | Última posição de todos |
| GET | `/api/positions?deviceId=&from=&to=` | Histórico de posições |
| GET | `/api/reports/trips?deviceId=&from=&to=` | Viagens |
| GET | `/api/reports/stops?deviceId=&from=&to=` | Paradas |
| GET | `/api/reports/events?deviceId=&from=&to=` | Eventos |
| GET | `/api/reports/summary?deviceId=&from=&to=` | Resumo |
| GET | `/api/commands/types?deviceId=` | Tipos de comandos suportados |
| POST | `/api/commands/send` | Enviar comando |
| POST | `/api/session` | Login (para obter cookie do WS) |
| GET | `/api/socket` (WS) | WebSocket de posições em tempo real |

> Velocidade no Traccar é em **knots**. Conversão: `km/h = speed * 1.852`
> Duração em viagens: **milissegundos**. Conversão: `min = duration / 60000`
> Distância: **metros**. Conversão: `km = distance / 1000`

### Explorar a API do Traccar

```
http://localhost:8082/api/swagger   (Swagger UI)
http://localhost:8082/api/spec.json (OpenAPI spec)
```

---

## Tratamento de erros

| HTTP Status | Significado |
|---|---|
| 200 | Sucesso |
| 400 | Bad Request — parâmetros inválidos |
| 401 | Unauthorized — JWT inválido ou expirado |
| 403 | Forbidden — papel insuficiente |
| 404 | Not Found — dispositivo não encontrado ou não sincronizado com o Traccar |
| 502 | Bad Gateway — Traccar indisponível |
| 500 | Erro interno do backend |
