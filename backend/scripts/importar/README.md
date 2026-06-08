# Importação de dados do sistema anterior

Popula o banco do AgilLock com os **clientes** e **dispositivos** exportados do
Traccar antigo (`Clientes.xlsx` e `Dispositivos.xlsx`).

O processo tem 2 etapas: **converter** as planilhas em JSON (local, Python) e
**importar** os JSON para o banco (dentro do container backend, em produção).

O script de importação é **idempotente** — pode rodar mais de uma vez sem
duplicar (cliente deduplicado por e-mail; dispositivo por IMEI/identificador).

---

## Etapa 1 — Converter as planilhas (na sua máquina)

```bash
cd backend/scripts/importar
pip install openpyxl
python converter-xlsx.py
```

Lê as planilhas de `../../../DadosDoSistemaAnterior` (raiz do repo; ajustável via
variável de ambiente `ORIGEM_DADOS`) e gera:

- `data/clientes.json`
- `data/dispositivos.json`

> A pasta `data/` está no `.gitignore` — não vai pro git (contém dados pessoais).

---

## Etapa 2 — Importar (na VPS, dentro do container `backend`)

O Traccar de produção escuta na porta interna `8082`, **não exposta**
publicamente — por isso o import roda **dentro do container backend**, que
alcança `postgres:5432` e `traccar:8082` pela rede Docker.

### 2.1 Copiar os JSON para dentro do container

Na VPS, na pasta onde fica o `docker-compose.yml`:

```bash
# copie a pasta importar (com os data/*.json) para o container
docker compose cp ./backend/scripts/importar backend:/app/scripts/importar
```

> Alternativa: `git pull` na VPS + rebuild da imagem (a pasta `scripts/` é
> copiada no Dockerfile). O `docker compose cp` evita rebuild para um one-off.

### 2.2 Ensaiar primeiro (dry-run, não grava nada)

```bash
docker compose exec backend npx tsx scripts/importar/import-dados-anteriores.ts --dry-run
```

Confira os números e os relatórios gerados em `data/` antes de valer.

### 2.3 Rodar de verdade

```bash
docker compose exec backend npx tsx scripts/importar/import-dados-anteriores.ts
```

Flags disponíveis:

| Flag | Efeito |
|---|---|
| `--dry-run` | Simula; não grava no banco nem no Traccar. Gera os relatórios. |
| `--sem-traccar` | Grava no Postgres mas **não** cria devices no Traccar. |

### 2.4 Recuperar os relatórios

```bash
docker compose cp backend:/app/scripts/importar/data ./relatorios-import
```

Relatórios gerados (UTF-8 com BOM, abrem direto no Excel):

- `senhas-clientes.csv` — `nome,email,senhaProvisoria` (⚠️ contém senhas; trate com cuidado e apague depois)
- `dispositivos-nao-vinculados.csv` — dispositivos cujo cliente não foi resolvido automaticamente (revisar e vincular no painel)
- `erros-traccar.csv` — IMEIs que falharam ao criar no Traccar

---

## O que o script faz

1. Usa o usuário **ADMIN** existente como `criadoPorId` (rode o seed antes se não houver).
2. Cria **Cliente + ClienteLogin** (senha provisória aleatória por cliente).
   - `Desativado = Sim` → status/login `INATIVO`.
   - Heurística PF/PJ pelo nome (LTDA, ME, EIRELI, etc.).
3. Cria **Dispositivo** e tenta **vincular ao cliente** pelo campo `Contato`
   (nome do dono), ignorando rótulos de plano do Traccar como "Atual Master".
   O que não casar com segurança vai para o CSV de não vinculados.
4. Cria o device no **Traccar** (ou reaproveita se já existir o IMEI) e grava `traccarId`.

---

---

## Motoristas (vêm da API ao vivo, não de planilha)

Não há planilha de motoristas — os dados são buscados da API do sistema anterior
(Azul Monitor / Traccar em `monitorando.me`). O JSON `apiSistemaAnterior.json` é só
a especificação OpenAPI, não os dados.

### 1. Buscar da API (na sua máquina)

```bash
cd backend/scripts/importar
MONITORANDO_USER=<email> MONITORANDO_PASS=<senha> python fetch-monitorando.py
```

Gera `data/motoristas.json` e `data/motoristas-vinculos.json`. Credenciais via env
(nunca commitar). A API só expõe `nome` e `identificador` (sem CNH/telefone) e o
vínculo motorista↔veículo só é recuperável pela última posição (`driverUniqueId`).

### 2. Importar (dentro do container backend)

```bash
docker compose cp ./backend/scripts/importar backend:/app/scripts/importar
docker compose exec backend npx tsx scripts/importar/import-motoristas.ts --dry-run
docker compose exec backend npx tsx scripts/importar/import-motoristas.ts
```

Cria os Motorista (dedup por identificador), cria os drivers no Traccar e aplica os
vínculos recuperáveis. Flags `--dry-run` / `--sem-traccar` iguais ao import principal.
Relatório: `data/motoristas-vinculos-nao-resolvidos.csv`.

---

## ⚠️ Importante — rastreadores e Traccar novo

Como este é um Traccar **novo** (separado do sistema anterior), criar os devices
aqui **não** faz os rastreadores reportarem para cá. Cada rastreador precisa ser
**reapontado por SMS** para o IP/porta desta VPS (GT06 → `5023`, Suntech → `5011`).
Isso é uma operação à parte, fora deste script.
