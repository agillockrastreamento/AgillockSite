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

**404** placa sem dispositivo.

> O `GET` só devolve o que está **ativo**. Recorrência desativada aqui some da resposta — e é assim que o Raposo sabe que ela acabou: ele desativa o plano espelhado do lado dele (antes o plano ficava órfão, contando e alertando sozinho).

**Sincronização (decisão de desenho):** as **recorrências (planos) são bidirecionais**, por KM **e** por data (endpoints de escrita abaixo). Os **registros** são import **one-way** (carga de histórico). O "feito" vindo da Ágil Lock **não** cria lançamento no Raposo automaticamente: lá ele fecha a ocorrência do plano e abre uma **pendência** para o operador confirmar responsável/custo — o efeito financeiro é decisão humana do Raposo.

### Escrita de recorrências (Raposo → Ágil Lock)

Oito rotas, todas por placa e com a mesma `x-api-key`. As seis marcadas com ⭐ entraram em **07/08/2026** e fecham a mão dupla: antes só dava para criar e marcar feito por KM, então o espelho **passava a mentir na primeira edição** e o lado por data não existia.

| Rota | O que faz |
|---|---|
| `POST /veiculo/:placa/manutencoes/recorrencia` | Cria recorrência por KM (`kmBase` = KM atual). Devolve `{ id, kmBase }`. |
| `POST .../recorrencia/:id/feito` | Reseta o contador (`kmBase` = KM atual) e deixa o registro. |
| ⭐ `PUT .../recorrencia/:id` | Edita `titulo`, `descricao`, `intervaloKm`, `kmBase` **ou** `kmProximo`. |
| ⭐ `DELETE .../recorrencia/:id` | **Desativa** (`ativa: false`). |
| ⭐ `POST .../recorrencia-data` | Cria recorrência por data. Devolve `{ id, dataReferencia }`. |
| ⭐ `PUT .../recorrencia-data/:id` | Edita título, tipo, data e intervalo. |
| ⭐ `POST .../recorrencia-data/:id/feito` | Avança para a próxima data (ou encerra a AVULSA) e deixa o registro. |
| ⭐ `DELETE .../recorrencia-data/:id` | **Desativa**. |

Regras que valem para todas:

- **Excluir é desativar, nunca apagar.** Os registros de manutenção apontam para a recorrência; apagá-la levaria o histórico do cliente junto.
- **`kmProximo` no `PUT` por KM.** Os dois lados contam diferente: aqui é `kmBase + intervaloKm`, no Raposo é o alvo absoluto. Mandando `kmProximo`, a conversão acontece aqui — onde as duas peças estão à mão.
- **Alvo que muda zera os avisos.** Uma revisão empurrada de 10.000 para 15.000 km recomeça a escada de alertas; sem isso o aviso de 50 km, já marcado como enviado, nunca sairia de novo.
- **`tipoRecorrencia`** aceita `AVULSA | INTERVALO | SEMANAL | MENSAL | ANUAL`; o Raposo usa `INTERVALO` (a cada N dias) e `AVULSA` (data única). Datas são ancoradas a 00:00 de São Paulo, como no portal.
- **Origem `RAPOSO`** em tudo que nasce por aqui — é o que a tela do cliente usa para mostrar de onde veio. Estas rotas **não** emitem webhook de volta: o que veio de lá não volta para lá.

## Webhook — Ágil Lock → Raposo ⭐ (07/08/2026)

Antes, o Raposo **perguntava**: um job de 20 em 20 minutos, uma chamada por placa. Com 150 veículos são **450 chamadas por hora** para descobrir que quase nada mudou, e ainda assim o KM da tela dele ficava até 20 minutos atrasado. Agora a Ágil Lock **avisa**.

**Endpoint no Raposo:** `POST https://raposomotors.com.br/api/webhooks/agillock`, header `x-agillock-secret`.

**Corpo** (um evento por requisição):

```json
{ "id": "<uuid do evento>", "tipo": "km.lote", "dados": { "...": "..." } }
```

| Tipo | Quando | Dados |
|---|---|---|
| `km.lote` | A cada ~60 s, se algum odômetro mudou | `{ veiculos: [{ placa, km, odometroMetros }], medidoEm }` |
| `recorrencia.criada` / `.editada` | Portal ou admin criam/editam | `placa`, `recorrenciaId`, `titulo`, `intervaloKm`, `kmBase` |
| `recorrencia.desativada` | Exclusão (que é desativação) | `placa`, `recorrenciaId` |
| `recorrencia.feita` | "Marcar como feito" | + `registroId`, `dataRealizacao`, `kmRealizacao`, `custo`, `oficina` |
| `recorrenciaData.*` | Idem, por data | `tipoRecorrencia`, `dataReferencia`, `intervaloDias` |
| `registro.criado` | Manutenção avulsa registrada | `registroId`, `titulo`, `dataRealizacao`, `custo`, `oficina` |

Como funciona, e por que assim:

