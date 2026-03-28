# Plano Geral — Sistema AgilLock

## Visão Geral

O projeto consiste em transformar o site institucional estático da AgilLock em uma plataforma completa de gestão financeira e rastreamento, mantendo a landing page no GitHub Pages e adicionando um sistema de back-end com banco de dados, integração com EFI Bank e painel administrativo.

---

## Diagnóstico do Site Atual

| Item | Situação |
|---|---|
| Landing page | Funcional, mas desatualizada |
| "Acesso 1" | Link para IP externo sem relação com a empresa — deve ser removido |
| "Acesso 2" | Link para rastreador — manter, renomear para "Acesso ao Rastreador" |
| Formulário de contato | `enviaemail.php` não funciona no GitHub Pages (sem suporte PHP) |
| 2ª Via Boleto | Link para Banco do Brasil desatualizado — será substituído pela nova consulta |
| `default.php` | Arquivo de listagem de diretório da Hostinger — pode ser removido ou ignorado |

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | HTML, CSS, JavaScript (Bootstrap) — GitHub Pages |
| Backend | Node.js + Express + TypeScript |
| Banco de Dados | PostgreSQL |
| ORM | Prisma |
| API Financeira | EFI Bank (Gerencianet) — SDK Node.js |
| Autenticação | JWT (JSON Web Tokens) |
| Infra/Deploy | Docker + Docker Compose — Hostinger VPS |
| Certificado EFI | `homologacao-381777-AgilLockRastreamento.p12` (já disponível) |

---

## Fases do Projeto

### Fase 1 — Estrutura de Back-end e Banco de Dados
- Criar projeto Node.js com TypeScript
- Configurar Prisma com PostgreSQL
- Definir schema do banco de dados
- Criar sistema de autenticação JWT com 3 roles (ADMIN, COLABORADOR, VENDEDOR)
- Configurar Docker e docker-compose

### Fase 2 — Integração EFI Bank
- Configurar SDK EFI com certificado p12
- Implementar geração de carnê de boletos
- Implementar consulta de status de boletos
- Implementar baixa de boletos
- Implementar sincronização de pagamentos

### Fase 3 — API REST (Rotas por Perfil)
- Auth: login/logout
- Clientes: CRUD completo
- Placas: CRUD vinculado a clientes
- Carnês: gerar, unificar, baixar, cancelar
- Boletos: status, baixa manual, exportação
- Vendedores: CRUD, carteira, comissões
- Colaboradores: CRUD
- Dashboard: cards de métricas (Admin)

### Fase 4 — Frontend (Novas Telas no AgillockSite)
- Página de Login (única, diferencia pelo role pós-autenticação)
- Painel Administrador
- Painel Colaborador
- Painel Vendedor (Carteira)
- Modernização da Landing Page

### Fase 5 — Deploy
- Configurar Dockerfile para backend + PostgreSQL
- Configurar variáveis de ambiente
- Deploy no DigitalOcean via Docker Compose

---

## Estrutura de Pastas Final

```
D:/Projetos/AgilLockRastreamento/
├── docs/                          ← documentação (esta pasta)
├── AgillockSite/                  ← frontend (GitHub Pages)
│   ├── index.html                 ← landing page atualizada
│   ├── admin/
│   │   ├── login.html
│   │   ├── dashboard.html
│   │   ├── clientes.html
│   │   ├── colaboradores.html
│   │   ├── vendedores.html
│   │   └── gerar-cobranca.html
│   ├── colaborador/
│   │   ├── clientes.html
│   │   └── gerar-cobranca.html
│   └── vendedor/
│       └── carteira.html
└── backend/                       ← backend Node.js (novo)
    ├── src/
    │   ├── routes/
    │   ├── middleware/
    │   ├── services/
    │   └── utils/
    ├── prisma/
    │   └── schema.prisma
    ├── Dockerfile
    ├── docker-compose.yml
    └── .env.example
```

---

## Índice da Documentação

- [ROADMAP.md](./ROADMAP.md) — Etapas do projeto com checklist de tarefas
- [ARQUITETURA.md](./ARQUITETURA.md) — Decisões arquiteturais e fluxos
- [DATABASE.md](./DATABASE.md) — Schema do banco de dados
- [API.md](./API.md) — Endpoints da API REST
- [EFI.md](./EFI.md) — Integração EFI Bank
- [FRONTEND.md](./FRONTEND.md) — Especificação das telas
- [DEPLOY.md](./DEPLOY.md) — Guia de deploy Docker/DigitalOcean
