# Especificação das Telas — Frontend

O frontend permanece no GitHub Pages (AgillockSite). Novas telas são adicionadas como páginas HTML estáticas que consomem a API REST do backend.

A URL da API será armazenada em `js/config.js`:
```javascript
// js/config.js
// Em desenvolvimento local: aponte para localhost
// Em produção (GitHub Pages): aponte para o subdomínio da API
const API_URL = 'https://api.agillock.com.br/api';
```

> **Desenvolvimento local**: Para testar sem publicar no GitHub Pages, basta abrir os arquivos HTML diretamente no browser ou usar a extensão **Live Server** do VS Code. Mude `API_URL` para `http://localhost:3000/api` enquanto desenvolve.

---

## 1. Landing Page — Alterações (index.html)

### Navbar — Alterações nos botões de acesso
**Antes:**
- "Acesso 1" → `http://104.236.223.168` (REMOVER)
- "Acesso 2" → `https://agillock.monitorando.me/admin` (manter como "Acesso ao Rastreador")

**Depois:**
```html
<li>
  <a href="admin/login.html">Acesso Administrativo</a>
</li>
<li>
  <a href="https://agillock.monitorando.me/admin">Acesso ao Rastreador</a>
</li>
```

### Seção 2ª Via Boleto
Substituir o link do Banco do Brasil por um campo de busca simples:
```
[ Informe seu CPF/CNPJ ]  [ Buscar Boletos ]
→ Exibe lista de boletos em aberto com link para pagamento
```

### Modernização Visual
- Atualizar foto de fundo do header (imagem mais moderna)
- Melhorar tipografia e espaçamentos
- Adicionar seção de diferenciais (cards com ícones modernos)
- Atualizar footer com redes sociais corretas
- Corrigir links HTTP → HTTPS (Google Fonts, jQuery CDN)
- Remover `default.php` e `enviaemail.php` (não funcionam no GitHub Pages)
- Substituir formulário de contato por link para WhatsApp ou formulário via API

---

## 2. Página de Login — admin/login.html

**Campos:**
- Email
- Senha
- Botão "Entrar"

**Comportamento:**
```javascript
// POST /api/auth/login
// Se sucesso → salva token no localStorage
// Lê role do payload JWT:
//   ADMIN → redirect para /admin/dashboard.html
//   COLABORADOR → redirect para /colaborador/clientes.html
//   VENDEDOR → redirect para /vendedor/carteira.html
```

---

## 3. Painel Administrador

### admin/dashboard.html
**Cards de métricas:**
- Total de Clientes
- Total de Placas
- Recebimentos do Dia (R$)
- Boletos em Atraso (quantidade)

**Botões de ação (Etapa 10):**
- Importar dados do EFI — abre modal com preview dos carnês e confirmação
- Corrigir links PDF — atualiza boletos importados sem link de PDF

**Navegação lateral:**
- Dashboard
- Clientes
- Gerar Cobrança
- Cobranças
- Colaboradores
- Vendedores
- Configurações

---

### admin/clientes.html (e colaborador/clientes.html)

**Formulário de novo cliente — campos obrigatórios (`*`):**
- Nome, CPF/CNPJ, Telefone
- Endereço: CEP, Logradouro, Número, Bairro, Cidade, UF (todos obrigatórios para garantir exibição no boleto EFI)
- E-mail: **opcional** — se preenchido, EFI envia o boleto por e-mail ao cliente

**Tabela de clientes:**
- Nome, CPF/CNPJ, Telefone, Cidade, Status (Ativo/Inativo), Ações

**Ações por cliente (dropdown/botões):**
- Ver detalhes (abre painel lateral ou nova página)
- Editar dados
- Ativar/Inativar
- Ver carnês
- Gerar novo carnê
- Unificar carnês

**Painel de detalhes do cliente:**
- Dados cadastrais + endereço
- Lista de placas (com botão Adicionar Placa / Editar / Inativar)
- **Aba Dispositivos**: cada dispositivo exibe um **toggle switch** à esquerda — ON (âmbar) = vinculado, OFF (cinza) = desvinculado; clicar no toggle OFF vincula imediatamente; clicar no toggle ON abre confirmação antes de desvincular; badges e botões existentes permanecem intactos
- Lista de carnês:
  - Carnê unificado ou individual
  - Status de cada parcela (Pendente / Pago / Atrasado)
  - Botões: Baixar PDF, Dar Baixa, Editar Vencimento, Excluir

