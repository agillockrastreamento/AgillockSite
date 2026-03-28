# Opções de Deploy — AgilLock Backend + Banco de Dados

> Análise feita em: **Março/2026**
> Stack: Node.js + Express + TypeScript + PostgreSQL (Docker Compose já configurado)
> Escala estimada: ~1.000 clientes, acesso simultâneo de 3 perfis (Admin, Colaborador, Vendedor)

---

## Critérios Avaliados

| Critério            | Peso | Motivo                                                            |
|---------------------|------|-------------------------------------------------------------------|
| Custo mensal        | Alto | Empresa pequena em crescimento                                    |
| Suporte a Docker    | Alto | Stack já usa Docker Compose                                       |
| Banco de dados      | Alto | PostgreSQL gerenciado ou self-hosted                              |
| Latência no Brasil  | Médio| Usuários estão no Brasil                                          |
| Facilidade de setup | Médio| Equipe pequena sem DevOps dedicado                                |
| Confiabilidade/SLA  | Médio| Sistema de cobrança — downtime tem impacto financeiro             |
| SSL/HTTPS gratuito  | Médio| Necessário para EFI webhook e segurança                           |

---

## Opções Comparadas

### 1. DigitalOcean Droplet ⭐ RECOMENDADO

**O que é:** VPS (servidor virtual privado) gerenciável, com datacenter em São Paulo.

| Item                | Detalhes                                                        |
|---------------------|-----------------------------------------------------------------|
| **Plano mínimo**    | Droplet Basic: 1 vCPU, 2 GB RAM, 50 GB SSD — **US$12/mês**     |
| **Banco de dados**  | PostgreSQL self-hosted via Docker (já configurado) **ou** Managed Database a partir de US$15/mês |
| **Docker**          | Suporte nativo, instala com 1 comando                           |
| **SSL**             | Let's Encrypt gratuito via Nginx (já planejado no ROADMAP)      |
| **Datacenter BR**   | Sim — São Paulo (nyc3 como fallback)                            |
| **Latência BR**     | < 20ms para usuários no Brasil                                  |
| **Uptime SLA**      | 99,99%                                                          |
| **Custo estimado**  | US$12/mês (~R$72) tudo no mesmo Droplet                         |
| **Backups**         | Snapshots automáticos por +20% do plano (US$2,40/mês)          |

**Vantagens:**
- Já está previsto no ROADMAP.md — sem mudança de plano
- Docker Compose funciona sem modificações
- Datacenter em São Paulo = menor latência
- Documentação excelente, comunidade enorme
- Painel intuitivo para quem não tem DevOps
- Firewall gerenciado gratuito

**Desvantagens:**
- Você gerencia o SO (atualizações, segurança)
- PostgreSQL no mesmo servidor = sem separação de recursos
- Sem auto-scaling (mas para 1.000 clientes não é necessário)

**Custo total estimado: US$12–14/mês (R$72–85)**

---

### 2. Railway

**O que é:** PaaS (plataforma como serviço) com deploy automático a partir do GitHub.

| Item                | Detalhes                                                        |
|---------------------|-----------------------------------------------------------------|
| **Plano**           | Hobby: US$5/mês + uso (CPU/RAM/bandwidth)                       |
| **Banco de dados**  | PostgreSQL gerenciado incluído no plano                         |
| **Docker**          | Suporte via `docker-compose.yml` ou `Dockerfile`                |
| **SSL**             | Automático, sem configuração                                    |
| **Datacenter BR**   | Não — US East ou US West (latência ~150–200ms do Brasil)        |
| **Uptime SLA**      | 99,9%                                                           |
| **Custo estimado**  | US$5 fixo + ~US$5–10 de uso = **US$10–15/mês**                  |

**Vantagens:**
- Deploy automático via GitHub push
- PostgreSQL gerenciado sem configuração
- SSL automático
- Zero administração de servidor

**Desvantagens:**
- Sem datacenter no Brasil — latência maior
- Custo variável pode surpreender
- Menos controle sobre o ambiente
- Limites de uso no plano básico podem requerer upgrade

**Custo total estimado: US$10–20/mês (R$60–120) — variável**

---

### 3. Render

**O que é:** PaaS similar ao Railway, focado em simplicidade.

| Item                | Detalhes                                                        |
|---------------------|-----------------------------------------------------------------|
| **Plano**           | Starter Web Service: US$7/mês                                   |
| **Banco de dados**  | PostgreSQL gerenciado: US$7/mês (plano Starter)                 |
| **Docker**          | Suporte via `Dockerfile` (não Docker Compose diretamente)       |
| **SSL**             | Automático                                                      |
| **Datacenter BR**   | Não — Ohio/Frankfurt (latência 150–250ms do Brasil)             |
| **Uptime SLA**      | 99,95%                                                          |
| **Custo estimado**  | US$14/mês (backend + banco separados)                           |

