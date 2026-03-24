# Contratos — Design Spec

## Goal
Criar um módulo de contratos que gera contratos a partir de templates HTML, permite edição em browser, envia para assinatura eletrônica via ClickSign e rastreia o status até a assinatura completa.

## Architecture

### Stack
- **Frontend:** HTML + Bootstrap 3 + jQuery + Vanilla JS (padrão do projeto)
- **Backend:** Node.js + Express + Prisma + TypeScript
- **PDF:** puppeteer (HTML → PDF para enviar ao ClickSign)
- **Assinatura eletrônica:** ClickSign API v3

### Fluxo principal
1. Usuário seleciona tipo de contrato + cliente + fiadores (PJ) + testemunhas → "Gerar Prévia"
2. Backend preenche template HTML com dados do cliente/representante/fiadores/testemunhas
3. Frontend exibe HTML em `contenteditable` para edição
4. Usuário salva como Rascunho ou envia direto para assinatura
5. Ao enviar: backend converte HTML → PDF → cria envelope no ClickSign → adiciona signatários (salvando os links retornados nessa etapa) → ativa envelope
6. Frontend exibe links de assinatura por signatário (copiar + abrir WhatsApp)
7. ClickSign envia webhook ao finalizar → backend atualiza status para ASSINADO

---

## Data Model

### Novo modelo `Contrato`

```prisma
model Contrato {
  id                    String    @id @default(uuid())
  tipo                  String    // "PF_COM_ASSISTENCIA" | "PF_SEM_ASSISTENCIA" | "PJ_COM_ASSISTENCIA" | "PJ_SEM_ASSISTENCIA"
  clienteId             String
  cliente               Cliente   @relation(fields: [clienteId], references: [id])
  fiadores              Json?     // [{nome, cpf, rg, nacionalidade, profissao, estadoCivil, dataNascimento, email, telefone, cep, logradouro, numero, complemento, bairro, cidade, estado}]
  testemunhas           Json      // [{nome, cpf, email, telefone, assinarDigital: bool}] — sempre 2
  htmlConteudo          String    @db.Text  // HTML preenchido + editado — @db.Text obrigatório (contratos são grandes)
  metodoAutenticacao    String    // "token_email" | "token_whatsapp" | "token_sms" | "handwritten"
  status                String    @default("RASCUNHO") // "RASCUNHO" | "AGUARDANDO_ASSINATURA" | "ASSINADO" | "CANCELADO"
  clicksignEnvelopeId   String?
  clicksignDocumentoId  String?
  signatarios           Json?     // [{nome, signerId, link, tipo: "cliente"|"socio"|"fiador"|"testemunha"|"agillock"}]
  criadoPorId           String
  criadoPor             User      @relation("ContratoCriador", fields: [criadoPorId], references: [id])
  assinadoEm            DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
}
```

Adicionar ao modelo `Cliente`:
```prisma
contratos Contrato[]
```

> **Exclusão de Cliente:** Se um cliente tiver contratos associados, a exclusão deve ser bloqueada com erro 400 "Não é possível excluir um cliente com contratos." Seguir o mesmo padrão das guards existentes em `clientes.routes.ts` (ex: boletos pendentes). NÃO usar cascade delete em contratos.

Adicionar ao modelo `User`:
```prisma
// Permissões colaborador
podeCriarContrato   Boolean @default(true)
podeEditarContrato  Boolean @default(true)
podeExcluirContrato Boolean @default(true)

// Relação
contratosCriados Contrato[] @relation("ContratoCriador")
```

### Atualização do modelo `Configuracoes` (atenção: nome correto é `Configuracoes`, com 's')
Adicionar campos para representante AgilLock que assina os contratos:
```prisma
representanteNome     String?
representanteEmail    String?
representanteTelefone String?
representanteCpf      String?
```

---

## Templates HTML

### Localização
`backend/src/templates/contratos/`
- `pf-com-assistencia.html`
- `pf-sem-assistencia.html`
- `pj-com-assistencia.html`
- `pj-sem-assistencia.html`

