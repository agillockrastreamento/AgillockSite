# Portal do Cliente — Especificação

Cobre tudo relacionado ao acesso do cliente ao sistema: autenticação, login gerenciado pelo admin/colaborador, telas disponíveis por perfil, pagamentos e ajustes globais de UI.

Para a tela de rastreamento do cliente (mapa, barra de veículos, overlays, bloqueio por inadimplência) ver também: `docs/traccar/PORTAL_CLIENTE.md`.

---

## Visão geral

```
Admin / Colaborador
  └── cliente-detalhe.html (tab "Login")
        ├── Criar login do cliente
        ├── Editar email / redefinir senha
        ├── Ativar / Inativar
        └── Excluir
        (permissões por ação controladas pelo ADMIN)

Login unificado
  └── login.html — ÚNICO ponto de entrada para todos os perfis
        ├── ADMIN       → dashboard.html
        ├── COLABORADOR → colaborador/clientes.html
        ├── VENDEDOR    → vendedor/carteira.html
        └── CLIENTE     → cliente/rastreamento.html

Portal do Cliente  (AgillockSite/cliente/)
  ├── rastreamento.html       — mapa ao vivo (todos os perfis)
  └── pagamentos.html         — boletos (somente Cliente Responsável)

Nota: cliente/login.html é um redirect → login.html (não há tela separada)
```

### Perfis de cliente

| Perfil | Acesso |
|---|---|
| **Cliente Responsável (Faturamento)** | Rastreamento + Pagamentos |
| **Cliente Vinculado** (associado ao dispositivo, não é o faturante) | Rastreamento apenas |

---

## 1. Modelo de Dados — `ClienteLogin`

Tabela nova, separada do model `User` (que é para colaboradores/vendedores/admin).

```prisma
model ClienteLogin {
  id        String   @id @default(cuid())
  clienteId String   @unique
  email     String   @unique
  senhaHash String
  ativo     Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  cliente   Cliente  @relation(fields: [clienteId], references: [id])
}
```

Adicionar em `model Cliente`:
```prisma
login ClienteLogin?
```

### JWT do portal do cliente

Token separado do token admin/colaborador. Expiração: 7 dias (sessão longa, padrão do cliente).

Payload:
```json
{
  "sub": "clienteLoginId",
  "clienteId": "clxxx...",
  "role": "CLIENTE",
  "tipo": "responsavel" | "vinculado"
}
```

`tipo` é determinado na autenticação: se o cliente é o `criadoPorId` do carnê ou tem faturamento associado → `responsavel`; caso contrário → `vinculado`.

---

## 2. Login Unificado — `POST /api/auth/login`

**Não existe endpoint separado para cliente.** O endpoint `POST /api/auth/login` (já existente) detecta automaticamente o tipo de usuário:

1. Busca na tabela `User` (admin/colaborador/vendedor) → JWT com `role: ADMIN | COLABORADOR | VENDEDOR`
2. Se não encontrado, busca na tabela `ClienteLogin` → JWT com `role: CLIENTE`

**Response para cliente:**
```json
{
  "token": "eyJ...",
  "user": { "id": "clxxx...", "nome": "João Silva", "email": "...", "role": "CLIENTE", "tipo": "responsavel" }
}
```

JWT de cliente: payload `{ sub, clienteId, role: "CLIENTE", tipo: "responsavel" | "vinculado" }`, expiração 7 dias.

O frontend (`login.html`) detecta `data.user.role === 'CLIENTE'`, armazena em `localStorage('al_cliente_token')` e redireciona para `../cliente/rastreamento.html`.

> `POST /api/auth/cliente` permanece como alias por compatibilidade.

---

## 3. Rotas de Backend — Gerenciamento do Login (admin/colaborador)

