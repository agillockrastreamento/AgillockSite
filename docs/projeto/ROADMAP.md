# ROADMAP — AgilLock Sistema de Gestão

Ordem de implementação recomendada. Cada etapa entrega algo funcional e testável.

---

## Etapa 1 — Estrutura do Backend ✅ CONCLUÍDA
**Objetivo**: Ter o servidor Node.js rodando com banco de dados e autenticação.

- [x] Criar projeto Node.js + TypeScript (`backend/`)
- [x] Configurar Prisma v7 com schema completo (User, Cliente, Placa, Carne, Boleto, BoletoPlaca, ComissaoVendedor, Configuracoes)
- [x] Migration inicial gerada (`prisma/migrations/..._init/migration.sql`) e aplicada em dev
- [x] Implementar `POST /auth/login` com JWT
- [x] Implementar `GET /auth/me`
- [x] Implementar middleware de autenticação e verificação de roles
- [x] Criar script de seed: usuário Admin inicial + Configuracoes padrão
- [x] Configurar CORS para dev (`localhost:5500`) e prod (`agillock.com.br`)
- [x] Ambiente dev: tudo no Docker com um único comando `npm run dev`
- [x] `docker-compose.dev.yml` — backend com hot reload + PostgreSQL (porta 5433 no host)
- [x] `docker-compose.yml` — stack completa para produção com Nginx
- [x] Testado: login retorna JWT, credenciais erradas retornam 401

> **Observações de implementação:**
> - Prisma v7 exige `prisma.config.ts` com `datasource.url` (não aceita mais `url = env()` no schema)
> - O Prisma Client precisa ser gerado dentro do container (plataforma Linux)
> - PostgreSQL mapeado na porta `5433` do host para não conflitar com outros projetos

**Resultado**: API rodando em `http://localhost:3000`, login funcionando, banco criado com todas as tabelas.

---

## Etapa 2 — API de Clientes e Placas ✅ CONCLUÍDA
**Objetivo**: CRUD completo de clientes e placas funcionando.

- [x] `GET /clientes` — listar todos (ADMIN e COLABORADOR) com filtros por busca, status e vendedorId
- [x] `GET /clientes/:id` — detalhe do cliente com placas e carnês
- [x] `POST /clientes` — criar cliente
- [x] `PUT /clientes/:id` — editar cliente
- [x] `PATCH /clientes/:id/status` — toggle ativo/inativo
- [x] `DELETE /clientes/:id` — excluir (ADMIN), bloqueia se tiver carnês
- [x] `GET /clientes/:id/placas` — listar placas do cliente
- [x] `POST /clientes/:id/placas` — adicionar placa (valida duplicata)
- [x] `PUT /placas/:id` — editar placa
- [x] `PATCH /placas/:id/status` — toggle ativo/inativo
- [x] `DELETE /placas/:id` — excluir placa (ADMIN), bloqueia se tiver boletos

> **Observações de implementação:**
> - `@types/express` v5 tipa `req.params` como `string | string[]` — criado helper `src/utils/params.ts`
> - Hot reload no Windows + Docker exige `nodemon --legacy-watch` (polling) em vez de `tsx watch`
> - `health check` deve ser registrado antes de `app.use('/api', placasRoutes)` para não ser interceptado

**Resultado**: API de clientes e placas funcionando com autenticação, validações e busca por nome/CPF/placa.

---

## Etapa 3 — Integração EFI Bank ✅ CONCLUÍDA
**Objetivo**: Gerar carnê de boletos e consultar status via EFI.

- [x] Instalar e configurar SDK EFI com certificado p12 (`backend/cert/certificado.p12`)
- [x] Implementar `efi.service.ts` (wrapper das chamadas EFI)
- [x] Implementar `comissao.service.ts` (cálculo e registro de comissões)
- [x] `POST /carnes` — gerar carnê individual (1 placa)
- [x] `GET /carnes/:id/pdf` — link para download do PDF
- [x] `DELETE /carnes/:id` — cancelar carnê no EFI + banco
- [x] `POST /carnes/unificar` — unificar carnês (cancela individuais, cria unificado)
- [x] `PATCH /boletos/:id/baixa` — dar baixa manual
- [x] `POST /efi/webhook` — receber notificação de pagamento automático
- [x] Ao receber pagamento: atualizar status do boleto + calcular comissão do vendedor
- [x] `POST /admin/migrar-efi` — placeholder (implementação na Etapa 10)