**Vantagens:**
- PostgreSQL gerenciado sem configuração
- Deploy simples via GitHub
- Plano gratuito para testes

**Desvantagens:**
- Docker Compose **não suportado** — precisaria adaptar o setup
- Sem datacenter no Brasil
- Plano free hiberna após inatividade (inadequado para produção)
- Banco no plano Starter tem limite de 1 GB

**Custo total estimado: US$14/mês (R$85)**

---

### 4. Fly.io

**O que é:** Plataforma de containers distribuída globalmente.

| Item                | Detalhes                                                        |
|---------------------|-----------------------------------------------------------------|
| **Plano**           | Pay-as-you-go — shared-cpu-1x, 256MB: ~US$1,94/mês             |
| **Banco de dados**  | Fly Postgres (gerenciado): a partir de US$3,88/mês              |
| **Docker**          | Nativo via `Dockerfile`                                         |
| **SSL**             | Automático                                                      |
| **Datacenter BR**   | Sim — GRU (São Paulo) disponível                                |
| **Uptime SLA**      | 99,9%                                                           |
| **Custo estimado**  | US$6–10/mês para este projeto                                   |

**Vantagens:**
- Mais barato de todos para cargas pequenas
- Datacenter em São Paulo
- Docker nativo
- Escalabilidade automática

**Desvantagens:**
- CLI obrigatória (menos intuitivo que DO para iniciantes)
- Fly Postgres não é completamente gerenciado (você ainda faz backups)
- Documentação menos madura
- Comportamento de cold start em instâncias pequenas

**Custo total estimado: US$6–10/mês (R$36–60)**

---

### 5. Hostinger VPS (Brasil)

**O que é:** VPS de provedor com faturamento em R$, datacenter no Brasil.

| Item                | Detalhes                                                        |
|---------------------|-----------------------------------------------------------------|
| **Plano**           | KVM 2: 2 vCPU, 8 GB RAM, 100 GB NVMe — **R$49,99/mês** (anual) |
| **Banco de dados**  | Self-hosted via Docker                                          |
| **Docker**          | Suporte nativo                                                  |
| **SSL**             | Let's Encrypt gratuito                                          |
| **Datacenter BR**   | Sim — São Paulo                                                 |
| **Uptime SLA**      | 99,9%                                                           |
| **Custo estimado**  | R$49,99/mês pagando anual (R$599/ano)                           |

**Vantagens:**
- **Mais barato** com melhor hardware (8 GB RAM)
- Pagamento em reais, sem variação cambial
- Datacenter no Brasil
- NFS mais rápido que HDD

**Desvantagens:**
- Suporte técnico de qualidade variável
- Menos reconhecido que DigitalOcean no ecossistema DevOps
- Você gerencia tudo (SO, segurança, backups)

**Custo total estimado: R$50–60/mês**

---

### 6. AWS Lightsail

**O que é:** VPS simplificado da AWS, preço fixo.

| Item                | Detalhes                                                        |
|---------------------|-----------------------------------------------------------------|
| **Plano**           | 2 GB RAM, 2 vCPU, 60 GB SSD — US$10/mês                        |
| **Banco de dados**  | Managed PostgreSQL: US$15/mês (separado)                        |
| **Docker**          | Suporte nativo                                                  |
| **SSL**             | Let's Encrypt ou ACM gratuito                                   |
| **Datacenter BR**   | Sim — São Paulo (sa-east-1)                                     |
| **Uptime SLA**      | 99,99%                                                          |
| **Custo estimado**  | US$25/mês (instância + banco separados)                         |

**Vantagens:**
- Infraestrutura AWS (confiabilidade máxima)
- Datacenter em São Paulo
- Fácil migrar para serviços AWS maiores no futuro

**Desvantagens:**
- Banco gerenciado caro para o porte do projeto
- AWS tem curva de aprendizado maior
- Custo mais alto sem benefício proporcional para este projeto

**Custo total estimado: US$10–25/mês (R$60–150)**

---

## Tabela Resumo

