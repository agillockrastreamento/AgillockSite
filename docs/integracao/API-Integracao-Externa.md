# API AgilLock — Integração Externa

Documentação dos endpoints necessários para integrar um sistema externo à
plataforma AgilLock. Com esta API, o sistema integrado consegue, em nome de um
**cliente** (usuário final), autenticar-se com e-mail e senha e:

- listar os veículos do cliente com a **localização** atual;
- obter a **quilometragem (km)** de cada veículo;
- **bloquear** e **desbloquear** o veículo.

> Todas as chamadas representam o próprio cliente: a API só retorna e só atua
> sobre os veículos pertencentes ao usuário autenticado.

---

## 1. Informações gerais

| Item | Valor |
|---|---|
| **Base URL** | `https://api.agillock.com.br` |
| **Prefixo** | Todos os endpoints começam com `/api` |
| **Formato** | JSON (`Content-Type: application/json`) |
| **Autenticação** | Bearer Token (JWT) no header `Authorization` |
| **Codificação** | UTF-8 |

Exemplo de header autenticado:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

---

## 2. Autenticação

### `POST /api/auth/login`

Autentica o cliente com e-mail e senha e devolve o token de acesso.

**Request**

```json
{
  "email": "cliente@exemplo.com",
  "senha": "senha-do-cliente"
}
```

**Response `200 OK`**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "b1f0c2a4-...-uuid",
    "nome": "JOÃO DA SILVA",
    "email": "cliente@exemplo.com",
    "role": "CLIENTE",
    "tipo": "responsavel"
  }
}
```

**Como usar o token**

- Envie-o em **todas** as chamadas seguintes no header `Authorization: Bearer <token>`.
- Validade: **7 dias**. Após expirar, as chamadas retornam `401` — basta
  refazer o login para obter um novo token.

**Erros possíveis**

| Status | Corpo | Significado |
|---|---|---|
| `400` | `{ "error": "Email e senha são obrigatórios." }` | Faltou e-mail ou senha |
| `401` | `{ "error": "Credenciais inválidas." }` | E-mail/senha incorretos |
| `401` | `{ "error": "Acesso inativo. Contate o administrador." }` | Login desativado |
| `401` | `{ "error": "Cliente inativo. Contate o administrador." }` | Cliente desativado |

**Exemplo cURL**

```bash
curl -X POST https://api.agillock.com.br/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"cliente@exemplo.com","senha":"senha-do-cliente"}'
```

---

## 3. Veículos: localização e quilometragem

### `GET /api/cliente/rastreamento/posicoes`

Retorna a lista de veículos do cliente, cada um com seus dados de cadastro,
status de conexão e a **última posição conhecida** (incluindo a quilometragem).

Este é o endpoint principal da integração: serve tanto para **exibir os veículos
no mapa** quanto para **ler o km** usado no plano de manutenção.

**Headers:** `Authorization: Bearer <token>`

**Response `200 OK`** — array de veículos:

```json
[
  {
    "dispositivoId": "a3c9f1e0-...-uuid",
    "nome": "HILUX SW4",
    "placa": "ABC1D23",
    "categoria": "car",
    "marca": "TOYOTA",
    "modeloVeiculo": "SW4",
    "cor": "PRATA",
    "status": "online",
    "lastUpdate": "2026-06-08T12:40:11.000Z",
    "posicao": {
      "latitude": -23.55052,
      "longitude": -46.633308,
      "velocidade": 0,
      "curso": 180,
      "altitude": 720,
      "fixTime": "2026-06-08T12:40:08.000Z",
      "deviceTime": "2026-06-08T12:40:08.000Z",
      "serverTime": "2026-06-08T12:40:11.000Z",
      "valida": true,
      "endereco": "Tv. Tapynare, 64 - Maracanau/CE",
      "ignicao": false,
      "emMovimento": false,
      "odometro": 184320500,
      "horas_motor": 1204.5,
      "bloqueado": false,
      "alarme": null
    }
  }
]
```

**Campos do veículo**

| Campo | Tipo | Descrição |
|---|---|---|
| `dispositivoId` | string (UUID) | **Identificador do veículo.** Use-o no endpoint de comandos (bloquear/desbloquear). |
| `nome` | string | Nome/identificação do veículo |
| `placa` | string \| null | Placa |
| `categoria` | string \| null | Categoria (ex.: `car`, `pickup`, `motorcycle`) |
| `marca`, `modeloVeiculo`, `cor` | string \| null | Dados do veículo |
| `status` | string | Conexão: `online`, `offline` ou `unknown` |
| `lastUpdate` | string (ISO 8601) \| null | Quando o veículo se comunicou pela última vez |
| `posicao` | objeto \| null | Última posição. `null` se o veículo nunca reportou. |

**Campos de `posicao`** (os relevantes para a integração)

| Campo | Tipo | Descrição |
|---|---|---|
| `latitude` | number | Latitude (graus decimais) |
| `longitude` | number | Longitude (graus decimais) |
| `velocidade` | number | Velocidade em **km/h** |
| `curso` | number | Direção em graus (0–360) |
| `fixTime` | string (ISO) | Data/hora da posição |
| `valida` | boolean | Se a posição (GPS) é válida |
| `endereco` | string \| null | Endereço aproximado |
| `ignicao` | boolean \| null | Motor ligado (`true`) / desligado (`false`) |
| `emMovimento` | boolean \| null | Se o veículo está em movimento |
| **`odometro`** | number \| null | **Quilometragem total em METROS.** Para obter km: `odometro / 1000`. |
| `horas_motor` | number \| null | Horímetro (horas de motor ligado) |
| `bloqueado` | boolean \| null | Estado de bloqueio do veículo (`true` = bloqueado) |
| `alarme` | string \| null | Descrição do alarme ativo, se houver |

> ℹ️ **Quilometragem (km):** o campo `odometro` vem em **metros**. Para o plano
> de manutenção, use `km = Math.round(odometro / 1000)`. Recomenda-se ler o km
> periodicamente (ex.: a cada poucos minutos) e armazenar no sistema externo.
> O campo pode ser `null` em veículos que ainda não acumularam telemetria.

**Erros possíveis**

| Status | Corpo | Significado |
|---|---|---|
| `401` | `{ "error": "..." }` | Token ausente, inválido ou expirado → refazer login |
| `403` | `{ "error": "acesso_bloqueado" }` | Acesso do cliente bloqueado (pendência) — trate exibindo aviso |

**Exemplo cURL**

```bash
curl https://api.agillock.com.br/api/cliente/rastreamento/posicoes \
  -H "Authorization: Bearer <token>"
