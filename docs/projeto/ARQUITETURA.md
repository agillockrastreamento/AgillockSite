# Arquitetura do Sistema

## Visão Geral

```
[GitHub Pages]           [Hostinger VPS - Docker]
AgillockSite/     ←→    Backend Node.js  ←→  PostgreSQL
(Landing + Painéis)      (API REST JWT)        (Prisma ORM)
                               ↓
                         EFI Bank API
                    (Geração de Carnês/Boletos)
```

---

## Decisões Arquiteturais

### 1. Frontend Separado do Backend
O GitHub Pages serve apenas arquivos estáticos (HTML/CSS/JS). Toda a lógica de negócio fica no backend Node.js hospedado na Hostinger VPS. O frontend se comunica via chamadas HTTP (fetch/axios) para a API.

**Consequência**: o CORS precisa ser configurado no backend para aceitar requisições do domínio do GitHub Pages.

### 2. Autenticação JWT
O sistema usa JWT (JSON Web Token) para autenticação. Após login, o token é armazenado no `localStorage` do browser. Cada requisição à API envia o token no header `Authorization: Bearer <token>`.

O token contém o `userId`, `role` e `nome` do usuário. O middleware de autenticação verifica e decodifica o token em cada rota protegida.

### 3. Roles de Acesso
Três perfis de usuário, todos na mesma tabela `User`:

| Role | Acesso |
|---|---|
| `ADMIN` | Dashboard geral + Clientes + Gerar Cobrança + Colaboradores + Vendedores |
| `COLABORADOR` | Todos os Clientes + Gerar Cobrança |
| `VENDEDOR` | Carteira (comissões e clientes vinculados a ele) |

### 4. Rastreabilidade por Colaborador
Cada cliente registra quem o criou (`criado_por_user_id`), mas todos os colaboradores têm acesso à lista completa de clientes. O campo de criador serve apenas para histórico/auditoria.

### 5. Carnê Unificado
Um cliente com múltiplas placas pode ter:
- **Carnês individuais** por placa
- **Carnê unificado**: um único carnê com valor somado das placas

Quando há carnê unificado, a comissão do vendedor é calculada placa a placa (não pelo valor total do boleto unificado), conforme regra solicitada.

### 6. Cálculo de Comissão
```
Para cada placa dentro do boleto:
  se valor_placa < 50.00 → comissão = 12.5%
  se valor_placa >= 50.00 → comissão = 18.0%

Os percentuais e o valor de referência são configuráveis pelo Administrador.
```

---

## Fluxo de Autenticação

```
1. Usuário acessa /admin/login.html
2. Preenche email + senha → POST /api/auth/login
3. Backend valida credenciais → retorna JWT
4. Frontend salva token no localStorage
5. Frontend lê o `role` do payload JWT:
   - ADMIN → redireciona para /admin/dashboard.html
   - COLABORADOR → redireciona para /colaborador/clientes.html
   - VENDEDOR → redireciona para /vendedor/carteira.html
6. Cada página protegida verifica o token antes de renderizar
```

---

## Fluxo de Geração de Carnê

```
1. Colaborador/Admin preenche dados do cliente e cobrança
2. Frontend → POST /api/carnes (dados: cliente, placas, valor, vencimento, parcelas)
3. Backend:
   a. Busca/cria cliente no banco
   b. Chama EFI API → gera carnê
   c. Salva carnê e boletos no banco (com IDs do EFI)
   d. Retorna link do PDF do carnê
4. Frontend mostra botão para baixar/compartilhar
```

---

## Fluxo de Sincronização de Pagamentos

Como o EFI processa os pagamentos, precisamos sincronizar o status:
- **Webhook**: configurar endpoint `POST /api/efi/webhook` para receber notificações de pagamento do EFI (recomendado)
- **Polling**: alternativamente, consultar status dos boletos pendentes periodicamente (fallback)

---

## Estrutura de Pastas — Backend

```
backend/
├── src/
│   ├── app.ts                  ← configuração Express + middlewares
│   ├── server.ts               ← entrada principal
│   ├── routes/
│   │   ├── auth.routes.ts      ← login, /me, change-password
│   │   ├── clientes.routes.ts
│   │   ├── placas.routes.ts
│   │   ├── carnes.routes.ts
│   │   ├── boletos.routes.ts   ← GET /boletos (cobranças), baixa, editar
│   │   ├── usuarios.routes.ts  ← colaboradores + vendedores
│   │   ├── dashboard.routes.ts
│   │   ├── configuracoes.routes.ts
│   │   ├── vendedor.routes.ts  ← carteira, detalhes, exportar CSV
│   │   └── efi.routes.ts       ← webhook EFI, segunda-via, migrar-efi
│   ├── middleware/
│   │   ├── auth.middleware.ts  ← verifica JWT
│   │   └── roles.middleware.ts ← verifica role
│   ├── services/
│   │   ├── efi.service.ts      ← integração EFI Bank
│   │   └── comissao.service.ts ← cálculo de comissões
│   └── utils/
│       ├── jwt.ts
│       └── params.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   ├── seed-admin.ts           ← cria/atualiza admin e configurações padrão
│   └── docker-entrypoint-dev.sh
├── cert/
│   └── certificado.p12         ← gitignored
├── .env                        ← gitignored
├── .env.example
├── Dockerfile
├── docker-compose.yml          ← produção
├── docker-compose.dev.yml      ← desenvolvimento
└── package.json
```
