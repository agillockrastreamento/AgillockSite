# Notificações

As notificações usam o sistema de eventos existente (`EventoNotificacao`) — a mesma "área de notificações / eventos" do site e do app. Eventos do admin usam `adminEvento=true`; eventos do cliente são associados ao(s) `ClienteLogin` do cliente. Push no app via `expo-push.service`.

> Convenção de mensagem (padrão do projeto): `mensagem` no formato `"Rótulo: detalhe"` — o front deriva o rótulo de `mensagem.split(':')[0]` (ver `MEMORY.md`).

## Visão geral dos disparos

| Quando | Destinatário | tipoEvento | Condição |
|---|---|---|---|
| Após cada consulta (10h/17h) | **Cliente** | `multaNova` | Só se surgiu **AIT nova** desde a última consulta |
| Diário (na rodada 10h/17h) | **Cliente** | `multaVencimento7dias` | Multa a **7 dias** do vencimento (1× por multa) |
| Diário (na rodada 10h/17h) | **Cliente** | `multaVencimentoHoje` | Multa vence **hoje** (1× por multa) |
| Após cada lote (10h/17h) | **Admin** | `consultaMultasConcluida` | Lote terminou (sucesso/parcial) |
| Após cada lote (10h/17h) | **Admin** | `consultaMultasErro` | Lote falhou (erro geral) |

Todos respeitam **dedup** para não repetir (ver abaixo). Push (app) + registro na área de notificações (web/app) seguem o fluxo já existente.

---

## Cliente — "multa nova" (só quando há novidade)

Requisito: como os dados já ficam salvos, **só notificar quando houver multa nova** — evitar avisar repetidamente sobre a mesma multa.

**Como detectar nova:** na consulta de um veículo, **antes** do delete+insert dos `Multa`, capturar o conjunto de AITs já existentes no banco. Após buscar do Detran, comparar:
```
aitsAntigos = Set(multas atuais no banco)
aitsNovos   = Set(multas vindas do Detran)
novas = aitsNovos - aitsAntigos
```
- Se `novas.size > 0` → 1 notificação ao cliente: `multaNova`, mensagem ex.:
  `"Nova multa: veículo OSU6H88 — 1 nova autuação (ESTACIONAR EM LOCAL/HORÁRIO PROIBIDO), vencimento 13/04/2026."`
  (Se várias novas no mesmo veículo, agrupar em uma mensagem: "2 novas autuações".)
- Se `novas.size === 0` → **não notifica** (mesmo que o veículo continue tendo multas antigas).

Isso já garante o anti-spam principal sem precisar de tabela extra, porque uma multa só é "nova" uma única vez (depois ela passa a constar no banco).

## Cliente — lembretes de vencimento (7 dias e no dia)

Na rodada de consulta (após persistir), para cada multa de veículo de cliente habilitado:
- Calcular dias até `dataVencimento`.
- `== 7` → `multaVencimento7dias`: `"Multa a vencer: OSU6H88 — autuação vence em 7 dias (13/04/2026), R$ 132,85."`
- `== 0` → `multaVencimentoHoje`: `"Multa vence hoje: OSU6H88 — R$ 132,85. Pague para evitar acréscimos."`

**Dedup obrigatório** (a rodada acontece 2×/dia; não pode disparar o mesmo lembrete duas vezes no mesmo dia, nem repetir): tabela `NotificacaoMultaEnvio` (espelha `NotificacaoFinanceiraEnvio`):

```prisma
model NotificacaoMultaEnvio {
  id             String   @id @default(uuid())
  clienteLoginId String
  ait            String
  tipo           String   // "multaNova" | "multaVencimento7dias" | "multaVencimentoHoje"
  dataReferencia DateTime // dia de referência (00:00) — p/ unicidade por dia
  createdAt      DateTime @default(now())

  clienteLogin ClienteLogin @relation(fields: [clienteLoginId], references: [id], onDelete: Cascade)

  @@unique([clienteLoginId, ait, tipo, dataReferencia])
}
```
Antes de enviar, tentar `create` (ou `upsert`/checar) com a chave única; se já existe, pula. (`multaNova` pode usar `dataReferencia` = data da 1ª detecção; na prática a detecção por diff já evita repetição, mas a tabela dá garantia.)

## Admin — resumo da consulta automática (10h e 17h)

Após **cada** lote agendado, 1 notificação para o admin (`adminEvento=true`), com o resumo vindo do `ConsultaMultaLog`:

- Sucesso/parcial → `consultaMultasConcluida`:
  `"Consulta de multas (10h): concluída — 41 multas de 18 clientes (24 veículos: 23 ok, 1 erro) em 3min12s."`
- Erro geral → `consultaMultasErro`:
  `"Consulta de multas (17h): FALHOU — não foi possível concluir (erro: timeout no Detran)."`

Mesma estrutura para execução **manual** (`POST /api/multas/consultar-todos`) — pode usar o mesmo tipo, indicando origem na mensagem.

Como é 1 evento por execução (e o `ConsultaMultaLog` já é único por execução), o dedup é natural (1 notificação por `logId`).

---

## Onde aparece
- **Cliente:** área de notificações/eventos do site e do app (mesma lista de eventos já existente) + push no app (`expo-push`).
- **Admin:** painel de eventos/notificações do admin (eventos com `adminEvento=true`).

## Pontos de implementação
- Criar os eventos dentro de `multas.service.ts` (na função que consulta cada veículo e no fechamento do lote), reutilizando o helper de criação de evento/push já usado pelo `NotificationService`/`FinanceiroNotificationService`.
- Respeitar as **preferências de notificação** do cliente se fizer sentido criar um `tipoEvento` configurável (opcional; por ora, multas notificam sempre que habilitado). Avaliar se entra em `PreferenciaNotificacao`.
- Datas: `dataVencimento` vem como texto `dd/mm/aaaa` — parsear para calcular os dias.
