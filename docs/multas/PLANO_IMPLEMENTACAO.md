# Plano de implementação

Ordem sugerida, em fases verificáveis. Commits em português, direto na `main` (convenção do projeto).

Arquitetura: o fluxo do Detran roda num **worker** numa máquina Windows da rede do cliente; o **backend** (Hostinger) é o cérebro (banco, agenda, fila, notificações, telas). Ver [ARQUITETURA_WORKER](ARQUITETURA_WORKER.md).

## Fase 0 — Pré-requisitos
- [x] Parser de HTML: **`cheerio`** (confirmado).
- [x] Conectividade: servidor Hostinger **não alcança** o Detran; proxy **descartado** (IPRoyal bloqueia `.gov.br`). **Solução: worker** na rede do cliente ([ARQUITETURA_WORKER](ARQUITETURA_WORKER.md), [CONECTIVIDADE_PROXY](CONECTIVIDADE_PROXY.md)).
- [x] `BACKEND_URL` de produção: `https://api.agillock.com.br` (validado — `/api` responde 401 = no ar).
- [ ] Gerar a `WORKER_API_KEY` (segredo forte; vai no backend e no `.env` do worker).

## Fase 1 — Núcleo de integração Detran CE (lib compartilhada) ✅
Código que fala com o Detran e parseia — roda no worker (projeto `detran-worker/`), desenvolvido/testado local. Ver [RECONHECIMENTO_DETRAN_CE](RECONHECIMENTO_DETRAN_CE.md).
- [x] `detran-worker/src/detran-ce.ts` — classe `DetranCeSession` com os 6 passos (`iniciar`/`login`/`consultarPrincipal`/`consultarMultas`/`emitirExtrato`/`gerarBoleto`). HTTP via `undici` (dispatcher aceita cert do Detran) + `cheerio`.
- [x] `consultarVeiculoCompleto(placa, renavam)` traz **TUDO** (situação + multas + pix/boleto de todas). `gerarPagamento(placa, renavam, aits?)` p/ subconjunto.
- [x] Teste (`npm run test:ce`) com `OSU6H88` — 2 multas, valores, pix EMV, QR e boleto PDF (134 KB) OK em ~4s.
- [x] IPVA: detecta frase "débito de IPVA" (validado; hoje sem débito pois foi pago). Multas: 100%.
- [ ] **Pendente validar:** detecção de `licenciamentoPendente` (heurística) — precisa de um veículo com licenciamento pendente para confirmar o texto exato. IPVA em débito idem (a OSU6H88 quitou).

## Fase 2 — Banco de dados (backend) ✅
- [x] Modelos Prisma: flag `Cliente.multasHabilitado`, `VeiculoMultaSituacao`, `Multa`, `ConsultaMultaLog`, `NotificacaoMultaEnvio`.
- [x] `ConsultaJob` (fila do worker) + `WorkerStatus` (saúde/heartbeat do worker).
- [x] Migração `20260709120629_consulta_multas_detran` criada e aplicada; client gerado; schema válido.

## Fase 3 — Backend: fila + endpoints do worker ✅
- [x] Auth por `WORKER_API_KEY` (`middleware/worker-api-key.middleware.ts`, Bearer/x-api-key).
- [x] Endpoints `/api/worker/*` (`routes/worker.routes.ts`): `claim` (long-poll ~25s), `jobs/:id/resultado`, `jobs/:id/erro`, `heartbeat`.
- [x] `services/multas.service.ts`: ao receber `resultado` persiste `VeiculoMultaSituacao` + `Multa` (delete+insert em transação), salva boleto em `uploads/multas/...`, guarda pix. Pagamento avulso salvo em `uploads/multas/pagamentos/`.
- [x] Recuperação de jobs travados (`PROCESSANDO` > 10 min → `PENDENTE`, ou `ERRO` após 5 tentativas); heartbeat + `getWorkerStatus` (online = heartbeat < 3 min).
- [x] Testado ponta a ponta (auth 401, claim→PROCESSANDO, resultado→CONCLUIDO+PDF, heartbeat→online). Build do backend OK.
- [ ] Pendente (Fase 5): detectar AITs novas para notificações (marcado com TODO no service).

## Fase 4 — Worker (`detran-worker/`) + deploy no Windows ✅ (código; deploy pendente)
- [x] `detran-worker/src/worker.ts`: lê `.env` (`BACKEND_URL`, `WORKER_API_KEY`), loop de `claim` (long-poll) → executa a lib da Fase 1 (`consultarVeiculoCompleto`/`gerarPagamento`) → envia `resultado`/`erro`; heartbeat via claim; backoff em falha. `DadosInvalidosError` → erro permanente.
- [x] Teste ponta a ponta local: backend cria job → worker consulta o Detran → resultado persistido. CONSULTA_VEICULO (OSU6H88: situação+2 multas+pix+boleto) e GERAR_PAGAMENTO (subconjunto) OK. Typecheck OK.
- [ ] Instalação no Windows como serviço (NSSM) na máquina do cliente — quando for pra produção (ver [ARQUITETURA_WORKER](ARQUITETURA_WORKER.md)).

