# Geocodificação self-hosted (Nominatim) — Documentação completa

> **Status:** em produção desde **2026-08-20**.
> **Objetivo:** substituir a **Geocoding API do Google** (custo alto por requisição) por um
> **Nominatim self-hosted do Brasil**, mantendo o Google só como *fallback*. Reverse geocoding =
> transformar coordenada (lat/lon) em endereço legível para relatórios e rastreamento.

> ⚠️ **Isto é reverse geocoding (endereço a partir da coordenada), NÃO os "tiles" do mapa visual.**
> O mapa que aparece na tela continua sendo Leaflet com camadas Google/CartoDB/OSM/ESRI — isso não mudou.
> O custo que zeramos é o da **Geocoding API** (endereços), que era o caro por volume.

---

## 1. Onde está tudo (topologia)

A produção está dividida em servidores (ver `memory/project_arquitetura_tres_servidores.md`).
Para geocodificação interessam dois:

| Papel | IP | Host | Specs | O que roda |
|---|---|---|---|---|
| **Geocoder (Nominatim)** | `179.198.125.98` | `srv1899337` | Ubuntu 24.04, 2 vCPU, 8 GB RAM, 96 GB disco, swap 8 GB | Nominatim (Docker) — **dedicado só a isso** |
| **Backend + nginx** | `179.198.102.3` | `srv1899373` | Ubuntu 24.04, 2 vCPU EPYC | `agillock-backend`, `agillock-nginx`, `traccar-postgres` |

Outros servidores (contexto): Traccar em `2.25.131.149`; VPS antigo `72.62.13.73` virou só encaminhador.

**Ligação entre os dois:** um **túnel WireGuard** privado (a porta do Nominatim **não** fica exposta na internet).

```
┌───────────────────────────┐   WireGuard (criptografado)   ┌──────────────────────────────┐
│ BACKEND  179.198.102.3     │   10.9.0.2  ⇄  10.9.0.1       │ GEOCODER  179.198.125.98     │
│ container agillock-backend │ ───────────────────────────▶ │ container nominatim (Docker) │
│ NOMINATIM_URL=             │      http://10.9.0.1:8080     │ Postgres 16 + PostGIS 3.4    │
│   http://10.9.0.1:8080     │                               │ base Brasil (~68 GB no disco)│
└───────────────────────────┘                               └──────────────────────────────┘
        │ (só em erro/timeout/vazio)
        ▼
   Google Geocoding API (fallback)
```

---

## 2. Como a geocodificação funciona no código

Arquivo único: **`backend/src/utils/reverse-geocode.ts`** (função `reverseGeocode(lat, lon)`).

- **Cadeia de provedores** por env `GEOCODER_PROVIDER` (lista separada por vírgula, tentada em ordem
  até um devolver endereço não-vazio). Provedores: `google | nominatim | photon`.
- **Configuração de produção (backend `179.198.102.3`, `/opt/agillock/backend/.env`):**
  ```env
  GEOCODER_PROVIDER=nominatim,google
  NOMINATIM_URL=http://10.9.0.1:8080
  GOOGLE_MAPS_GEOCODING_API_KEY=***   # ainda presente (fallback)
  ```
  → **Nominatim é o principal**; o Google **só** entra se o Nominatim falhar, der timeout ou vazio.
- **Cache no Postgres** (`GeocodeCache`, DB `agillock`): chave = `lat,lon` com 4 casas decimais
  (~11 m), coluna `provedor`, TTL 180 dias. Endereço vazio **nunca** é cacheado.
- **Dedup de chamadas simultâneas** (`emVoo`): relatórios disparam vários workers; a mesma coordenada
  vai ao provedor uma vez só.
- **Formatação por provedor** (`formatarNominatim` usa `road`/`house_number`/`suburb`; Photon usa outros
  campos — apontar um formatador para o outro devolve string vazia).
- O Nominatim é chamado como `GET {NOMINATIM_URL}/reverse?format=jsonv2&lat=..&lon=..&accept-language=pt-BR`.

**Backup do `.env` antes da virada:** `/opt/agillock/backend/.env.bak.geocoder`.

---

## 3. Nominatim — instalação e configuração

