# Arquitetura

## Visão geral

A funcionalidade adiciona uma integração **backend → Detran CE** (HTTP), uma **rotina agendada** (2×/dia), e **telas** no admin, no portal do cliente (site) e no app.

```
                       ┌──────────────────────────────────────────┐
                       │            Detran CE (Central)            │
                       │  sistemas.detran.ce.gov.br/central        │
                       └───────────────▲──────────────────────────┘
                                       │ HTTP (sem captcha)
                                       │ login → principal → multas
                                       │ → emitir_extrato → gerar_boleto
                       ┌───────────────┴──────────────────────────┐
                       │             BACKEND (Node)                │
                       │  detran-ce.service.ts  (cliente HTTP)     │
                       │  multas.service.ts     (orquestração)     │
                       │  multas-scheduler      (10h e 17h)        │
                       │  multas.routes.ts (admin) / cliente-*     │
                       │  Prisma: Cliente.multasHabilitado,        │
                       │   VeiculoMultaSituacao, Multa,            │
                       │   ConsultaMultaLog                        │
                       └───────▲───────────────────────▲──────────┘
                               │ JWT admin             │ JWT cliente
                ┌──────────────┴───────┐      ┌────────┴───────────────┐
                │   AgillockSite        │      │   App (React Native)   │
                │  admin/multas.html    │      │   Tela "Multas"        │
                │  admin/clientes.html  │      │                        │
                │  (site) multas.html   │      │                        │
                └───────────────────────┘      └────────────────────────┘
```

## Componentes

### Backend
- **`detran-ce.service.ts`** — cliente HTTP de baixo nível. Implementa os 6 passos do [RECONHECIMENTO](RECONHECIMENTO_DETRAN_CE.md): manter sessão/cookie, extrair CSRF, login, parse de `principal`, parse de `multas`, `emitir_extrato_multas` (Pix), `gerar_boleto` (PDF). Sem estado de negócio — só fala com o Detran.
- **`multas.service.ts`** — orquestração de negócio: consultar um veículo, persistir situação/itens, gerar/atualizar Pix e boleto, montar respostas para admin e cliente.
- **Scheduler** (em `server.ts`, padrão `setTimeout` recursivo) — dispara `multas.service.consultarTodosHabilitados()` às 10h e 17h (America/Sao_Paulo), gravando um `ConsultaMultaLog` por execução. Ver [SCHEDULER](SCHEDULER.md).
- **Rotas** — admin (`multas.routes.ts`) e cliente (em `cliente-portal.routes.ts` ou `cliente-multas.routes.ts`). Ver [API](API.md).

### Dados
Ver [BANCO_DE_DADOS](BANCO_DE_DADOS.md). Resumo:
- `Cliente.multasHabilitado` — flag de habilitação (default `false`).
- `VeiculoMultaSituacao` — 1 registro por dispositivo habilitado: contagem, IPVA, licenciamento, último Pix/boleto (das "todas as multas"), timestamps e status da última consulta.
- `Multa` — itens da tabela de multas (substituídos a cada consulta).
- `ConsultaMultaLog` — histórico das execuções (manuais e agendadas).
- `NotificacaoMultaEnvio` — dedup das notificações ao cliente.

### Notificações
Reusam o `EventoNotificacao` existente (área de notificações/eventos do site e app; `adminEvento=true` para o admin) + push no app. Disparadas dentro do `multas.service.ts`: ao cliente (multa nova / vencimento 7 dias / no dia) e ao admin (resumo de cada consulta). Ver [NOTIFICACOES](NOTIFICACOES.md).

### Frontend
- **Admin:** botão de habilitar em `clientes.html` (padrão do `podeEditarMedidores`); nova tela `admin/multas.html` com lista, filtros, busca individual e **aba de histórico**.
- **Site cliente:** nova tela `multas.html` no portal do cliente.
- **App:** nova tela "Multas".

## Decisões de design

1. **HTTP puro, não Puppeteer.** O fluxo não tem captcha nem JS obrigatório; HTTP é mais leve, rápido e estável. (Puppeteer já existe no projeto, mas é desnecessário aqui.)

2. **Fonte de placa/renavam:** o modelo `Dispositivo` já tem `placa`, `renavam` e `chassi`. A consulta usa esses dados — o cliente não redigita nada. Veículos sem renavam/chassi cadastrado entram como "pendência de cadastro" (não consultáveis).

3. **Granularidade da habilitação:** por **cliente** (`Cliente.multasHabilitado`), seguindo o padrão de `podeEditarMedidores`. Habilitar o cliente habilita a tela (site/app) e inclui **todos os dispositivos do cliente** na rotina.

4. **Pix/boleto pré-gerados vs. sob demanda:**
   - Na consulta automática, geramos e guardamos o extrato de **todas as multas** do veículo (Pix `emv`, `qr_code` e PDF), para exibição imediata.
   - Quando o usuário (admin ou cliente) seleciona **um subconjunto**, um endpoint **sob demanda** chama `emitir_extrato_multas` + `gerar_boleto` só para os AITs escolhidos e retorna Pix/PDF na hora. (O extrato do Detran tem validade; sempre que o usuário for pagar, regeneramos para garantir dados atuais.)

5. **Armazenamento do PDF:** salvo em disco sob `uploads/multas/<dispositivoId>/Extrato_<id>.pdf` (servido por `/uploads`, como já é feito no projeto). O caminho fica em `VeiculoMultaSituacao.boletoArquivo`. Pix (`emv`) e `qr_code` (base64) ficam em colunas. Boletos sob demanda podem ser transientes (stream direto, sem persistir).

6. **Idempotência da consulta:** cada consulta substitui os `Multa` do dispositivo (delete+insert em transação) e atualiza a `VeiculoMultaSituacao`. Histórico de execução fica em `ConsultaMultaLog` (não guardamos histórico de cada multa individual ao longo do tempo — só o estado atual + log de execuções).

7. **Resiliência do scheduler:** consulta veículo a veículo; um erro em um veículo não derruba a execução (captura por veículo, conta sucessos/erros no log). Pequeno atraso entre veículos para não martelar o Detran.

8. **Escopo geográfico:** começa com **Detran CE**. O `detran-ce.service.ts` é específico do CE; a orquestração (`multas.service.ts`) é desenhada para permitir outros Detrans no futuro (1 service por estado), selecionando pelo estado do veículo/cliente.