| Plataforma           | Custo/mês (aprox.) | Docker Compose | Datacenter BR | PostgreSQL Gerenciado | Facilidade |
|----------------------|--------------------|:--------------:|:-------------:|:---------------------:|:----------:|
| **DigitalOcean** ⭐  | R$72–85            | ✅ Nativo       | ✅ São Paulo   | Opcional (+US$15)     | ⭐⭐⭐⭐⭐  |
| Fly.io               | R$36–60            | ⚠️ Parcial     | ✅ São Paulo   | Sim (semi-gerenciado) | ⭐⭐⭐⭐    |
| Hostinger VPS        | R$50–60            | ✅ Nativo       | ✅ São Paulo   | Não                   | ⭐⭐⭐⭐    |
| Railway              | R$60–120           | ✅ Suporte      | ❌             | ✅ Gerenciado          | ⭐⭐⭐⭐⭐  |
| Render               | R$85               | ❌ (só Docker) | ❌             | ✅ Gerenciado          | ⭐⭐⭐⭐    |
| AWS Lightsail        | R$60–150           | ✅ Nativo       | ✅ São Paulo   | Opcional (caro)       | ⭐⭐⭐      |

---

## Decisão Final: Hostinger VPS

> **Escolha feita em Março/2026.** Ver instruções de deploy em `DEPLOY.md`.

### Por quê Hostinger?

**1. Melhor custo-benefício** — R$49,99/mês (anual) com 8 GB RAM vs US$12/mês (~R$72) com 2 GB RAM no DigitalOcean.

**2. Pagamento em reais** — sem variação cambial. Todos os planos são faturados em BRL.

**3. Hardware superior pelo preço** — KVM 2: 2 vCPU, 8 GB RAM, 100 GB NVMe é mais que suficiente para este projeto.

---

## DigitalOcean Droplet (alternativa descartada)

### Por que foi considerada originalmente?

**1. Era o plano original** — o ROADMAP.md inicial previa DigitalOcean.

**2. Docker Compose sem adaptação** — o `docker-compose.yml` de produção já está configurado com Nginx + backend + PostgreSQL. Em qualquer PaaS (Railway, Render), seria necessário adaptar.

**3. Datacenter em São Paulo** — menor latência para os usuários brasileiros. Webhook do EFI Bank responde mais rápido.

**4. Custo previsível em R$** — com o câmbio atual, ~R$72/mês é acessível para uma empresa em crescimento. Sem surpresas de cobrança variável.

**5. Escala suficiente** — para 1.000 clientes com acesso simultâneo de menos de 10 usuários internos, 2 GB RAM é mais que suficiente. CPU compartilhada aguenta tranquilamente.

**6. Documentação e comunidade** — tutoriais abundantes para Node.js + Docker + Nginx + Let's Encrypt no DigitalOcean.

### Plano recomendado: Droplet Basic — $12/mês

```
1 vCPU Intel
2 GB RAM
50 GB SSD NVMe
2 TB bandwidth/mês
Datacenter: São Paulo (sfo3 como fallback)
```

> Para adicionar banco gerenciado no futuro (quando o volume crescer), basta adicionar o **Managed Database PostgreSQL** a partir de US$15/mês e atualizar a `DATABASE_URL` no `.env`.

### Configuração de Produção Recomendada (tudo no mesmo Droplet)

```
Droplet Ubuntu 22.04
└── Docker Compose
    ├── container: backend (Node.js + Express)
    ├── container: postgres (PostgreSQL 16)
    └── container: nginx (reverse proxy + SSL termination)
```

SSL via **Certbot + Let's Encrypt** para `api.agillock.com.br` (gratuito, renovação automática).

---

## Checklist de Deploy (DigitalOcean)

Seguindo o ROADMAP.md Etapa 9:

- [ ] Criar Droplet Ubuntu 22.04 (2 GB RAM) em São Paulo
- [ ] `apt install docker.io docker-compose-plugin`
- [ ] Configurar DNS: `api.agillock.com.br` → IP do Droplet
- [ ] Instalar Certbot: `certbot certonly --standalone -d api.agillock.com.br`
- [ ] Criar `/app/.env` com variáveis de produção (EFI, JWT_SECRET, DATABASE_URL)
- [ ] Copiar `cert/certificado.p12` para o servidor (via SCP)
- [ ] `docker compose up -d --build`
- [ ] Verificar migrations: `docker compose exec backend npx prisma migrate deploy`
- [ ] Configurar webhook EFI → `https://api.agillock.com.br/api/efi/webhook`
- [ ] Atualizar `AgillockSite/js/config.js` com URL de produção
- [ ] Push do frontend → GitHub Pages republica automaticamente
- [ ] Testar fluxo completo

---

## Alternativa Econômica: Hostinger VPS

Se o orçamento for o fator principal, a **Hostinger VPS KVM 2** (R$49,99/mês pagando anual) oferece hardware superior (8 GB RAM, 2 vCPU) pelo menor custo em reais. O setup é idêntico ao DigitalOcean (Ubuntu + Docker + Certbot).

**Desvantagem**: suporte e confiabilidade levemente inferiores ao DigitalOcean para fins de produção.

---

*Documento gerado em Março/2026 — revisar preços diretamente nos sites das plataformas antes de contratar.*
