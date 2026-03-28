# API REST do Traccar

## Base URL

```
http://localhost:8082/api
```

Em produção:
```
https://rastreamento.agillock.com.br/api
```

---

## Autenticação

### Opção 1 — Basic Auth (recomendada para server-to-server)

Enviar header `Authorization` com credenciais em base64:

```
Authorization: Basic base64(email:senha)
```

Exemplo em Node.js:
```javascript
const credentials = Buffer.from('admin@agillock.com.br:senha123').toString('base64');
// → resultado: "YWRtaW5AYWdpbGxvY2suY29tLmJyOnNlbmhhMTIz"

fetch('http://localhost:8082/api/devices', {
  headers: {
    'Authorization': `Basic ${credentials}`
  }
});
```

### Opção 2 — Session via Cookie

```javascript
// 1. Fazer login
const session = await fetch('http://localhost:8082/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'email=admin@agillock.com.br&password=senha123'
});
// Retorna cookie JSESSIONID — necessário para WebSocket

// 2. Usar o cookie nas próximas requisições
const cookie = session.headers.get('set-cookie');
```

### Opção 3 — Token Bearer

```javascript
// Gerar token via API
const tokenResp = await fetch('http://localhost:8082/api/users/1/token', {
  method: 'POST',
  headers: { 'Authorization': `Basic ${credentials}` }
});
const { token } = await tokenResp.json();

// Usar token
fetch('http://localhost:8082/api/devices', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Ou via query string
fetch(`http://localhost:8082/api/session?token=${token}`);
```

> Para o backend Node.js do AgilLock, usar **Basic Auth** é a forma mais simples — não precisa gerenciar sessão ou token.

---

## Endpoints — Dispositivos

### GET /api/devices
Lista todos os dispositivos acessíveis pelo usuário autenticado.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Fiat Uno - João Silva",
    "uniqueId": "123456789012345",
    "status": "online",
    "lastUpdate": "2026-03-28T10:00:00.000+0000",
    "positionId": 42,
    "groupId": 0,
    "model": "",
    "contact": "",
    "phone": "",
    "category": "car",
    "disabled": false,
    "geofenceIds": [],
    "attributes": {}
  }
]
```

**Query params:**
- `?id=1` — buscar por ID
- `?uniqueId=IMEI` — buscar por IMEI
- `?all=true` — (admin) retorna todos os dispositivos do sistema

---

### POST /api/devices
Cadastra um novo dispositivo.

**Body:**
```json
{
  "name": "Fiat Uno - João Silva",
  "uniqueId": "123456789012345",
  "category": "car"
}
```

**Response:** objeto Device com `id` gerado.

---

### PUT /api/devices/{id}
Atualiza um dispositivo (enviar objeto completo).

---

### DELETE /api/devices/{id}
Remove um dispositivo e todo seu histórico.

---

## Endpoints — Posições

### GET /api/positions
Retorna **última posição** de cada dispositivo do usuário.

**Response:**
```json
[
  {
    "id": 42,
    "deviceId": 1,
    "deviceTime": "2026-03-28T10:00:00.000+0000",
    "fixTime": "2026-03-28T10:00:00.000+0000",
    "serverTime": "2026-03-28T10:00:01.000+0000",
    "outdated": false,
    "valid": true,
    "latitude": -23.5505,
    "longitude": -46.6333,
    "altitude": 760.0,
    "speed": 22.87,
    "course": 180.0,
    "address": "Av. Paulista, 1000, São Paulo",
    "accuracy": 0.0,
    "network": null,
    "attributes": {
      "ignition": true,
      "motion": true,
      "rssi": -85,
      "sat": 8,
      "distance": 1200.5,
      "totalDistance": 45000.0,
      "hours": 72000,
      "power": 12.4
    }
  }
]
```

**Query params:**
- `?deviceId=1` — posição de um dispositivo específico
- `?id=42` — uma posição específica pelo ID

---

### GET /api/positions (histórico)

Para buscar histórico, usar os parâmetros de data:

```
GET /api/positions?deviceId=1&from=2026-03-28T00:00:00Z&to=2026-03-28T23:59:59Z
```

- `from` e `to` no formato ISO 8601 UTC
- Retorna array de posições no período

---

## Endpoints — Relatórios

### GET /api/reports/trips
Relatório de viagens (quando saiu, quando chegou, distância, duração).

```
GET /api/reports/trips?deviceId=1&from=2026-03-01T00:00:00Z&to=2026-03-28T23:59:59Z
```

**Response:**
```json
[
  {
    "deviceId": 1,
    "deviceName": "Fiat Uno - João Silva",
    "startTime": "2026-03-28T08:00:00.000+0000",
    "startAddress": "Rua A, 100, São Paulo",
    "startLat": -23.5505,
    "startLon": -46.6333,
    "endTime": "2026-03-28T09:30:00.000+0000",
    "endAddress": "Rua B, 200, São Paulo",
    "endLat": -23.5600,
    "endLon": -46.6400,
    "distance": 15000.0,
    "averageSpeed": 40.5,
    "maxSpeed": 80.2,
    "duration": 5400000,
    "spentFuel": 0.0,
    "driverName": ""
  }
]
```

