# Arquitetura do Traccar

## Componentes do ecossistema

O Traccar é composto por quatro componentes independentes:

| Componente | Tecnologia | Função |
|---|---|---|
| **Traccar Server** | Java (Spring-like, Netty, Jersey) | Backend principal: recebe dados dos dispositivos, armazena posições, expõe API REST e WebSocket |
| **Traccar Web** | React (repositório separado: `traccar/traccar-web`) | Front-end web embutido no server, serve na porta 8082 |
| **Traccar Manager** | Mobile (Android/iOS) | App de administração mobile |
| **Traccar Client** | Mobile (Android/iOS) | Transforma o celular em dispositivo de rastreamento |

Para o AgilLock, usaremos apenas o **Traccar Server** (que já inclui a API e o web embutido).

---

## Arquitetura interna do Traccar Server

```
┌──────────────────────────────────────────────────────┐
│                  TRACCAR SERVER                       │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │           DEVICE PROTOCOL LAYER                │  │
│  │  Netty (TCP/UDP) — porta por protocolo         │  │
│  │  GT06: 5023 | Teltonika: 5027 | GPS103: 5001  │  │
│  └──────────────────────┬─────────────────────────┘  │
│                         │ Decodifica mensagem binária │
│  ┌──────────────────────▼─────────────────────────┐  │
│  │            MESSAGE HANDLER                     │  │
│  │  Filtra, valida, calcula atributos             │  │
│  └──────────────────────┬─────────────────────────┘  │
│                         │ Objeto Position             │
│  ┌──────────────────────▼─────────────────────────┐  │
│  │            DATABASE LAYER (Liquibase)          │  │
│  │  MySQL / PostgreSQL / H2                       │  │
│  │  tc_positions, tc_devices, tc_users, etc.      │  │
│  └──────────────────────┬─────────────────────────┘  │
│                         │                             │
│  ┌──────────────────────▼─────────────────────────┐  │
│  │         REST API (Jersey/JAX-RS)               │  │
│  │  Porta 8082 — /api/*                           │  │
│  └──────────────────────┬─────────────────────────┘  │
│                         │                             │
│  ┌──────────────────────▼─────────────────────────┐  │
│  │         WEBSOCKET (Jetty)                      │  │
│  │  /api/socket — push de posições em tempo real  │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

---

## Fluxo de dados: do dispositivo ao frontend

```
1. Dispositivo GPS (GT06)
   └── Envia pacote binário via TCP para IP_DO_SERVIDOR:5023

2. Traccar Server (Netty listener na porta 5023)
   └── Decodifica protocolo GT06
   └── Extrai: latitude, longitude, velocidade, ignição, timestamp, IMEI
   └── Salva em tc_positions vinculado ao tc_devices

3. Backend AgilLock (Node.js)
   └── GET /api/positions?deviceId=X  →  Traccar REST API
   └── Ou WebSocket /api/socket para receber atualizações em tempo real
   └── Vincula deviceId (Traccar) com placa/cliente (banco AgilLock)

4. Frontend AgillockSite
   └── Chama endpoint interno do backend AgilLock
   └── Renderiza posições no mapa (Leaflet.js)
```

---

## Modelo de dados principal

### Device (dispositivo)
```json
{
  "id": 1,
  "name": "Veículo Cliente ABC",
  "uniqueId": "123456789012345",   // IMEI do aparelho
  "status": "online",               // online | unknown | offline
  "lastUpdate": "2026-03-28T10:00:00.000+0000",
  "positionId": 42,                 // ID da última posição
  "groupId": 0,
  "model": "",
  "contact": "",
  "phone": "",
  "category": "car",
  "disabled": false,
  "geofenceIds": [],
  "attributes": {}
}
```

### Position (posição GPS)
```json
{
  "id": 42,
  "deviceId": 1,
  "deviceTime": "2026-03-28T10:00:00.000+0000",  // horário no dispositivo
  "fixTime": "2026-03-28T10:00:00.000+0000",      // horário do fix GPS
  "serverTime": "2026-03-28T10:00:01.000+0000",   // horário que chegou ao servidor
  "outdated": false,
  "valid": true,
  "latitude": -23.5505,
  "longitude": -46.6333,
  "altitude": 760.0,
  "speed": 42.5,              // em knots (nós) — converter: km/h = knots * 1.852
  "course": 180.0,            // direção em graus (0-360)
  "address": "Rua Exemplo, 100, São Paulo",
  "accuracy": 0.0,
  "network": null,
  "attributes": {
    "ignition": true,         // chave ligada/desligada
    "motion": true,           // em movimento
    "rssi": -85,              // sinal GSM
    "sat": 8,                 // satélites GPS
    "distance": 1200.5,       // distância percorrida (metros)
    "totalDistance": 45000.0, // odômetro total (metros)
    "hours": 72000            // horas de funcionamento (segundos)
  }
}
```

### Event (evento)
```json
{
  "id": 10,
  "deviceId": 1,
  "positionId": 42,
  "serverTime": "2026-03-28T10:00:00.000+0000",
  "type": "deviceOnline",   // ver lista de tipos abaixo
  "attributes": {}
}
```

**Tipos de eventos mais comuns:**
| Tipo | Descrição |
|---|---|
| `deviceOnline` | Dispositivo ficou online |
| `deviceOffline` | Dispositivo ficou offline |
| `deviceMoving` | Iniciou movimento |
| `deviceStopped` | Parou |
| `geofenceEnter` | Entrou em cerca virtual |
| `geofenceExit` | Saiu de cerca virtual |
| `ignitionOn` | Chave ligada |
| `ignitionOff` | Chave desligada |
| `alarm` | Alarme (vibração, SOS, etc.) |

---

## Modelo de autorização (RBAC)

| Papel | Permissões |
|---|---|
| **Administrator** | Acesso total, gerencia todos os usuários e dispositivos |
| **Manager** | Cria e gerencia usuários subordinados |
| **User** | Acessa apenas seus próprios dispositivos |

No contexto do AgilLock, criaremos um usuário administrador no Traccar e o backend Node.js usará esse usuário para consultar todos os dados.

---

## Escalabilidade

Para produção com muitos dispositivos:
- **TimescaleDB** (extensão do PostgreSQL) é recomendado para `tc_positions` (time-series)
- Suporte a clustering horizontal via Redis broadcast
- Filtros de posição configuráveis para reduzir volume de dados