**Filtros:**
- Busca por nome/CPF/CNPJ/placa
- Status (Ativo/Inativo)
- Status financeiro (Adimplente/Inadimplente)

---

### admin/gerar-cobranca.html (e colaborador/gerar-cobranca.html)

**Formulário em etapas:**

**Etapa 1 — Cliente**
- Campo de busca (busca cliente existente) OU cadastrar novo
- Ao selecionar cliente existente: exibe placas

**Etapa 2 — Dispositivos**
- Lista de dispositivos exibida com **toggle switch** à esquerda de cada item
- Clicar no toggle ativa o dispositivo (borda âmbar + switch deslizante); clicar novamente desativa
- Comportamento deselect: clicar num dispositivo já selecionado limpa a seleção e desabilita o botão "Próximo"
- Se cliente tem carnê unificado: avisa que o dispositivo será adicionado ao unificado

**Etapa 3 — Cobrança**
- Valor por placa (R$)
- Número de parcelas
- Data do 1º vencimento
- Juros (% ao dia)
- Multa (%)
- Descrição (ex: "Mensalidade Rastreamento")
- Vendedor responsável — campo autocomplete (debounce 300ms → `GET /api/vendedores?busca=`) com botão `×` inline ao selecionar

**Etapa 4 — Confirmar e Gerar**
- Resumo da cobrança
- Botão "Gerar Carnê"
- Após gerado: opções de Baixar PDF, Copiar Link, Enviar por WhatsApp, Enviar por Email

---

### admin/colaboradores.html

**Tabela:**
- Nome, Email, Status, Data Cadastro, Badges de permissão, Ações
- Badges de permissão incluem ícones para todas as 16 permissões, incluindo as de contratos

**Ações:** Editar, Ativar/Inativar, Excluir

**Modal Novo/Editar Colaborador:**
- Nome
- Email
- Senha (somente no cadastro / opção de redefinir)
- Status (Ativo/Inativo)
- **16 checkboxes de permissões granulares** (todas marcadas por padrão), agrupadas com cabeçalhos por categoria (adaptados ao tema escuro via `.perm-group-label`):
  - **Clientes**: excluir / editar dados / inativar/ativar
  - **Placas**: excluir / inativar/ativar
  - **Dispositivos**: criar / editar / excluir / inativar/ativar / desvincular de clientes
  - **Cobranças**: baixa manual / cancelar/excluir carnês / alterar data de vencimento
  - **Contratos**: criar / editar / excluir

---

### admin/vendedores.html

**Tabela:**
- Nome, Email, Total Clientes, Total Vendas (R$), Status

**Ao expandir um vendedor:**
- Lista de clientes do vendedor
- Por cliente: placas, boletos, status de adimplência

**Ações por vendedor:** Editar, Ativar/Inativar, Excluir, Ver Comissões

**Configurações de Comissão (editável pelo admin):**
- % para boletos < R$ X (atualmente 12,5%)
- % para boletos >= R$ X (atualmente 18%)
- Valor de referência X (atualmente R$ 50,00)
- Botão Salvar → reflete imediatamente na tela do vendedor

---

### admin/configuracoes.html

- Botão **Alterar Senha** → modal com Senha Atual, Nova Senha e Confirmação (com toggle de visibilidade)
- Parâmetros de Cobrança: Percentual menor (%), Percentual maior (%), Valor de referência (R$)
- Encargos por Atraso: Multa (% — máx. 10%), Juros Diários (% ao dia — máx. 1%)
- Botão Salvar Configurações

---

## 4. Painel Vendedor — vendedor/carteira.html

### Tela Principal da Carteira

**Header:**
- Seletor de mês (anterior / mês atual / próximo)

**Toggle:** `Deixando de Ganhar | Ganhos Garantidos | Ganhos Futuros`

**Card Principal (destaque):**
- Fundo VERMELHO se "atrasado", VERDE se "garantidos", AZUL se "futuros"
- Valor total de comissão no mês (somado)
- **Barra de pagamento** (visível apenas na aba "Ganhos Garantidos"):
  - **Visão admin** (quando `?vendedorId=` está na URL):
    - Esquerda: botão **"Efetuar Pagamento"** → modal de confirmação (avisa que aparecerá para o vendedor como "Saque Realizado" e que é necessário anexar comprovante) → após confirmar: badge **"Pago ✓"**
    - Direita: botão **"Anexar Comprovante"** (desabilitado antes do pagamento) → abre seletor de arquivo (PDF/JPG/PNG) → após upload: **"Ver / Baixar Comprovante"**
  - **Visão vendedor**:
    - Esquerda: badge **"Saque Realizado ✓"** (se admin já pagou) ou **"Saldo Acumulado"** (se não)
    - Direita: botão **"Ver Comprovante"** (apenas se admin anexou arquivo) → abre em nova aba

