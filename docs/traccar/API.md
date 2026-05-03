# API de Rastreamento e Traccar - AgilLock

Atualizado em: 2026-05-03

Este documento cobre:

1. API REST do backend AgilLock para rastreamento.
2. WebSocket de tempo real exposto pelo backend.
3. API REST/WebSocket do Traccar usada internamente.

Frontend web e app mobile nunca acessam o Traccar diretamente. Eles sempre usam o backend AgilLock.

## Bases

| Ambiente | REST | WebSocket |
|---|---|---|
| Produção | `https://api.agillock.com.br/api` | `wss://api.agillock.com.br/ws/rastreamento` |
| Local | `http://localhost:3000/api` | `ws://localhost:3000/ws/rastreamento` |
| Traccar interno Docker | `http://traccar:8082/api` | `ws://traccar:8082/api/socket` |

## Identificadores

| Campo | Origem | Tipo | Uso |
|---|---|---|---|
| `dispositivoId` | AgilLock `Dispositivo.id` | string | Rotas REST do backend |
| `identificador` | AgilLock `Dispositivo.identificador` | string | IMEI, chave de vínculo com Traccar |
| `traccarId` | Traccar `Device.id` | number | WebSocket e relatórios internos |
| `deviceId` | Traccar | number | Campo usado em mensagens Traccar |

O vínculo entre AgilLock e Traccar é feito por IMEI:

```text
Dispositivo.identificador <-> Traccar Device.uniqueId
```

## Autenticação e acesso

Admin/colaborador:

- Rotas `/api/rastreamento/*`
- JWT interno com `role: ADMIN` ou `COLABORADOR`
- Exige permissão de monitoramento (`podeAcessarMonitoramento` para colaborador)

Cliente/app:

- Rotas `/api/cliente/rastreamento/*`
- JWT com `role: CLIENTE`
- Filtra dispositivos por `clienteId` do token, incluindo vínculos em `DispositivoCliente`
- Bloqueia rastreamento se houver boleto `ATRASADO` com mais de 10 dias

## Modelo de posição normalizada

O backend converte a posição do Traccar para um formato estável:

```json
{
  "latitude": -3.7319,
  "longitude": -38.5267,
  "velocidade": 42,
  "curso": 180,
  "altitude": 30,
  "fixTime": "2026-05-03T12:00:00.000Z",
  "deviceTime": "2026-05-03T12:00:00.000Z",
  "serverTime": "2026-05-03T12:00:01.000Z",
  "valida": true,
  "endereco": "Rua A, Fortaleza",
  "ignicao": true,
  "emMovimento": true,
  "alarme_codigo": null,
  "alarme": null,
  "sinal": 4,
  "satelites": 10,
  "tensao": 12.6,
  "bateria_tensao": 4.1,
  "bateria_nivel": 85,
  "carregando": true,
  "odometro": 123456,
  "distancia_segmento": 350,
  "horas_motor": 10.5,
  "combustivel": null,
  "combustivel_gasto": null,
  "bloqueado": false,
  "entrada_digital": null,
  "saida_digital": null,
  "motorista_id": null
}
```

Conversões aplicadas:

- Velocidade: Traccar envia knots; backend retorna km/h (`speed * 1.852`).
- Distância: Traccar envia metros; respostas resumidas retornam km quando indicado.
- Duração: Traccar envia milissegundos; respostas resumidas retornam minutos ou horas quando indicado.
- Medidores do sistema podem substituir odômetro/horímetro nativos quando `ignorarOdometro` estiver ativo.

## Admin/colaborador - snapshot

`GET /api/rastreamento/posicoes`

Retorna todos os dispositivos ativos.

Resposta:

```json
[
  {
    "dispositivoId": "uuid",
    "nome": "Tracker Hilux",
    "placa": "ABC-1234",
    "identificador": "359999999999999",
    "categoria": "car",
    "imagemUrl": "/uploads/dispositivos/foto.webp",
    "marca": "Toyota",
    "modeloVeiculo": "Hilux",
    "cor": "Prata",
    "telefoneRastreador": "+558599999999",
    "operadora": "Vivo",
    "limiteVelocidade": 100,
    "cliente": { "id": "uuid", "nome": "João Silva" },
    "clienteLoginId": "clxxx",
    "motorista": { "id": "uuid", "nome": "Maria" },
    "traccarId": 1,
    "status": "online",
    "lastUpdate": "2026-05-03T12:00:00.000Z",
    "posicao": {}
  }
]
```