## Fase 5 — Orquestração + Scheduler + Notificações (backend) ✅
- [x] `iniciarConsultaLote(origem)`: cria `ConsultaMultaLog` + jobs `CONSULTA_VEICULO` para cada veículo de cliente habilitado (com placa + renavam/chassi). Jobs carregam `logId` (migração `consulta_job_log_id`).
- [x] Tabulação do log conforme resultados chegam (`contabilizarNoLog`, com guard de fechamento único); ao fechar, notifica admin (`consultaMultasConcluida`/`consultaMultasErro`).
- [x] Notificações ao cliente: `multaNova` (diff de AITs, suprimida na 1ª consulta), `multaVencimento7dias`/`multaVencimentoHoje`, com dedup via `NotificacaoMultaEnvio` + push (`ExpoPushService`).
- [x] Scheduler 10h/17h em `server.ts` (padrão `setTimeout`/SP). Testado E2E: lote→worker→log OK + resumo admin + `multaNova` com dedup.
- [ ] Alerta ao admin se o worker ficar **offline** (heartbeat vencido) — fazer junto da tela admin (Fase 7, usa `getWorkerStatus`).

## Fase 6 — API (admin + cliente) ✅
- [x] `multas-admin.routes.ts` (`/api/multas`): `GET /` (lista+filtros), `GET /:id` (detalhe), `POST /:id/consultar` (job+aguarda), `POST /:id/pagamento` (job `GERAR_PAGAMENTO`+aguarda), `GET /historico`, `GET /worker-status`, `POST /consultar-todos`.
- [x] `PATCH /api/clientes/:id/multas-habilitado` (toggle; ao habilitar dispara consulta inicial dos veículos elegíveis).
- [x] `cliente-multas.routes.ts` (`/api/cliente/multas`): `GET /` e `POST /:id/pagamento`. Gate `requireMultasHabilitado` + `podeAcessarDispositivo`.
- [x] `multasHabilitado` exposto no perfil do cliente (`/api/cliente/perfil`). Rotas registradas em `app.ts`.
- [x] Pagamento: cria job (regenera valor atual) e aguarda o worker (long-poll ~40s); 202 se ainda processando.
- [x] Helpers no service: `criarJobConsulta`, `criarJobPagamento`, `aguardarJob`, `getDetalheVeiculo`.
- [x] Testado E2E (backend+worker): habilitar→consulta inicial, lista, detalhe, consultar, pagamento (admin e cliente), consultar-todos+histórico, perfil.

## Fase 7 — Admin (web) ✅
- [x] Botão `.btn-multas` (ícone `fa-gavel`, verde quando ligado) em `admin/clientes.html` → `PATCH /api/clientes/:id/multas-habilitado`.
- [x] Tela `admin/multas.html`: aba Multas (filtros, tabela, detalhe em modal com pagamento Pix/QR/boleto) + aba Histórico + badge de status do worker + botão "Consultar todos" + aviso 10h/17h.
- [x] Entrada "Multas" no menu de todas as páginas admin (`fa-gavel`, após Cobranças).
- [x] Testado no navegador (Puppeteer) — prints na raiz: lista, botão em clientes, pagamento (QR/Pix/boleto), histórico.

## Fase 8 — Cliente (web) ✅
- [x] `cliente/multas.html`: cards por veículo com tabela de multas (checkbox), aviso 10h/17h, "Pagar selecionadas"/"Pagar todas" → Pix (QR + copia-e-cola) + boleto PDF. Mostra desconto ("de R$X").
- [x] Item "Multas" no menu de todas as páginas do cliente, **condicional** à flag: `multasHabilitado` exposto em `/api/cliente/me/permissoes` e regra `multas.html` em `aplicarPermissoesSidebar` (`auth-guard-cliente.js`).
- [x] Usa `AL_CLIENTE`. Testado no navegador — prints na raiz: `print-5-cliente-multas`, `print-6-cliente-pagamento`.

## Fase 9 — App
- [ ] Tela "Multas" condicional à flag; QR/Pix/copiar; download de PDF (expo-file-system v18). Ver [FRONTEND_CLIENTE_APP](FRONTEND_CLIENTE_APP.md).

## Fase 10 — Validação final
- [ ] Worker rodando como serviço no Windows, reiniciando no boot.
- [ ] Consulta em lote manual (`POST /consultar-todos`) e conferir histórico + notificações.
- [ ] Pix (pagável) e boleto (PDF abre) para "uma" e "todas".
- [ ] Habilitar/desabilitar cliente → tela aparece/some no site e app.
- [ ] Derrubar o worker → admin recebe alerta de offline; jobs ficam pendentes e processam ao voltar.
- [ ] `npm run typecheck` (app) e `npm run build` (backend). Migração em produção (`npm run db:deploy`).

## Riscos / pontos de atenção
- **Worker/máquina offline:** consultas param. Mitigação: heartbeat + alerta ao admin; jobs não se perdem (processam ao voltar); no-break + suspensão desativada.
- **IP residencial do worker bloqueado pelo Detran** (menos provável que datacenter). Mitigação: trocar de rede; monitorar com curl de verificação.
- **Validade do boleto/Pix:** valor muda com o tempo → regenerar no pagamento quando o worker está online; senão exibir guardado com a data.
- **Mudança de HTML do Detran** quebra o parser. Mitigação: `cheerio` + amostras de HTML em `docs/multas/exemplos/`.
- **hCaptcha** passar a ser exigido no login do CE (hoje não é). Mitigação: monitorar.
- **Carga no Detran:** consulta sequencial com pequeno delay; evitar paralelismo agressivo no worker.