**Cards secundários:**
- Card: `Comissão X%` → valor somado desta faixa (clicável → vai para carteira-detalhes.html)
- Card: `Comissão Y%` → valor somado desta faixa (clicável)

---

### Tela de Detalhes — vendedor/carteira-detalhes.html

**Aberta ao clicar em qualquer card secundário.**

**Header:**
- Título: "Seus clientes em atraso (ou garantidos) — ganhos X%"
- Card com valor do somatório (vermelho ou verde)

**Filtros:**
- Campo busca por Nome ou Placa
- Data De → Data Até
- Botão "Exportar CSV"

**Tabela (planilha):**

| Nome | Telefone | Situação Veículo | Data Contrato | Situação Contrato | Vencimento Original | Data Pagamento | Valor Boleto | Valor Pago |
|---|---|---|---|---|---|---|---|---|

**Ações por linha:**
- Botão "Falar com Cliente" → abre WhatsApp com número do cliente
- Botão "Baixar Boleto" → link do boleto no EFI

---

## 5. Autenticação no Frontend

Todas as páginas protegidas carregam `js/auth-guard.js` que expõe o objeto global `window.AL`:

```javascript
// Uso nas páginas:
var currentUser = AL.requireAuth(['ADMIN']);       // redireciona se não autenticado/sem role
var currentUser = AL.requireAuth(['ADMIN', 'COLABORADOR']);

// Token armazenado em:
localStorage.getItem('al_token');

// Helpers disponíveis em window.AL:
AL.apiGet(path)            // fetch com Bearer automático
AL.apiPost(path, body)
AL.apiPut(path, body)
AL.apiPatch(path, body)
AL.apiDelete(path)
AL.showAlert(msg, type)    // toast fixo no rodapé
AL.confirmar({ titulo, mensagem, btnTexto, btnClasse })  // modal de confirmação (retorna Promise)
AL.initThemeToggle(btnId)  // toggle dark/light mode
AL.badgeStatus(status)     // badge colorida para status do boleto
AL.fmtMoney(valor)         // formata R$ 1.234,56
AL.fmtDate(date)           // formata DD/MM/AAAA — strings YYYY-MM-DD são parseadas sem conversão de fuso (evita bug de "dia anterior" em UTC-3)
AL.fmtCpfCnpj(str)         // formata CPF ou CNPJ
AL.isHoje(date)            // true se a data for hoje
AL.logout()                // remove token e redireciona para login
```

---

## 6. Estrutura de Arquivos em AgillockSite

```
AgillockSite/
├── index.html
├── favicon.ico
├── admin/
│   ├── login.html
│   ├── dashboard.html          ← cards métricas + botões EFI (Etapa 10)
│   ├── clientes.html           ← autocomplete vendedor (× inline)
│   ├── cliente-detalhe.html    ← tabs Dados/Placas/Cobranças; autocomplete vendedor
│   ├── gerar-cobranca.html     ← wizard 4 steps; sugestão unificação automática
│   ├── cobrancas.html          ← tabela plana de todos boletos; filtros; PDF/baixa/WA
│   ├── colaboradores.html      ← 8 checkboxes de permissão por colaborador
│   ├── vendedores.html         ← expansão inline de clientes; link para carteira
│   └── configuracoes.html      ← alterar senha + parâmetros de comissão e encargos
├── colaborador/
│   ├── clientes.html           ← autocomplete vendedor; botões condicionais por permissão
│   ├── cliente-detalhe.html    ← autocomplete vendedor; botões condicionais por permissão
│   ├── gerar-cobranca.html     ← autocomplete vendedor (× inline)
│   └── cobrancas.html          ← igual admin, sem ações de admin
├── vendedor/
│   ├── carteira.html           ← 3 toggles (atrasado/garantido/futuro) + seletor de mês
│   └── carteira-detalhes.html  ← tabela por percentual; WhatsApp com link do boleto; CSV
└── js/
    ├── auth-guard.js           ← window.AL (ver seção 5)
    ├── config.js               ← window.API_URL ('http://localhost:3000' em dev)
    ├── jquery.js
    ├── bootstrap.min.js
└── css/
    └── admin.css               ← estilos compartilhados: sidebar, cards, tabelas, wizard
```