```

---

## 4. Bloquear / Desbloquear o veículo

O bloqueio e o desbloqueio são feitos enviando um **comando** para o veículo.

### `POST /api/cliente/dispositivos/{dispositivoId}/comandos`

`{dispositivoId}` é o campo `dispositivoId` obtido no endpoint de posições.

**Headers:** `Authorization: Bearer <token>`

**Request**

```json
{ "tipo": "engineStop" }
```

| `tipo` | Ação |
|---|---|
| `engineStop` | **Bloquear** o veículo |
| `engineResume` | **Desbloquear** o veículo |

**Response `200 OK`**

```json
{ "ok": true }
```

O comando é enviado ao veículo. A confirmação de que o veículo efetivamente
bloqueou/desbloqueou se reflete depois no campo `posicao.bloqueado` do endpoint
de posições (na próxima comunicação do veículo).

**Erros possíveis**

| Status | Corpo | Significado |
|---|---|---|
| `400` | `{ "error": "Tipo de comando é obrigatório." }` | Faltou o campo `tipo` |
| `403` | `{ "error": "Sem permissão para bloquear o veículo." }` | Cliente sem permissão de bloqueio |
| `403` | `{ "error": "Sem permissão para desbloquear o veículo." }` | Cliente sem permissão de desbloqueio |
| `404` | `{ "error": "Dispositivo não encontrado." }` | Veículo não pertence ao cliente |
| `500` | `{ "error": "..." }` | Falha ao enviar o comando |

**Exemplo cURL — bloquear**

```bash
curl -X POST \
  https://api.agillock.com.br/api/cliente/dispositivos/<dispositivoId>/comandos \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"engineStop"}'
```

**Exemplo cURL — desbloquear**

```bash
curl -X POST \
  https://api.agillock.com.br/api/cliente/dispositivos/<dispositivoId>/comandos \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"engineResume"}'
```

---

## 5. Fluxo recomendado da integração

1. **Login** — o usuário informa e-mail e senha no sistema externo, que chama
   `POST /api/auth/login` e guarda o `token` (renovar quando der `401`).
2. **Mapa / localização** — chamar `GET /api/cliente/rastreamento/posicoes`
   periodicamente (ex.: a cada 15–30 s para o mapa) e plotar `posicao.latitude`/
   `posicao.longitude` de cada veículo.
3. **Quilometragem / plano de manutenção** — do mesmo retorno, ler
   `posicao.odometro` (metros → km) por veículo e alimentar o plano de
   manutenção próprio do sistema externo.
4. **Bloqueio/Desbloqueio** — chamar
   `POST /api/cliente/dispositivos/{dispositivoId}/comandos` com
   `tipo: "engineStop"` ou `"engineResume"`; conferir o resultado depois em
   `posicao.bloqueado`.

---

## 6. Resumo dos endpoints

| Método | Endpoint | Finalidade |
|---|---|---|
| `POST` | `/api/auth/login` | Autenticar (e-mail + senha) → token |
| `GET` | `/api/cliente/rastreamento/posicoes` | Veículos + localização + km |
| `POST` | `/api/cliente/dispositivos/{dispositivoId}/comandos` | Bloquear / desbloquear |

---

## 7. Observações importantes

- **Escopo por cliente:** o token é do cliente; a API só enxerga e só atua sobre
  os veículos dele. Não é necessário (nem possível) informar o cliente nas
  chamadas — ele já está embutido no token.
- **Unidades:** velocidade em **km/h**; `odometro` em **metros**; datas em **ISO
  8601 (UTC)**.
- **Identificador do veículo:** sempre o `dispositivoId` (UUID) retornado em
  `/posicoes`. É a chave usada em todos os outros endpoints.
- **Tratamento de erros:** sempre verifique o status HTTP. `401` → refazer login;
  `403 acesso_bloqueado` → cliente com pendência; `404` → veículo fora do escopo.
- **Consumo via navegador (CORS):** integrações **servidor-a-servidor** (back-end,
  mobile, scripts) funcionam sem nenhuma configuração extra. Já um **frontend web**
  que faça as chamadas direto do navegador precisa que o domínio seja liberado.
