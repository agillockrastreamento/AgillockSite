# Deploy do Traccar

## Dois ambientes, dois docker-compose

| | Desenvolvimento | Produção |
|---|---|---|
| **Arquivo** | `docker-compose.dev.yml` | `docker-compose.yml` |
| **Banco senha** | `dev_password` (fixa) | `${POSTGRES_PASSWORD}` (variável) |
| **Config Traccar** | `traccar/traccar.dev.xml` | `traccar/traccar.xml` |
| **Porta 8082** | Exposta no host (`localhost:8082`) | Apenas interna (sem expor) |
| **Porta 5023** | Exposta no host (GT06) | Exposta no host (GT06) |
| **Filtros de posição** | Desativados (facilita testes) | Ativos (descarta dados inválidos) |
| **Nginx** | Não tem | Proxy reverso para backend + Traccar admin |

### Importante — dispositivo físico só funciona em produção

O dispositivo GT06 usa rede celular (4G/2G) e precisa de um **IP público** para se conectar. Se o aparelho estiver em outra rede (caso normal de uso real), ele não consegue alcançar `localhost` nem o IP local da máquina de desenvolvimento.

**Consequência prática:**
- Tudo que envolve o dispositivo físico (posições reais, testes GT06) → feito **diretamente em produção**
- Desenvolvimento local serve para: implementar código, testar rotas via Postman/Insomnia, desenvolver o frontend
- **Fluxo de trabalho:** código local → commit → push → pull no servidor → testar com dispositivo real

---

## Desenvolvimento

### Arquivos já criados

```
backend/
├── docker-compose.dev.yml     ← serviço traccar adicionado
└── traccar/
    ├── traccar.dev.xml        ← config dev (dev_password, sem filtros)
    └── traccar.xml            ← config produção (referência)
```

### Passo 1 — Criar o banco `traccar`

Executar **uma única vez**. Se o postgres dev já estiver rodando:

```bash
cd backend
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U agillock_user -c "CREATE DATABASE traccar;"
```

Se o postgres ainda não estiver rodando, subir só ele primeiro:

```bash
docker compose -f docker-compose.dev.yml up -d postgres
# aguardar ficar healthy, então:
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U agillock_user -c "CREATE DATABASE traccar;"
```

### Passo 2 — Subir tudo

```bash
cd backend
docker compose -f docker-compose.dev.yml up -d
```

O Traccar vai:
1. Conectar ao PostgreSQL
2. Criar as ~20 tabelas no banco `traccar` automaticamente (Liquibase)
3. Iniciar o listener HTTP na porta 8082 e TCP na porta 5023

Verificar logs:
```bash
docker compose -f docker-compose.dev.yml logs -f traccar
```

Aguardar a linha parecida com:
```
INFO: Server started
```

### Passo 3 — Criar conta admin no Traccar

1. Abrir `http://localhost:8082` no browser
2. Na primeira inicialização, o Traccar pede para criar o administrador
3. Usar as credenciais que estão (ou que você definir) no `.env`:
   ```
   TRACCAR_USER=admin@agillock.com.br
   TRACCAR_PASSWORD=AdminTraccar@dev
   ```

> Se as variáveis `TRACCAR_USER` e `TRACCAR_PASSWORD` não existirem no `.env`, o `docker-compose.dev.yml` usa os defaults definidos com `:-` (`admin@agillock.com.br` / `AdminTraccar@dev`).

### Passo 4 — Adicionar ao `.env`

```env
# Traccar — desenvolvimento
TRACCAR_URL=http://traccar:8082
TRACCAR_USER=admin@agillock.com.br
TRACCAR_PASSWORD=AdminTraccar@dev
```

> O backend acessa o Traccar via `http://traccar:8082` porque ambos estão na **mesma rede Docker**. O nome `traccar` é o nome do serviço no `docker-compose.dev.yml`.

### Como fica a comunicação em desenvolvimento

```
Browser (localhost:5500)
    └── chama localhost:3000/api/rastreamento/posicoes
              ↓
        Backend Node.js (container, porta 3000)
            └── chama http://traccar:8082/api/...   (rede interna Docker)
                          ↓
                    Traccar (container, porta 8082 interna / 8082 host)

Dispositivo GT06 (chip 4G)
    └── conecta TCP para SEU_IP_LOCAL:5023
              ↓
        Traccar (container, porta 5023 exposta no host)

WebSocket frontend:
Browser → ws://localhost:3000/ws/rastreamento → Backend Node.js → ws://traccar:8082/api/socket
```

> Para o dispositivo GPS se conectar à sua máquina em desenvolvimento, o IP que você passa no comando SMS (`SERVER,0,IP,5023,0#`) deve ser o **IP local da sua máquina na rede** (ex: `192.168.1.10`), não `localhost`.

---

## Produção (Hostinger)

### Diferenças em relação ao dev

1. O serviço `traccar` entra no `docker-compose.yml` (produção)
2. A porta `8082` **não é exposta** no host — o backend acessa via rede Docker interna
3. A config usa `traccar/traccar.xml` (com filtros ativos e senha via variável)
4. O nginx faz proxy do Traccar Web UI se precisar acessar pelo browser

### Adicionar ao `docker-compose.yml` de produção (quando for fazer deploy)

```yaml
# Adicionar ao services:
  traccar:
    image: traccar/traccar:latest
    container_name: traccar
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "5023:5023"   # GT06 — exposto publicamente
      # 8082 NÃO exposto — backend acessa via rede interna
    volumes:
      - ./traccar/traccar.xml:/opt/traccar/conf/traccar.xml:ro
      - traccar_logs:/opt/traccar/logs
    environment:
      - TZ=America/Sao_Paulo
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    networks:
      - agillock_net

# Adicionar ao volumes:
  traccar_logs:
```

### Variáveis de ambiente de produção (`.env` do servidor)

```env
TRACCAR_URL=http://traccar:8082
TRACCAR_USER=admin@agillock.com.br
TRACCAR_PASSWORD=SenhaSeguraDeProducao123
```

### Criar banco em produção (apenas uma vez)

```bash
docker compose exec postgres \
  psql -U agillock_user -c "CREATE DATABASE traccar;"
docker compose up -d traccar
```

### Nginx — proxy para o Web UI do Traccar (opcional)

Se quiser acessar a interface de administração do Traccar pelo browser em produção, adicionar ao `nginx.conf`:

```nginx
server {
    listen 443 ssl;
    server_name traccar.seudominio.com.br;

    # ... ssl_certificate etc ...

    location / {
        proxy_pass http://traccar:8082;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # WebSocket (necessário para /api/socket)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

---

## Estrutura final de arquivos

```
backend/
├── docker-compose.dev.yml   ← dev: traccar + postgres + backend
├── docker-compose.yml       ← prod: traccar + postgres + backend + nginx
├── .env                     ← adicionar TRACCAR_URL, TRACCAR_USER, TRACCAR_PASSWORD
└── traccar/
    ├── traccar.dev.xml      ← config dev (dev_password, sem filtros)
    └── traccar.xml          ← config prod (senha via variável, filtros ativos)
```

---

## Portas em desenvolvimento

| Porta no host | Container | Para que serve |
|---|---|---|
| `localhost:8082` | traccar:8082 | Web UI admin + API REST do Traccar |
| `localhost:5023` | traccar:5023 | Protocolo GT06 (dispositivos GPS) |
| `localhost:3000` | backend:3000 | API AgilLock + WebSocket frontend |
| `localhost:5433` | postgres:5432 | PostgreSQL (acesso externo, ex: DBeaver) |