Todas requerem JWT de ADMIN ou COLABORADOR (com permissão configurável).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/clientes/:id/login` | Verifica se o cliente tem login (retorna status, email, ativo) |
| POST | `/api/clientes/:id/login` | Cria login (email + senha) |
| PUT | `/api/clientes/:id/login` | Edita email ou redefine senha |
| PATCH | `/api/clientes/:id/login/status` | Toggle ativo/inativo (sem body) |
| DELETE | `/api/clientes/:id/login` | Exclui o login permanentemente |

**Body POST/PUT:**
```json
{ "email": "cliente@email.com", "senha": "SenhaSegura123" }
```

---

## 4. Tab "Login" em cliente-detalhe.html

### Onde aparece
Adicionada nas telas:
- `AgillockSite/admin/cliente-detalhe.html`
- `AgillockSite/colaborador/cliente-detalhe.html`

Ordem das tabs: **Dados · Dispositivos · Cobranças · Login**

### Estados da tab

**Sem login cadastrado:**
```
[+ Criar Login]
```

**Login existente:**
```
Email: joao@email.com    Status: [● Ativo]
[Editar]  [Inativar]  [Excluir]
```

### Controle de permissão — COLABORADOR

Em `admin/configuracoes.html` (seção "Permissões de Colaborador"), o ADMIN define o que o colaborador pode fazer na tab Login:

```
Login do Cliente:
  [✓] Criar login
  [✓] Editar (alterar email / resetar senha)
  [✗] Inativar / ativar
  [✗] Excluir
```

Ações não permitidas aparecem com `disabled` + tooltip "Requer permissão de administrador".

Novos campos no model `User` para essas permissões:
```prisma
podeCriarLoginCliente   Boolean @default(true)
podeEditarLoginCliente  Boolean @default(true)
podeInativarLoginCliente Boolean @default(false)
podeExcluirLoginCliente Boolean @default(false)
```

---

## 5. Portal do Cliente — Autenticação (`auth-guard-cliente.js`)

Arquivo novo, análogo ao `auth-guard.js` mas para o portal do cliente.

```javascript
// AgillockSite/js/auth-guard-cliente.js

window.AL_CLIENTE = {
  requireAuth(tiposPermitidos) {
    // tiposPermitidos: ['responsavel', 'vinculado'] ou omitir para qualquer CLIENTE
    // Lê localStorage('al_cliente_token')
    // Decodifica JWT, verifica expiração e role === 'CLIENTE'
    // Se tipo não permitido → redireciona para login
    // Retorna { clienteId, nome, tipo }
  },
  logout() {
    localStorage.removeItem('al_cliente_token');
    location.href = '../cliente/login.html';
  },
  apiGet(path) { /* fetch com Bearer do token do cliente */ },
  apiPost(path, body) { /* idem */ },
};
```

Token armazenado em `localStorage('al_cliente_token')` (separado do `al_token` do admin).

---

## 6. Tela de Rastreamento — `cliente/rastreamento.html`

Ver especificação completa da tela de rastreamento em `docs/traccar/PORTAL_CLIENTE.md`.

**Resumo das diferenças em relação ao admin:**
- Barra de veículos no rodapé do mapa (cards com foto/placa/modelo, scrollável)
- Foto do veículo é cadastrada pelo próprio cliente (separada da foto do admin)
- Relatório e Histórico abrem como overlay dentro da mesma tela (não navegam para outra página)
- Bloqueio por inadimplência: se boleto vencido > 10 dias, modal bloqueante ao entrar

---

## 7. Tela de Pagamentos — `cliente/pagamentos.html`

Disponível apenas para **Cliente Responsável** (`tipo === 'responsavel'` no JWT).

Se um cliente vinculado tentar acessar → redireciona para `rastreamento.html`.

### Rotas de backend necessárias

```
GET /api/cliente/boletos
  ?status=PENDENTE|PAGO|ATRASADO|CANCELADO
  ?dataVencDe=YYYY-MM-DD
  ?dataVencAte=YYYY-MM-DD
  ?placaId=...

  Response: lista de boletos do cliente logado (filtrado pelo clienteId do JWT)
  Inclui: valor, vencimento, status, placa, linkBoleto (para segunda via)
```

### Layout

```
┌─ topbar ────────────────────────────────────────────────────┐
│ Pagamentos                                                   │
├─ filtros ───────────────────────────────────────────────────┤
│ [Todos] [Pendente] [Pago] [Atrasado]   [De:] [Até:]        │
├─ resumo ────────────────────────────────────────────────────┤
│ Total pendente: R$ XXX   Em aberto: N   Pago no período: R$ │
├─ lista ─────────────────────────────────────────────────────┤
│ [Placa] [Vencimento] [Valor] [Status] [Ação]               │
│ ABC-1234  10/05/2026  R$120   ● Pendente  [2ª Via]         │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Foto do veículo pelo cliente