### Processo de criação
Os templates são derivados manualmente dos 4 arquivos `.docx` em `AgillockSite/contratos/`. O desenvolvedor deve:
1. Abrir cada `.docx`
2. Extrair o conteúdo textual e estrutura
3. Criar o HTML equivalente com os placeholders abaixo

### Sistema de placeholders (`{{CHAVE}}`)

**Dados do cliente (PF):**
- `{{NOME_CLIENTE}}` — nome completo
- `{{CPF_CLIENTE}}` — CPF formatado
- `{{RG_CLIENTE}}`
- `{{PROFISSAO_CLIENTE}}`
- `{{ESTADO_CIVIL_CLIENTE}}`
- `{{DATA_NASCIMENTO_CLIENTE}}` — formato DD/MM/YYYY
- `{{TELEFONE_CLIENTE}}`
- `{{EMAIL_CLIENTE}}`
- `{{ENDERECO_CLIENTE}}` — logradouro, nº, complemento, bairro, cidade/UF, CEP

**Dados do cliente (PJ — substitui dados PF):**
- `{{RAZAO_SOCIAL}}`
- `{{CNPJ}}`
- `{{TELEFONE_PJ}}`
- `{{EMAIL_PJ}}`
- `{{ENDERECO_PJ}}`

**Sócios (PJ — repetidos por índice 1..N):**
- `{{SOCIO_1_NOME}}`, `{{SOCIO_1_CPF}}`, `{{SOCIO_1_RG}}`, `{{SOCIO_1_PROFISSAO}}`, `{{SOCIO_1_ESTADO_CIVIL}}`, `{{SOCIO_1_NACIONALIDADE}}`, `{{SOCIO_1_DATA_NASCIMENTO}}`

**Fiadores (PJ — repetidos por índice 1..N):**
- `{{FIADOR_1_NOME}}`, `{{FIADOR_1_CPF}}`, `{{FIADOR_1_RG}}`, `{{FIADOR_1_PROFISSAO}}`, `{{FIADOR_1_ESTADO_CIVIL}}`, `{{FIADOR_1_NACIONALIDADE}}`, `{{FIADOR_1_DATA_NASCIMENTO}}`, `{{FIADOR_1_ENDERECO}}`

**Testemunhas (sempre 2):**
- `{{TESTEMUNHA_1_NOME}}`, `{{TESTEMUNHA_1_CPF}}`
- `{{TESTEMUNHA_2_NOME}}`, `{{TESTEMUNHA_2_CPF}}`

**Representante AgilLock:**
- `{{REPRESENTANTE_NOME}}`, `{{REPRESENTANTE_CPF}}`

**Data:**
- `{{DATA_HOJE}}` — formato "dia de mês de ano" (ex: "23 de março de 2026")
- `{{DATA_HOJE_CURTA}}` — DD/MM/YYYY

---

## Backend

### Novos arquivos

#### `backend/src/services/clicksign.service.ts`
```typescript
// Configuração via env: CLICKSIGN_ACCESS_TOKEN, CLICKSIGN_BASE_URL
// (sandbox: https://sandbox.clicksign.com, prod: https://app.clicksign.com)
// Todas as requisições: Content-Type: application/vnd.api+json, Accept: application/vnd.api+json

criarEnvelope(nome: string): Promise<{ envelopeId: string }>
uploadDocumento(envelopeId: string, pdfBuffer: Buffer, filename: string): Promise<{ documentId: string }>

// O link de assinatura vem do RESPONSE de adicionarSignatario (POST /signers), NÃO do activate.
// Salvar o link retornado aqui antes de ativar o envelope.
adicionarSignatario(envelopeId: string, dados: SignatarioDados): Promise<{ signerId: string, link: string }>

adicionarRequisitoQualificacao(envelopeId: string, documentId: string, signerId: string, qualificacao: string): Promise<void>
adicionarRequisitoAutenticacao(envelopeId: string, signerId: string, tipo: string): Promise<void>
ativarEnvelope(envelopeId: string): Promise<void>  // PATCH status: "running" — não retorna links
cancelarEnvelope(envelopeId: string): Promise<void>
```