`posicao` é `null` quando não existe última posição.

## Cliente/app - snapshot

`GET /api/cliente/rastreamento/posicoes`

Mesma finalidade, mas filtrado pelo cliente autenticado.

Campos específicos:

```json
{
  "dispositivoId": "uuid",
  "nome": "Tracker Hilux",
  "placa": "ABC-1234",
  "categoria": "car",
  "imagemUrlCliente": "/uploads/cliente/foto.webp",
  "marca": "Toyota",
  "modeloVeiculo": "Hilux",
  "cor": "Prata",
  "limiteVelocidade": 100,
  "podeGerenciarManutencao": true,
  "cliente": { "id": "uuid", "nome": "João Silva" },
  "traccarId": 1,
  "status": "online",
  "lastUpdate": "2026-05-03T12:00:00.000Z",
  "posicao": {}
}
```

Se o acesso estiver bloqueado:

```json
{ "error": "acesso_bloqueado" }
```

com HTTP `403`.

## Reverse geocode

| Perfil | Rota |
|---|---|
| Admin | `GET /api/rastreamento/geocode/reverse?lat=-3.73&lon=-38.52` |
| Cliente | `GET /api/cliente/rastreamento/geocode/reverse?lat=-3.73&lon=-38.52` |

Resposta:

```json
{ "endereco": "Rua A, Fortaleza, CE" }
```

O backend tenta Google Maps se houver chave configurada e usa Nominatim como fallback.

## Histórico

Admin:

`GET /api/rastreamento/dispositivos/:id/historico?from=ISO&to=ISO`

Cliente:

`GET /api/cliente/rastreamento/dispositivos/:id/historico?from=ISO&to=ISO`

Resposta:

```json
{
  "dispositivo": {
    "id": "uuid",
    "nome": "Tracker Hilux",
    "placa": "ABC-1234",
    "categoria": "car"
  },
  "total": 120,
  "posicoes": [
    {
      "latitude": -3.7319,
      "longitude": -38.5267,
      "velocidade": 42,
      "curso": 180,
      "fixTime": "2026-05-03T12:00:00.000Z",
      "valida": true,
      "ignicao": true
    }
  ]
}
```

Padrão sem filtros: últimas 24 horas.

## Viagens

Admin:

`GET /api/rastreamento/dispositivos/:id/viagens?from=ISO&to=ISO`

Cliente:

`GET /api/cliente/rastreamento/dispositivos/:id/viagens?from=ISO&to=ISO`

Resposta:

```json
[
  {
    "inicio": "2026-05-03T08:00:00.000Z",
    "fim": "2026-05-03T09:30:00.000Z",
    "origem": "Rua A",
    "destino": "Rua B",
    "origemLat": -3.7319,
    "origemLng": -38.5267,
    "destinoLat": -3.741,
    "destinoLng": -38.536,
    "distancia": 15.2,
    "velocidadeMedia": 38,
    "velocidadeMaxima": 80,
    "duracao": 90
  }
]
```

Padrão sem filtros: últimos 7 dias.

## Paradas

Admin:

`GET /api/rastreamento/dispositivos/:id/paradas?from=ISO&to=ISO`

Cliente:

`GET /api/cliente/rastreamento/dispositivos/:id/paradas?from=ISO&to=ISO`

Resposta:

```json
[
  {
    "inicio": "2026-05-03T09:30:00.000Z",
    "fim": "2026-05-03T10:00:00.000Z",
    "endereco": "Rua B",
    "latitude": -3.741,
    "longitude": -38.536,
    "duracao": 30,
    "horasMotor": 0.2
  }
]
```

## Eventos

Admin:

`GET /api/rastreamento/dispositivos/:id/eventos?from=ISO&to=ISO`

Cliente:

`GET /api/cliente/rastreamento/dispositivos/:id/eventos?from=ISO&to=ISO`

Resposta:

```json
[
  {
    "id": 11,
    "tipo": "ignitionOff",
    "tipoLabel": "Ignição desligada",
    "hora": "2026-05-03T10:00:00.000Z",
    "atributos": {}
  }
]
```

Eventos comuns:

```text
deviceOnline, deviceOffline, deviceUnknown, deviceMoving, deviceStopped,
deviceOverspeed, deviceFuelDrop, commandResult, geofenceEnter, geofenceExit,
alarm, ignitionOn, ignitionOff, maintenance, textMessage, driverChanged, media
```

