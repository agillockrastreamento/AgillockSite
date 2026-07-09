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

## Fase 4 — Worker (`detran-worker/`) + deploy no Windows
- [ ] Projeto Node separado: lê `.env` (`BACKEND_URL`, `WORKER_API_KEY`), faz `claim` → executa a lib da Fase 1 → envia `resultado`/`erro`; `heartbeat` periódico.
- [ ] Deps mínimas (cliente HTTP + `cheerio` + `dotenv`).
- [ ] Instalação no Windows como serviço (NSSM) — ver passo a passo em [ARQUITETURA_WORKER](ARQUITETURA_WORKER.md).
- [ ] Teste ponta a ponta: backend cria job → worker processa → resultado no banco.

## Fase 5 — Orquestração + Scheduler + Notificações (backend)
- [ ] Ao chegar `resultado` de `CONSULTA_VEICULO`: detectar **AITs novas** (diff antes de substituir) e disparar notificações ([NOTIFICACOES](NOTIFICACOES.md)): cliente (`multaNova`, `multaVencimento7dias`, `multaVencimentoHoje` com dedup) e admin (`consultaMultasConcluida`/`Erro`).
- [ ] Scheduler 10h/17h em `server.ts` ([SCHEDULER](SCHEDULER.md)): cria jobs `CONSULTA_VEICULO` para cada veículo de cliente habilitado + fecha `ConsultaMultaLog`.
- [ ] Alerta ao admin se o worker estiver **offline** (heartbeat vencido).

## Fase 6 — API (admin + cliente)
- [ ] `multas.routes.ts` (admin): `GET /api/multas`, `GET /:id`, `POST /:id/consultar` (cria job), `POST /:id/pagamento` (cria job `GERAR_PAGAMENTO`), `GET /:id/boleto`, `GET /historico`, `POST /consultar-todos`.
- [ ] `PATCH /api/clientes/:id/multas-habilitado` (em `clientes.routes.ts`).
- [ ] Rotas do cliente: `GET /api/cliente/multas`, `POST /:id/pagamento`, `GET /:id/boleto`. Gate por `multasHabilitado`.
- [ ] Expor `multasHabilitado` no login/perfil do cliente. Registrar rotas em `app.ts`.
- [ ] Pagamento: se worker online → job `GERAR_PAGAMENTO` (valor atual); se offline → dado guardado com data ([ARQUITETURA_WORKER](ARQUITETURA_WORKER.md), cuidado com validade).

## Fase 7 — Admin (web)
- [ ] Botão `.btn-multas` em `admin/clientes.html` (toggle). Ver [FRONTEND_ADMIN](FRONTEND_ADMIN.md).
- [ ] Tela `admin/multas.html`: aba Multas (filtros, tabela, detalhe, pagamento) + aba Histórico + status do worker.
- [ ] Entrada no menu do admin.

## Fase 8 — Cliente (web)
- [ ] `multas.html` no portal do cliente + menu condicional à flag. Ver [FRONTEND_CLIENTE_APP](FRONTEND_CLIENTE_APP.md).

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