---

### GET /api/reports/stops
Relatório de paradas.

```
GET /api/reports/stops?deviceId=1&from=2026-03-28T00:00:00Z&to=2026-03-28T23:59:59Z
```

---

### GET /api/reports/summary
Resumo do período (distância total, velocidade máxima, tempo em movimento).

```
GET /api/reports/summary?deviceId=1&from=2026-03-28T00:00:00Z&to=2026-03-28T23:59:59Z
```

---

### GET /api/reports/events
Eventos do período.

```
GET /api/reports/events?deviceId=1&from=2026-03-28T00:00:00Z&to=2026-03-28T23:59:59Z&type=ignitionOn&type=ignitionOff
```

---

## WebSocket — Posições em tempo real

O WebSocket permite receber atualizações de posição assim que o servidor recebe do dispositivo, sem precisar fazer polling.

**Endpoint:** `ws://localhost:8082/api/socket`

**Autenticação:** Requer **cookie de sessão** (não aceita Basic Auth). É preciso fazer login via `/api/session` primeiro.

**Formato das mensagens recebidas:**
```json
{
  "positions": [
    {
      "id": 43,
      "deviceId": 1,
      "latitude": -23.5510,
      "longitude": -46.6340,
      "speed": 30.5,
      "fixTime": "2026-03-28T10:01:00.000+0000",
      "attributes": { "ignition": true, "motion": true }
    }
  ]
}
```

```json
{
  "devices": [
    {
      "id": 1,
      "status": "online",
      "lastUpdate": "2026-03-28T10:01:00.000+0000"
    }
  ]
}
```

```json
{
  "events": [
    {
      "id": 11,
      "deviceId": 1,
      "type": "ignitionOff",
      "serverTime": "2026-03-28T10:01:00.000+0000"
    }
  ]
}
```

- Cada mensagem pode conter qualquer combinação de `positions`, `devices` e `events`
- Keepalive enviado pelo servidor a cada 55 segundos (objeto vazio `{}`)

**Exemplo no backend Node.js:**
```javascript
const WebSocket = require('ws');

// 1. Fazer login para obter cookie
const loginResp = await fetch('http://localhost:8082/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'email=admin@agillock.com.br&password=senha123',
  redirect: 'manual'
});
const cookie = loginResp.headers.get('set-cookie');

// 2. Conectar ao WebSocket com o cookie
const ws = new WebSocket('ws://localhost:8082/api/socket', {
  headers: { Cookie: cookie }
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.positions) {
    // Processar novas posições
    msg.positions.forEach(pos => {
      console.log(`Dispositivo ${pos.deviceId}: ${pos.latitude}, ${pos.longitude}`);
    });
  }
});
```

---

## Endpoints — Geofences (cercas virtuais)

### GET /api/geofences
Lista as cercas virtuais.

### POST /api/geofences
Cria uma cerca virtual.

**Body (círculo):**
```json
{
  "name": "Pátio Central",
  "area": "CIRCLE (-23.5505 -46.6333, 500)",
  "attributes": {}
}
```

**Body (polígono):**
```json
{
  "name": "Zona de Entrega SP",
  "area": "POLYGON ((-23.55 -46.63, -23.56 -46.63, -23.56 -46.64, -23.55 -46.64, -23.55 -46.63))",
  "attributes": {}
}
```

---

## Endpoints — Usuários

### GET /api/users
Lista usuários (admin only).

### POST /api/users
Cria novo usuário.

### GET /api/session
Verifica sessão atual / retorna usuário logado.

---

## Endpoints — Comandos

Enviar comandos para dispositivos (ex: desligar motor, solicitar posição).

### GET /api/commands/types?deviceId=1
Lista os tipos de comandos disponíveis para o dispositivo.

### POST /api/commands/send
Envia comando para o dispositivo.

```json
{
  "deviceId": 1,
  "type": "engineStop",
  "attributes": {}
}
```

Tipos comuns: `positionSingle`, `positionPeriodic`, `positionStop`, `engineStop`, `engineResume`, `alarmArm`, `alarmDisarm`

---

## Tratamento de erros

| HTTP Status | Significado |
|---|---|
| 200 | Sucesso |
| 400 | Bad Request — parâmetros inválidos |
| 401 | Unauthorized — credenciais inválidas |
| 403 | Forbidden — sem permissão para o recurso |
| 404 | Not Found — recurso não existe |
| 500 | Internal Server Error |

---

## Postman / Insomnia

Para explorar a API, usar a especificação OpenAPI disponível em:
```
http://localhost:8082/api/swagger
```
ou importar o arquivo JSON da especificação que fica em:
```
http://localhost:8082/api/spec.json
```
