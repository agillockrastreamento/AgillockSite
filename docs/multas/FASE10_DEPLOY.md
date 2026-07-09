# Fase 10 — Deploy em produção + instalação do worker

Guia para colocar a consulta de multas no ar. Não há código novo aqui — é configuração/infra.

Referências: [ARQUITETURA_WORKER](ARQUITETURA_WORKER.md) (worker + NSSM), `memory/project_deploy_producao.md` (fluxo de deploy).

## Visão geral do que precisa acontecer

1. **Gerar a `WORKER_API_KEY`** (a mesma no backend e no worker).
2. **Deploy do backend** (aplica a migração das tabelas de multas).
3. **Atualizar o `.env` do servidor** com a `WORKER_API_KEY`.
4. **Instalar o worker** numa máquina Windows sempre-ligada (rede que alcança o Detran).
5. **Validar** habilitando um cliente e conferindo a consulta.

> Lembrete da arquitetura: **o servidor Hostinger NÃO fala com o Detran** (é bloqueado). Quem consulta o Detran é o **worker**, na sua rede. O backend só orquestra. Por isso o bloqueio do servidor é irrelevante para a feature.

---

## 1. Gerar a `WORKER_API_KEY`

Um segredo forte, **idêntico** no backend e no worker. Gere no servidor (ou onde preferir):

```bash
openssl rand -base64 36
# ex.: Bm9yJpLk9AF3HZCjb2F7znnuT27uK0xA4JJeNu1yB9R9RpzW
```

Guarde esse valor — vai nos passos 3 (servidor) e 4 (worker).

## 2. Deploy do backend (aplica a migração)

**Antes:** as migrações novas (`..._consulta_multas_detran`, `..._consulta_job_log_id`) já precisam estar **commitadas e no repositório remoto** (a migração é aplicada no boot do container, a partir do código pull-ado).

**Snapshot do banco antes** (a migração roda no boot; não dá pra backup no meio):
```bash
# na Hostinger, faça o snapshot do volume postgres_data (ex.: parar, copiar o volume, ou dump)
docker compose exec postgres pg_dump -U agillock_user agillock > /root/backup_pre_multas_$(date +%F).sql
```

Deploy:
```bash
cd /opt/agillock/backend
git pull
docker compose up -d --build backend
docker compose logs -f backend    # deve logar "prisma migrate deploy" aplicando as migrações e depois "Servidor rodando…"
```

> O `CMD` do container roda `prisma migrate deploy` no boot — é o `up -d --build` que efetivamente aplica a migração (ver `project_deploy_producao`).

O front web (`AgillockSite/`) é servido direto do mesmo `git pull` — as telas de multas (admin e cliente) já sobem juntas. O **app** tem release próprio (EAS/store), fora desse fluxo.

## 3. Atualizar o `.env` do servidor (WORKER_API_KEY)

O backend lê `/opt/agillock/backend/.env` (via `env_file` no `docker-compose.yml`).

```bash
cd /opt/agillock/backend
nano .env
#   adicione ao final:
#   WORKER_API_KEY=<a-chave-do-passo-1>
#   salvar: Ctrl+O, Enter, Ctrl+X

docker compose up -d --force-recreate backend   # recria o container para ler o novo .env
docker compose logs -f backend
```

⚠️ **Só editar o `.env` não aplica** — o container precisa ser **recriado** (`--force-recreate`, ou `--build` no deploy). Sem `WORKER_API_KEY`, os endpoints `/api/worker/*` respondem **503** ("worker não configurado").

Teste rápido (deve responder **401**, não 503):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.agillock.com.br/api/worker/heartbeat
# 401 = configurado (faltou a chave na requisição). 503 = .env não aplicado.
```

## 4. Instalar o worker na máquina Windows

Passo a passo detalhado (Node, `.env`, serviço via NSSM) está em [ARQUITETURA_WORKER](ARQUITETURA_WORKER.md) — seção "Instalação e operação no Windows". Resumo:

1. Instalar **Node.js LTS** (20+) na máquina que fica ligada (e alcança o Detran).
2. Copiar a pasta **`detran-worker/`** do repositório para a máquina (ex.: `C:\detran-worker\`) e rodar `npm install`.
3. Criar `C:\detran-worker\.env`:
   ```ini
   BACKEND_URL=https://api.agillock.com.br
   WORKER_API_KEY=<a-mesma-chave-do-passo-1>
   POLL_INTERVALO_MS=1000
   ```
4. Testar manual: `npm run start` → deve logar "Worker de multas conectado…".
5. Rodar como **serviço** (inicia no boot, reinicia se cair) — recomendado **NSSM**:
   ```powershell
   C:\nssm\win64\nssm.exe install DetranWorker
   #  Application path: C:\Program Files\nodejs\node.exe
   #  Startup directory: C:\detran-worker
   #  Arguments: node_modules\tsx\dist\cli.mjs src/worker.ts
   #  (ou compile e aponte para o .js; ver ARQUITETURA_WORKER)
   C:\nssm\win64\nssm.exe start DetranWorker
   ```
6. Confirmar que a máquina alcança o Detran:
   ```powershell
   curl.exe -k -s -o NUL -w "%{http_code}\n" https://sistemas.detran.ce.gov.br/central
   # esperado 200
   ```
7. Cuidados: desativar suspensão/hibernação, no-break, horário ativo do Windows Update fora de 10h/17h.

## 5. Validação final

1. No admin (`/AgillockSite/admin/multas.html`): o badge deve mostrar **Worker online**.
2. Habilitar um cliente real (botão martelo em `clientes.html`) → dispara a consulta inicial; em segundos o veículo aparece na tela de multas com os dados.
3. Clicar num veículo → **Gerar pagamento** → conferir QR/Pix e **baixar o boleto** (abre PDF).
4. Aba **Histórico**: conferir a consulta registrada.
5. Aguardar (ou disparar "Consultar todos") e conferir as **notificações**: cliente recebe multa nova/vencimento; admin recebe o resumo no painel de eventos.
6. No dia seguinte, confirmar que a rotina **10h e 17h** rodou (aba Histórico com origem "Agendada").

## Rollback / problemas

- **Worker offline** no admin: a máquina caiu ou perdeu internet. Os jobs ficam pendentes e processam quando voltar; nada se perde.
- **503 nos endpoints do worker:** `.env` do servidor sem `WORKER_API_KEY` ou container não recriado (repetir passo 3).
- **401 no worker (logs do worker):** a `WORKER_API_KEY` do worker ≠ a do servidor.
- **Migração:** se algo falhar no boot, restaurar o dump do passo 2 e investigar antes de novo deploy.

## Extensões futuras (fora desta fase)

- Boleto de **IPVA/licenciamento** (hoje só informativo — possui/não possui).
- **Detran PA** (precisa de solver de Turnstile + placa PA) — ver [DETRAN_PA](DETRAN_PA.md).