#### `backend/src/services/pdf.service.ts`
```typescript
// Usa puppeteer com args: ['--no-sandbox', '--disable-setuid-sandbox']
htmlParaPdf(html: string): Promise<Buffer>
```

#### `backend/src/services/contrato-template.service.ts`
```typescript
// Lê template HTML do disco, substitui todos os {{PLACEHOLDERS}} com dados reais
preencherTemplate(tipo: string, dados: DadosContrato): string
```

#### `backend/src/routes/contratos.routes.ts`

> **Atenção:** registrar a rota `POST /preview` ANTES de qualquer rota com `:id` no arquivo, para evitar que Express interprete "preview" como um id.

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/contratos` | Listar com filtros (status, tipo, clienteId, criadoPorId, dataInicio, dataFim) | ADMIN, COLABORADOR |
| GET | `/api/contratos/:id` | Detalhe do contrato | ADMIN, COLABORADOR |
| POST | `/api/contratos/preview` | Preenche template, retorna HTML (não salva) — **declarar antes de `/:id`** | ADMIN, COLABORADOR |
| POST | `/api/contratos` | Salva contrato como RASCUNHO | ADMIN, COLABORADOR |
| PUT | `/api/contratos/:id` | Atualiza HTML (só RASCUNHO) | ADMIN, COLABORADOR |
| POST | `/api/contratos/:id/enviar` | HTML→PDF→ClickSign, ativa envelope, retorna signatários+links | ADMIN, COLABORADOR |
| POST | `/api/contratos/:id/cancelar` | Cancela envelope ClickSign + atualiza status | ADMIN, COLABORADOR |
| DELETE | `/api/contratos/:id` | Exclui (só RASCUNHO) | ADMIN, COLABORADOR |

#### Webhook — `backend/src/routes/webhooks.routes.ts`

- `POST /api/webhooks/clicksign` — **rota pública, sem authMiddleware JWT**

> **Crítico:** registrar este router em `app.ts` ANTES dos routers que usam `authMiddleware`, igual ao padrão do webhook EFI já existente. Se registrado depois, o ClickSign receberá 401 em todas as notificações.

**Verificação HMAC-SHA256:**
> O Express precisa do body raw (não parseado) para calcular o HMAC. Usar `express.raw({ type: '*/*' })` especificamente nessa rota, OU configurar um `verify` callback no `express.json()` global para capturar o raw body antes do parse. **Não usar `req.body` parseado para o cálculo HMAC** — o resultado sempre será inválido.

Implementação sugerida:
```typescript
router.post('/clicksign',
  express.raw({ type: '*/*' }),  // captura body como Buffer antes de parsear
  (req, res) => {
    const rawBody = req.body as Buffer;
    const hmacHeader = req.headers['content-hmac'] as string; // "sha256=<hash>"
    const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
    if (hmacHeader !== expected) { res.status(401).json({ error: 'HMAC inválido' }); return; }

    const payload = JSON.parse(rawBody.toString());
    const event = payload?.data?.attributes?.event;  // ClickSign v3 event field
    const envelopeId = payload?.data?.relationships?.envelope?.data?.id;

    if (event === 'envelope.closed') { /* status = ASSINADO */ }
    if (event === 'envelope.canceled') { /* status = CANCELADO */ }

    res.status(200).json({ ok: true });
  }
);
```

**Eventos ClickSign v3 a tratar:**
- `envelope.closed` (ou `close`) → status = ASSINADO, `assinadoEm` = now
- `envelope.canceled` (ou `cancel`) → status = CANCELADO
- `sign` → log apenas (assinatura parcial, envelope ainda não fechado)

> Nota: a documentação ClickSign v3 usa os nomes de evento como `envelope.closed` / `envelope.canceled`. Validar contra o payload real no sandbox antes de subir para produção.

### Atualização obrigatória: `backend/src/routes/configuracoes.routes.ts`
O handler de `PUT /api/configuracoes` atualmente só persiste 5 campos (`percentualMenor`, `percentualMaior`, `valorReferencia`, `multaPercentual`, `jurosDiarios`). **Deve ser atualizado** para também aceitar e persistir os 4 novos campos do representante:
- `representanteNome`
- `representanteEmail`
- `representanteTelefone`
- `representanteCpf`

O handler de `GET /api/configuracoes` também deve retornar esses campos.

### Registro em `app.ts`
```typescript
// Webhooks públicos — ANTES de qualquer router com authMiddleware
app.use('/api/webhooks', webhooksRoutes);

