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

## Produção (Hostinger) ✅ Concluído

Servidor: `root@72.62.13.73` — path: `/opt/agillock/backend`

### Diferenças em relação ao dev

1. O serviço `traccar` já está no `docker-compose.yml` (produção)
2. A porta `8082` **não é exposta** no host — o backend acessa via rede Docker interna (`backend_agillock_net`)
3. A configuração usa variáveis de ambiente (`CONFIG_USE_ENVIRONMENT_VARIABLES=true`) — sem XML montado
4. Filtros de posição ativos (descarta dados inválidos)

### Passo a passo executado (histórico)

#### 1. Puxar atualizações no servidor

```bash
cd /opt/agillock/backend
git pull origin main
```

#### 2. Abrir porta 5023 no firewall (para os dispositivos GPS)

```bash
ufw allow 5023/tcp
ufw reload
```

> O firewall estava desabilitado (`ufw status: inactive`), mas a regra foi adicionada com sucesso. Se o firewall for ativado no futuro, a porta já estará liberada.

#### 3. Criar o banco `traccar` no PostgreSQL

```bash
docker compose exec postgres psql -U agillock_user -d agillock -c "CREATE DATABASE traccar;"
```

> Importante: usar `-d agillock` (não omitir o banco) para evitar erro `database agillock_user does not exist`.

#### 4. Adicionar variáveis de ambiente ao `.env` do servidor

```bash
echo "" >> /opt/agillock/backend/.env
echo "TRACCAR_URL=http://traccar:8082" >> /opt/agillock/backend/.env
echo "TRACCAR_USER=admin@agillock.com.br" >> /opt/agillock/backend/.env
echo "TRACCAR_PASSWORD=AdminTraccar@Agillock2026" >> /opt/agillock/backend/.env
```

#### 5. Subir o container Traccar

```bash
cd /opt/agillock/backend
docker compose up -d traccar
```

Aguardar a linha nos logs:
```bash
docker compose logs traccar 2>&1 | tail -5
# Esperar: "Liquibase: Update has been successful."
```

#### 6. Criar conta admin (primeira vez — newServer=true)

Como a porta 8082 não está exposta, o comando é executado via container temporário na rede Docker:

```bash
docker run --rm --network backend_agillock_net curlimages/curl:latest \
  -s -X POST http://traccar:8082/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Admin","email":"admin@agillock.com.br","password":"AdminTraccar@Agillock2026"}'
```

> Não enviar `"administrator":true` — o Traccar define automaticamente o primeiro usuário como admin (modo `newServer`).

**Credenciais de produção:**
- Email: `admin@agillock.com.br`
- Senha: `AdminTraccar@Agillock2026`

---

### Acessar o painel Traccar de produção pelo browser

A porta 8082 não é exposta publicamente. Para acessar via browser, usar **túnel SSH**:

```powershell
# Rodar no PowerShell ou terminal local — manter aberto enquanto usar
ssh -L 8082:traccar:8082 root@72.62.13.73
```

Enquanto o terminal estiver aberto, acessar: `http://localhost:8082`

> Embora pareça local, o browser está se comunicando com o Traccar **de produção**. Qualquer dispositivo adicionado aqui é real. Se o Traccar de desenvolvimento também estiver rodando localmente na porta 8082, feche-o antes de abrir o túnel para evitar conflito.

---

### Variáveis de ambiente de produção (`.env` do servidor)

```env
TRACCAR_URL=http://traccar:8082
TRACCAR_USER=admin@agillock.com.br
TRACCAR_PASSWORD=AdminTraccar@Agillock2026
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