## Resumo

Admin:

`GET /api/rastreamento/dispositivos/:id/resumo?from=ISO&to=ISO`

Cliente:

`GET /api/cliente/rastreamento/dispositivos/:id/resumo?from=ISO&to=ISO`

Resposta:

```json
{
  "distancia": 120.5,
  "velocidadeMedia": 45,
  "velocidadeMaxima": 110,
  "horasMotor": 3.5
}
```

Retorna `null` quando não há dados.

## Comandos

Admin:

| Método | Rota |
|---|---|
| GET | `/api/rastreamento/dispositivos/:id/tipos-comandos` |
| POST | `/api/rastreamento/dispositivos/:id/comandos` |

Cliente:

| Método | Rota |
|---|---|
| GET | `/api/cliente/dispositivos/:dispositivoId/tipos-comandos` |
| POST | `/api/cliente/dispositivos/:dispositivoId/comandos` |

Envio:

```json
{
  "tipo": "engineStop",
  "atributos": {}
}
```

Tipos comuns:

```text
positionSingle, positionPeriodic, positionStop,
engineStop, engineResume, alarmArm, alarmDisarm
```

Quando o cliente envia `engineStop` ou `engineResume`, o backend também gera eventos internos `deviceLocked` ou `deviceUnlocked` para notificações.

## Medidores do sistema

Admin:

`PATCH /api/rastreamento/dispositivos/:id/medidores`

Uso: ajustar odômetro/horímetro próprios quando o equipamento não reporta dados confiáveis.

Campos esperados:

```json
{
  "ignorarOdometro": true,
  "odometroSistemaKm": 45320.5,
  "horimetroSistemaHoras": 150.2
}
```

O backend persiste em `Dispositivo`:

- `ignorarOdometro`
- `odometroSistemaMetros`
- `horimetroSistemaSegundos`
- `telemetriaUltimaPosicaoEm`
- `telemetriaUltimaLatitude`
- `telemetriaUltimaLongitude`
- `telemetriaUltimaIgnicao`

## Detalhe enriquecido

Admin:

`GET /api/rastreamento/dispositivos/:id/detalhe`

Retorna cadastro, cliente, motorista, dados de chip/rastreador, estado Traccar, posição e medidores. É usado pela tela de detalhe e pelo fluxo de foco ao voltar do histórico.

## Geocercas

### Rotas admin

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/rastreamento/cercas` | Lista compatível com Traccar |
| GET | `/api/rastreamento/dispositivos/:id/cercas` | Cercas vinculadas ao dispositivo |
| POST | `/api/rastreamento/cercas` | Cria cerca simples |
| DELETE | `/api/rastreamento/cercas/:id` | Remove cerca simples |
| DELETE | `/api/rastreamento/cercas/:id/dispositivos/:dispositivoId` | Desvincula dispositivo |
| GET | `/api/rastreamento/geocercas` | Lista gerencial |
| GET | `/api/rastreamento/geocercas/:id` | Detalhe gerencial |
| POST | `/api/rastreamento/geocercas` | Cria geocerca |
| PUT | `/api/rastreamento/geocercas/:id` | Edita geocerca |
| DELETE | `/api/rastreamento/geocercas/:id` | Exclui geocerca |

### Rotas cliente/app

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cliente/rastreamento/cercas` | Cercas visíveis no mapa |
| GET | `/api/cliente/rastreamento/dispositivos/:dispositivoId/cercas` | Cercas do dispositivo |
| POST | `/api/cliente/rastreamento/cercas` | Cria cerca simples própria |
| DELETE | `/api/cliente/rastreamento/cercas/:id` | Remove cerca simples própria |
| GET | `/api/cliente/rastreamento/geocercas` | Lista geocercas próprias |
| GET | `/api/cliente/rastreamento/geocercas/:id` | Detalhe |
| POST | `/api/cliente/rastreamento/geocercas` | Cria geocerca própria |
| PUT | `/api/cliente/rastreamento/geocercas/:id` | Edita geocerca própria |
| DELETE | `/api/cliente/rastreamento/geocercas/:id` | Exclui geocerca própria |

Payload:

```json
{
  "nome": "Garagem",
  "descricao": "Local de pernoite",
  "area": "CIRCLE (-3.7319 -38.5267, 300)",
  "tipo": "circulo",
  "dispositivos": ["uuid"],
  "visivelCliente": true,
  "notificarCliente": true,
  "sistemasNotif": { "web": true, "app": true, "email": false },
  "dataInicio": "2026-05-03T00:00:00-03:00",
  "ativa": true
}
```

Formatos `area`:

```text
CIRCLE (lat lon, radius)
POLYGON ((lon lat, lon lat, lon lat, lon lat))
LINESTRING (lon lat, lon lat)
```

O admin pode criar geocercas visíveis ao cliente (`visivelCliente = true`). O cliente só edita/exclui geocercas com `origemTipo = "CLIENTE"`.

## Relatórios em lote

Admin:

```text
GET /api/rastreamento/relatorios/batch/historico
GET /api/rastreamento/relatorios/batch/viagens
GET /api/rastreamento/relatorios/batch/paradas
GET /api/rastreamento/relatorios/batch/eventos
GET /api/rastreamento/relatorios/batch/resumo
GET /api/rastreamento/relatorios/exportar
```

Cliente/app:

```text
GET /api/cliente/rastreamento/relatorios/batch/historico
GET /api/cliente/rastreamento/relatorios/batch/viagens
GET /api/cliente/rastreamento/relatorios/batch/paradas
GET /api/cliente/rastreamento/relatorios/batch/eventos
GET /api/cliente/rastreamento/relatorios/batch/resumo
GET /api/cliente/rastreamento/relatorios/exportar
GET /api/cliente/rastreamento/dispositivos/:id/exportar
```

Query:

```text
from=2026-05-03T00:00:00-03:00
to=2026-05-03T23:59:59-03:00
deviceId=1,2,3
type=route|events|trips|stops|summary
```

Diferença:

- Admin envia `deviceId` como `traccarId`.
- Cliente envia `deviceId` como `dispositivoId`; o backend valida propriedade e converte para `traccarId`.

Exportação retorna XLSX:

```text
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename=relatorio_<type>.xlsx
```

## Logs

Admin:

`GET /api/rastreamento/logs`

Retorna `text/plain` com as últimas linhas do log do Traccar. O backend tenta ler `/opt/traccar/logs/tracker-server.log` e usa `GET /api/server/log` como fallback.

## WebSocket do backend

Endpoint:

```text
wss://api.agillock.com.br/ws/rastreamento
```

O servidor atual aceita conexões no path `/ws/rastreamento` e retransmite mensagens transformadas do Traccar para os clientes conectados.

### Mensagem de posições

```json
{
  "positions": [
    {
      "deviceId": 1,
      "latitude": -3.7319,
      "longitude": -38.5267,
      "velocidade": 42,
      "curso": 180,
      "altitude": 30,
      "fixTime": "2026-05-03T12:00:00.000Z",
      "deviceTime": "2026-05-03T12:00:00.000Z",
      "serverTime": "2026-05-03T12:00:01.000Z",
      "valida": true,
      "endereco": "Rua A",
      "ignicao": true,
      "emMovimento": true,
      "satelites": 10,
      "bateria_nivel": 85,
      "odometro": 123456,
      "horas_motor": 10.5
    }
  ]
}
```

`deviceId` no WebSocket é o `traccarId`.

### Mensagem de dispositivos

```json
{
  "devices": [
    {
      "traccarId": 1,
      "imei": "359999999999999",
      "status": "offline",
      "lastUpdate": "2026-05-03T12:00:00.000Z"
    }
  ]
}
```

### Mensagem de eventos

```json
{
  "events": [
    {
      "deviceId": 1,
      "type": "geofenceEnter",
      "tipoLabel": "Entrou na cerca",
      "serverTime": "2026-05-03T12:00:00.000Z",
      "positionId": 123,
      "geofenceId": 10,
      "lat": -3.7319,
      "lng": -38.5267,
      "endereco": "Rua A"
    }
  ]
}
```

O backend também pode emitir eventos sintéticos de geocerca quando o Traccar não envia `geofenceEnter`/`geofenceExit`, usando cache das geocercas e cálculo local de ponto dentro da área.

### Recomendações para o app mobile

- Abrir WebSocket depois do snapshot `/cliente/rastreamento/posicoes`.
- Montar mapa local `traccarId -> dispositivoId`.
- Ignorar mensagens cujo `deviceId` não exista no mapa do cliente.
- Revalidar snapshot periodicamente para captar novos dispositivos, foto, status ou permissões.
- Tratar queda de conexão com backoff e novo snapshot após reconectar.