> **Observações de implementação:**
> - SDK `sdk-node-apis-efi` v1.3.1 é CommonJS sem tipos TypeScript → usar `require()` com `eslint-disable-next-line`
> - Certificado p12 fica em `backend/cert/certificado.p12` (gitignored via `cert/.gitignore`)
> - EFI usa centavos (inteiros) → converter: `Math.round(valor * 100)` ao enviar, `valor / 100` ao receber
> - `criarCarne()` cria cliente EFI em `createOneStepCarnet` — deve ter `name` e opcionalmente `cpf`
> - Para carnê unificado: `split_items: false` agrupa todas as placas em um boleto mensal
> - `BoletoPlaca` registra qual placa contribuiu quanto em cada boleto unificado (para comissão correta)
> - Webhook responde 200 imediatamente e processa em `setImmediate()` para não travar a resposta
> - `EFI_CLIENT_ID` e `EFI_CLIENT_SECRET` devem ser preenchidos no `.env` para testar

**Resultado**: Geração e gestão de boletos via EFI funcionando.

---

## Etapa 4 — API de Vendedores, Colaboradores e Dashboard ✅ CONCLUÍDA
**Objetivo**: Gestão de usuários internos e métricas.

- [x] CRUD de Colaboradores (ADMIN) — `src/routes/usuarios.routes.ts`
- [x] CRUD de Vendedores (ADMIN) — mesmo arquivo
- [x] `GET /dashboard` — cards: clientes ativos, placas ativas, recebimentos do dia, atrasados
- [x] `GET /vendedores/:id/clientes` — clientes do vendedor com próximo boleto
- [x] `GET /vendedor/carteira` — carteira do vendedor logado (por mês, toggle atraso/garantido)
- [x] `GET /vendedor/carteira/detalhes` — listagem filtrada por busca e percentual
- [x] `GET /vendedor/carteira/exportar` — exportar CSV (UTF-8 com BOM para Excel)
- [x] `GET /configuracoes` + `PUT /configuracoes` — percentuais de comissão

> **Observações de implementação:**
> - Rotas com prefixo específico (`/api/vendedor`, `/api/dashboard`, `/api/configuracoes`) devem ser registradas em `app.ts` **antes** de `app.use('/api', usuariosRoutes)` para evitar bloqueio pelo `requireRoles('ADMIN')` do router de usuários
> - Carteira "garantido": usa `ComissaoVendedor` filtrado por `boleto.dataPagamento` no mês
> - Carteira "atraso": calcula comissão teórica direto nos boletos `ATRASADO` do mês (sem `ComissaoVendedor`)
> - Dashboard atualiza boletos `PENDENTE` vencidos para `ATRASADO` a cada chamada
> - CSV com BOM (`\uFEFF`) para Excel reconhecer UTF-8 corretamente
> - Comissão unificado: ABC1234 R$50 → 18% (R$9), DEF5678 R$30 → 12,5% (R$3,75) = R$12,75 ✓

**Resultado**: API completa e pronta para consumo pelo frontend.

---

## Etapa 5 — Frontend: Landing Page Atualizada ✅ CONCLUÍDA
**Objetivo**: Modernizar o site institucional sem quebrar o que existe.

- [x] Remover "Acesso 1" (link para IP externo)
- [x] Renomear "Acesso 2" → "Acesso ao Rastreador"
- [x] Adicionar botão "Acesso Administrativo" → `/admin/login.html`
- [x] Atualizar seção "2ª Via Boleto": substituir link BB por campo de busca via API
- [x] Corrigir links HTTP → HTTPS (Google Fonts, jQuery CDN)
- [x] Substituir formulário de contato PHP por link WhatsApp
- [x] Atualizar footer: ano 2026, redes sociais corretas (Facebook + WhatsApp)
- [x] Criar `js/config.js` com `API_URL` configurável por ambiente
- [x] Adicionar `GET /api/segunda-via` (endpoint público) no backend

