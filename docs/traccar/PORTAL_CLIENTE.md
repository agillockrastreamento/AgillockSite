# Portal do Cliente - Rastreamento

Atualizado em: 2026-05-03

Este documento cobre a parte de rastreamento do portal do cliente e os pontos que devem ser reutilizados no app mobile. Para autenticação, pagamentos, notificações e manutenções, ver também `docs/projeto/PORTAL_CLIENTE.md` e `docs/projeto/API.md`.

## Diferenças em relação ao admin

| Área | Admin | Cliente/app |
|---|---|---|
| Snapshot | `/api/rastreamento/posicoes` | `/api/cliente/rastreamento/posicoes` |
| Dispositivos visíveis | Todos ativos | Apenas próprios ou vinculados |
| Imagem | `imagemUrl` | `imagemUrlCliente` |
| Comandos | Admin/colaborador | Cliente autorizado ao dispositivo |
| Bloqueio financeiro | Não aplica | Bloqueia com atraso > 10 dias |
| Geocercas | Admin gerencia todas | Cliente gerencia apenas próprias |
| Relatórios em lote | `deviceId` = `traccarId` | `deviceId` = `dispositivoId` local |

## Fluxo recomendado

```text
1. POST /api/auth/login
2. GET /api/cliente/rastreamento/status-acesso
3. GET /api/cliente/rastreamento/posicoes
4. Abrir /ws/rastreamento
5. Atualizar tela por mensagens cujo deviceId esteja no snapshot
```

O WebSocket envia `deviceId` como ID do Traccar. O cliente/app deve montar:

```text
traccarId -> dispositivoId
```

com base no snapshot.

## Snapshot

`GET /api/cliente/rastreamento/posicoes`

Resposta resumida:

```json
[
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
    "posicao": {
      "latitude": -3.7319,
      "longitude": -38.5267,
      "velocidade": 42,
      "ignicao": true,
      "emMovimento": true,
      "endereco": "Rua A"
    }
  }
]
```

## Bloqueio por inadimplência

Consulta:

```text
GET /api/cliente/rastreamento/status-acesso
```

Resposta:

```json
{ "bloqueado": false }
```

ou:

```json
{ "bloqueado": true, "diasAtraso": 15 }
```

Enquanto bloqueado, as rotas de rastreamento retornam HTTP `403`:

```json
{ "error": "acesso_bloqueado" }
```

Regra: existe boleto `ATRASADO` do cliente com vencimento anterior a hoje menos 10 dias.

## Histórico, viagens, paradas, eventos e resumo

| Método | Rota |
|---|---|
| GET | `/api/cliente/rastreamento/dispositivos/:id/historico` |
| GET | `/api/cliente/rastreamento/dispositivos/:id/viagens` |
| GET | `/api/cliente/rastreamento/dispositivos/:id/paradas` |
| GET | `/api/cliente/rastreamento/dispositivos/:id/eventos` |
| GET | `/api/cliente/rastreamento/dispositivos/:id/resumo` |

Query:

```text
from=2026-05-03T00:00:00-03:00
to=2026-05-03T23:59:59-03:00
```

## Relatórios em lote

| Método | Rota |
|---|---|
| GET | `/api/cliente/rastreamento/relatorios/batch/historico` |
| GET | `/api/cliente/rastreamento/relatorios/batch/viagens` |
| GET | `/api/cliente/rastreamento/relatorios/batch/paradas` |
| GET | `/api/cliente/rastreamento/relatorios/batch/eventos` |
| GET | `/api/cliente/rastreamento/relatorios/batch/resumo` |
| GET | `/api/cliente/rastreamento/relatorios/exportar` |
| GET | `/api/cliente/rastreamento/dispositivos/:id/exportar` |

No cliente/app, `deviceId` em query deve ser o ID local (`dispositivoId`), não o `traccarId`.

## Foto do veículo

```text
POST   /api/cliente/dispositivos/:dispositivoId/foto
DELETE /api/cliente/dispositivos/:dispositivoId/foto
```

Upload:

- `multipart/form-data`
- Campo: `foto`
- Tipos: JPG, PNG, WEBP
- Limite atual: 10 MB

Resposta:

```json
{ "imagemUrlCliente": "/uploads/cliente/arquivo.webp" }
```

## Comandos

```text
GET  /api/cliente/dispositivos/:dispositivoId/tipos-comandos
POST /api/cliente/dispositivos/:dispositivoId/comandos
```

Body:

```json
{ "tipo": "engineStop", "atributos": {} }
```

Recomendação para app: exigir confirmação clara para comandos de bloqueio/desbloqueio.

## Geocercas

O cliente vê:

- Geocercas próprias (`origemTipo = CLIENTE`).
- Geocercas do admin marcadas como `visivelCliente = true` e vinculadas a seus dispositivos.

Rotas:

```text
GET    /api/cliente/rastreamento/cercas
GET    /api/cliente/rastreamento/dispositivos/:dispositivoId/cercas
POST   /api/cliente/rastreamento/cercas
DELETE /api/cliente/rastreamento/cercas/:id
GET    /api/cliente/rastreamento/geocercas
GET    /api/cliente/rastreamento/geocercas/:id
POST   /api/cliente/rastreamento/geocercas
PUT    /api/cliente/rastreamento/geocercas/:id
DELETE /api/cliente/rastreamento/geocercas/:id
```

Payload gerencial:

```json
{
  "nome": "Casa",
  "descricao": "Raio de segurança",
  "area": "CIRCLE (-3.7319 -38.5267, 300)",
  "tipo": "circulo",
  "dispositivos": ["uuid"],
  "notificarCliente": true,
  "sistemasNotif": { "web": true, "app": true, "email": false },
  "dataInicio": "2026-05-03T00:00:00-03:00",
  "ativa": true
}
```

## WebSocket

Endpoint:

```text
wss://api.agillock.com.br/ws/rastreamento
```

Mensagens possíveis:

```json
{ "positions": [{ "deviceId": 1, "latitude": -3.73, "longitude": -38.52 }] }
```

```json
{ "devices": [{ "traccarId": 1, "imei": "359999999999999", "status": "online" }] }
```

```json
{ "events": [{ "deviceId": 1, "type": "ignitionOn", "tipoLabel": "Ignição ligada" }] }
```

O app deve descartar mensagens de `deviceId` que não pertençam ao cliente logado.

## Push notification no mobile

A API usa Expo Push Notifications, sem Firebase.

Fluxo:

```text
POST   /api/cliente/notificacoes/app-tokens
GET    /api/cliente/notificacoes/app-tokens
DELETE /api/cliente/notificacoes/app-tokens
```

O backend envia push para eventos com canal `app` ativo e também para eventos financeiros:

- `boletoVencendoHoje`: uma vez às 09:00 no dia do vencimento.
- `boletoAtrasado`: uma vez por dia às 09:00 enquanto o boleto estiver atrasado.
- `pagamentoRecebido`: quando o boleto for marcado como pago por webhook EFI ou baixa manual.