## API interna do Traccar usada pelo backend

Autenticação:

- REST: Basic Auth (`TRACCAR_USER` + `TRACCAR_PASSWORD`)
- WebSocket: cookie `JSESSIONID` obtido por `POST /api/session`

Endpoints usados:

| Método | Endpoint Traccar | Uso |
|---|---|---|
| GET | `/api/devices` | Lista dispositivos |
| GET | `/api/devices?uniqueId=IMEI` | Busca por IMEI |
| POST | `/api/devices` | Cria dispositivo |
| PUT | `/api/devices/:id` | Atualiza dispositivo |
| DELETE | `/api/devices/:id` | Remove dispositivo |
| PUT | `/api/devices/:id/accumulators` | Ajusta acumuladores |
| GET | `/api/positions` | Últimas posições |
| GET | `/api/positions?deviceId=...` | Últimas posições filtradas |
| GET | `/api/reports/route?deviceId=&from=&to=` | Histórico/rota |
| GET | `/api/reports/trips?deviceId=&from=&to=` | Viagens |
| GET | `/api/reports/stops?deviceId=&from=&to=` | Paradas |
| GET | `/api/reports/events?deviceId=&from=&to=` | Eventos |
| GET | `/api/reports/summary?deviceId=&from=&to=` | Resumo |
| GET | `/api/reports/:type?...` | Exportação XLSX |
| GET | `/api/commands/types?deviceId=` | Tipos de comando |
| POST | `/api/commands/send` | Envio de comando |
| GET | `/api/geofences` | Lista geocercas |
| GET | `/api/geofences?deviceId=` | Geocercas por dispositivo |
| POST | `/api/geofences` | Cria geocerca |
| PUT | `/api/geofences/:id` | Atualiza geocerca |
| DELETE | `/api/geofences/:id` | Remove geocerca |
| POST | `/api/permissions` | Vincula device/geofence ou device/driver |
| DELETE | `/api/permissions` | Remove vínculo |
| GET | `/api/drivers` | Lista motoristas |
| POST | `/api/drivers` | Cria motorista |
| PUT | `/api/drivers/:id` | Atualiza motorista |
| DELETE | `/api/drivers/:id` | Remove motorista |
| GET | `/api/server/log` | Log do servidor |
| POST | `/api/session` | Login para cookie do WS |
| WS | `/api/socket` | Stream de posições, devices e eventos |

## Sincronização com Traccar

Dispositivo:

- Ao criar dispositivo no AgilLock, o backend cria `Device` no Traccar.
- Ao editar, atualiza nome, IMEI, categoria, modelo, telefone e atributos.
- Ao excluir, remove no Traccar quando possível.
- O cadastro local não deve depender da disponibilidade momentânea do Traccar sem tratamento de erro.

Motorista:

- Motoristas podem ser sincronizados como `Driver`.
- Vínculo motorista/dispositivo é feito via `/api/permissions` com `{ deviceId, driverId }`.

Geocerca:

- Criação/edição/remove no Traccar e espelha metadados locais em `Geocerca`.
- Vínculo com dispositivo usa `/api/permissions` com `{ deviceId, geofenceId }`.

## Notificações geradas a partir do rastreamento

O WebSocket processa posições e eventos para gerar notificações:

- Ignição ligada/desligada.
- Entrada/saída de geocerca.
- Excesso de velocidade.
- Corte de energia.
- Km excedida/reduzida.
- Troca de óleo.
- Bloqueio/desbloqueio por comando.

Eventos são persistidos em `EventoNotificacao` e entregues conforme `PreferenciaNotificacao`.

## Tratamento de falhas

| Situação | Comportamento |
|---|---|
| Traccar REST indisponível | Rotas retornam `502` quando o dado é obrigatório |
| Sem posição | `posicao: null` ou lista vazia |
| Dispositivo sem Traccar | `404 Dispositivo não sincronizado` |
| Keepalive WS `{}` | Descartado |
| WS Traccar caiu | Backend tenta reconectar em 5s |
| Falha ao obter sessão WS | Nova tentativa em 10s |
| Endereço ausente | Usa reverse geocode quando necessário ou retorna `null` |

## Swagger do Traccar

Em ambiente com Traccar exposto:

```text
http://localhost:8082/api/swagger
http://localhost:8082/api/spec.json
```
