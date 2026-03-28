# Ambientes e Deploy

## Como os Ambientes Funcionam

Tanto em desenvolvimento quanto em produção, **tudo roda dentro do Docker**. A diferença é o que cada ambiente prioriza: velocidade de iteração (dev) vs estabilidade e segurança (prod).

---

## Desenvolvimento Local

### Comando único para iniciar tudo

```bash
cd backend
npm run dev
# equivale a: docker compose -f docker-compose.dev.yml up
```

### O que acontece automaticamente na ordem certa

```
1. PostgreSQL sobe e passa no healthcheck
2. Backend aguarda o banco estar pronto (depends_on: service_healthy)
3. npm install — instala dependências dentro do container
4. prisma generate — gera o Prisma Client para Linux (dentro do container)
5. prisma migrate deploy — aplica os arquivos de migration (mesmos da produção)
6. seed-admin.ts — cria admin e configurações padrão (só na 1ª vez, verifica se já existe)
7. tsx watch — servidor sobe com hot reload ativo
```

### Por que o código muda sem rebuildar a imagem?

O `docker-compose.dev.yml` monta o código-fonte como volume:
```yaml
volumes:
  - .:/app          # todo o código do host dentro do container
  - /app/node_modules  # node_modules do container (não usa o do host)
```
O `tsx watch` dentro do container monitora os arquivos e reinicia o servidor automaticamente a cada salvamento. Você edita no VS Code, o servidor recarrega sozinho.

### Para encerrar

**Ctrl+C** no terminal onde o `npm run dev` está rodando para tudo (banco + backend).

Se quiser também remover os containers e a rede (equivale a um "estado zerado"):
```bash
npm run dev:down
# equivale a: docker compose -f docker-compose.dev.yml down
```
> Os **dados do banco são preservados** em um volume Docker (`postgres_dev_data`) mesmo após o `down`. Para apagar os dados também: `docker compose -f docker-compose.dev.yml down -v`

### Portas disponíveis no host

| Serviço | Porta |
|---|---|
| API Backend | `http://localhost:3000` |
| PostgreSQL | `localhost:5433` (para conectar com DBeaver/pgAdmin) |

> A porta do PostgreSQL é **5433** (não 5432) para não conflitar com outros projetos que possam estar rodando.

### Credenciais do banco (dev)

| Campo | Valor |
|---|---|
| Host | `localhost` |
| Porta | `5433` |
| Banco | `agillock` |
| Usuário | `agillock_user` |
| Senha | `dev_password` |

---

## Produção (Hostinger VPS)

### Diferenças em relação ao dev

| | Desenvolvimento | Produção |
|---|---|---|
| Comando | `npm run dev` | `docker compose up -d --build` |
| Imagem backend | `node:20-alpine` direta | Construída pelo `Dockerfile` |
| Código | Montado como volume (hot reload) | Copiado e compilado (`tsc`) na imagem |
| node_modules | Instalado ao iniciar o container | Instalado durante o `docker build` |
| Schema | `prisma migrate deploy` (mesmos arquivos de migration da produção) | `prisma migrate deploy` (migrations versionadas) |
| PostgreSQL | Exposto na porta 5433 do host | Somente rede interna Docker |
| Nginx | Não incluso | Incluso (reverse proxy + SSL) |
| Variáveis de ambiente | Hardcoded no docker-compose.dev.yml | Via arquivo `.env` seguro |

### Dev e prod usam o mesmo mecanismo de migration

Ambos os ambientes rodam `prisma migrate deploy`, que aplica os arquivos SQL versionados da pasta `prisma/migrations/`. Isso garante que o banco de dev sempre esteja idêntico ao de produção.

**Quando mudar o schema** (adicionar coluna, nova tabela etc.), o fluxo é:
```bash
# 1. Editar prisma/schema.prisma
# 2. Gerar nova migration dentro do container de dev:
docker compose -f docker-compose.dev.yml exec backend npx prisma migrate dev --name descricao_da_mudanca
# 3. Commitar o arquivo gerado em prisma/migrations/
# 4. Em produção, basta fazer deploy — migrate deploy aplicará automaticamente
```