> **Observações de implementação:**
> - `js/config.js` define `window.API_URL` — em dev altere para `http://localhost:3000`
> - Endpoint `GET /api/segunda-via?busca=CPF_CNPJ_ou_PLACA` — público, sem autenticação; busca campo `cpfCnpj` (11 ou 14 dígitos) ou placa
> - Endpoint registrado em `efi.routes.ts` (já público, sem authMiddleware no router)
> - Formulário PHP `enviaemail.php` removido; contato agora via botão WhatsApp
> - Links `http://` do Google Fonts e jQuery Easing CDN corrigidos para `https://`
> - Navbar dropdown: "Acesso ao Rastreador" + "Acesso Administrativo" (removido "Acesso 1" com IP)
> - Tema claro/escuro com CSS custom properties + anti-FOUC script no `<head>`; persiste via `localStorage`
> - Scroll reveal com `IntersectionObserver` (classes `.reveal`, `.reveal-left`, `.reveal-right`, `.reveal-d1..4`)
> - Hover effects: cards de serviço (translateY), botões (scale), imagens timeline (scale), social links (scale + cor)
> - Botões "Leia mais..." removidos
> - Responsivo: `col-sm-6` nos cards de serviço, 2ª Via com flex wrap, footer centralizado no mobile

**Resultado**: Landing page moderna e funcional publicada no GitHub Pages.

---

## Etapa 6 — Frontend: Tela de Login e Painel Admin ✅ CONCLUÍDA
**Objetivo**: Acesso administrativo funcional.

- [x] `admin/login.html` — formulário de login, JWT, redirect por role
- [x] `js/auth-guard.js` — proteção de páginas (verificar token + expiração), máscaras de input (`maskCpfCnpj`, `maskPhone`, `maskPlaca`)
- [x] `css/admin.css` — estilos compartilhados: sidebar, cards, tabelas, wizard; borda amarela em todos os inputs com foco
- [x] `admin/dashboard.html` — cards: clientes, placas, recebimentos do dia, atrasados
- [x] `admin/clientes.html` — tabela de clientes, busca em tempo real (debounce), filtros, ações; navega para página de detalhe
- [x] `admin/cliente-detalhe.html` — página completa de detalhe do cliente (substituiu slide-in)
  - Aba **Dados**: formulário completo com endereço + ViaCEP, máscaras CPF/CNPJ e telefone, associação de vendedor
  - Aba **Placas**: lista com toggle ativo/inativo e exclusão, adicionar placa
  - Aba **Cobranças**: grupos colapsáveis (Em aberto / Pagos / Cancelados), filtros de data e placa, tabs por placa (não unificado), spinner no baixa, editar data/valor, cancelar carnê, modal Unificar Carnês
- [x] `admin/gerar-cobranca.html` — wizard 4 steps: cliente (com endereço completo) → placa → cobrança → confirmar; associa vendedor ao cliente no ato
- [x] `admin/colaboradores.html` — CRUD, filtro por busca/status, senha opcional na edição, toggle de visibilidade da senha
- [x] `admin/vendedores.html` — lista com expansão inline de clientes (dark mode corrigido), filtro por busca/status, senha opcional na edição, toggle de visibilidade
- [x] `admin/configuracoes.html` — editar percentuais de comissão + multa por atraso (% ao mês) + juros diários (% ao dia)