// Rotas autenticadas (existentes + nova)
app.use('/api/contratos', contratosRoutes);
```

### Variáveis de ambiente adicionadas (`.env`)
```
CLICKSIGN_ACCESS_TOKEN=   # gerado em sandbox.clicksign.com → Configurações → API
CLICKSIGN_BASE_URL=https://sandbox.clicksign.com
CLICKSIGN_WEBHOOK_SECRET= # gerado ao registrar webhook no ClickSign
```

---

## ClickSign — Fluxo de Envio Detalhado

```
1. criarEnvelope(nome) → envelopeId

2. htmlParaPdf(htmlConteudo) → pdfBuffer
   uploadDocumento(envelopeId, pdfBuffer, "contrato.pdf") → documentId

3. Para cada signatário:
   a. adicionarSignatario(envelopeId, dados) → { signerId, link }
      *** SALVAR link aqui — não virá do activate ***
   b. adicionarRequisitoQualificacao(envelopeId, documentId, signerId, qualificacao)
   c. adicionarRequisitoAutenticacao(envelopeId, signerId, metodoAutenticacao)

4. ativarEnvelope(envelopeId)
   → Envelope muda de "draft" para "running"
   → ClickSign notifica signatários conforme communicate_events

5. Salvar no DB: clicksignEnvelopeId, clicksignDocumentoId, signatarios (com links), status = AGUARDANDO_ASSINATURA

6. Retornar ao frontend: lista de signatários com links
```

Signatários e ordem de assinatura (grupo ClickSign):
1. **Grupo 1:** Cliente PF (ou Sócio(s) para PJ) + Fiadores (PJ)
2. **Grupo 2:** Representante AgilLock
3. **Grupo 3:** Testemunhas (somente se `assinarDigital: true`)

Qualificações:
- Cliente PF / Sócio PJ → `"party"`
- Fiador → `"party"` (ClickSign v3 não tem "guarantor" — usar "party")
- Representante AgilLock → `"party"`
- Testemunha → `"witness"`

Autenticação: método escolhido pelo usuário (`token_email`, `token_whatsapp`, `token_sms`, `handwritten`)

---

## Frontend

### Páginas novas

#### `admin/contratos.html` e `colaborador/contratos.html`
- Sidebar com item "Contratos" (`fa-file-text`) após Cobranças
- Filtros: busca livre (nome do cliente), select de status, select de tipo
- Tabela: Cliente | Tipo | Status (badge) | Criado em | Criado por | Ações
- Ações: ícone ver/editar (→ `contrato-form.html?id=X`), excluir (só RASCUNHO), cancelar (só AGUARDANDO_ASSINATURA)
- Botão "Novo Contrato" → `contrato-form.html` (oculto se `!podeCriarContrato`)

**Badges de status:**
- RASCUNHO → cinza (`badge-default`)
- AGUARDANDO_ASSINATURA → amarelo (`badge-pendente`)
- ASSINADO → verde (`badge-ativo`)
- CANCELADO → vermelho (`badge-atrasado`)

#### `admin/contrato-form.html` e `colaborador/contrato-form.html`
Wizard de 3 steps:

**Step 1 — Tipo, Cliente e Partes**
- 4 cards de seleção de tipo com ícone e descrição curta
- Busca de cliente (mesmo padrão do gerar-cobrança: digita → busca `/api/clientes?busca=` → seleciona)
- Se cliente PJ selecionado: picker "Número de fiadores" (0, 1, 2, 3) + formulário por fiador (mesmos campos de sócio em `cliente-form.html`: nome, cpf, rg, nacionalidade, profissão, estado civil, data nascimento, endereço)
- Select "Método de autenticação ClickSign": Token e-mail / Token WhatsApp / Token SMS / Assinatura manuscrita

**Step 2 — Testemunhas**
- 2 blocos fixos: Nome*, CPF*, E-mail*, Telefone*
- Toggle por testemunha: "Assinar digitalmente pelo ClickSign?"

**Step 3 — Prévia e Assinatura**
- Botão "Gerar Prévia" → `POST /api/contratos/preview` → renderiza HTML retornado em `div[contenteditable]` estilizado
- Botão "Salvar Rascunho" → `POST /api/contratos` (status RASCUNHO) ou `PUT /api/contratos/:id` se editando
- Botão "Enviar para Assinatura" (desabilitado até prévia ser gerada):
  - Chama `POST /api/contratos` (se novo) depois `POST /api/contratos/:id/enviar`
  - Mostra spinner durante processamento (PDF + ClickSign leva ~5-10s)
  - Após sucesso: painel "Contrato enviado para assinatura" com tabela de signatários:
    - Nome | Papel | Botão "Copiar link" | Botão "WhatsApp" (`https://wa.me/55{telefone}?text=Segue+o+link+para+assinatura:+{link}`)

