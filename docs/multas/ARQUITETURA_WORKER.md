# Arquitetura do Worker (máquina intermediária)

Como o servidor de produção (Hostinger) **não alcança o Detran** (bloqueio de rede — ver [CONECTIVIDADE_PROXY](CONECTIVIDADE_PROXY.md)) e a via de proxy foi descartada (a IPRoyal bloqueia domínios `.gov.br` e exigiria US$ 500 em fundos para liberar), a consulta ao Detran passa a ser feita por um **mini-worker** rodando numa **máquina Windows sempre ligada, em outra rede** (residencial, que alcança o Detran normalmente).

> Decisão: **worker (agente) na rede do cliente**, não proxy. Sem mensalidade, sem bloqueio de domínio, sem exposição da rede.

## Visão geral

```
   ┌───────────────────────────┐         ┌──────────────────────────────┐        ┌───────────┐
   │   BACKEND (Hostinger)     │         │   WORKER (Windows, sempre     │        │  DETRAN   │
   │   "cérebro"               │◀───────▶│   ligado, outra rede)         │───────▶│    CE     │
   │                           │  HTTPS  │   "braço"                     │  HTTP  │           │
   │ • banco de dados          │ (worker │                               │        └───────────┘
   │ • agenda 10h/17h          │  faz a  │ • fluxo do Detran (HTTP)      │
   │ • fila de jobs            │  saída) │ • parse (cheerio)             │
   │ • notificações            │         │ • gera boleto/pix             │
   │ • telas admin/cliente     │         │                               │
   └───────────────────────────┘         └──────────────────────────────┘
```

- **Backend (Hostinger):** todo o estado e a lógica de negócio — banco, agenda, fila de tarefas, notificações, telas.
- **Worker (Windows):** programa pequeno e "burro" que apenas executa o fluxo do Detran quando solicitado, parseia e devolve. Não guarda nada além de uma chave de API.

## Comunicação — polling (o worker procura o backend)

**O worker faz só conexões de saída** para o backend (que é público). O backend **nunca** conecta no worker. Isso é fundamental:
- Nada é exposto na rede do cliente — sem abrir portas no roteador, sem IP fixo, sem túnel.
- Funciona atrás de qualquer Wi-Fi/roteador residencial.

Ciclo:
```
Worker → Backend:  "tem job pendente?"   (long-poll: o backend segura até ~25s)
Backend → Worker:  { job: consultar placa X renavam Y }
Worker:            [vai ao Detran, consulta, parseia, gera pix/boleto]
Worker → Backend:  { resultado: situação + multas + pix + boletoPdf }
Backend:           [salva, detecta multa nova, dispara notificações]
```

**Long-polling:** o worker chama `claim` e o backend só responde quando há job (ou após ~25s sem nada). Assim, jobs interativos (cliente clicando "pagar") são pegos em ~1s, sem o worker ficar martelando o servidor.

## Fila de jobs (banco)

Novo modelo `ConsultaJob` no backend:

```prisma
model ConsultaJob {
  id           String   @id @default(uuid())
  tipo         String   // "CONSULTA_VEICULO" | "GERAR_PAGAMENTO"
  uf           String   @default("CE")
  placa        String
  renavam      String?
  dispositivoId String?
  aits         Json?    // GERAR_PAGAMENTO: AITs selecionados (null/[] = todas)
  status       String   @default("PENDENTE") // PENDENTE | PROCESSANDO | CONCLUIDO | ERRO
  tentativas   Int      @default(0)
  resultado    Json?    // devolvido pelo worker (situação/multas/pix; PDF vai p/ arquivo)
  erro         String?
  origem       String   // "AGENDADA" | "MANUAL_ADMIN" | "CLIENTE"
  claimedEm    DateTime?
  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  @@index([status, criadoEm])
}
```

- **Recuperação de falha:** job em `PROCESSANDO` há mais de N min (worker caiu no meio) volta para `PENDENTE`.
- Jobs concluídos podem ser limpos periodicamente (o dado final vive em `VeiculoMultaSituacao`/`Multa`).

## Endpoints do worker (no backend)

Autenticados por uma **chave de API do worker** (header `Authorization: Bearer <WORKER_API_KEY>`), separada do JWT das telas.

| Rota | Função |
|---|---|
| `POST /api/worker/claim` | Long-poll; retorna o próximo job `PENDENTE`, marca `PROCESSANDO` + `claimedEm` |
| `POST /api/worker/jobs/:id/resultado` | Worker envia o resultado (JSON; PDF em base64 ou multipart) → backend salva e processa |
| `POST /api/worker/jobs/:id/erro` | Worker reporta erro (backend marca `ERRO` / re-enfileira) |
| `POST /api/worker/heartbeat` | Sinal de vida (liveness) |

Ao receber o `resultado` de um `CONSULTA_VEICULO`, o backend: atualiza `VeiculoMultaSituacao` + `Multa`, salva o boleto em `uploads/multas/...`, detecta multas novas e dispara as notificações ([NOTIFICACOES](NOTIFICACOES.md)).