- **Imagem:** `mediagis/nominatim:4.5` (Postgres 16, PostGIS 3.4, osm2pgsql 1.11).
- **Compose:** `/opt/nominatim/docker-compose.yml` (no geocoder).
- **Dados de origem:** extrato do Brasil da Geofabrik
  (`https://download.geofabrik.de/south-america/brazil-latest.osm.pbf`, ~1,9 GB → base ~55-60 GB;
  uso de disco total ~68 GB de 96 GB).
- **Volume persistente:** `nominatim-data:/var/lib/postgresql/16/main`.
  O import só re-roda se o marcador `/var/lib/postgresql/16/main/import-finished` **não** existir —
  por isso `docker compose up -d`/reboot **não re-importa**, só serve.
- **Sem flatnode** (ver erro #1). **Sem** import de Wikipedia (`IMPORT_WIKIPEDIA=false`).
- **Cap de 1 núcleo** (`cpus: "1.0"`) — proteção contra o throttle da Hostinger (ver erro #2).
- **Porta publicada só no túnel:** `ports: - "10.9.0.1:8080:8080"` (nada em `0.0.0.0`).
- `shm_size: 2gb`, `THREADS=2`, `restart: unless-stopped`, tuning Postgres (shared_buffers 2G, maint 2G).

### `docker-compose.yml` (referência — senha omitida)
```yaml
services:
  nominatim:
    image: mediagis/nominatim:4.5
    container_name: nominatim
    cpus: "1.0"
    restart: unless-stopped
    ports:
      - "10.9.0.1:8080:8080"          # só no IP do túnel WireGuard
    environment:
      PBF_URL: https://download.geofabrik.de/south-america/brazil-latest.osm.pbf
      REPLICATION_URL: https://download.geofabrik.de/south-america/brazil-updates/
      IMPORT_WIKIPEDIA: "false"
      NOMINATIM_PASSWORD: "***"
      THREADS: "2"
      POSTGRES_SHARED_BUFFERS: 2GB
      POSTGRES_MAINTENANCE_WORK_MEM: 2GB
      POSTGRES_EFFECTIVE_CACHE_SIZE: 4GB
      POSTGRES_WORK_MEM: 50MB
    volumes:
      - nominatim-data:/var/lib/postgresql/16/main
    shm_size: 2gb
volumes:
  nominatim-data:
```

> ⚠️ **Warm de ~8-9 min em todo recreate/reboot:** o `start.sh` roda `nominatim admin --warm`
> (aquece caches) **antes** de subir a API na 8080. Durante esse intervalo o reverse cai no
> **Google (fallback)** — sem erro para o usuário.

---

## 4. WireGuard (o túnel)

A porta 8080 do Nominatim **não** fica na internet — só acessível pelo túnel criptografado.

| | Geocoder `179.198.125.98` | Backend `179.198.102.3` |
|---|---|---|
| IP no túnel (`wg0`) | `10.9.0.1/24` | `10.9.0.2/24` |
| Porta UDP | ouve em `51820` | inicia a conexão |
| Config | `/etc/wireguard/wg0.conf` | `/etc/wireguard/wg0.conf` |
| Serviço | `wg-quick@wg0` (enabled) | `wg-quick@wg0` (enabled) |

- **Backend → geocoder:** `Endpoint = 179.198.125.98:51820`, `AllowedIPs = 10.9.0.1/32`,
  `PersistentKeepalive = 25`. Latência medida: **~1-3 ms** (praticamente mesmo datacenter).
- O **container** do backend alcança `10.9.0.1` pela `wg0` do host; o Docker mascara a origem como
  `10.9.0.2` (por isso o firewall do geocoder libera `10.9.0.2`).
- **Chaves:** `/etc/wireguard/{privatekey,publickey}` nos dois servidores.

### Firewall do geocoder
- **ufw:** ativo; libera SSH (22) e **UDP 51820 só do `179.198.102.3`**.
- **DOCKER-USER (iptables):** dropa qualquer acesso à 8080 que **não** venha de `10.9.0.2`
  (Docker fura o ufw em portas publicadas, por isso a regra é aqui). Persistida pelo serviço
  systemd `nominatim-firewall.service`.
- Como a porta é publicada só em `10.9.0.1`, o IP público **não tem nada** na 8080 — confirmado:
  `179.198.125.98:8080` dá **timeout** de fora; `10.9.0.1:8080` funciona pelo túnel.

### Ordem de boot (importante)
Drop-in `/etc/systemd/system/docker.service.d/wg-order.conf` faz o Docker subir **depois** do
`wg-quick@wg0` (`After=`/`Wants=`). Sem isso, no reboot o Docker tentaria publicar em `10.9.0.1`
antes do túnel existir e o container falharia.

---

## 5. Atualizações do mapa (OSM) — como e quando

- **Quando:** **semanal, todo domingo às 03:00 (horário de Brasília / 06:00 UTC).**
- **Como:** systemd timer **no host do geocoder**:
  - `nominatim-update.timer` → `OnCalendar=Sun *-*-* 03:00:00 America/Sao_Paulo`, `Persistent=true`
    (se o servidor estiver desligado às 3h, roda no próximo boot).
  - `nominatim-update.service` → `docker exec nominatim sudo -E -u nominatim nominatim replication
    --project-dir /nominatim --catch-up`.
- **`--catch-up`** aplica todos os diffs pendentes do OSM e **sai** (testado: encerra com `success`).
  - ⚠️ **Não usar** `--once` (fica dormindo esperando o próximo diff → trava o job de timer) nem
    modo `continuous` (atualiza por intervalo, sem horário fixo).
- **Características:** roda em **segundo plano, sem downtime**, capado em 1 núcleo, leva ~1-2 min
  (uma semana de diffs do Brasil). Se falhar, **não corrompe** nada (fica no último estado bom) e o
  **Google cobre** as consultas.
- **Por que semanal?** Nome de rua/bairro muda em escala de meses/anos; semanal é folgado de sobra.
  Para trocar a frequência: editar `OnCalendar` no `.timer` e `systemctl daemon-reload` (sem mexer no
  container). Ex.: diário = `*-*-* 03:00:00 America/Sao_Paulo`.

---

## 6. Erros enfrentados e como foram resolvidos

1. **Disco 100% no import (flatnode de 82 GB).** A imagem mediagis liga `flatnode` se existir o
   diretório `/nominatim/flatnode` — e o arquivo é dimensionado pelo **maior ID de nó global do OSM**
   (~82 GB), não pelo tamanho do Brasil. **Solução:** NÃO montar volume em `/nominatim/flatnode`;
   para extrato de país o osm2pgsql usa cache em RAM/DB. Compose final tem só `nominatim-data`.

2. **Throttle de CPU da Hostinger (fair-use).** O import segurou os 2 núcleos a 100% por horas →
   a Hostinger throttlou (steal chegou a **85%**, ritmo caiu de ~420/s para ~20/s). **Solução:**
   capar o container em **1 núcleo** (`cpus: "1.0"` / cgroup `cpu.max=100000 100000`), o que mantém o
   VPS em ~50% e **nunca** re-dispara a trava. O usuário removeu a limitação no painel **uma vez**
   (é "tiro único" — se voltar a 100% re-limita e leva dias); com o cap de 1 núcleo isso não ocorre.
   Resultado: steal 85% → ~0%, ritmo voltou a 300+/s.

3. **`--once` trava o job.** No teste, `nominatim replication --once` aplicou os diffs mas depois
   **ficou dormindo** (`Sleeping for … sec before next update`), segurando o serviço em `activating`.
   **Solução:** usar **`--catch-up`** (aplica e sai).

4. **Warm de ~9 min em cada recreate/reboot.** Esperado (`nominatim admin --warm` roda antes da API).
   Coberto pelo Google enquanto isso — não é erro, é comportamento a conhecer.

5. **Import lento por ser VPS de 2 núcleos.** O import do Brasil inteiro levou horas (rank 26 de
   ruas foi o gargalo). Uma vez pronto, servir consultas usa CPU ~0%.

---

## 7. Runbook — comandos úteis

> SSH por chave já configurado para `root@179.198.125.98` e `root@179.198.102.3`.

### Estado geral (geocoder)
```bash
ssh root@179.198.125.98
docker ps                                   # container 'nominatim' Up
ss -ltn | grep 8080                         # deve ser 10.9.0.1:8080 (NÃO 0.0.0.0)
wg show wg0                                  # handshake recente com o backend
systemctl list-timers nominatim-update.timer# próxima atualização (domingo 03h BRT)
df -h /                                      # disco (~71%)
top -bn1 | grep '%Cpu'                       # steal deve ser ~0
```

### Testar reverse geocode
```bash
# de dentro do geocoder:
docker exec nominatim curl -s "http://localhost:8080/reverse?format=jsonv2&lat=-3.7319&lon=-38.5267&accept-language=pt-BR"
# do backend, pelo caminho real do código:
ssh root@179.198.102.3 'docker exec agillock-backend node -e "require(\"./dist/utils/reverse-geocode\").reverseGeocode(-3.7319,-38.5267).then(console.log)"'
```

### Rodar a atualização manualmente (fora do domingo)
```bash
ssh root@179.198.125.98 'systemctl start nominatim-update.service'
ssh root@179.198.125.98 'journalctl -u nominatim-update.service -n 20 --no-pager'
```

### Reiniciar o Nominatim (lembrar: ~9 min de warm; Google cobre)
```bash
ssh root@179.198.125.98 'cd /opt/nominatim && docker compose restart nominatim'
```

### Túnel WireGuard
```bash
# status:  wg show wg0   (nos dois lados)
# subir/reiniciar:  systemctl restart wg-quick@wg0
# ping pelo túnel (do backend):  ping -c2 10.9.0.1
```

### Troubleshooting — "tudo caindo no Google"
Se o cache passar a gravar `provedor=google`, o Nominatim está inacessível. Checar, em ordem:
1. `docker ps` no geocoder — container `nominatim` está `Up`? (se recém-reiniciado, pode estar no warm)
2. `ss -ltn | grep 8080` — está em `10.9.0.1:8080`?
3. `wg show wg0` nos dois — handshake recente? Se não, `systemctl restart wg-quick@wg0`.
4. Do backend: `docker exec agillock-backend node -e "fetch('http://10.9.0.1:8080/status').then(r=>console.log(r.status))"`.
5. Conferir `NOMINATIM_URL=http://10.9.0.1:8080` no `.env` do backend.

---

## 8. Como remover o Google depois (zerar o custo)

Quando o cache estiver cheio e a confiança alta:
```bash
ssh root@179.198.102.3
cd /opt/agillock/backend
# 1) tirar o google da cadeia:
sed -i 's/^GEOCODER_PROVIDER=.*/GEOCODER_PROVIDER=nominatim/' .env
# (opcional) remover/comentar a linha GOOGLE_MAPS_GEOCODING_API_KEY
# 2) aplicar:
docker compose up -d backend
```
> Sem o Google, se o Nominatim estiver fora, o reverse devolve string vazia (não quebra o app, só fica
> sem endereço naquele ponto). Por isso remover só depois de dias estável.

---

## 9. Referências

- **Memória do agente (onde estão as decisões, IPs e pegadinhas):**
  `C:\Users\Pedro\.claude\projects\D--Projetos-AgilLockRastreamento\memory\`
  - `project_geocoding_photon.md` — decisão, config, WireGuard, updates, erros (este assunto).
  - `project_arquitetura_tres_servidores.md` — topologia dos 3 servidores.
  - `MEMORY.md` — índice.
- **Código:** `backend/src/utils/reverse-geocode.ts` · schema `GeocodeCache` em `backend/prisma/schema.prisma`.
- **Arquivos no geocoder (`179.198.125.98`):**
  - `/opt/nominatim/docker-compose.yml`
  - `/etc/wireguard/wg0.conf`
  - `/etc/systemd/system/nominatim-update.{service,timer}`
  - `/etc/systemd/system/nominatim-firewall.service`
  - `/etc/systemd/system/docker.service.d/wg-order.conf`
- **Arquivos no backend (`179.198.102.3`):**
  - `/opt/agillock/backend/.env` (+ `.env.bak.geocoder`)
  - `/etc/wireguard/wg0.conf`

---

*Última atualização desta doc: 2026-08-20.*