O cliente pode adicionar uma foto própria do veículo na barra inferior do mapa. Essa foto é **independente** da foto cadastrada pelo admin em `dispositivo.html`.

| Quem | Onde aparece |
|---|---|
| Foto cadastrada pelo **admin** | Somente na tela de rastreamento do admin (card do dispositivo) |
| Foto cadastrada pelo **cliente** | Somente na barra de veículos do portal do cliente |

**Rotas:**
```
POST   /api/cliente/dispositivos/:dispositivoId/foto
       multipart/form-data, campo "foto", max 2MB, JPG/PNG/WEBP
       Response: { imagemUrlCliente: "/uploads/cliente/..." }

DELETE /api/cliente/dispositivos/:dispositivoId/foto
```

Novo campo no modelo `Dispositivo` (ou tabela auxiliar `DispositivoFotoCliente`):
```prisma
// Opção mais simples: campo no próprio Dispositivo
imagemUrlCliente String? // foto enviada pelo cliente
```

---

## 9. Sidebar do Portal do Cliente

Segue o mesmo padrão visual das outras sidebars (`admin.css`), com suporte à minimização (ver seção 10).

**Links por perfil:**

Cliente Responsável:
```
[fa-map-marker]  Rastreamento
[fa-money]       Pagamentos
```

Cliente Vinculado:
```
[fa-map-marker]  Rastreamento
```

---

## 10. Sidebar minimizável — todos os perfis

Aplicável a: **Admin, Colaborador, Vendedor, Cliente**.

### Comportamento

| Estado | O que mostra |
|---|---|
| **Expandido** (padrão) | Logo completa + texto dos itens + submenus |
| **Minimizado** | Favicon como logo + apenas ícones, sem texto |

Estado salvo em `localStorage('al-sidebar-state')`: `'expanded'` ou `'collapsed'`.

### CSS a adicionar em `admin.css`

```css
/* ── Sidebar colapsada ── */
.admin-sidebar { transition: width 0.2s ease; }
.admin-sidebar.collapsed { width: 58px; overflow: hidden; }

.admin-sidebar.collapsed .sidebar-nav li > a span,
.admin-sidebar.collapsed .sidebar-user-nome,
.admin-sidebar.collapsed .btn-logout span,
.admin-sidebar.collapsed .sidebar-arrow { display: none; }

.admin-sidebar.collapsed .sidebar-nav li > a {
  justify-content: center;
  padding: 12px 0;
}

/* Submenu vira tooltip lateral no collapsed */
.admin-sidebar.collapsed .sidebar-submenu {
  display: none !important;
}
.admin-sidebar.collapsed .sidebar-dropdown:hover .sidebar-submenu {
  display: block !important;
  position: absolute;
  left: 58px;
  top: auto;
  background: #1e2530;
  border-radius: 0 6px 6px 0;
  min-width: 180px;
  z-index: 1000;
  box-shadow: 4px 4px 12px rgba(0,0,0,.3);
  padding: 4px 0;
}

/* Área de conteúdo acompanha a mudança */
.admin-content { transition: margin-left 0.2s ease; }
```

### JS a adicionar (global, em `auth-guard.js` ou script inline)

```javascript
(function () {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Aplicar estado salvo imediatamente (antes de qualquer render)
  if (localStorage.getItem('al-sidebar-state') === 'collapsed') {
    sidebar.classList.add('collapsed');
    const logo = sidebar.querySelector('.sidebar-brand img');
    if (logo) logo.src = logo.src.replace(/[^/]+$/, '../favicon.ico');
  }

  // Botão de toggle (adicionar em cada sidebar HTML)
  const btnToggle = document.getElementById('btn-sidebar-toggle');
  if (btnToggle) {
    btnToggle.addEventListener('click', function () {
      const collapsed = sidebar.classList.toggle('collapsed');
      localStorage.setItem('al-sidebar-state', collapsed ? 'collapsed' : 'expanded');
      const logo = sidebar.querySelector('.sidebar-brand img');
      if (logo) {
        logo.src = collapsed
          ? logo.getAttribute('data-favicon')
          : logo.getAttribute('data-logo');
      }
    });
  }
})();
```