## O que a consulta automática traz (mudança: trazer TUDO)

> **Decisão (supera as decisões #4 e #5 de [ARQUITETURA](ARQUITETURA.md)):** como o custo/limite de tráfego do proxy deixou de existir, a consulta agendada traz **tudo de uma vez** e guarda no backend.

Cada `CONSULTA_VEICULO` (10h/17h) retorna e persiste:
- Situação: nº de multas, débito de IPVA (sim/não), licenciamento (pendente/em dia).
- Tabela completa de multas (AIT, motivo, datas, valores, `selecaoValue`).
- **Pix de "todas as multas"**: `emv` (copia-e-cola) + `qr_code` (PNG base64).
- **Boleto PDF de "todas as multas"** (salvo em `uploads/multas/<dispositivoId>/`).

**Vantagem:** mesmo se o worker desligar/cair depois, os dados de pagamento já estão no backend, prontos pra exibir e baixar.

### Cuidado com validade (importante)
Boleto/Pix de multa têm **valor que muda com o tempo** (juros/atualização por data) e vencimento. Um boleto gerado às 10h pode ficar desatualizado se pago dias depois. Regra:
- Exibir sempre o dado guardado, **com a data** ("valores atualizados em \<data\>").
- Quando o cliente for **efetivar o pagamento**: se o worker estiver online, criar um job `GERAR_PAGAMENTO` para **regenerar** com o valor atual (dos AITs escolhidos); se offline, usar o guardado avisando que os valores são da última consulta.
- O fluxo do usuário não muda: ele clica "pagar", escolhe uma multa ou todas, e recebe Pix/boleto (regenerado quando possível).

## Fluxos

**Automático (10h/17h):**
1. Backend cria N jobs `CONSULTA_VEICULO` (`origem=AGENDADA`), um por veículo habilitado.
2. Worker processa (traz tudo, inclui pix+boleto de todas).
3. Backend salva + notifica (cliente: multa nova/vencimento; admin: resumo da rodada).

**Cliente paga (sob demanda):**
1. Cliente escolhe multas e clica pagar → backend cria job `GERAR_PAGAMENTO` (`origem=CLIENTE`) com os AITs.
2. Worker gera pix+boleto atualizados só desses AITs → devolve.
3. Backend entrega ao cliente (Pix copia-e-cola, QR, PDF).

**Admin "buscar agora":** cria job `CONSULTA_VEICULO` (`origem=MANUAL_ADMIN`) de um veículo específico.

## Confiabilidade e monitoramento

- **Máquina/internet cai:** jobs ficam `PENDENTE`; ao voltar, o worker processa o acumulado. Nada se perde, só atrasa.
- **Heartbeat:** worker envia `POST /api/worker/heartbeat` a cada ~60s. O backend guarda `ultimoHeartbeat`. Se passar de X min sem sinal, marca o worker como **offline** e **notifica o admin** ("worker offline — consultas paradas"). A tela do admin mostra o status (online/offline, visto por último).
- **Retry:** erros transitórios do Detran → o job volta a `PENDENTE` (até um limite de `tentativas`).

## Segurança

- Comunicação worker↔backend por **HTTPS**, autenticada por `WORKER_API_KEY` (segredo forte, só no worker e no backend).
- Endpoints do worker isolados, exigem a chave (não o login das telas).
- Worker faz **só saída** → rede do cliente **não exposta**.
- Chave rotacionável a qualquer momento (troca no backend e no worker).
- Worker não guarda dados sensíveis (stateless; só a chave no `.env`).

---

# Instalação e operação no Windows (passo a passo)

A máquina é **Windows** e precisa rodar o worker **sempre**, reiniciando sozinho ao ligar o PC e se travar. Abaixo, do zero.

## 1. Instalar o Node.js
1. Baixar o instalador **LTS** em https://nodejs.org (versão 20+).
2. Instalar com as opções padrão.
3. Conferir no `cmd`/PowerShell:
   ```powershell
   node -v
   npm -v
   ```

## 2. Copiar o worker para a máquina
- Colocar a pasta do worker (ex.: `detran-worker/`) em um caminho fixo, ex.: `C:\detran-worker\`.
- Dentro dela, instalar as dependências:
  ```powershell
  cd C:\detran-worker
  npm install
  ```

## 3. Configurar as variáveis (arquivo `.env`)
Em vez de variáveis de ambiente do Windows (que dão trabalho com contas de serviço), o worker lê um arquivo **`.env`** na própria pasta — mais simples e confiável. Criar `C:\detran-worker\.env`:
```ini
BACKEND_URL=https://api.agillock.com.br
WORKER_API_KEY=coloque-aqui-a-chave-secreta-forte
POLL_INTERVALO_MS=1000
```
- `BACKEND_URL` — endereço do backend de produção.
- `WORKER_API_KEY` — a chave secreta (a mesma que eu configuro no backend). Gere algo longo e aleatório.
- Guarde esse arquivo — não precisa mexer depois.

> Alternativa (variáveis do sistema): Painel → *Editar as variáveis de ambiente do sistema* → **Variáveis de Ambiente** → em *Variáveis do sistema*, **Novo** para `BACKEND_URL` e `WORKER_API_KEY`. Ou via PowerShell **como admin**: `setx BACKEND_URL "https://api.agillock.com.br" /M`. (O `.env` é mais recomendado.)

## 4. Testar manualmente (antes de virar serviço)
```powershell
cd C:\detran-worker
node worker.js
```
Deve logar algo como `Worker conectado ao backend, aguardando jobs...`. Deixe rodando e peça um teste no admin — o job deve ser processado. `Ctrl+C` para parar.

## 5. Fazer iniciar sozinho no boot + reiniciar se cair

Recomendado: rodar como **serviço do Windows** com o **NSSM** (simples e robusto — reinicia no boot e se o processo travar).

### Opção A — NSSM (recomendada)
1. Baixar o NSSM em https://nssm.cc/download e extrair (ex.: `C:\nssm\`).
2. Abrir o **PowerShell como Administrador** e instalar o serviço:
   ```powershell
   C:\nssm\win64\nssm.exe install DetranWorker
   ```
3. Na janela do NSSM (o worker é TypeScript, roda via `tsx`):
   - **Application → Path:** `C:\Program Files\nodejs\node.exe`
   - **Application → Startup directory:** `C:\detran-worker`
   - **Application → Arguments:** `node_modules\tsx\dist\cli.mjs src\worker.ts`
   - Aba **Details → Startup type:** `Automatic` (inicia no boot).
   - Aba **Exit actions:** deixar "Restart" (reinicia se cair).
   - Aba **I/O** (opcional): apontar `Output`/`Error` para arquivos de log, ex.: `C:\detran-worker\logs\out.log` e `err.log`.
   - Clicar **Install service**.
4. Iniciar:
   ```powershell
   C:\nssm\win64\nssm.exe start DetranWorker
   ```
5. Pronto — o serviço `DetranWorker` sobe junto com o Windows e se recupera de quedas. Gerenciar em `services.msc` ou:
   ```powershell
   nssm restart DetranWorker
   nssm stop DetranWorker
   nssm status DetranWorker
   ```

### Opção B — PM2 (alternativa)
```powershell
npm install -g pm2 pm2-windows-startup
pm2-startup install
cd C:\detran-worker
pm2 start worker.js --name detran-worker
pm2 save
```
PM2 reinicia se cair; `pm2-windows-startup` faz subir no boot.

### Opção C — Agenda de Tarefas (mais simples, menos robusta)
- *Agendador de Tarefas* → **Criar Tarefa** → gatilho **"Ao iniciar o computador"** → ação: iniciar `node.exe` com argumento `C:\detran-worker\worker.js` → em *Configurações*, marcar "Reiniciar se a tarefa falhar".

## 6. Cuidados com a máquina
- **Energia:** desativar suspensão/hibernação (Configurações → Energia → "Nunca" suspender). Ideal ligar num **no-break**.
- **Atualizações do Windows:** configurar horário ativo para não reiniciar durante as janelas de 10h/17h (e o serviço volta sozinho após reboot, de qualquer forma).
- **Antivírus:** liberar a pasta `C:\detran-worker` e o `node.exe` se necessário.
- **Rede:** confirmar de tempos em tempos que a máquina ainda alcança o Detran:
  ```powershell
  curl.exe -k -s -o NUL -w "%{http_code}\n" https://sistemas.detran.ce.gov.br/central
  ```
  (esperado `200`).

## 7. Atualizar o worker (quando houver nova versão)
- Parar o serviço (`nssm stop DetranWorker`), substituir os arquivos, `npm install` se mudou dependência, iniciar de novo (`nssm start DetranWorker`).
- Como a lógica de negócio vive no backend, o worker muda pouco.

---

## Implementação (o que será construído)

- **Backend:** modelo `ConsultaJob`, endpoints `/api/worker/*` (claim/resultado/erro/heartbeat) com auth por chave, agenda 10h/17h criando jobs, status de saúde do worker na tela do admin. Restante (modelos de multas, notificações, telas) conforme os outros docs.
- **Worker (`detran-worker/`):** projeto Node separado (dependências mínimas: cliente HTTP + `cheerio` + `dotenv`). Faz `claim` → executa fluxo do Detran → `resultado`. É onde vive o código de fala com o Detran (equivalente ao `detran-ce.service.ts`, mas rodando na máquina do cliente).
- **Config:** `WORKER_API_KEY` (backend + worker), `BACKEND_URL` (worker). Sem proxy.

## Pendências
- Definir o `BACKEND_URL` real (produção: `https://api.agillock.com.br`).
- Gerar a `WORKER_API_KEY`.
- (Futuro PA) o worker também servirá para o PA, mas lá ainda há o Turnstile — ver [DETRAN_PA](DETRAN_PA.md); um worker com navegador real pode até resolver o Turnstile sem solver pago (a avaliar quando chegarmos no PA).