---

## Dockerfile (Produção)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx scripts/seed-admin.ts && node dist/server.js"]
```

---

## docker-compose.yml (Produção)

```yaml
services:
  postgres:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_DB: agillock
      POSTGRES_USER: agillock_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - agillock_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agillock_user -d agillock"]
      interval: 3s
      timeout: 5s
      retries: 10

  backend:
    build: .
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://agillock_user:${POSTGRES_PASSWORD}@postgres:5432/agillock
    volumes:
      - ./cert:/app/cert:ro
    ports:
      - "3000:3000"
    networks:
      - agillock_net

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend
    networks:
      - agillock_net

networks:
  agillock_net:

volumes:
  postgres_data:
```

---

## Nginx — Reverse Proxy (Produção)

```nginx
server {
    listen 80;
    server_name api.agillock.com.br;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.agillock.com.br;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    location / {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Passos para Deploy na Hostinger VPS

### 1. Preparar o servidor
```bash
# Ubuntu 22.04, mínimo 2 GB RAM (KVM 2: 8 GB RAM recomendado)
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install docker-compose-plugin -y
```

### 2. Gerar os arquivos de migration (fazer antes, uma única vez)
```bash
# Na sua máquina de desenvolvimento, com o ambiente dev rodando:
docker compose -f docker-compose.dev.yml exec backend npx prisma migrate dev --name init
# Commitar a pasta prisma/migrations/ gerada
```

### 3. Clonar o repositório no servidor
```bash
git clone https://github.com/agillockrastreamento/backend.git
cd backend
```

### 4. Criar o .env de produção
```bash
cp .env.example .env
nano .env  # preencher com valores reais de produção
```

### 5. Copiar o certificado p12 de produção
```bash
mkdir -p cert
scp certificado_producao.p12 user@ip_droplet:/path/backend/cert/certificado.p12
```

### 6. Configurar SSL com Let's Encrypt
```bash
apt install certbot -y
certbot certonly --standalone -d api.agillock.com.br
mkdir -p nginx/ssl
cp /etc/letsencrypt/live/api.agillock.com.br/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/api.agillock.com.br/privkey.pem nginx/ssl/
```

### 7. Subir tudo
```bash
docker compose up -d --build
```

### 8. Verificar logs
```bash
docker compose logs -f backend
docker compose logs -f postgres
```

---

## .env.example (Produção)

```env
# Banco de dados
POSTGRES_PASSWORD=senha_segura_aqui

# JWT — string longa e aleatória (mínimo 256 bits)
JWT_SECRET=chave_secreta_jwt_aqui

# EFI Bank
EFI_CLIENT_ID=
EFI_CLIENT_SECRET=
EFI_CERT_PATH=/app/cert/certificado.p12
EFI_CERT_PASSWORD=
EFI_SANDBOX=false

# CORS
CORS_ORIGIN=https://agillock.com.br

# Admin inicial (seed) — preencher com as credenciais de produção
ADMIN_EMAIL=seu_email_admin_aqui
ADMIN_SENHA=sua_senha_segura_aqui

# Porta da API
PORT=3000
```

---

## Observações de Segurança

- `.env` e `cert/*.p12` nunca devem ir para o Git (já no `.gitignore` do backend e raiz)
- Em produção, o PostgreSQL não expõe nenhuma porta para o host (somente rede interna Docker)
- Firewall do servidor (UFW): liberar apenas portas 22, 80 e 443
- O seed cria o admin com as credenciais definidas em `ADMIN_EMAIL`/`ADMIN_SENHA` no `.env`; se o admin já existir, atualiza o e-mail e a senha automaticamente
- Nunca commitar credenciais reais — usar `.env` de produção apenas no servidor
