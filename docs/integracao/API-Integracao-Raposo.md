# API de Integração — Raposo Motors

Superfície **dedicada** ao Raposo Motors, server-to-server. Vive em `backend/src/routes/integracao-raposo.routes.ts`, montada em `/api/integracao/raposo` (ver `app.ts`). É keyed por **placa** (o Raposo liga por placa, não pelo UUID do dispositivo) e devolve KM já em **km**.

Por que uma superfície própria (e não os endpoints de admin): os endpoints de `/api/rastreamento/*` são keyed por `:id` (UUID do dispositivo), autenticados por **login/JWT humano** e o comando responde `{ ok: true }` (só enfileirado). Para o Raposo isso seria acoplado e frágil. Aqui a Raposo fala por **placa**, autentica por **API key** e o comando **confirma** antes de responder.

## Autenticação

Header **`x-api-key`**, comparado com `process.env.RAPOSO_API_KEY` (`backend/src/middleware/raposo-api-key.middleware.ts`, mesmo padrão da integração IAPRO / worker de multas).

| Situação | Resposta |
|---|---|
| `RAPOSO_API_KEY` não configurada no servidor | `503 { error: "Integração Raposo não configurada (RAPOSO_API_KEY ausente)." }` |
| Header ausente ou diferente | `401 { error: "API key inválida." }` |

A **mesma** chave fica em `AGILLOCK_API_KEY` no Raposo. Gere uma string longa e aleatória; guarde nos `secrets/` dos dois lados, nunca commitada.

```env
# .env do backend da Ágil Lock
RAPOSO_API_KEY=<mesma-chave-do-raposo>
```

## Endpoints

### `GET /veiculo/:placa/detalhe`

KM, velocidade, estado de bloqueio e posição do veículo. Resolve o dispositivo pela placa (normalizada para alfanumérico maiúsculo; casa com placa salva com ou sem hífen, `ativo: true`), busca a posição no Traccar e sincroniza os medidores.

**200**
```json
{
  "placa": "ABC1D23",
  "dispositivoId": "<uuid-do-dispositivo>",
  "online": true,
  "km": 12345,
  "odometroMetros": 12345678,
  "velocidade": 0,
  "bloqueado": false,
  "latitude": -3.73,
  "longitude": -38.52,
  "atualizadoEm": "2026-07-26T12:00:00.000Z"
}
```

- `km` = `Math.round(odometroMetros / 1000)` — a Ágil Lock guarda o odômetro em **metros**; a conversão para km acontece aqui, na borda.
- `velocidade` em km/h. `null` quando não há posição recente.
- `bloqueado` — o Traccar **não envia `blocked` em todo pacote** (some em pacote de movimento). Para não "sumir e voltar", persistimos o **último estado real** em `Dispositivo.telemetriaUltimoBloqueio` e usamos como fallback (mesmo padrão de `telemetriaUltimaIgnicao`). Fica `null` só até o rastreador reportar `blocked` pela **primeira vez** — nunca fabricamos "desbloqueado". Se um device específico jamais reportar `blocked`, o campo permanece `null` e a confirmação de comando cai em `confirmado: false` (o comando ainda é enfileirado).

**404** `{ "error": "Veículo não encontrado para a placa informada." }` — placa sem dispositivo ativo.
**500** erro ao consultar.

### `POST /veiculo/:placa/comando`

Bloqueia (`engineStop`) ou desbloqueia (`engineResume`) o motor. **Não há ACK síncrono do rastreador**: com `aguardarConfirmacao`, o servidor faz **polling** do `bloqueado` (a cada 5 s, até 60 s) e só então responde. É a Ágil Lock que espera — o cliente do Raposo faz uma chamada só.

**Body**
```json
{ "tipo": "engineStop", "aguardarConfirmacao": true }
```
`tipo` ∈ `engineStop` | `engineResume` (obrigatório). `aguardarConfirmacao` (default `false`): quando `true`, aguarda a confirmação; quando `false`, retorna assim que enfileira.