**Edição de rascunho** (`contrato-form.html?id=X`):
- Carrega dados do contrato, pula para Step 3 com HTML editável preenchido
- Permite salvar alterações ou enviar para assinatura
- Se status != RASCUNHO: exibe contrato em modo leitura (sem edição), mostra painel de signatários

#### Atualização `admin/configuracoes.html`
Nova seção **"Representante AgilLock (Contratos)"**:
- Campos: Nome completo*, CPF*, E-mail*, Telefone*
- Salva via `PUT /api/configuracoes` (após atualização do handler)

#### Atualização `admin/colaboradores.html`
Nova seção de permissões **"Contratos"**:
- Checkboxes: "Criar contratos", "Editar contratos", "Excluir contratos"
- Campos: `podeCriarContrato`, `podeEditarContrato`, `podeExcluirContrato`

#### Atualização das sidebars
Adicionar item "Contratos" em:
- `admin/contratos.html`, `admin/contrato-form.html`
- `colaborador/contratos.html`, `colaborador/contrato-form.html`
- Também atualizar os itens de sidebar em **todas as páginas admin e colaborador existentes** para incluir o link "Contratos"

---

## Permissões

| Ação | ADMIN | COLABORADOR |
|------|-------|-------------|
| Ver lista de contratos | ✅ | ✅ |
| Criar contrato | ✅ | `podeCriarContrato` |
| Editar rascunho | ✅ | `podeEditarContrato` |
| Enviar para assinatura | ✅ | `podeCriarContrato` |
| Excluir rascunho | ✅ | `podeExcluirContrato` |
| Cancelar contrato | ✅ | `podeEditarContrato` |

---

## Tratamento de Erros

- Representante AgilLock não configurado → 400 antes de chamar ClickSign
- Cliente PJ sem sócios com CPF válido → 400 antes de chamar ClickSign
- ClickSign indisponível → 502 com mensagem clara no frontend
- Webhook com HMAC inválido → 401, não processa
- Excluir/editar contrato já enviado → 400 "Contrato já enviado para assinatura"
- Excluir cliente com contratos → 400 "Não é possível excluir um cliente com contratos"
- puppeteer falha ao gerar PDF → 500, não chama ClickSign

---

## Variáveis de Ambiente Necessárias
```
CLICKSIGN_ACCESS_TOKEN=   # gerado em sandbox.clicksign.com → Configurações → API
CLICKSIGN_BASE_URL=https://sandbox.clicksign.com
CLICKSIGN_WEBHOOK_SECRET= # gerado ao registrar webhook no ClickSign
```