No HTML de cada sidebar, adicionar atributos e botão:
```html
<img src="../img/logo_agillock_white_new.png"
     data-logo="../img/logo_agillock_white_new.png"
     data-favicon="../favicon.ico"
     ... />

<!-- No rodapé da sidebar, antes do btn-logout -->
<button id="btn-sidebar-toggle" class="btn-sidebar-toggle" title="Minimizar/Expandir">
  <i class="fa fa-chevron-left"></i>
</button>
```

O ícone do botão inverte (`fa-chevron-right`) quando o sidebar estiver collapsed.

---

## 11. index.html — Simplificação do botão "Acessar"

### Situação atual

Dropdown com dois itens:
- "Acesso Administrativo" → `login.html`
- "Acesso ao Rastreador" → link externo

### Nova situação

Dropdown removido. Botão único → `login.html`. O login do cliente fica em `cliente/login.html`, acessado por comunicação direta com o cliente.

```html
<!-- Antes -->
<li class="dropdown">
  <a href="#" class="dropdown-toggle" data-toggle="dropdown">
    Acessar <span class="caret"></span>
  </a>
  <ul class="dropdown-menu">
    <li><a class="dropdown-item access-admin" href="login.html">Admin</a></li>
    <li><a href="...">Rastreamento</a></li>
  </ul>
</li>

<!-- Depois -->
<li><a href="login.html" class="btn btn-custom navbar-btn">Acessar</a></li>
```

---

## 12. Ordem de implementação sugerida

```
1. index.html — remover dropdown (5 min, zero risco)
2. Sidebar minimizável — admin.css + JS em todos os perfis
3. Backend — ClienteLogin (migration + rotas CRUD); login do cliente integrado ao POST /api/auth/login existente
4. Tab "Login" em cliente-detalhe.html (admin + colaborador)
5. auth-guard-cliente.js (cliente/login.html é apenas redirect → login.html)
6. cliente/rastreamento.html (sem barra inferior — base funcionando primeiro)
7. Bloqueio por inadimplência (rota /status-acesso + modal)
8. Barra de veículos no rodapé + upload de foto pelo cliente
9. Overlays de histórico/relatório (reutiliza rastreamento-detalhe.js)
10. cliente/pagamentos.html
```

---

## 13. Arquivos a criar / modificar

| Arquivo | Ação | Descrição |
|---|---|---|
| `backend/prisma/schema.prisma` | Modificar | Adicionar `ClienteLogin` + campos de permissão em `User` + `imagemUrlCliente` em `Dispositivo` |
| `backend/src/routes/auth.routes.ts` | Modificar | `POST /auth/login` agora tenta `User` e depois `ClienteLogin` — sem rota separada |
| `backend/src/routes/cliente-portal.routes.ts` | Criar | Rotas `/cliente/boletos`, `/cliente/dispositivos/:id/foto`, `/cliente/rastreamento/*` |
| `backend/src/routes/clientes.routes.ts` | Modificar | Adicionar rotas de `/clientes/:id/login` (CRUD) |
| `AgillockSite/admin/cliente-detalhe.html` | Modificar | Adicionar tab "Login" |
| `AgillockSite/colaborador/cliente-detalhe.html` | Modificar | Adicionar tab "Login" (com permissões) |
| `AgillockSite/admin/configuracoes.html` | Modificar | Adicionar seção de permissões de login do cliente |
| `AgillockSite/admin/colaboradores.html` | Modificar | Adicionar badges e checkboxes das novas permissões |
| `AgillockSite/login.html` | Modificar | Login unificado — redireciona clientes para `cliente/rastreamento.html` |
| `AgillockSite/cliente/login.html` | Redirect | Apenas redireciona para `login.html` |
| `AgillockSite/cliente/rastreamento.html` | Criar | Mapa ao vivo com barra de veículos |
| `AgillockSite/cliente/pagamentos.html` | Criar | Boletos do cliente |
| `AgillockSite/js/auth-guard-cliente.js` | Criar | Auth guard do portal |
| `AgillockSite/js/rastreamento-cliente.js` | Criar | Adapta rastreamento.js para o portal |
| `AgillockSite/index.html` | Modificar | Remover dropdown "Acessar" |
| `AgillockSite/css/admin.css` | Modificar | Estilos sidebar collapsed + portal cliente |