**200**
```json
{ "ok": true, "enfileirado": true, "confirmado": true, "bloqueado": true, "dispositivoId": "<uuid>" }
```
- `enfileirado: true` — o comando foi enviado ao Traccar.
- `confirmado` — `true` só se o `bloqueado` refletiu o alvo dentro de 60 s. Se estourar o tempo, volta `confirmado: false` com o último `bloqueado` lido (o comando pode ainda aplicar quando o veículo se comunicar).

**400** `tipo` inválido. **404** placa sem dispositivo. **502** dispositivo sem vínculo no rastreador / falha ao enviar.

> ⚠️ Este endpoint **corta/religa motor de verdade**. Do lado do Raposo, em dev/teste o cliente opera em **modo fake** e nunca chega aqui. Só produção com `AGILLOCK_API_KEY` setada dispara a chamada real.

### `GET /veiculo/:placa/manutencoes`

Devolve os **planos** (recorrências por KM e por data) e os **registros** de manutenção do veículo, por placa. O Raposo importa isto: recorrência → `plano_manutencao` (`agillock_recorrencia_id`); registro → `manutencao` (origem `IMPORTADO_AGILLOCK`, `agillock_registro_id`), **idempotente** pelas chaves.

```json
{
  "placa": "ABC1D23",
  "dispositivoId": "...",
  "recorrencias": [{ "id": "...", "titulo": "Óleo 5000km", "descricao": null, "intervaloKm": 5000, "kmBase": 12000 }],
  "recorrenciasData": [{ "id": "...", "titulo": "Revisão anual", "tipoRecorrencia": "ANUAL", "dataReferencia": "2026-12-01T...", "intervaloDias": null }],
  "registros": [{ "id": "...", "titulo": "Troca de óleo", "tipo": "preventiva", "dataRealizacao": "2026-02-01T...", "kmRealizacao": 5000, "custo": 120.5, "oficina": "Oficina X" }]
}
```

**404** placa sem dispositivo. **Sincronização (decisão de desenho):** as **recorrências (planos) são bidirecionais** — o Raposo também vai **criar/editar/marcar-feito** recorrências aqui (endpoints de escrita `POST /veiculo/:placa/manutencoes/recorrencia` e `.../recorrencia/:id/feito`, a criar). Os **registros** são import **one-way** (carga de histórico). O "feito" vindo da Ágil Lock **não** cria lançamento no Raposo automaticamente: lá ele vira uma **pendência** para o operador confirmar responsável/custo (o efeito financeiro é decisão humana do Raposo). Reconciliação contínua por job; webhook em tempo real é o próximo passo.

## Como o Raposo consome

`apps/api/src/integrations/agillock.ts`:
- `obterDetalhe(placa)` → `GET .../detalhe`
- `obterVelocidade(placa)` → `detalhe.velocidade ?? 0` (salvaguarda "não bloquear em movimento")
- `enviarComando(placa, tipo, aguardarConfirmacao=true)` → `POST .../comando`, traduz `confirmado` para `status: "CONFIRMADO" | "ENVIADO"`

Job `agillock:sincronizar-km` (hora em hora) atualiza o espelho `veiculo.hodometro`; o bloqueio automático usa `obterVelocidade`/`enviarComando`. Contrato no lado Raposo: [`docs/05-integracoes.md` §5](../../../Raposo_Motors/docs/05-integracoes.md).

## Checklist para ligar em produção

1. `RAPOSO_API_KEY` no `.env` do backend da Ágil Lock (e `AGILLOCK_API_KEY` igual no Raposo).
2. Placas da Raposo cadastradas na Ágil Lock (`dispositivo.ativo = true`) — normalizamos para alfanumérico maiúsculo dos dois lados.
3. `AGILLOCK_API_URL` no Raposo apontando para a Ágil Lock (pública ou rede interna do VPS).
4. Teste de leitura primeiro (`GET /detalhe`) — não corta motor. Bloqueio só depois, com um veículo combinado, em campo.
