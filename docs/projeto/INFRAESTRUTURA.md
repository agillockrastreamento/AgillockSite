# Infraestrutura de Produção — AgilLock Rastreamento

> **Runbook operacional.** Documenta a arquitetura de 3 servidores adotada em **2026‑08‑19/20**, onde está cada coisa, como verificar, como atualizar, os cuidados e como tudo foi feito.
> **Contém IPs e caminhos operacionais, mas NÃO contém senhas/chaves** (essas ficam nos `.env` de cada servidor). Se este repositório for público, avaliar antes de versionar.

## Índice
1. [Contexto — por que mudou](#1-contexto)
2. [Topologia dos servidores](#2-topologia)
3. [Onde está cada coisa](#3-onde-está-cada-coisa)
4. [Fluxo de dados](#4-fluxo-de-dados)
5. [Como os dispositivos GPS chegam (encaminhamento)](#5-encaminhamento-dos-dispositivos)
6. [Acessos (SSH e credenciais)](#6-acessos)
7. [Serviços, systemd e crons por servidor](#7-serviços-systemd-e-crons)
8. [Como verificar a saúde](#8-verificação-de-saúde)
9. [Como fazer deploy / atualizar](#9-deploy--atualização)
10. [Cuidados e pegadinhas (CRÍTICO)](#10-cuidados-e-pegadinhas)
11. [Como a migração foi feita](#11-como-a-migração-foi-feita)
12. [Pendências e futuro](#12-pendências-e-futuro)
13. [Referências de memória](#13-referências-de-memória)

---

## 1. Contexto

A produção rodava **inteira** num VPS da Hostinger (`72.62.13.73`, 2 vCPU). Com a frota crescendo ~10× em ~2,5 meses (de ~140 para ~1.500 dispositivos ativos), um gargalo latente no motor de notificação (N+1: `preferenciaNotificacao.findUnique` por cliente × tipo de evento **a cada posição**) fez o backend saturar os 2 núcleos. A Hostinger ativou a **limitação de CPU** (steal ~70‑90%), que é **punitiva por tempo** (só reseta após dias de uso baixo) — travando o sistema.

Solução em duas frentes:
- **Correção da causa raiz** — cache das preferências (uso caiu de 203% para ~40% no node).
- **Divisão da carga em servidores separados** — Traccar num servidor, backend/banco/nginx em outro, e o VPS antigo virou só **encaminhador de portas** (função de kernel, imune ao throttle).

Resultado: cada máquina roda a ~15‑20% da capacidade, sem throttle, com folga grande para crescer.

---

## 2. Topologia

```
                        DISPOSITIVOS GPS (~866 online)
                         apontam p/ 72.62.13.73:<porta protocolo>
                                     │
                                     ▼
        ┌────────────────────── VPS 72.62.13.73 ──────────────────────┐
        │  Papel: SÓ ENCAMINHADOR (iptables DNAT, kernel, custo ~0)     │
        │  - portas de protocolo GPS  ──DNAT──▶ 2.25.131.149            │
        │  - 80/443 (web/API)         ──DNAT──▶ 179.198.102.3           │
        │  - backend-postgres-1 (parado p/ tráfego; guarda os bancos    │
        │    antigos como backup: agillock + traccar 31GB)              │
        └───────────────┬───────────────────────────┬──────────────────┘
                        │ GPS                        │ web/API
                        ▼                            ▼
   ┌──────── 2.25.131.149 (TRACCAR) ────────┐  ┌──── 179.198.102.3 (BACKEND) ────┐
   │ Ubuntu 24.04 · 2 vCPU · 8GB · 96GB      │  │ Ubuntu 24.04 · 2 vCPU EPYC · 8GB │
   │ /opt/traccar (docker compose):          │  │ /opt/agillock/backend (compose): │
   │  - traccar (6.12.2, pinado por digest)  │  │  - agillock-backend (Node)       │
   │  - traccar-postgres (DB traccar 71M pos)│  │  - agillock-nginx (SSL/proxy)    │
   │ + IAPRO (app pré-existente, não mexer)  │  │  - traccar-postgres (DB agillock)│
   │ 8082 travada só p/ 179 (systemd)        │  │ backend ──▶ Traccar 2.25:8082    │
   └─────────────────────────────────────────┘  └──────────────────────────────────┘
                                                     ▲
                              api.agillock.com.br (registro.br) A ──▶ 179.198.102.3
```

| Servidor | IP | Papel | Specs | Também roda |
|---|---|---|---|---|
| **VPS** | `72.62.13.73` | Encaminhador de portas + backup dos bancos | 2 vCPU (com throttle Hostinger) | — |
| **Traccar** | `2.25.131.149` | Traccar (ingestão GPS + histórico) | 2 vCPU / 8GB / 96GB | **IAPRO** (não mexer) |
| **Backend** | `179.198.102.3` | Backend + banco `agillock` + nginx/SSL | 2 vCPU EPYC / 8GB / 96GB | — |

---

## 3. Onde está cada coisa

| Coisa | Servidor | Local / detalhe |
|---|---|---|
| **Traccar (app)** | 2.25 | container `traccar`, `/opt/traccar/docker-compose.yml` (imagem pinada por digest = **6.12.2**) |
| **Banco do Traccar** (`traccar`, ~71M posições) | 2.25 | container `traccar-postgres`, DB `traccar` |
| **API/Web do Traccar** | 2.25 | porta **8082** (travada só p/ 179) |
| **Portas de protocolo GPS** | 2.25 | 5001, 5011, 5013, 5023, 5056, 5058, 5087, 5207, 5216 |
| **Porta OSMand (injeção do webhook ZHENCB)** | 2.25 | porta **5055** (travada só p/ 179 — ver §14) |
| **Backend (Node)** | 179 | container `agillock-backend`, `/opt/agillock/backend` (`build: .`) |
| **Banco `agillock`** (clientes, financeiro, notificações) | 179 | container `traccar-postgres` (nome herdado), DB `agillock` |
| **nginx + SSL** | 179 | container `agillock-nginx`, `/opt/agillock/backend/nginx/` (`nginx.conf`, `ssl/fullchain.pem`, `ssl/privkey.pem`) |
| **Uploads** (documentos/imagens) | 179 | bind mount `/opt/agillock/backend/uploads` → `/app/uploads` |
| **Certificado EFI (p12)** | 179 | `/opt/agillock/backend/cert/certificado.p12` |
| **.env do backend** (segredos) | 179 | `/opt/agillock/backend/.env` (`TRACCAR_URL`, `TRACCAR_OSMAND_URL=http://2.25.131.149:5055`, `DATABASE_URL`, `POSTGRES_PASSWORD`, `TRACCAR_USER/PASSWORD`, etc.) |
| **DNS** `api.agillock.com.br` | registro.br | registro **A → 179.198.102.3** (TTL 300) |
| **Site** `agillock.com.br` | GitHub Pages | repo `AgillockSite` (`git push` publica; **não** está nos VPS) |
| **Encaminhamento (regras)** | VPS | iptables DNAT + systemd `agillock-forward.service` |
| **Backup dos bancos antigos** | VPS | container `backend-postgres-1` (parado p/ tráfego, mas de pé): DBs `agillock` (antigo) e `traccar` (31GB, histórico original) |

**Rede Docker:** no 179, o `agillock-backend`/`agillock-nginx` entram na rede externa `traccar_traccar_net` (do compose `/opt/traccar`), por isso resolvem `postgres` (host do DB agillock) e o antigo `traccar` por nome de serviço.

---

## 4. Fluxo de dados

**Posição GPS (tempo real):**
```
dispositivo → 72.62.13.73:<porta> → [DNAT] → 2.25:<porta> → Traccar → grava tc_positions
                                                                   │
   app/web ◀── backend (179, WS) ◀── Traccar API/WS (2.25:8082) ◀──┘
```

**Comando (bloqueio/desbloqueio):**
```
app → api.agillock.com.br (179) → backend → Traccar API (2.25:8082)
    → [volta pelo DNAT/MASQUERADE do VPS] → dispositivo
```
Comandos: `engineStop` = bloquear, `engineResume` = desbloquear (via `POST {TRACCAR_URL}/api/commands/send`).

**Requisição web/API do cliente:**
```
app/navegador → api.agillock.com.br
   ├─ (DNS já propagado) → 179 direto
   └─ (cache antigo)     → 72.62.13.73 → [DNAT 443] → 179
   → nginx (SSL) → agillock-backend:3000 → banco agillock (179) / Traccar API (2.25)
```

---

## 5. Encaminhamento dos dispositivos

Os rastreadores foram provisionados com o **IP cru** `72.62.13.73` (alguns firmwares GPS103 **só aceitam IP**, não domínio). Por isso o VPS não pode ser desligado — ele **encaminha** as portas para o servidor de Traccar.

- Funciona porque o **Traccar identifica o dispositivo pelo IMEI no payload**, não pelo IP de origem. O mascaramento (MASQUERADE) não atrapalha; comandos voltam pelo mesmo caminho.
- É **kernel puro (iptables)** → custo de CPU ~0, funciona mesmo com o VPS estrangulado.
- Regras atuais: **18** DNAT de protocolo → `2.25` (9 portas × TCP/UDP) + **2** DNAT web (80/443) → `179`.

**Ver as regras:**
```bash
ssh -i ~/.ssh/id_ed25519 root@72.62.13.73 'iptables -t nat -L PREROUTING -n --line-numbers | grep DNAT'
```

**Reverter o Traccar de volta pro VPS (emergência):** parar de encaminhar e subir o Traccar local — mas isso exige o Traccar rodando no VPS de novo (hoje `restart=no` e parado). Preferir corrigir o 2.25.

---

## 6. Acessos

- **SSH:** a chave `~/.ssh/id_ed25519` (máquina de dev do Pedro) autentica nos **três** servidores como `root`.
  - VPS: `ssh -i ~/.ssh/id_ed25519 root@72.62.13.73`
  - Traccar: `ssh root@2.25.131.149` (mesma chave, sem `-i` necessário)
  - Backend: `ssh root@179.198.102.3`
- **Traccar admin (API):** usuário `admin@agillock.com.br` — senha em `179:/opt/agillock/backend/.env` (`TRACCAR_PASSWORD`).
- **Postgres:** usuário `agillock_user`, senha em cada `.env` (`POSTGRES_PASSWORD`). Não existe role `postgres` nem `agillock`.
- **DNS:** painel do **registro.br** (acesso do Pedro).
- **Transferência grande entre servidores:** copiar a chave temporariamente para o servidor de origem e usar **rsync direto** (ver §10).

---

## 7. Serviços, systemd e crons

### VPS `72.62.13.73`
- **Containers:** só `backend-postgres-1` (de pé, guarda os bancos antigos). `backend-backend-1`, `backend-nginx-1`, `traccar` estão **parados** e com **`--restart=no`** (não sobem no reboot — senão roubariam as portas do encaminhamento).
- **systemd `agillock-forward.service`** (`enabled`) → reaplica DNAT+FORWARD+MASQUERADE no boot, depois do Docker. Script: `/usr/local/bin/agillock-forward.sh`. `ip_forward=1` fixo em `/etc/sysctl.conf`.
- **Crontab:**
  - `0 3 1 * *` — renovação SSL (`/root/renova_ssl.sh`) *(usa porta 80, hoje encaminhada → ver §12)*
  - `0 6,15,20 * * *` — backup (`/root/backup_db.sh`): dumpa **só** o banco `agillock` antigo (32MB), envia ao Google Drive via rclone. **Leve.**
  - `0 4 * * *` — rotação de logs do Traccar antigo (mantém 3 dias).

### Traccar `2.25.131.149`
- **Containers:** `traccar`, `traccar-postgres` (+ `iapro_*` — **não mexer**).
- **systemd `agillock-traccar-fw.service`** (`enabled`) → regra `DOCKER-USER`: **8082 e 5055** só aceitam `179.198.102.3`, DROP o resto. Script: `/usr/local/bin/agillock-traccar-fw.sh` (loop sobre as duas portas — ver §14).
- **Retenção:** `DATABASE_POSITIONS_HISTORY_DAYS=180` no compose (poda posições > 180 dias; com ~5 meses de base, começa a podar por volta de set/2026).

### Backend `179.198.102.3`
- **Containers:** `agillock-backend`, `agillock-nginx`, `traccar-postgres` (hospeda o DB `agillock`).
- Sem systemd extra. `restart: always` nos containers (sobem no boot normalmente).
- Schedulers internos do backend (no boot): notificações (scan "sem atualização" a cada 30 min), financeiro/clicksign/recorrências (diários), multas (10h/17h), webhook‑raposo (60s).

---

## 8. Verificação de saúde

### Snapshot geral (colar e rodar)
```bash
# VPS — encaminhador
ssh -i ~/.ssh/id_ed25519 root@72.62.13.73 'docker ps --format "{{.Names}} {{.Status}}"; \
  echo "DNAT device->2.25: $(iptables -t nat -L PREROUTING -n|grep -c to:2.25.131.149) | web->179: $(iptables -t nat -L PREROUTING -n|grep -c to:179.198.102.3)"; \
  systemctl is-enabled agillock-forward.service'

# 2.25 — Traccar: posições/min tem que ser > 0
ssh root@2.25.131.149 "docker exec traccar-postgres psql -U agillock_user -d traccar -t -c \
  \"SELECT count(*) FROM tc_positions WHERE servertime > now()-interval '1 min';\""

# 179 — backend responde? (404 na raiz = OK; 401 no /api = OK)
curl -s -o /dev/null -w "%{http_code}\n" https://api.agillock.com.br/api/
```

### Sinais de saudável
- **2.25:** posições/min **> 0** (tinha ~1.800/min); `traccar` e `traccar-postgres` `Up`.
- **179:** `agillock-backend` `Up`; `https://api.agillock.com.br/api/` → **401**; logs `[Notif]` fluindo (`docker logs --tail 20 agillock-backend`).
- **VPS:** DNAT 18+2; `backend-postgres-1 Up`; steal ainda pode estar alto (ok — só encaminha).

### Verificar a API do Traccar (só de dentro do 179 ou do 2.25)
```bash
# do 2.25 (localhost) — login + contagem de dispositivos
ssh root@2.25.131.149 'curl -s -c /tmp/c -d "email=admin@agillock.com.br&password=<VER .env>" http://127.0.0.1:8082/api/session >/dev/null; \
  curl -s -b /tmp/c http://127.0.0.1:8082/api/devices | grep -o "\"id\":" | wc -l'
```

---

## 9. Deploy / atualização

### Backend (179) — clone git (sparse-checkout do `backend/`)
`/opt/agillock` é um **clone git** do monorepo com **sparse-checkout** ativo só no `backend/` (os outros diretórios do repo — `AgillockSite/`, `app/`, `docs/`… — ficam fora da árvore de trabalho). Rastreia `origin/main`. Deploy normal:
```bash
ssh root@179.198.102.3 'cd /opt/agillock/backend && git pull && docker compose up -d --build backend'
```
- **Arquivos só-de-produção** (`.env*`, `uploads/`, `cert/*.p12`, `nginx/ssl/*.pem`) não estão no repo e são preservados; os `.bak-*`/`uploads/` estão em `.git/info/exclude` (ignore local, não commitado) para o `git status` ficar limpo. O `git pull` **não** os toca.
- O `docker-compose.yml` do repo **é o de produção** (split-arch: backend+nginx na rede externa `traccar_traccar_net`; postgres+traccar estão no 2.25). Não confundir com o `docker-compose.dev.yml` (dev local).
- **Cuidado com skip-worktree:** o sparse-checkout usa o mesmo bit, então `git update-index --skip-worktree` num arquivo do cone não gruda. Para pinar um arquivo divergente, o certo é commitá-lo no repo (foi o que se fez com o compose).
- **Migrations Prisma** rodam no boot do container (CMD faz `prisma migrate deploy`). Fazer **snapshot do volume do postgres** (no 179) antes de deploy com migração nova.
- Mudou `TRACCAR_URL`/`.env`? `docker compose up -d --force-recreate backend`.

### Traccar (2.25)
```bash
ssh root@2.25.131.149 'cd /opt/traccar && docker compose up -d traccar'   # recria com a config atual
```
- **Versão pinada por digest (6.12.2).** Para atualizar de versão, trocar o `image:` no compose por outro digest/tag e recriar — **conferir que o schema/Liquibase é compatível**.
- Mudar retenção: editar `DATABASE_POSITIONS_HISTORY_DAYS` no compose e recriar o traccar.
- **Pegadinha:** recriar o Traccar sob carga pode deixar "container zumbi". Fazer em horário de baixo movimento; se travar ao parar, `docker kill traccar` e subir de novo.

### DNS (registro.br)
- Registro **A** de `api.agillock.com.br` → `179.198.102.3`, TTL 300. Trocas propagam em ~5 min.

### Site estático (`agillock.com.br`)
- `git push origin main` no repo `AgillockSite` publica no GitHub Pages. **Não** toca nos VPS.

---

## 10. Cuidados e pegadinhas

**CRÍTICO:**
1. **Não religar os containers antigos do VPS** (`backend-backend-1`, `backend-nginx-1`, `traccar`). Estão `restart=no` de propósito — se subirem, roubam as portas 80/443/50xx e **quebram o encaminhamento**. Se precisar do postgres antigo, ele já está de pé (`backend-postgres-1`).
2. **Encaminhamento do VPS depende do systemd `agillock-forward.service`.** Um reboot do VPS sem ele = tudo para. Já está `enabled`; conferir após qualquer mexida em iptables/Docker no VPS.
3. **8082 do 2.25 é a API admin do Traccar** (permite logar e comandar dispositivos). Está travada só p/ o 179 via `agillock-traccar-fw.service`. Ao recriar containers no 2.25, conferir que a regra `DOCKER-USER` continua (o systemd reaplica no boot).
4. **IAPRO no 2.25** (`iapro_*`, portas 80/443/4000/5432) é uma aplicação separada em produção — **não parar, não conflitar**. O Traccar usa 8082 + 50xx (sem conflito).

**Operacional:**
5. **Transferência grande entre servidores:** usar **rsync direto** (copiar a chave temporária p/ o servidor de origem, `rsync -P -e "ssh -i tmpkey ..."`, remover a chave depois). **Nunca** `ssh cat | ssh cat` (relay frágil; se um timeout deixa processo sobreposto, **corrompe** o arquivo).
6. **Scripts de loop com `$var` via nohup/heredoc:** gravar via **base64** (`echo <b64> | base64 -d > script.sh`) — heredoc aninhado quebra a expansão das variáveis.
7. **Import grande no Traccar ao vivo:** via **staging UNLOGGED sem índice** + `INSERT ... ON CONFLICT (id) DO NOTHING` **em lotes** com auto‑freio por load. Nunca um `INSERT` único de dezenas de milhões de linhas na tabela ao vivo.
8. **Throttle da Hostinger** é por tempo (reseta após dias de uso baixo). Não adianta "reduzir e esperar minutos". O VPS hoje só encaminha (uso ~0), então deve resetar sozinho.
9. **Contagem de linhas:** `reltuples` (pg_class) é **estimativa** e pode estar defasada (mostrava 64,7M quando o real era 70,5M). Para número exato, `count(*)`.

---

## 11. Como a migração foi feita

Sequência executada em 2026‑08‑19/20 (para referência/repetição):

1. **Otimização do backend** (commit `e37fd42`): cache TTL de `preferenciaNotificacao` (chave cliente+dispositivo+tipo), logs do `[Notif]` atrás de `NOTIF_DEBUG`, loop O(n²) do `traccar.ws` → Map. Node 203%→~40%.
2. **Limpeza de disco:** apagados ~24GB de logs antigos do Traccar + build cache; cron de rotação (4h).
3. **Traccar → 2.25:** Docker instalado; compose replicado (digest 6.12.2); dump de **config** do Traccar (sem posições) restaurado; validado (2254 devices, login 200); **encaminhamento das portas do VPS virado p/ 2.25** (iptables DNAT); backend repontado (`TRACCAR_URL`).
4. **Backend → 179:** dump/restore do banco `agillock` (final, com backend parado = zero perda); código+`.env`+cert+uploads transferidos; compose (backend+nginx) na rede do Traccar; SSL copiado; **80/443 do VPS encaminhados p/ 179** (sem janela de indisponibilidade na propagação); **DNS trocado** p/ 179.
5. **Persistência** (systemd) do encaminhamento no VPS + `restart=no` nos containers antigos.
6. **Segurança:** 8082 do 2.25 travada só p/ 179 (DOCKER-USER + systemd).
7. **Fix dos equipamentos "zerados":** offline apareciam sem rastro porque o `positionid` apontava p/ posição no histórico não‑migrado. Recuperadas as 381 posições órfãs + restart do Traccar.
8. **Histórico completo (5 meses / 70,5M posições):** dump `tc_positions` no VPS (`\copy ... | gzip -1`, ~4h sob throttle, 5,4GB) → **rsync direto** VPS→2.25 → staging UNLOGGED (stream `gunzip | psql \copy`) → `INSERT ON CONFLICT` em **8 lotes de 9M** com auto‑freio → `DROP` staging + `ANALYZE`. Total final: **71.338.409 posições**, 0 órfãos, relatórios antigos OK, tracking ao vivo intacto.

---

## 12. Pendências e futuro

- **Renovação SSL:** o certbot antigo no VPS renovava via porta 80. Como 80 agora encaminha p/ 179, configurar a **renovação no 179** (certbot lá, com o DNS já apontando pro 179). Cert atual válido ~até out/2026.
- **Retirar o VPS no futuro:** só é possível quando os dispositivos deixarem de apontar p/ `72.62.13.73` (provisionar novos com domínio `rastreamento.agillock.com.br` → 2.25, e migrar os antigos aos poucos). Enquanto isso, o VPS precisa ficar de pé como encaminhador.
- **Crescimento:** cada servidor está a ~15‑20%. Reavaliar (upgrade p/ 4 vCPU ou rebalancear) quando a frota ativa dobrar (~3.000 dispositivos).
- **Retenção de 180 dias:** começa a podar posições de mar/2026 por volta de set/2026 (comportamento esperado).

---

## 13. Referências de memória

Memória do projeto (em `~/.claude/.../memory/`) com o detalhamento e as decisões:

- **`project_arquitetura_tres_servidores.md`** — esta arquitetura (fonte primária; resume tudo isto).
- `project_cpu_throttle_notif_hotpath.md` — o incidente do throttle e a correção do N+1 das notificações.
- `project_deploy_producao.md` — fluxo de deploy antigo (single‑server); **parcialmente desatualizado** por esta migração.
- `project_traccar.md` / `project_traccar_nova_porta_protocolo.md` — integração Traccar, portas de protocolo.
- `project_relatorio_timeout_504_cors.md` / `project_login_cors_pool_exhaustion.md` — incidentes anteriores de "CORS"/pool.
- `project_geocoding_photon.md` — geocoding (Nominatim self‑hosted em `179.198.125.98`).

> Para futuras sessões: **comece por `project_arquitetura_tres_servidores.md` e por este arquivo.** Eles têm os IPs, papéis e cuidados. Confirme o estado real com o snapshot da §8 antes de agir.

---

## 14. Alterações posteriores

### 2026‑08‑24 — Webhook ZHENCB (tags BLE) voltou a gravar posição

**Sintoma:** desde a migração (19/08), o webhook das tags BLE ZHENCB (A01/A02/A03) falhava com timeout de 10 s por chamada (`ConnectTimeoutError attempted address: traccar:5055`). Cada lote prendia vários `fetch` por 10 s no event‑loop do backend → **lentidão intermitente** em toda a API. As tags ficaram 5 dias sem gravar (`lastupdate` congelado em 19/08).

**Causa:** `backend/src/routes/webhooks.routes.ts` encaminha as posições ao protocolo **OSMand do Traccar (porta 5055)** via `process.env.TRACCAR_OSMAND_URL || 'http://traccar:5055'`. Após a divisão em 3 servidores, (1) não existe mais container `traccar` no 179, (2) a env não estava setada, e (3) o Traccar do 2.25 **nem publicava a 5055**.

**Correção aplicada:**
- **2.25:** adicionada `- "5055:5055"` ao `ports:` do `/opt/traccar/docker-compose.yml` e recriado o traccar (`docker compose up -d traccar`).
- **2.25:** `agillock-traccar-fw.sh` agora tranca **5055 além da 8082** (loop `for P in 8082 5055`), só aceitando `179.198.102.3` — a 5055 injeta posição, não pode ficar exposta.
- **179:** `TRACCAR_OSMAND_URL=http://2.25.131.149:5055` no `.env` + `docker compose up -d --force-recreate backend`.
- **Verificado:** fim dos timeouts; tags cadastradas voltam a gravar 200. Tags **não cadastradas** no Traccar (ex.: `E6:72:CA:35:32:A0`) dão **400** (esperado — falha rápida, não trava). Cadastrar no Traccar se forem tags válidas.

### 2026‑08‑24 — ⚠️ CRÍTICO: link do 179 péssimo para o usuário final (telas grandes lentas)

**Sintoma:** telas de **clientes** e **dispositivos** no painel demoram **60‑120 s** (ou nem carregam). Relatado como "lento de novo".

**NÃO é o servidor.** Medições: query Prisma completa **746 ms**; backend responde `/api/dispositivos` (4,65 MB, 2287 disp.) em **0,23 s** internamente; DB count ~4 ms; `179` e `2.25` a **0% steal / ~90% idle**, load < 1. O gargalo é **a rede do usuário final até `179.198.102.3` em respostas grandes**:

| Caminho | `/api/dispositivos` (4,65 MB) |
|---|---|
| dentro do container (179) | **0,23 s** |
| datacenter `2.25` → `179` direto | **1,58 s** (2,9 MB/s) |
| minha máquina (BR) → **VPS 72.62** → 179 | **2,5 s** (1,8 MB/s) |
| minha máquina (BR) → **`179` direto** | **80 s+** (~38 KB/s) ❌ |

Ping ao 179 é ótimo (52 ms, 0% perda) — só fluxos **grandes/sustentados** afundam (assinatura de MTU black hole/PMTUD quebrado ou shaping no caminho consumidor→179). O DNS aponta **direto para o 179** desde a migração → os navegadores pegam o caminho ruim. Datacenter‑a‑datacenter e o caminho **via VPS** (DNAT kernel, imune ao throttle) são rápidos.

**Correção recomendada (ação no registro.br):** apontar `api.agillock.com.br` **de volta para `72.62.13.73`** (VPS). Ele já faz DNAT 443→179 em kernel (imune ao throttle de CPU); SSL continua terminando no 179. Testado 2,5 s vs 80 s. TTL 300 → ~5 min. **Pendente de aplicar.**

**Alternativas / mitigações:**
- ~~MSS clamping / MTU no `179`~~ — **TESTADO e DESCARTADO (2026‑08‑24)**: `iptables -t mangle` `--set-mss 1360` e depois `1200` (PREROUTING + FORWARD, regra matchando pacotes) **não mudaram nada** (seguiu ~40 KB/s). Logo **não é MTU black hole** — é **shaping/degradação de banda** no caminho consumidor→179, que **não tem correção no servidor**. Regras removidas. Não repetir.
- **Paginar/enxugar** `/api/dispositivos` e `/api/clientes` (hoje devolvem tudo num payload de ~4,65 MB) + brotli — reduz o problema em qualquer caminho. Fix de código/frontend, médio prazo. Só ameniza; não substitui o flip de DNS.