- **KM em lote, manutenção na hora.** Cada moto emite posição a cada poucos segundos: um webhook por posição seria muito pior que o polling. As placas com odômetro novo se acumulam em memória (do `traccar.ws`, onde o odômetro é atualizado em tempo real) e descarregam **uma chamada por minuto** — 60 por hora, independente do tamanho da frota. Eventos de manutenção são raros e cada um importa, então vão na hora.
- **Outbox com retentativa** (`WebhookRaposoEvento`). O evento é gravado antes de ser entregue; um worker envia a cada 15 s com backoff (30 s → 30 min, 12 tentativas). Sem isso, um deploy do Raposo — que derruba a API dele por alguns segundos — perderia em silêncio os eventos do intervalo.
- **Idempotência pelo `id`.** O Raposo grava o id recebido e ignora repetição: reentrega não vira manutenção duplicada.
- **A ordem é preservada.** Falha de rede interrompe a rodada em vez de pular para o próximo evento — "editada" chegando depois de "desativada" reabriria um plano encerrado.
- **`400`/`422` do Raposo = desistir**; qualquer outro status = tentar de novo. Payload que ele recusa não melhora com insistência, e insistir bloquearia a fila atrás dele.
- **O job diário do Raposo continua**, agora como **rede de segurança**: ele relê tudo por placa e conserta o que o webhook não entregou. Webhook para o tempo real, reconciliação para o que escapou — nenhum dos dois sozinho basta.

**Variáveis (no `.env` do backend da Ágil Lock):**

```env
RAPOSO_WEBHOOK_ATIVO=false                  # nasce DESLIGADO; sem isto nada é gravado nem enviado
RAPOSO_WEBHOOK_URL=https://raposomotors.com.br/api/webhooks/agillock
RAPOSO_WEBHOOK_SECRET=<mesmo AGILLOCK_WEBHOOK_SECRET do Raposo>
RAPOSO_WEBHOOK_CLIENTE_IDS=<uuid do cliente Raposo>   # separados por vírgula
```

> 🔴 **`RAPOSO_WEBHOOK_CLIENTE_IDS` é filtro de vazamento, não de desempenho.** A frota da Ágil Lock é de vários clientes e a integração é com **um**. Sem essa lista **nenhum** evento sai — fecha por padrão, de propósito.

## Como o Raposo consome

`apps/api/src/integrations/agillock.ts`:
- `obterDetalhe(placa)` → `GET .../detalhe`
- `obterVelocidade(placa)` → `detalhe.velocidade ?? 0` (salvaguarda "não bloquear em movimento")
- `enviarComando(placa, tipo, aguardarConfirmacao=true)` → `POST .../comando`, traduz `confirmado` para `status: "CONFIRMADO" | "ENVIADO"`
- `criarRecorrenciaAgillock` / `editarRecorrenciaAgillock` / `excluirRecorrenciaAgillock` / `marcarRecorrenciaFeitaAgillock` — o par por KM
- `criarRecorrenciaDataAgillock` / `editarRecorrenciaDataAgillock` / `excluirRecorrenciaDataAgillock` / `marcarRecorrenciaDataFeitaAgillock` — o par por data

Um plano do tipo `AMBOS` no Raposo espelha **duas** recorrências aqui e guarda os dois ids (`agillock_recorrencia_id` e `agillock_recorrencia_data_id`). Todas as chamadas são **best-effort**: a Ágil Lock fora do ar não impede ninguém de editar um plano lá, e o job diário reconcilia.

Job `agillock:sincronizar-km` (hora em hora) atualiza o espelho `veiculo.hodometro` — com o webhook ligado ele vira redundância barata; `agillock:sincronizar-manutencao` roda 1×/dia como rede de segurança. Contrato no lado Raposo: [`docs/05-integracoes.md` §5](../../../Raposo_Motors/docs/05-integracoes.md).

## Checklist para ligar em produção

1. `RAPOSO_API_KEY` no `.env` do backend da Ágil Lock (e `AGILLOCK_API_KEY` igual no Raposo).
2. Placas da Raposo cadastradas na Ágil Lock (`dispositivo.ativo = true`) — normalizamos para alfanumérico maiúsculo dos dois lados.
3. `AGILLOCK_API_URL` no Raposo apontando para a Ágil Lock (pública ou rede interna do VPS).
4. Teste de leitura primeiro (`GET /detalhe`) — não corta motor. Bloqueio só depois, com um veículo combinado, em campo.

### Para ligar o webhook (a ordem importa)

1. **Backup do banco** antes da migração, conferido — a tabela de outbox entra por migração **aditiva** (só cria).
2. Subir o código com `RAPOSO_WEBHOOK_ATIVO=false`. Nesse estado a Ágil Lock se comporta exatamente como antes; o rollback é não ligar.
3. Descobrir o id do cliente Raposo e pôr em `RAPOSO_WEBHOOK_CLIENTE_IDS`. Sem ele, ligar não produz efeito nenhum (fecha por padrão).
4. Conferir que o Raposo já tem `AGILLOCK_WEBHOOK_SECRET` — com o segredo ausente lá, a rota responde 401 e o outbox só acumula tentativas.
5. Ligar (`RAPOSO_WEBHOOK_ATIVO=true`), reiniciar e acompanhar o log: a linha `[webhook-raposo] ligado → ...` e, em até um minuto, o primeiro `km.lote`. Conferir o KM de duas ou três placas contra o painel.
6. Se algo estranhar: `RAPOSO_WEBHOOK_ATIVO=false` e reiniciar. Os eventos ficam no outbox e são entregues quando religar.