> **Observações de implementação:**
> - Stack: Bootstrap 3.3.1 (local) + Font Awesome 4.7 (CDN) + vanilla JS + jQuery
> - Sidebar fixa (240px, #1e2530) com colapso responsive em < 768px via transform translateX
> - `admin/cliente-detalhe.html` usa `GET /api/clientes/:id` (Dados/Placas) e `GET /api/clientes/:id/carnes` (Cobranças — inclui `placa` nos boletos)
> - Wizard com `.wizard-step.active` (#fed136) e `.wizard-step.done` (#28a745)
> - Auth via JWT em `localStorage('al_token')`, decode sem biblioteca (atob base64)
> - Todas as chamadas API via `window.AL.apiGet/Post/Put/Patch/Delete()` com Bearer automático
> - Login: admin@agillock.com.br / Admin@2025 → dashboard; VENDEDOR → ../vendedor/carteira.html
> - Dados de teste no banco: João da Silva Teste (CPF: 12345678901), placa TST9999, 3 boletos
> - **Atenção tipos**: `Placa.ativo` e `User.ativo` são `Boolean` — frontend usa `p.ativo`/`u.ativo` (não `status`)
> - **Atenção tipos**: `Cliente.status` é `String` ("ATIVO"/"INATIVO") — frontend usa `c.status` normalmente
> - Rotas de colaboradores/vendedores: `usuariosRoutes` montado em `/api` → `/api/colaboradores`, `/api/vendedores` (sem `/usuarios/`)
> - `GET /api/vendedores/:id/clientes` retorna `{ vendedor, clientes }` (objeto), não array direto
> - `POST /api/carnes` espera `dataVencimento` e `numeroParcelas` (não `vencimento`/`parcelas`)
> - `PATCH /boletos/:id/editar` aceita `dataVencimento` e/ou `valor` (valor só atualiza DB; EFI não permite editar valor)
> - Endereço do cliente: 7 campos separados (`cep`, `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `estado`) + ViaCEP auto-fill no blur do CEP
> - `showAlert` usa toasts fixos no rodapé (z-index 99999) — não conflita com modais
> - Busca de clientes em tempo real com debounce 400ms (sem botão de buscar)
> - Comissão do vendedor: calculada automaticamente no momento do pagamento (baixa manual ou webhook EFI), não na criação da cobrança

**Resultado**: Admin consegue gerenciar tudo pelo painel.

---

## Etapa 7 — Frontend: Painel Colaborador ✅ CONCLUÍDA
**Objetivo**: Interface para o colaborador do dia a dia.

- [x] `colaborador/clientes.html` — mesma estrutura do admin, sem aba de vendedores/colaboradores/configurações
- [x] `colaborador/cliente-detalhe.html` — detalhe do cliente com Gerar Cobrança e Unificar visíveis para COLABORADOR
- [x] `colaborador/gerar-cobranca.html` — geração de carnê com seleção de vendedor responsável
- [x] Login redireciona COLABORADOR para `../colaborador/clientes.html`
- [x] **Sistema de permissões granulares** — 8 permissões configuráveis por colaborador pelo admin:
  - `podeExcluirCliente`, `podeEditarCliente`, `podeInativarCliente`
  - `podeExcluirPlaca`, `podeInativarPlaca`
  - `podeBaixaManual`, `podeCancelarCarne`, `podeAlterarVencimento`
  - Todas embutidas no JWT no login; painel admin com checkboxes e badges de permissão
  - Backend verifica cada permissão nas rotas correspondentes (retorna 403 se negada)
  - Frontend oculta botões condicionalmente (sem recarregar a página)
- [x] **Autocomplete de vendedor** — substituiu o `<select>` em 6 telas (admin + colaborador):
  - `admin/clientes.html`, `admin/gerar-cobranca.html`, `admin/cliente-detalhe.html`
  - `colaborador/clientes.html`, `colaborador/gerar-cobranca.html`, `colaborador/cliente-detalhe.html`
  - Campo de texto com debounce 300ms → `GET /api/vendedores?busca=` → dropdown de resultados
  - Ao selecionar: nome aparece dentro do próprio input + botão `×` sobreposto à direita do input
  - Clique no `×`: limpa o input e foca (sem chip div separado)
  - Ao editar cliente com vendedor já associado: input pré-populado com `×` visível

> **Observações de implementação:**
> - Permissões usam padrão `perm !== false`: `undefined` (token ADMIN, sem campo) → trata como `true`
> - `GET /api/vendedores?busca=` aceito também por COLABORADOR (necessário para o autocomplete)
> - Migrations manuais adicionadas: `20260319130000_add_pode_excluir_placa` e `20260319140000_add_editar_inativar_permissions`
> - Após migration manual sempre rodar `prisma generate` + restart do container
> - Borda do wrapper externo do carnê: `border:1px solid #edf0f3` (inline no JS, em `carregarCobrancas()`)
> - Borda dos grupos internos do carnê: CSS class `.cobranca-group` na `<style>` (`border: 1px solid #e2e8f0`)

**Resultado**: Colaborador consegue criar e gerenciar clientes e cobranças com permissões configuráveis pelo admin.

---

## Etapa 8 — Frontend: Painel Vendedor (Carteira) ✅ CONCLUÍDA
**Objetivo**: Vendedor acompanha suas comissões em todas as fases do ciclo de cobrança.

### UX — `vendedor/carteira.html`

**Estrutura da página:**
```
┌─────────────────────────────────────────────────────────┐
│  Carteira                          [Seletor de mês ▼]  │
│  Acompanhe suas comissões por fase de cobrança.         │
├─────────────────────────────────────────────────────────┤
│  [Ganhos Atrasados]  [Ganhos Garantidos]  [Ganhos Futuros]  │  ← 3 botões toggle na mesma linha
├─────────────────────────────────────────────────────────┤
│                                                         │
│          ┌──────────────────────────────┐               │
│          │  R$ 1.200,00  (fundo colorido)│              │  ← card principal: total do toggle ativo
│          │  Comissões Garantidas        │               │
│          └──────────────────────────────┘               │
│                                                         │
│    ┌────────────────┐    ┌────────────────┐             │
│    │ R$ 400,00      │    │ R$ 800,00      │             │  ← 2 cards por percentual
│    │ Comissão 12,5% │    │ Comissão 18%   │             │
│    └────────────────┘    └────────────────┘             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Comportamento dos 3 botões toggle:**
- Ao clicar em qualquer botão, **toda a tela se re-renderiza** para o estado selecionado:
  - Card principal muda cor de fundo e valores
  - Os 2 cards de percentual mostram o breakdown 12%/18% do estado ativo
- **Ganhos Atrasados** → fundo vermelho, dados de boletos `ATRASADO` do mês
- **Ganhos Garantidos** → fundo verde, dados de boletos `PAGO` do mês (comissão confirmada)
- **Ganhos Futuros** → fundo azul/neutro, dados de boletos `PENDENTE` do mês (aparece imediatamente após criação da cobrança)

**Clique nos cards de percentual (12% ou 18%):**
- Navega para `carteira-detalhes.html?toggle=ESTADO&percentual=12|18&mes=AAAA-MM`
- A tela de detalhes exibe apenas os clientes daquela combinação (estado ativo + percentual clicado)

---

### UX — `vendedor/carteira-detalhes.html`

**Estrutura:**
```
← Voltar   Detalhes — Comissão 12,5% — Garantido — Mar/2026

┌──────────────────────────────────┐
│  Total: R$ 400,00  (fundo verde) │   ← mini-card com o total filtrado
└──────────────────────────────────┘

┌────────┬──────────┬──────────┬────────────┬──────────┬──────────┬───────────┐
│ Cliente│ Telefone │ Placa    │ Vencimento │ Pgto     │ Boleto   │ Comissão  │
├────────┼──────────┼──────────┼────────────┼──────────┼──────────┼───────────┤
│ João S.│ (11)9... │ ABC1234  │ 10/03/2026 │ 08/03/26 │ [Boleto] │ R$ 6,25   │
│        │          │          │            │          │[WhatsApp]│           │
└────────┴──────────┴──────────┴────────────┴──────────┴──────────┴───────────┘

[Exportar CSV]
```

- Filtro por busca (nome/placa) no topo da tabela
- Botão "Falar com Cliente" → link WhatsApp com número do cliente
- Botão "Baixar Boleto" → link do boleto no EFI
- Exportar CSV: arquivo com os dados exibidos

---

### Checklist de implementação

- [x] `vendedor/carteira.html` — layout com 3 botões toggle, card principal, 2 cards de percentual, seletor de mês
- [x] Toggle persiste na navegação (passado via query param para carteira-detalhes)
- [x] **Botão "Ganhos Futuros" oculto em meses passados** — visível apenas no mês atual e futuros; se o mês navega para o passado e o toggle ativo era "futuro", volta automaticamente para "garantido"
- [x] `vendedor/carteira-detalhes.html` — mini-card total, tabela, filtro por busca, WhatsApp, link boleto, exportar CSV
- [x] Coluna "Data Pgto" exibida apenas no toggle "garantido"
- [x] Cores: Atrasado = `#dc3545` (vermelho), Garantido = `#28a745` (verde), Futuro = `#17a2b8` (azul)

> **Observações de implementação:**
> - `isMesPassado(mesStr)` compara com `new Date()` a cada verificação (não em cache), garantindo que ao virar a meia-noite o comportamento seja correto
> - Percentuais reais (12,5% / 18%) são buscados via `GET /api/configuracoes` e usados como labels nos cards e no título da página de detalhes
> - Exportar CSV: fetch com `Authorization: Bearer` + blob download (não via `window.location.href` que não envia o token)
> - Filtro de busca na página de detalhes é client-side (dados já carregados), sem nova chamada à API

> **Fluxo do boleto entre os estados:**
> Cobrança criada → `PENDENTE` → aparece em **Futuros**
> Venceu sem pagamento → `ATRASADO` → aparece em **Atrasados**
> Pago (webhook EFI ou baixa manual) → `PAGO` + `ComissaoVendedor` criado → aparece em **Garantidos**
>
> A API `/api/vendedor/carteira?mes=AAAA-MM` retorna os 3 totais de uma vez. O frontend renderiza apenas o estado ativo conforme o botão selecionado.

**Resultado**: Vendedor entra no painel, vê rapidamente quanto tem garantido, quanto está em risco (atrasado) e quanto está projetado (futuro), e pode detalhar cada grupo por percentual de comissão.

---

## Etapa 9 — Deploy em Produção
**Objetivo**: Sistema rodando na Hostinger com domínio e SSL.

### 9.1 — Provisionar o servidor (Hostinger VPS)
- [x] Contratar VPS na Hostinger (Ubuntu 22.04, mín. 2 GB RAM)
- [x] Anotar o **IP público** do servidor (disponível no painel da Hostinger após provisionamento)
- [x] Instalar Docker + Docker Compose no servidor

### 9.2 — Configurar subdomínio no registro.br
> **Pré-requisito**: ter o IP público do servidor em mãos (passo 9.1).

1. Acesse [registro.br](https://registro.br) → faça login → clique em **agillock.com.br**
2. Clique em **DNS** → **Configurar zona DNS**
   > ⚠️ Usar **"Configurar zona DNS"**, não "Alterar servidores DNS" (isso muda quem gerencia o DNS, não é o que queremos)
3. Clique em **Adicionar registro** e preencha:

   | Campo  | Valor                                      |
   |--------|--------------------------------------------|
   | Nome   | `api`                                      |
   | Tipo   | `A`                                        |
   | Valor  | IP público do servidor (ex: `123.45.67.89`) |
   | TTL    | `3600` (padrão)                            |

4. Salve. O subdomínio `api.agillock.com.br` ficará ativo em até 24h (geralmente minutos).

- [x] Criar registro DNS tipo `A` com nome `api` apontando para o IP do servidor

### 9.3 — Configurar o servidor
- [x] Gerar certificado SSL com Let's Encrypt para `api.agillock.com.br`
- [x] Configurar Nginx como reverse proxy (porta 443 → container backend porta 3000)
- [x] Criar `.env` de produção com chaves EFI de produção
- [x] Copiar certificado p12 de produção para o servidor (`backend/cert/certificado.p12`)

> **Observações de deploy:**
> - Dockerfile usa build em dois estágios: `builder` (com devDependencies para compilar TypeScript) + imagem final (só production)
> - `docker compose restart` NÃO relê o `.env` — usar `docker compose up -d --force-recreate backend` ao alterar variáveis de ambiente
> - CORS_ORIGIN deve incluir `https://agillock.com.br` (domínio via CNAME do GitHub Pages)

### 9.4 — Subir a aplicação
- [x] Subir containers: `docker compose up -d --build`
- [x] Migrations e seed rodam automaticamente no `CMD` do Dockerfile (sem comando manual)

### 9.5 — Conectar os serviços externos
- [ ] Configurar webhook no painel EFI apontando para `https://api.agillock.com.br/api/efi/webhook`
- [x] Atualizar `js/config.js` no frontend: `window.API_URL = 'https://api.agillock.com.br'`
- [x] Publicar frontend atualizado no GitHub Pages

### 9.6 — Validação final
- [x] Testar fluxo completo: login → criar cliente → gerar carnê → pagamento → comissão

**Resultado**: Sistema 100% em produção.

---

---

## Ajustes Pós-Etapa 8 ✅ CONCLUÍDOS (2026-03-22)

Melhorias incrementais aplicadas após a conclusão das etapas principais.

### Ajuste 1 — E-mail não obrigatório no cadastro de clientes
- [x] Campo e-mail removido de `required` em `admin/clientes.html` e `colaborador/clientes.html`
- [x] Label alterado de "E-mail *" para "E-mail"
- [x] Comportamento EFI mantido: se o cliente tiver e-mail cadastrado, a EFI envia o boleto por e-mail; se não tiver, não envia (campo `email` já era condicional no `criarCarne`)

### Ajuste 2 — Data correta no step de confirmação do gerar-cobrança
- [x] Corrigido bug visual em `fmtDate()` (`auth-guard.js`): strings `YYYY-MM-DD` vindas de `<input type="date">` eram interpretadas como UTC midnight, causando exibição do dia anterior em fusos negativos (ex: UTC-3 Brasil)
- [x] Fix: parse manual das partes da string (`split('-')`) sem criação de objeto `Date`, eliminando a conversão de fuso
- [x] Afeta gerar-cobrança admin e colaborador (step 4 — resumo antes de gerar)

### Ajuste 3 — Endereço obrigatório na criação de clientes
- [x] Campos CEP, Logradouro, Número, Bairro, Cidade e UF marcados como `required` (com `*` no label) em `admin/clientes.html` e `colaborador/clientes.html`
- [x] Backend: `POST /api/clientes` agora retorna 400 se qualquer campo de endereço obrigatório estiver ausente
- [x] **Motivação**: os boletos EFI saíam sem endereço do cliente; tornar o endereço obrigatório na criação garante disponibilidade para todos os carnês futuros

### Ajuste 4 — Endereço do cliente no boleto EFI
- [x] Corrigido: o `SELECT` do cliente em `carnes.routes.ts` não incluía os campos de endereço; agora inclui `cep, logradouro, numero, complemento, bairro, cidade, estado`
- [x] O objeto `customer` enviado ao EFI agora inclui o campo `address` (quando endereço está preenchido) nos 3 endpoints de geração: `POST /carnes`, `POST /carnes/unificar`, `POST /carnes/unificar-placas`
- [x] Adicionado tipo `EfiCustomerAddress` em `efi.service.ts`

### Ajuste 5 — Pagamento de comissão e comprovante na carteira do vendedor
- [x] Novo modelo `PagamentoComissao` no Prisma (migration aplicada): `vendedorId + mes` (unique), `valor`, `pago`, `comprovante` (caminho do arquivo), `comprovanteMime`
- [x] Instalado `multer` para upload de arquivos (PDF/JPG/PNG até 10 MB); arquivos salvos em `/app/uploads/comprovantes/` (persiste via volume Docker)
- [x] Novos endpoints em `GET|POST /api/vendedor/pagamentos` e `POST /api/vendedor/pagamentos/:id/comprovante`
- [x] `GET /api/vendedor/comprovante/:id` — serve o arquivo; aceita JWT via header `Authorization` **ou** query param `?token=` (necessário para abrir em nova aba no browser)
- [x] Frontend `vendedor/carteira.html` — barra de ações aparece na aba **Ganhos Garantidos**:
  - **Visão admin** (quando `vendedorId` está na URL): botão "Efetuar Pagamento" (esquerda) → modal de confirmação → após confirmar exibe badge "Pago ✓"; botão "Anexar Comprovante" (direita, desabilitado antes do pagamento) → ao ser anexado, vira "Ver / Baixar Comprovante"
  - **Visão vendedor**: badge "Saque Realizado ✓" (se pago) ou "Saldo Acumulado" (se não); botão "Ver Comprovante" (apenas se admin já anexou arquivo) que abre em nova aba

> **Observações de implementação:**
> - A rota `GET /api/vendedor/comprovante/:id` é registrada **antes** do `router.use(authMiddleware)` para poder aceitar o JWT via query param sem ser bloqueada pelo middleware global
> - Upload via `fetch` com `FormData` (não via `AL.apiPost`), pois precisa enviar `multipart/form-data`
> - `pagVendId = adminVendId || currentUser.userId` — funciona tanto para admin visualizando um vendedor quanto para o próprio vendedor

---

---

## Ajustes Pós-Etapa 9 ✅ CONCLUÍDOS (2026-03-26)

### Ajuste 6 — Contratos: sócios e fiadores condicionais no PDF
- [x] Template service (`contrato-template.service.ts`) processa blocos `{{#IF_SOCIO_N}}...{{/IF_SOCIO_N}}` e `{{#IF_FIADOR_N}}...{{/IF_FIADOR_N}}` **antes** da substituição de variáveis — evita variáveis vazias no PDF quando há menos sócios/fiadores que o máximo
- [x] Templates `pj-com-assistencia.html` e `pj-sem-assistencia.html` atualizados com blocos condicionais em parágrafos de identificação e blocos de assinatura para sócios 2–5 e fiadores 1–5
- [x] `SOCIOS_LABEL` dinâmico: "seu sócio" (1 sócio) ou "seus sócios" (N sócios)
- [x] Suporte escalado de 2 para **5 sócios** e de 3 para **5 fiadores**
- [x] Seletor de sócios em `admin/cliente-form.html` e `colaborador/cliente-form.html` limitado ao máximo de 5
- [x] Seletor de fiadores em `admin/contrato-form.html` e `colaborador/contrato-form.html` escalado para 0–5

### Ajuste 7 — Contratos: campo telefone nos sócios
- [x] Campo **Telefone** adicionado ao card de cada sócio em `admin/cliente-form.html` e `colaborador/cliente-form.html` (mesma linha de RG + CPF, 3 colunas `col-sm-4`)
- [x] `getSociosPayload()` agora inclui `telefone`
- [x] Máscara de telefone aplicada via `AL.maskPhone()` em cada sócio
- [x] **Motivação**: cada sócio é um signatário individual no ClickSign com notificação WhatsApp própria — sem telefone, todos compartilhariam o número da empresa

### Ajuste 8 — Contratos: auto-fill de fiadores a partir dos sócios
- [x] Em `admin/contrato-form.html` e `colaborador/contrato-form.html`: ao selecionar cliente PJ com sócios, os campos de fiadores são pré-preenchidos automaticamente com os dados dos sócios (nome, CPF, RG, profissão, estado civil, nascimento, e-mail, telefone, endereço)
- [x] Parâmetro `skipAutoFill` em `selecionarCliente(cliente, skipAutoFill)` — passado como `true` ao carregar contrato existente para não sobrescrever os fiadores já salvos
- [x] Toast informativo exibido após o auto-fill

### Ajuste 9 — Toggle switch nos dispositivos (gerar-cobrança)
- [x] `admin/gerar-cobranca.html` e `colaborador/gerar-cobranca.html`: radio buttons na lista de dispositivos substituídos por **toggle switches** (`.disp-card` + `.disp-toggle` + `.disp-toggle-knob`)
- [x] Toggle posicionado à **esquerda** do nome do dispositivo
- [x] Comportamento: clicar ativa o dispositivo; clicar novamente no mesmo desativa (deselect) — habilita/desabilita o botão "Próximo" conforme seleção
- [x] Estilo adaptado ao tema escuro

### Ajuste 10 — Toggle switch de vínculo nos dispositivos (cliente-detalhe)
- [x] `admin/cliente-detalhe.html` e `colaborador/cliente-detalhe.html` — aba Dispositivos: adicionado **toggle switch** (`.vinc-toggle`) à esquerda de cada item
- [x] ON (âmbar) = vinculado; OFF (cinza) = desvinculado
- [x] Clicar no toggle OFF → vincula via `POST /api/dispositivos/:id/clientes` imediatamente
- [x] Clicar no toggle ON → abre modal de confirmação antes de desvincular via `DELETE /api/dispositivos/:id/clientes/:clienteId`
- [x] No colaborador: desvincular via toggle respeita a permissão `canDesvincularDispositivo`
- [x] CSS `.vinc-toggle` e `.vinc-toggle.on` adicionados em `css/admin.css` (dark theme incluído)
- [x] Badges e botões existentes mantidos intactos

### Ajuste 11 — Permissões de contratos em colaboradores
- [x] `admin/colaboradores.html`: badges de permissão na tabela agora incluem `podeCriarContrato`, `podeEditarContrato`, `podeExcluirContrato`
- [x] Modal de novo/editar colaborador: permissões organizadas com **cabeçalhos por grupo** (`Clientes`, `Placas`, `Dispositivos`, `Cobranças`, `Contratos`) via classe `.perm-group-label` — cor `#555` no tema claro, `#adb5bd` no tema escuro

---

## Resumo Visual

```
Etapa 1  → Backend base + Auth + Docker
Etapa 2  → API Clientes + Placas
Etapa 3  → Integração EFI (boletos/carnês)
Etapa 4  → API Vendedores + Colaboradores + Dashboard
Etapa 5  → Landing Page modernizada
Etapa 6  → Painel Admin (frontend)
Etapa 7  → Painel Colaborador (frontend)
Etapa 8  → Painel Vendedor/Carteira (frontend)
Etapa 9  → Deploy em Produção
Ajustes 1–5  → E-mail opcional, endereço obrigatório/no boleto, data correta, pagamento comissão
Ajustes 6–11 → Contratos condicionais PDF, telefone nos sócios, auto-fill fiadores, toggle switches, permissões por grupo
```
