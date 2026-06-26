# Plano de implementação

Ordem sugerida, em fases verificáveis. Commits em português, direto na `main` (convenção do projeto).

## Fase 0 — Pré-requisitos
- [ ] **BLOQUEANTE — conectividade do servidor:** o teste no Hostinger retornou `000` (sem conexão). Diagnosticar (DNS/firewall de saída/bloqueio do Detran) e resolver. Provável solução: **proxy BR** para as requisições do `detran-ce.service`. O service deve suportar `HTTPS_PROXY`/agente de proxy configurável por env.
- [x] Parser de HTML: **`cheerio`** (confirmado) — adicionar à dependência do backend.

## Fase 1 — Integração Detran (núcleo)
- [ ] `backend/src/services/detran-ce.service.ts` com os 6 passos do [RECONHECIMENTO](RECONHECIMENTO_DETRAN_CE.md):
  - `criarSessao()` → cookie + CSRF
  - `login(placa, renavamOuChassi)` → status
  - `consultarPrincipal()` → `{ qtdMultas, possuiDebitoIpva, licenciamentoPendente }`
  - `consultarMultas()` → `Multa[]` (com `selecaoValue`)
  - `emitirExtrato(selecaoValues[])` → `{ extratoId, emv, qrCodeBase64 }`
  - `gerarBoleto(extratoId?)` → `Buffer` (PDF)
- [ ] Teste manual com a placa `OSU6H88` / renavam `01241525924` (deve retornar 2 multas + IPVA).

## Fase 2 — Banco de dados
- [ ] Modelos Prisma ([BANCO_DE_DADOS](BANCO_DE_DADOS.md)): flag em `Cliente`, `VeiculoMultaSituacao`, `Multa`, `ConsultaMultaLog`, `NotificacaoMultaEnvio`.
- [ ] Migração e `db:migrate`.

## Fase 3 — Orquestração + Scheduler + Notificações
- [ ] `multas.service.ts`: `consultarVeiculo(dispositivo)` (detecta AITs novas → persiste situação/itens + pré-gera Pix/boleto das todas) e `consultarTodosHabilitados(origem)` (lote + `ConsultaMultaLog`).
- [ ] Notificações ([NOTIFICACOES](NOTIFICACOES.md)): cliente (`multaNova`, `multaVencimento7dias`, `multaVencimentoHoje` com dedup) e admin (`consultaMultasConcluida`/`Erro`).
- [ ] Armazenamento do PDF em `uploads/multas/...`.
- [ ] Scheduler 10h/17h em `server.ts` ([SCHEDULER](SCHEDULER.md)).

## Fase 4 — API
- [ ] `multas.routes.ts` (admin): `GET /api/multas`, `GET /:id`, `POST /:id/consultar`, `POST /:id/pagamento`, `GET /:id/boleto`, `GET /historico`, `POST /consultar-todos`.
- [ ] `PATCH /api/clientes/:id/multas-habilitado` (em `clientes.routes.ts`).
- [ ] Rotas do cliente (em `cliente-portal.routes.ts` ou `cliente-multas.routes.ts`): `GET /api/cliente/multas`, `POST /:id/pagamento`, `GET /:id/boleto`. Gate por `multasHabilitado`.
- [ ] Expor `multasHabilitado` no payload de login/perfil do cliente.
- [ ] Registrar rotas em `app.ts`.

## Fase 5 — Admin (web)
- [ ] Botão `.btn-multas` em `admin/clientes.html` (toggle).
- [ ] Tela `admin/multas.html`: aba Multas (filtros, tabela, detalhe, pagamento) + aba Histórico.
- [ ] Entrada no menu do admin.

## Fase 6 — Cliente (web)
- [ ] `multas.html` no portal do cliente + entrada de menu condicional à flag.

## Fase 7 — App
- [ ] Tela "Multas" condicional à flag; QR/Pix/copiar; download de PDF (expo-file-system v18).

## Fase 8 — Validação final
- [ ] Rodar consulta em lote manual (`POST /consultar-todos`) e conferir histórico.
- [ ] Conferir Pix (pagável) e boleto (PDF abre) para "uma" e "todas".
- [ ] Testar habilitar/desabilitar cliente → tela aparece/some no site e app.
- [ ] `npm run typecheck` (app) e `npm run build` (backend).
- [ ] Aplicar migração em produção (`npm run db:deploy`).

## Riscos / pontos de atenção
- **IP bloqueado em produção** (mitigação: proxy BR). Validar na Fase 0.
- **hCaptcha** passar a ser exigido no login (hoje não é). Mitigação: monitorar; se ocorrer, avaliar fluxo alternativo.
- **Mudança de HTML do Detran** quebra o parser. Mitigação: `cheerio` + testes do parser com HTML salvo de exemplo (guardar amostra em `docs/multas/exemplos/`).
- **Validade do extrato/Pix:** regenerar no momento do pagamento (não confiar no Pix pré-gerado por muito tempo).
- **Carga no Detran:** consulta sequencial com delay; evitar paralelismo agressivo.
