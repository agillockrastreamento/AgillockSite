# Contratos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar módulo completo de contratos: geração de PDF a partir de templates HTML, envio para assinatura eletrônica via ClickSign e rastreamento de status.

**Architecture:** Templates HTML com placeholders `{{CHAVE}}` preenchidos pelo backend (contrato-template.service), convertidos em PDF via puppeteer, enviados ao ClickSign via API v3. Frontend wizard de 3 steps (tipo/cliente/fiadores → testemunhas → prévia+edição). Webhook público atualiza status quando envelope fecha.

**Tech Stack:** Node.js + Express + Prisma + TypeScript, puppeteer (HTML→PDF), ClickSign API v3 (JSON:API), Bootstrap 3 + jQuery (frontend existente).

---

## File Structure

### Criar
- `backend/src/services/pdf.service.ts` — puppeteer HTML→PDF
- `backend/src/services/clicksign.service.ts` — ClickSign API v3
- `backend/src/services/contrato-template.service.ts` — preenchimento de placeholders
- `backend/src/routes/contratos.routes.ts` — endpoints CRUD + preview + enviar + cancelar
- `backend/src/routes/webhooks.routes.ts` — webhook ClickSign público
- `backend/src/templates/contratos/pf-com-assistencia.html` — template contrato PF c/ assistência
- `backend/src/templates/contratos/pf-sem-assistencia.html` — template contrato PF s/ assistência
- `backend/src/templates/contratos/pj-com-assistencia.html` — template contrato PJ c/ assistência
- `backend/src/templates/contratos/pj-sem-assistencia.html` — template contrato PJ s/ assistência
- `AgillockSite/admin/contratos.html` — lista de contratos (admin)
- `AgillockSite/admin/contrato-form.html` — wizard criar/editar (admin)
- `AgillockSite/colaborador/contratos.html` — lista de contratos (colaborador)
- `AgillockSite/colaborador/contrato-form.html` — wizard criar/editar (colaborador)

### Modificar
- `backend/prisma/schema.prisma` — adicionar modelo Contrato, campos em User/Configuracoes/Cliente
- `backend/src/app.ts` — registrar webhooksRoutes e contratosRoutes
- `backend/src/routes/configuracoes.routes.ts` — adicionar 4 campos representante
- `backend/src/routes/clientes.routes.ts` — bloquear delete se cliente tem contratos
- `AgillockSite/admin/configuracoes.html` — seção "Representante AgilLock"
- `AgillockSite/admin/colaboradores.html` — permissões de contrato
- Todas as páginas admin e colaborador existentes — adicionar item "Contratos" na sidebar

---

## Task 1: Prisma Schema — Contrato model + campos

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Adicionar campos ao modelo User (permissões + relação)**

No arquivo `backend/prisma/schema.prisma`, adicionar após `podeAlterarVencimento Boolean @default(true)` (linha 56):

```prisma
  podeCriarContrato   Boolean @default(true)
  podeEditarContrato  Boolean @default(true)
  podeExcluirContrato Boolean @default(true)

  contratosCriados Contrato[] @relation("ContratoCriador")
```

- [ ] **Step 2: Adicionar relação ao modelo Cliente**

No arquivo `backend/prisma/schema.prisma`, adicionar após `carnes Carne[]` (linha 104):

```prisma
  contratos              Contrato[]
```

- [ ] **Step 3: Adicionar campos ao modelo Configuracoes**

No arquivo `backend/prisma/schema.prisma`, adicionar após `jurosDiarios Decimal @default(0.33) @db.Decimal(5, 2)` (linha 290):

```prisma
  representanteNome     String?
  representanteEmail    String?
  representanteTelefone String?
  representanteCpf      String?
```

- [ ] **Step 4: Adicionar modelo Contrato (ao final do schema, antes do último `}`)**

```prisma
model Contrato {
  id                   String    @id @default(uuid())
  tipo                 String    // "PF_COM_ASSISTENCIA" | "PF_SEM_ASSISTENCIA" | "PJ_COM_ASSISTENCIA" | "PJ_SEM_ASSISTENCIA"
  clienteId            String
  cliente              Cliente   @relation(fields: [clienteId], references: [id])
  fiadores             Json?     // [{nome, cpf, rg, nacionalidade, profissao, estadoCivil, dataNascimento, email, telefone, cep, logradouro, numero, complemento, bairro, cidade, estado}]
  testemunhas          Json      // [{nome, cpf, email, telefone, assinarDigital: bool}]
  htmlConteudo         String    @db.Text
  metodoAutenticacao   String    // "token_email" | "token_whatsapp" | "token_sms" | "handwritten"
  status               String    @default("RASCUNHO")
  clicksignEnvelopeId  String?
  clicksignDocumentoId String?
  signatarios          Json?     // [{nome, signerId, link, tipo: "cliente"|"socio"|"fiador"|"testemunha"|"agillock"}]
  criadoPorId          String
  criadoPor            User      @relation("ContratoCriador", fields: [criadoPorId], references: [id])
  assinadoEm           DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
}
```

- [ ] **Step 5: Gerar e rodar migration**

```bash
cd backend
npx prisma migrate dev --name add_contrato_module
```

Esperado: migration criada e aplicada, `prisma generate` rodado automaticamente.

- [ ] **Step 6: Verificar**

```bash
npx prisma studio
```

Abrir no browser e confirmar que o modelo `Contrato` aparece com todos os campos.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add Contrato model and representante fields to schema"
```

---

## Task 2: Backend services

**Files:**
- Create: `backend/src/services/pdf.service.ts`
- Create: `backend/src/services/clicksign.service.ts`
- Create: `backend/src/services/contrato-template.service.ts`

- [ ] **Step 1: Instalar puppeteer**

```bash
cd backend
npm install puppeteer
```

Esperado: `puppeteer` adicionado ao `package.json`.

- [ ] **Step 2: Criar pdf.service.ts**

```typescript
// backend/src/services/pdf.service.ts
import puppeteer from 'puppeteer';

export async function htmlParaPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', margin: { top: '2cm', bottom: '2cm', left: '2.5cm', right: '2.5cm' } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 3: Criar clicksign.service.ts**

```typescript
// backend/src/services/clicksign.service.ts
import fetch from 'node-fetch';

const BASE_URL = process.env.CLICKSIGN_BASE_URL || 'https://sandbox.clicksign.com';
const TOKEN    = process.env.CLICKSIGN_ACCESS_TOKEN || '';

const headers = {
  'Content-Type': 'application/vnd.api+json',
  'Accept':       'application/vnd.api+json',
  'Authorization': `Bearer ${TOKEN}`,
};

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickSign ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function criarEnvelope(nome: string): Promise<{ envelopeId: string }> {
  const data = await req('POST', '/api/v3/envelopes', {
    data: { type: 'envelopes', attributes: { name: nome, locale: 'pt-BR', auto_close: true, remind_interval: 3 } },
  });
  return { envelopeId: (data as any).data.id };
}

export async function uploadDocumento(envelopeId: string, pdfBuffer: Buffer, filename: string): Promise<{ documentId: string }> {
  const base64 = pdfBuffer.toString('base64');
  const data = await req('POST', `/api/v3/envelopes/${envelopeId}/documents`, {
    data: {
      type: 'documents',
      attributes: {
        filename,
        content_base64: `data:application/pdf;base64,${base64}`,
      },
    },
  });
  return { documentId: (data as any).data.id };
}

export interface SignatarioDados {
  nome: string;
  email: string;
  telefone?: string;
  cpf?: string;
  grupo?: number;
}

export async function adicionarSignatario(envelopeId: string, dados: SignatarioDados): Promise<{ signerId: string; link: string }> {
  const data = await req('POST', `/api/v3/envelopes/${envelopeId}/signers`, {
    data: {
      type: 'signers',
      attributes: {
        name: dados.nome,
        email: dados.email,
        ...(dados.telefone ? { phone_number: dados.telefone.replace(/\D/g, '') } : {}),
        ...(dados.cpf ? { documentation: dados.cpf.replace(/\D/g, '') } : {}),
        ...(dados.grupo !== undefined ? { group: dados.grupo } : {}),
        communicate_events: ['sign', 'envelope_closed'],
      },
    },
  });
  const attrs = (data as any).data.attributes;
  return { signerId: (data as any).data.id, link: attrs.link || attrs.sign_url || '' };
}

export async function adicionarRequisitoQualificacao(envelopeId: string, documentId: string, signerId: string, qualificacao: string): Promise<void> {
  await req('POST', `/api/v3/envelopes/${envelopeId}/requirements`, {
    data: {
      type: 'requirements',
      attributes: { action: qualificacao },  // "party" para cliente/sócio/fiador/representante, "witness" para testemunha
      relationships: {
        document: { data: { type: 'documents', id: documentId } },
        signer:   { data: { type: 'signers',   id: signerId } },
      },
    },
  });
}

export async function adicionarRequisitoAutenticacao(envelopeId: string, signerId: string, tipo: string): Promise<void> {
  await req('POST', `/api/v3/envelopes/${envelopeId}/requirements`, {
    data: {
      type: 'requirements',
      attributes: { action: tipo },
      relationships: {
        signer: { data: { type: 'signers', id: signerId } },
      },
    },
  });
}

export async function ativarEnvelope(envelopeId: string): Promise<void> {
  await req('PATCH', `/api/v3/envelopes/${envelopeId}`, {
    data: { type: 'envelopes', id: envelopeId, attributes: { status: 'running' } },
  });
}

export async function cancelarEnvelope(envelopeId: string): Promise<void> {
  await req('PATCH', `/api/v3/envelopes/${envelopeId}`, {
    data: { type: 'envelopes', id: envelopeId, attributes: { status: 'canceled' } },
  });
}
```

**Nota:** `node-fetch` já está instalado no projeto (usado em outros lugares). Se não estiver, rodar `npm install node-fetch`.

- [ ] **Step 4: Criar contrato-template.service.ts**

```typescript
// backend/src/services/contrato-template.service.ts
import fs from 'fs';
import path from 'path';

const TEMPLATES_DIR = path.resolve(__dirname, '../templates/contratos');

export interface DadosContrato {
  tipo: string;
  cliente: {
    nome: string; cpfCnpj?: string; tipoPessoa?: string;
    rg?: string; profissao?: string; estadoCivil?: string; dataNascimento?: string;
    telefone?: string; email?: string;
    logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; estado?: string; cep?: string;
    socios?: Array<{ nome: string; cpf?: string; rg?: string; profissao?: string; estadoCivil?: string; nacionalidade?: string; dataNascimento?: string }>;
  };
  fiadores?: Array<{
    nome: string; cpf?: string; rg?: string; profissao?: string; estadoCivil?: string; nacionalidade?: string; dataNascimento?: string;
    email?: string; telefone?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; estado?: string; cep?: string;
  }>;
  testemunhas: Array<{ nome: string; cpf?: string }>;
  representante: { nome?: string; cpf?: string };
}

function fmtData(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
}

function fmtEndereco(obj: { logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; estado?: string; cep?: string }): string {
  const parts = [obj.logradouro, obj.numero, obj.complemento, obj.bairro, obj.cidade && obj.estado ? `${obj.cidade}/${obj.estado}` : (obj.cidade || obj.estado), obj.cep ? `CEP ${obj.cep}` : ''];
  return parts.filter(Boolean).join(', ');
}

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function dataHoje(): { longa: string; curta: string } {
  const d = new Date();
  return {
    longa: `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`,
    curta: `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`,
  };
}

function tipoParaArquivo(tipo: string): string {
  const map: Record<string, string> = {
    PF_COM_ASSISTENCIA: 'pf-com-assistencia.html',
    PF_SEM_ASSISTENCIA: 'pf-sem-assistencia.html',
    PJ_COM_ASSISTENCIA: 'pj-com-assistencia.html',
    PJ_SEM_ASSISTENCIA: 'pj-sem-assistencia.html',
  };
  return map[tipo] || 'pf-com-assistencia.html';
}

export function preencherTemplate(tipo: string, dados: DadosContrato): string {
  const arquivo = path.join(TEMPLATES_DIR, tipoParaArquivo(tipo));
  let html = fs.readFileSync(arquivo, 'utf-8');

  const { longa, curta } = dataHoje();
  const c = dados.cliente;
  const rep = dados.representante;
  const socios = c.socios || [];
  const fiadores = dados.fiadores || [];
  const testemunhas = dados.testemunhas;

  const vars: Record<string, string> = {
    DATA_HOJE: longa,
    DATA_HOJE_CURTA: curta,
    // PF
    NOME_CLIENTE: c.nome || '',
    CPF_CLIENTE: c.cpfCnpj || '',
    RG_CLIENTE: c.rg || '',
    PROFISSAO_CLIENTE: c.profissao || '',
    ESTADO_CIVIL_CLIENTE: c.estadoCivil || '',
    DATA_NASCIMENTO_CLIENTE: fmtData(c.dataNascimento),
    TELEFONE_CLIENTE: c.telefone || '',
    EMAIL_CLIENTE: c.email || '',
    ENDERECO_CLIENTE: fmtEndereco(c),
    // PJ
    RAZAO_SOCIAL: c.nome || '',
    CNPJ: c.cpfCnpj || '',
    TELEFONE_PJ: c.telefone || '',
    EMAIL_PJ: c.email || '',
    ENDERECO_PJ: fmtEndereco(c),
    // Representante
    REPRESENTANTE_NOME: rep.nome || '',
    REPRESENTANTE_CPF: rep.cpf || '',
  };

  // Sócios
  socios.forEach((s, i) => {
    const n = i + 1;
    vars[`SOCIO_${n}_NOME`] = s.nome || '';
    vars[`SOCIO_${n}_CPF`] = s.cpf || '';
    vars[`SOCIO_${n}_RG`] = s.rg || '';
    vars[`SOCIO_${n}_PROFISSAO`] = s.profissao || '';
    vars[`SOCIO_${n}_ESTADO_CIVIL`] = s.estadoCivil || '';
    vars[`SOCIO_${n}_NACIONALIDADE`] = s.nacionalidade || '';
    vars[`SOCIO_${n}_DATA_NASCIMENTO`] = fmtData(s.dataNascimento);
  });

  // Fiadores
  fiadores.forEach((f, i) => {
    const n = i + 1;
    vars[`FIADOR_${n}_NOME`] = f.nome || '';
    vars[`FIADOR_${n}_CPF`] = f.cpf || '';
    vars[`FIADOR_${n}_RG`] = f.rg || '';
    vars[`FIADOR_${n}_PROFISSAO`] = f.profissao || '';
    vars[`FIADOR_${n}_ESTADO_CIVIL`] = f.estadoCivil || '';
    vars[`FIADOR_${n}_NACIONALIDADE`] = f.nacionalidade || '';
    vars[`FIADOR_${n}_DATA_NASCIMENTO`] = fmtData(f.dataNascimento);
    vars[`FIADOR_${n}_ENDERECO`] = fmtEndereco(f);
  });

  // Testemunhas
  [0, 1].forEach(i => {
    const n = i + 1;
    const t = testemunhas[i];
    vars[`TESTEMUNHA_${n}_NOME`] = t?.nome || '';
    vars[`TESTEMUNHA_${n}_CPF`] = t?.cpf || '';
  });

  // Substituir todos os placeholders
  for (const [key, val] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(val);
  }

  return html;
}
```

- [ ] **Step 5: Verificar compilação TypeScript**

```bash
cd backend
npx tsc --noEmit
```

Esperado: sem erros de compilação.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/
git add backend/package.json backend/package-lock.json
git commit -m "feat: add pdf, clicksign and contrato-template services"
```

---

## Task 3: HTML contract templates (4 arquivos)

**Files:**
- Create: `backend/src/templates/contratos/pf-com-assistencia.html`
- Create: `backend/src/templates/contratos/pf-sem-assistencia.html`
- Create: `backend/src/templates/contratos/pj-com-assistencia.html`
- Create: `backend/src/templates/contratos/pj-sem-assistencia.html`

> **Nota importante:** O conteúdo real dos contratos deve ser extraído dos arquivos `.docx` em `AgillockSite/contratos/`. Abrir cada arquivo no Word ou LibreOffice e copiar o texto para o HTML, substituindo os dados variáveis pelos placeholders `{{CHAVE}}` conforme a lista na spec (`docs/superpowers/specs/2026-03-23-contratos-design.md`). Os passos abaixo criam templates esqueleto — o desenvolvedor deve preenchê-los com o conteúdo real.

- [ ] **Step 1: Criar diretório de templates**

```bash
mkdir -p backend/src/templates/contratos
```

- [ ] **Step 2: Criar pf-com-assistencia.html**

Copiar conteúdo de `AgillockSite/contratos/CONTRATO PF ASSISTENCIA VEICULAR.docx` para HTML e substituir dados variáveis pelos placeholders. Estrutura mínima:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.6; color: #000; }
  h1 { text-align: center; font-size: 14pt; text-transform: uppercase; }
  p { text-align: justify; margin-bottom: 0.5em; }
  .assinatura { margin-top: 40px; }
</style>
</head>
<body>
<h1>CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE RASTREAMENTO VEICULAR COM ASSISTÊNCIA VEICULAR</h1>

<p>São Paulo, {{DATA_HOJE}}.</p>

<!-- CONTRATANTE (PF) -->
<p><strong>CONTRATANTE:</strong> {{NOME_CLIENTE}}, {{ESTADO_CIVIL_CLIENTE}}, {{PROFISSAO_CLIENTE}},
portador(a) do CPF nº {{CPF_CLIENTE}}, RG nº {{RG_CLIENTE}}, nascido(a) em {{DATA_NASCIMENTO_CLIENTE}},
residente e domiciliado(a) em {{ENDERECO_CLIENTE}},
telefone: {{TELEFONE_CLIENTE}}, e-mail: {{EMAIL_CLIENTE}}.</p>

<!-- Cole aqui o restante do texto do contrato, substituindo os dados variáveis pelos placeholders -->

<div class="assinatura">
<p>_______________________________________<br>{{NOME_CLIENTE}}<br>CPF: {{CPF_CLIENTE}}</p>
<p>_______________________________________<br>{{REPRESENTANTE_NOME}}<br>CPF: {{REPRESENTANTE_CPF}}<br>AgilLock Rastreamento</p>
<p>_______________________________________<br>{{TESTEMUNHA_1_NOME}}<br>CPF: {{TESTEMUNHA_1_CPF}}</p>
<p>_______________________________________<br>{{TESTEMUNHA_2_NOME}}<br>CPF: {{TESTEMUNHA_2_CPF}}</p>
</div>
</body>
</html>
```

- [ ] **Step 3: Criar pf-sem-assistencia.html**

Mesma estrutura, baseado em `CONTRATO PF SEM ASSISTENCIA VEICULAR 2.docx`. Mesmos placeholders PF.

- [ ] **Step 4: Criar pj-com-assistencia.html**

Baseado em `CONTRATO PJ ASSISTENCIA VEICULAR.docx`. Usar placeholders PJ (`{{RAZAO_SOCIAL}}`, `{{CNPJ}}`, `{{SOCIO_1_NOME}}`, etc.) e fiadores (`{{FIADOR_1_NOME}}`, etc.).

- [ ] **Step 5: Criar pj-sem-assistencia.html**

Baseado em `CONTRATO PJ SEM ASSISTENCIA VEICULAR.docx`. Mesmo padrão PJ.

- [ ] **Step 6: Testar preenchimento manualmente**

Criar um script temporário `backend/src/test-template.ts`:
```typescript
import { preencherTemplate } from './services/contrato-template.service';
import fs from 'fs';

const html = preencherTemplate('PF_COM_ASSISTENCIA', {
  tipo: 'PF_COM_ASSISTENCIA',
  cliente: { nome: 'João da Silva', cpfCnpj: '123.456.789-00', tipoPessoa: 'PF', rg: '12.345.678-9', profissao: 'Empresário', estadoCivil: 'Casado', dataNascimento: '1980-05-15', telefone: '11999999999', email: 'joao@teste.com', logradouro: 'Rua das Flores', numero: '123', bairro: 'Centro', cidade: 'São Paulo', estado: 'SP', cep: '01310-100' },
  testemunhas: [{ nome: 'Maria Souza', cpf: '987.654.321-00' }, { nome: 'Carlos Lima', cpf: '111.222.333-44' }],
  representante: { nome: 'Ana Costa', cpf: '555.666.777-88' },
});
fs.writeFileSync('/tmp/contrato-teste.html', html);
console.log('Gerado: /tmp/contrato-teste.html');
```

Rodar: `npx ts-node src/test-template.ts`
Abrir `/tmp/contrato-teste.html` no browser e confirmar que os placeholders foram substituídos corretamente.

Apagar o arquivo de teste após verificar.

- [ ] **Step 7: Commit**

```bash
git add backend/src/templates/
git commit -m "feat: add 4 HTML contract templates with placeholder system"
```

---

## Task 4: contratos.routes.ts

**Files:**
- Create: `backend/src/routes/contratos.routes.ts`

- [ ] **Step 1: Criar contratos.routes.ts**

```typescript
// backend/src/routes/contratos.routes.ts
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { requireRoles } from '../middleware/roles.middleware';
import prisma from '../utils/prisma';
import { preencherTemplate, DadosContrato } from '../services/contrato-template.service';
import { htmlParaPdf } from '../services/pdf.service';
import * as clicksign from '../services/clicksign.service';

const router = Router();
router.use(authMiddleware);
router.use(requireRoles('ADMIN', 'COLABORADOR'));

// POST /api/contratos/preview — ANTES de /:id para não ser interceptado
router.post('/preview', async (req: AuthRequest, res: Response): Promise<void> => {
  const { tipo, cliente, fiadores, testemunhas, representante } = req.body;
  if (!tipo || !cliente || !testemunhas) {
    res.status(400).json({ error: 'tipo, cliente e testemunhas são obrigatórios.' });
    return;
  }
  const html = preencherTemplate(tipo, { tipo, cliente, fiadores, testemunhas, representante } as DadosContrato);
  res.json({ html });
});

// GET /api/contratos
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { status, tipo, clienteId, criadoPorId, dataInicio, dataFim, busca } = req.query as Record<string, string>;
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (tipo) where.tipo = tipo;
  if (clienteId) where.clienteId = clienteId;
  if (criadoPorId) where.criadoPorId = criadoPorId;
  if (dataInicio || dataFim) {
    where.createdAt = {};
    if (dataInicio) (where.createdAt as any).gte = new Date(dataInicio);
    if (dataFim) (where.createdAt as any).lte = new Date(dataFim + 'T23:59:59');
  }
  if (busca) {
    where.cliente = { nome: { contains: busca, mode: 'insensitive' } };
  }
  const contratos = await prisma.contrato.findMany({
    where,
    include: { cliente: { select: { id: true, nome: true } }, criadoPor: { select: { id: true, nome: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(contratos);
});

// GET /api/contratos/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const contrato = await prisma.contrato.findUnique({
    where: { id: req.params.id },
    include: { cliente: true, criadoPor: { select: { id: true, nome: true } } },
  });
  if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  res.json(contrato);
});

// POST /api/contratos — salvar rascunho
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { tipo, clienteId, fiadores, testemunhas, htmlConteudo, metodoAutenticacao } = req.body;
  if (!tipo || !clienteId || !testemunhas || !htmlConteudo || !metodoAutenticacao) {
    res.status(400).json({ error: 'tipo, clienteId, testemunhas, htmlConteudo e metodoAutenticacao são obrigatórios.' });
    return;
  }
  // Verificar permissão
  if (req.user!.role === 'COLABORADOR') {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.podeCriarContrato) { res.status(403).json({ error: 'Sem permissão para criar contratos.' }); return; }
  }
  const contrato = await prisma.contrato.create({
    data: { tipo, clienteId, fiadores: fiadores || null, testemunhas, htmlConteudo, metodoAutenticacao, criadoPorId: req.user!.id },
  });
  res.status(201).json(contrato);
});

// PUT /api/contratos/:id — atualizar rascunho
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const contrato = await prisma.contrato.findUnique({ where: { id: req.params.id } });
  if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  if (contrato.status !== 'RASCUNHO') { res.status(400).json({ error: 'Apenas contratos em rascunho podem ser editados.' }); return; }
  if (req.user!.role === 'COLABORADOR') {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.podeEditarContrato) { res.status(403).json({ error: 'Sem permissão para editar contratos.' }); return; }
  }
  const { htmlConteudo, fiadores, testemunhas, metodoAutenticacao } = req.body;
  const updated = await prisma.contrato.update({
    where: { id: req.params.id },
    data: {
      ...(htmlConteudo !== undefined ? { htmlConteudo } : {}),
      ...(fiadores !== undefined ? { fiadores } : {}),
      ...(testemunhas !== undefined ? { testemunhas } : {}),
      ...(metodoAutenticacao !== undefined ? { metodoAutenticacao } : {}),
    },
  });
  res.json(updated);
});

// POST /api/contratos/:id/enviar — HTML→PDF→ClickSign
router.post('/:id/enviar', async (req: AuthRequest, res: Response): Promise<void> => {
  const contrato = await prisma.contrato.findUnique({
    where: { id: req.params.id },
    include: { cliente: true },
  });
  if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  if (contrato.status !== 'RASCUNHO') { res.status(400).json({ error: 'Contrato já enviado para assinatura.' }); return; }

  const config = await prisma.configuracoes.findUnique({ where: { id: '1' } });
  if (!config?.representanteNome || !config?.representanteEmail || !config?.representanteCpf) {
    res.status(400).json({ error: 'Configure o Representante AgilLock em Configurações antes de enviar contratos.' });
    return;
  }

  const cliente = contrato.cliente;
  const testemunhas = contrato.testemunhas as Array<{ nome: string; cpf: string; email: string; telefone: string; assinarDigital: boolean }>;
  const fiadores = (contrato.fiadores || []) as Array<{ nome: string; cpf: string; email: string; telefone: string }>;
  const metodo = contrato.metodoAutenticacao;

  // Gerar PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await htmlParaPdf(contrato.htmlConteudo);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao gerar PDF do contrato.' });
    return;
  }

  // ClickSign flow
  let envelopeId: string, documentId: string;
  const signatariosResult: Array<{ nome: string; signerId: string; link: string; tipo: string }> = [];
  try {
    ({ envelopeId } = await clicksign.criarEnvelope(`Contrato ${contrato.tipo} - ${cliente.nome}`));
    ({ documentId } = await clicksign.uploadDocumento(envelopeId, pdfBuffer, 'contrato.pdf'));

    // Grupo 1: cliente PF ou sócios PJ + fiadores
    const isPJ = contrato.tipo.startsWith('PJ');
    const socios = isPJ ? ((cliente.socios as any[]) || []) : [];

    if (isPJ) {
      for (const socio of socios) {
        const { signerId, link } = await clicksign.adicionarSignatario(envelopeId, { nome: socio.nome, email: socio.email || cliente.email || '', telefone: socio.telefone || cliente.telefone || '', cpf: socio.cpf, grupo: 1 });
        await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'party');
        await clicksign.adicionarRequisitoAutenticacao(envelopeId, signerId, metodo);
        signatariosResult.push({ nome: socio.nome, signerId, link, tipo: 'socio' });
      }
      for (const fiador of fiadores) {
        const { signerId, link } = await clicksign.adicionarSignatario(envelopeId, { nome: fiador.nome, email: fiador.email, telefone: fiador.telefone, cpf: fiador.cpf, grupo: 1 });
        await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'party');
        await clicksign.adicionarRequisitoAutenticacao(envelopeId, signerId, metodo);
        signatariosResult.push({ nome: fiador.nome, signerId, link, tipo: 'fiador' });
      }
    } else {
      const { signerId, link } = await clicksign.adicionarSignatario(envelopeId, { nome: cliente.nome, email: cliente.email || '', telefone: cliente.telefone || '', cpf: cliente.cpfCnpj || '', grupo: 1 });
      await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'party');
      await clicksign.adicionarRequisitoAutenticacao(envelopeId, signerId, metodo);
      signatariosResult.push({ nome: cliente.nome, signerId, link, tipo: 'cliente' });
    }

    // Grupo 2: Representante AgilLock
    const { signerId: repId, link: repLink } = await clicksign.adicionarSignatario(envelopeId, { nome: config.representanteNome!, email: config.representanteEmail!, telefone: config.representanteTelefone || '', cpf: config.representanteCpf || '', grupo: 2 });
    await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, repId, 'party');
    await clicksign.adicionarRequisitoAutenticacao(envelopeId, repId, metodo);
    signatariosResult.push({ nome: config.representanteNome!, signerId: repId, link: repLink, tipo: 'agillock' });

    // Grupo 3: Testemunhas digitais
    for (const t of testemunhas) {
      if (t.assinarDigital) {
        const { signerId, link } = await clicksign.adicionarSignatario(envelopeId, { nome: t.nome, email: t.email, telefone: t.telefone, cpf: t.cpf, grupo: 3 });
        await clicksign.adicionarRequisitoQualificacao(envelopeId, documentId, signerId, 'witness');
        await clicksign.adicionarRequisitoAutenticacao(envelopeId, signerId, metodo);
        signatariosResult.push({ nome: t.nome, signerId, link, tipo: 'testemunha' });
      }
    }

    await clicksign.ativarEnvelope(envelopeId);
  } catch (e: any) {
    res.status(502).json({ error: `Falha na integração com o ClickSign: ${e.message}` });
    return;
  }

  const updated = await prisma.contrato.update({
    where: { id: req.params.id },
    data: {
      status: 'AGUARDANDO_ASSINATURA',
      clicksignEnvelopeId: envelopeId,
      clicksignDocumentoId: documentId,
      signatarios: signatariosResult,
    },
  });
  res.json({ contrato: updated, signatarios: signatariosResult });
});

// POST /api/contratos/:id/cancelar
router.post('/:id/cancelar', async (req: AuthRequest, res: Response): Promise<void> => {
  const contrato = await prisma.contrato.findUnique({ where: { id: req.params.id } });
  if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  if (contrato.status !== 'AGUARDANDO_ASSINATURA') { res.status(400).json({ error: 'Apenas contratos aguardando assinatura podem ser cancelados.' }); return; }
  if (req.user!.role === 'COLABORADOR') {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.podeEditarContrato) { res.status(403).json({ error: 'Sem permissão para cancelar contratos.' }); return; }
  }
  if (contrato.clicksignEnvelopeId) {
    try { await clicksign.cancelarEnvelope(contrato.clicksignEnvelopeId); } catch { /* ignorar se já cancelado */ }
  }
  const updated = await prisma.contrato.update({ where: { id: req.params.id }, data: { status: 'CANCELADO' } });
  res.json(updated);
});

// DELETE /api/contratos/:id — só RASCUNHO
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const contrato = await prisma.contrato.findUnique({ where: { id: req.params.id } });
  if (!contrato) { res.status(404).json({ error: 'Contrato não encontrado.' }); return; }
  if (contrato.status !== 'RASCUNHO') { res.status(400).json({ error: 'Apenas rascunhos podem ser excluídos.' }); return; }
  if (req.user!.role === 'COLABORADOR') {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.podeExcluirContrato) { res.status(403).json({ error: 'Sem permissão para excluir contratos.' }); return; }
  }
  await prisma.contrato.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
```

- [ ] **Step 2: Verificar compilação**

```bash
cd backend && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/contratos.routes.ts
git commit -m "feat: add contratos.routes.ts with all CRUD + preview + enviar + cancelar"
```

---

## Task 5: webhooks.routes.ts + app.ts

**Files:**
- Create: `backend/src/routes/webhooks.routes.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Criar webhooks.routes.ts**

```typescript
// backend/src/routes/webhooks.routes.ts
import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';

const router = Router();

const WEBHOOK_SECRET = process.env.CLICKSIGN_WEBHOOK_SECRET || '';

router.post('/clicksign',
  express.raw({ type: '*/*' }),
  async (req: Request, res: Response): Promise<void> => {
    const rawBody = req.body as Buffer;
    const hmacHeader = (req.headers['content-hmac'] as string) || '';

    if (WEBHOOK_SECRET) {
      const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
      if (hmacHeader !== expected) {
        res.status(401).json({ error: 'HMAC inválido' });
        return;
      }
    }

    let payload: any;
    try { payload = JSON.parse(rawBody.toString()); } catch {
      res.status(400).json({ error: 'Payload inválido' });
      return;
    }

    const event = payload?.data?.attributes?.event;
    const envelopeId = payload?.data?.relationships?.envelope?.data?.id;

    if (!envelopeId) { res.status(200).json({ ok: true }); return; }

    if (event === 'envelope.closed' || event === 'close') {
      await prisma.contrato.updateMany({
        where: { clicksignEnvelopeId: envelopeId },
        data: { status: 'ASSINADO', assinadoEm: new Date() },
      });
    } else if (event === 'envelope.canceled' || event === 'cancel') {
      await prisma.contrato.updateMany({
        where: { clicksignEnvelopeId: envelopeId },
        data: { status: 'CANCELADO' },
      });
    }
    // 'sign' e outros eventos: ignorar (parcial)

    res.status(200).json({ ok: true });
  }
);

export default router;
```

- [ ] **Step 2: Registrar rotas em app.ts**

No arquivo `backend/src/app.ts`, adicionar os imports:

```typescript
import webhooksRoutes from './routes/webhooks.routes';
import contratosRoutes from './routes/contratos.routes';
```

Adicionar após `app.use('/api', efiRoutes);` (linha 50) — **antes** dos routers com authMiddleware:

```typescript
app.use('/api/webhooks', webhooksRoutes);  // webhook público — antes de authMiddleware
```

Adicionar após `app.use('/api/configuracoes', configuracoesRoutes);`:

```typescript
app.use('/api/contratos', contratosRoutes);
```

- [ ] **Step 3: Verificar compilação e inicialização**

```bash
cd backend && npx tsc --noEmit
npm run dev
```

Testar: `curl http://localhost:3000/api/health` deve retornar `{"status":"ok",...}`.

Testar: `curl -X POST http://localhost:3000/api/webhooks/clicksign -H "Content-Type: application/json" -d '{}'` deve retornar `{"ok":true}`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/webhooks.routes.ts backend/src/app.ts
git commit -m "feat: add webhooks.routes.ts and register contratos + webhooks in app.ts"
```

---

## Task 6: Atualizar configuracoes.routes.ts

**Files:**
- Modify: `backend/src/routes/configuracoes.routes.ts`

- [ ] **Step 1: Adicionar campos representante ao GET e PUT**

No `GET /api/configuracoes`, o handler já retorna o objeto completo do Prisma — os novos campos serão incluídos automaticamente após a migration.

No `PUT /api/configuracoes`, atualizar a desestruturação e o bloco de validação:

```typescript
// Substituir linha 21:
const { percentualMenor, percentualMaior, valorReferencia, multaPercentual, jurosDiarios,
        representanteNome, representanteEmail, representanteTelefone, representanteCpf } = req.body;

// Substituir a condição de validação (linhas 23-25) para incluir os novos campos:
if (percentualMenor === undefined && percentualMaior === undefined && valorReferencia === undefined
    && multaPercentual === undefined && jurosDiarios === undefined
    && representanteNome === undefined && representanteEmail === undefined
    && representanteTelefone === undefined && representanteCpf === undefined) {
  res.status(400).json({ error: 'Informe ao menos um campo para atualizar.' });
  return;
}

// Mudar o tipo de data para aceitar string além de number:
const data: Record<string, number | string | null> = {};
// ... campos existentes ...
if (representanteNome !== undefined)     data.representanteNome     = representanteNome;
if (representanteEmail !== undefined)    data.representanteEmail    = representanteEmail;
if (representanteTelefone !== undefined) data.representanteTelefone = representanteTelefone;
if (representanteCpf !== undefined)      data.representanteCpf      = representanteCpf;
```

- [ ] **Step 2: Verificar compilação**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 3: Testar endpoint**

Com o servidor rodando, salvar uma configuração com representante e buscar em seguida:

```bash
curl -X PUT http://localhost:3000/api/configuracoes \
  -H "Authorization: Bearer <token_admin>" \
  -H "Content-Type: application/json" \
  -d '{"representanteNome":"Ana Costa","representanteEmail":"ana@agillock.com","representanteCpf":"123.456.789-00","representanteTelefone":"11999999999"}'
```

Esperado: retorna objeto de configurações com os novos campos preenchidos.

- [ ] **Step 4: Bloquear delete de cliente com contratos em clientes.routes.ts**

Localizar o handler `DELETE /api/clientes/:id` em `backend/src/routes/clientes.routes.ts`. Antes da exclusão do cliente, adicionar verificação semelhante às guards existentes:

```typescript
const contratosCount = await prisma.contrato.count({ where: { clienteId: req.params.id } });
if (contratosCount > 0) {
  res.status(400).json({ error: 'Não é possível excluir um cliente com contratos.' });
  return;
}
```

- [ ] **Step 5: Verificar compilação**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/configuracoes.routes.ts backend/src/routes/clientes.routes.ts
git commit -m "feat: add representante fields to configuracoes and block cliente delete with contratos"
```

---

## Task 7: Atualizar admin/configuracoes.html

**Files:**
- Modify: `AgillockSite/admin/configuracoes.html`

- [ ] **Step 1: Ler o arquivo atual**

Abrir `AgillockSite/admin/configuracoes.html` e localizar o `<form id="form-config">` com os 5 campos existentes.

- [ ] **Step 2: Adicionar seção Representante AgilLock**

Após o botão "Salvar Configurações" (ou ao final do form-config, antes do `</form>`), adicionar nova seção:

```html
<hr>
<h4>Representante AgilLock <small>(usado nos contratos)</small></h4>
<div class="row">
  <div class="col-md-6">
    <div class="form-group">
      <label>Nome completo *</label>
      <input type="text" class="form-control" id="representanteNome" placeholder="Nome do representante">
    </div>
  </div>
  <div class="col-md-6">
    <div class="form-group">
      <label>CPF *</label>
      <input type="text" class="form-control" id="representanteCpf" placeholder="000.000.000-00" maxlength="14">
    </div>
  </div>
</div>
<div class="row">
  <div class="col-md-6">
    <div class="form-group">
      <label>E-mail *</label>
      <input type="email" class="form-control" id="representanteEmail" placeholder="email@empresa.com">
    </div>
  </div>
  <div class="col-md-6">
    <div class="form-group">
      <label>Telefone *</label>
      <input type="text" class="form-control" id="representanteTelefone" placeholder="(11) 99999-9999" maxlength="15">
    </div>
  </div>
</div>
```

- [ ] **Step 3: Carregar dados do representante no loadConfig()**

Na função JS `loadConfig()` (onde os campos existentes são preenchidos), adicionar:

```javascript
document.getElementById('representanteNome').value     = data.representanteNome     || '';
document.getElementById('representanteCpf').value      = data.representanteCpf      || '';
document.getElementById('representanteEmail').value    = data.representanteEmail    || '';
document.getElementById('representanteTelefone').value = data.representanteTelefone || '';
```

- [ ] **Step 4: Enviar dados do representante no saveConfig()**

Na função JS de submit do form, adicionar ao objeto de dados:

```javascript
representanteNome:     document.getElementById('representanteNome').value.trim(),
representanteCpf:      document.getElementById('representanteCpf').value.trim(),
representanteEmail:    document.getElementById('representanteEmail').value.trim(),
representanteTelefone: document.getElementById('representanteTelefone').value.trim(),
```

- [ ] **Step 5: Testar no browser**

Abrir `admin/configuracoes.html`, preencher os campos do representante, salvar e recarregar. Confirmar que os dados persistem.

- [ ] **Step 6: Commit**

```bash
git add AgillockSite/admin/configuracoes.html
git commit -m "feat: add representante AgilLock section to configuracoes.html"
```

---

## Task 8: Atualizar admin/colaboradores.html (permissões contrato)

**Files:**
- Modify: `AgillockSite/admin/colaboradores.html`

- [ ] **Step 1: Ler o arquivo atual**

Abrir `AgillockSite/admin/colaboradores.html`. Localizar a seção de permissões (checkboxes com `podeCancelarCarne`, `podeBaixaManual`, etc.).

- [ ] **Step 2: Adicionar checkboxes de contrato**

No bloco de permissões do modal de edição de colaborador, adicionar nova linha após os checkboxes existentes:

```html
<tr>
  <th colspan="2" class="text-center bg-primary text-white" style="padding:4px 8px">Contratos</th>
</tr>
<tr>
  <td><label style="font-weight:normal"><input type="checkbox" id="perm-criarContrato"> Criar contratos</label></td>
  <td><label style="font-weight:normal"><input type="checkbox" id="perm-editarContrato"> Editar contratos</label></td>
</tr>
<tr>
  <td><label style="font-weight:normal"><input type="checkbox" id="perm-excluirContrato"> Excluir contratos</label></td>
  <td></td>
</tr>
```

- [ ] **Step 3: Incluir campos no carregamento do colaborador**

Na função JS que popula o modal ao editar colaborador, adicionar:

```javascript
document.getElementById('perm-criarContrato').checked   = col.podeCriarContrato   !== false;
document.getElementById('perm-editarContrato').checked  = col.podeEditarContrato  !== false;
document.getElementById('perm-excluirContrato').checked = col.podeExcluirContrato !== false;
```

- [ ] **Step 4: Incluir campos no payload de save**

Na função de salvar colaborador, adicionar ao objeto:

```javascript
podeCriarContrato:   document.getElementById('perm-criarContrato').checked,
podeEditarContrato:  document.getElementById('perm-editarContrato').checked,
podeExcluirContrato: document.getElementById('perm-excluirContrato').checked,
```

- [ ] **Step 5: Testar no browser**

Abrir `admin/colaboradores.html`, editar um colaborador, marcar/desmarcar os novos checkboxes, salvar e reabrir. Confirmar que os valores persistem.

- [ ] **Step 6: Commit**

```bash
git add AgillockSite/admin/colaboradores.html
git commit -m "feat: add contrato permissions to colaboradores.html"
```

---

## Task 9: Criar contratos.html (lista) — admin e colaborador

**Files:**
- Create: `AgillockSite/admin/contratos.html`
- Create: `AgillockSite/colaborador/contratos.html`

- [ ] **Step 1: Criar AgillockSite/admin/contratos.html**

Seguir o padrão exato de `admin/clientes.html`:
- Mesma estrutura HTML (sidebar, navbar, container, anti-FOUC, Bootstrap 3, Font Awesome 4.7)
- Item "Contratos" como `class="active"` na sidebar, com ícone `fa-file-text`
- Header com título "Contratos" e botão "Novo Contrato" (oculto se `!podeCriarContrato`)

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Contratos — AgilLock</title>
  <script>
    (function(){var t=localStorage.getItem('al-theme');if(t==='dark')document.documentElement.classList.add('dark-theme');})();
  </script>
  <link rel="stylesheet" href="../css/bootstrap.min.css">
  <link rel="stylesheet" href="../css/font-awesome.min.css">
  <link rel="stylesheet" href="../css/admin.css">
</head>
<body>
  <!-- Sidebar (copiar de clientes.html, marcar Contratos como active) -->
  <div class="admin-sidebar" id="sidebar">
    <div class="sidebar-brand">
      <img src="../img/logo_agillock_white_new.png" alt="AgilLock" style="height:36px;vertical-align:middle;" onerror="this.style.display='none'" />
    </div>
    <ul class="sidebar-nav">
      <li><a href="dashboard.html"><i class="fa fa-tachometer fa-fw"></i> Dashboard</a></li>
      <li><a href="clientes.html"><i class="fa fa-users fa-fw"></i> Clientes</a></li>
      <li><a href="dispositivos.html"><i class="fa fa-microchip fa-fw"></i> Dispositivos</a></li>
      <li><a href="gerar-cobranca.html"><i class="fa fa-file-text fa-fw"></i> Gerar Cobrança</a></li>
      <li><a href="cobrancas.html"><i class="fa fa-money fa-fw"></i> Cobranças</a></li>
      <li class="active"><a href="contratos.html"><i class="fa fa-pencil-square-o fa-fw"></i> Contratos</a></li>
      <li><a href="colaboradores.html"><i class="fa fa-user fa-fw"></i> Colaboradores</a></li>
      <li><a href="vendedores.html"><i class="fa fa-handshake-o fa-fw"></i> Vendedores</a></li>
      <li><a href="configuracoes.html"><i class="fa fa-cog fa-fw"></i> Configurações</a></li>
    </ul>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <span id="user-nome" class="sidebar-user-nome">—</span>
        <span id="user-badge" class="al-badge" style="margin-top:4px;"></span>
      </div>
      <button id="btn-tema" class="btn-tema-sidebar"></button>
      <button id="btn-logout" class="btn btn-link btn-logout">Sair</button>
    </div>
  </div>
  <div class="sidebar-overlay" id="sidebar-overlay"></div>

  <div class="admin-content">
    <div class="admin-topbar">
      <button class="sidebar-toggle" id="sidebar-toggle"><i class="fa fa-bars"></i></button>
      <span class="admin-topbar-title">Contratos</span>
    </div>
    <div class="container-fluid">
      <!-- Filtros -->
      <div class="row" style="margin-bottom:12px">
        <div class="col-sm-3">
          <input type="text" class="form-control" id="busca" placeholder="Buscar cliente...">
        </div>
        <div class="col-sm-2">
          <select class="form-control" id="filtro-status">
            <option value="">Todos os status</option>
            <option value="RASCUNHO">Rascunho</option>
            <option value="AGUARDANDO_ASSINATURA">Aguardando Assinatura</option>
            <option value="ASSINADO">Assinado</option>
            <option value="CANCELADO">Cancelado</option>
          </select>
        </div>
        <div class="col-sm-2">
          <select class="form-control" id="filtro-tipo">
            <option value="">Todos os tipos</option>
            <option value="PF_COM_ASSISTENCIA">PF c/ Assistência</option>
            <option value="PF_SEM_ASSISTENCIA">PF s/ Assistência</option>
            <option value="PJ_COM_ASSISTENCIA">PJ c/ Assistência</option>
            <option value="PJ_SEM_ASSISTENCIA">PJ s/ Assistência</option>
          </select>
        </div>
        <div class="col-sm-2">
          <button class="btn btn-default" id="btn-filtrar"><i class="fa fa-search"></i> Filtrar</button>
        </div>
        <div class="col-sm-3 text-right">
          <a href="contrato-form.html" class="btn btn-primary" id="btn-novo"><i class="fa fa-plus"></i> Novo Contrato</a>
        </div>
      </div>
      <!-- Tabela -->
      <div class="table-responsive">
        <table class="table table-striped table-hover">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Criado em</th>
              <th>Criado por</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="tbody-contratos">
            <tr><td colspan="6" class="text-center text-muted" style="padding:24px">Carregando...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script src="../js/jquery.min.js"></script>
  <script src="../js/bootstrap.min.js"></script>
  <script src="../js/auth-guard.js"></script>
  <script>
    var _adminBase = '/AgillockSite/admin/contratos.html';
    var AL_ROLE_REQUIRED = ['ADMIN'];

    var TIPO_LABEL = {
      PF_COM_ASSISTENCIA: 'PF c/ Assistência',
      PF_SEM_ASSISTENCIA: 'PF s/ Assistência',
      PJ_COM_ASSISTENCIA: 'PJ c/ Assistência',
      PJ_SEM_ASSISTENCIA: 'PJ s/ Assistência',
    };

    var STATUS_BADGE = {
      RASCUNHO: '<span class="label label-default">Rascunho</span>',
      AGUARDANDO_ASSINATURA: '<span class="label label-warning">Aguardando Assinatura</span>',
      ASSINADO: '<span class="label label-success">Assinado</span>',
      CANCELADO: '<span class="label label-danger">Cancelado</span>',
    };

    var userPerms = {};

    window.AL.onReady(function(user) {
      userPerms = user;
      if (!user.podeCriarContrato && user.role !== 'ADMIN') {
        document.getElementById('btn-novo').style.display = 'none';
      }
      carregarContratos();
      window.AL.initThemeToggle('btn-tema');
      document.getElementById('btn-logout').onclick = function() { window.AL.logout(); };
      document.getElementById('sidebar-toggle').addEventListener('click', function() {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebar-overlay').classList.toggle('open');
      });
      document.getElementById('sidebar-overlay').addEventListener('click', function() {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('open');
      });
      document.getElementById('btn-filtrar').onclick = carregarContratos;
      document.getElementById('busca').addEventListener('keypress', function(e) { if (e.which === 13) carregarContratos(); });
    });

    function carregarContratos() {
      var params = new URLSearchParams();
      var busca = document.getElementById('busca').value.trim();
      var status = document.getElementById('filtro-status').value;
      var tipo = document.getElementById('filtro-tipo').value;
      if (busca) params.set('busca', busca);
      if (status) params.set('status', status);
      if (tipo) params.set('tipo', tipo);
      window.AL.apiGet('/api/contratos?' + params.toString(), function(contratos) {
        renderTabela(contratos);
      }, function(err) {
        document.getElementById('tbody-contratos').innerHTML = '<tr><td colspan="6" class="text-center text-danger">Erro ao carregar contratos.</td></tr>';
      });
    }

    function renderTabela(contratos) {
      var tbody = document.getElementById('tbody-contratos');
      if (!contratos.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px">Nenhum contrato encontrado.</td></tr>';
        return;
      }
      var html = '';
      contratos.forEach(function(c) {
        var isAdmin = userPerms.role === 'ADMIN';
        var acoes = '<a href="contrato-form.html?id=' + c.id + '" class="btn btn-xs btn-default" title="Ver/Editar"><i class="fa fa-eye"></i></a> ';
        if (c.status === 'RASCUNHO' && (isAdmin || userPerms.podeExcluirContrato)) {
          acoes += '<button class="btn btn-xs btn-danger btn-excluir" data-id="' + c.id + '" title="Excluir"><i class="fa fa-trash"></i></button> ';
        }
        if (c.status === 'AGUARDANDO_ASSINATURA' && (isAdmin || userPerms.podeEditarContrato)) {
          acoes += '<button class="btn btn-xs btn-warning btn-cancelar" data-id="' + c.id + '" title="Cancelar"><i class="fa fa-times"></i></button>';
        }
        html += '<tr><td>' + window.AL.escHtml(c.cliente.nome) + '</td>'
             + '<td>' + (TIPO_LABEL[c.tipo] || c.tipo) + '</td>'
             + '<td>' + (STATUS_BADGE[c.status] || c.status) + '</td>'
             + '<td>' + window.AL.fmtDate(c.createdAt) + '</td>'
             + '<td>' + window.AL.escHtml(c.criadoPor.nome) + '</td>'
             + '<td>' + acoes + '</td></tr>';
      });
      tbody.innerHTML = html;

      tbody.querySelectorAll('.btn-excluir').forEach(function(btn) {
        btn.onclick = function() {
          var id = btn.dataset.id;
          if (!confirm('Excluir este rascunho?')) return;
          window.AL.apiDelete('/api/contratos/' + id, function() {
            window.AL.showAlert('Contrato excluído.', 'success');
            carregarContratos();
          }, function(err) { window.AL.showAlert(err.message, 'danger'); });
        };
      });
      tbody.querySelectorAll('.btn-cancelar').forEach(function(btn) {
        btn.onclick = function() {
          var id = btn.dataset.id;
          if (!confirm('Cancelar este contrato no ClickSign?')) return;
          window.AL.apiPost('/api/contratos/' + id + '/cancelar', {}, function() {
            window.AL.showAlert('Contrato cancelado.', 'success');
            carregarContratos();
          }, function(err) { window.AL.showAlert(err.message, 'danger'); });
        };
      });
    }
  </script>
</body>
</html>
```

> **Nota sobre `window.AL.escHtml`:** Verificar se essa função existe em `auth-guard.js`. Se não existir, implementar inline: `function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }` e usar `escHtml()` no lugar de `window.AL.escHtml()`.

- [ ] **Step 2: Criar AgillockSite/colaborador/contratos.html**

Mesma estrutura. Diferenças:
- Sidebar colaborador (sem Dashboard, Colaboradores, Vendedores, Configurações)
- `AL_ROLE_REQUIRED = ['COLABORADOR']`
- Verificação de permissão usa `user.podeCriarContrato`

```html
<!-- Sidebar colaborador -->
<ul class="sidebar-nav">
  <li><a href="clientes.html"><i class="fa fa-users fa-fw"></i> Clientes</a></li>
  <li><a href="dispositivos.html"><i class="fa fa-microchip fa-fw"></i> Dispositivos</a></li>
  <li><a href="gerar-cobranca.html"><i class="fa fa-file-text fa-fw"></i> Gerar Cobrança</a></li>
  <li><a href="cobrancas.html"><i class="fa fa-money fa-fw"></i> Cobranças</a></li>
  <li class="active"><a href="contratos.html"><i class="fa fa-pencil-square-o fa-fw"></i> Contratos</a></li>
</ul>
```

Resto da lógica JS idêntico ao admin.

- [ ] **Step 3: Testar no browser**

Abrir `admin/contratos.html` com o Live Server. Confirmar que:
- A tabela carrega (vazia é OK se não há contratos ainda)
- O botão "Novo Contrato" está visível
- Sem erros no console

- [ ] **Step 4: Commit**

```bash
git add AgillockSite/admin/contratos.html AgillockSite/colaborador/contratos.html
git commit -m "feat: add contratos list pages for admin and colaborador"
```

---

## Task 10: Criar contrato-form.html (wizard) — admin e colaborador

**Files:**
- Create: `AgillockSite/admin/contrato-form.html`
- Create: `AgillockSite/colaborador/contrato-form.html`

- [ ] **Step 1: Criar AgillockSite/admin/contrato-form.html**

Seguir o padrão de `admin/gerar-cobranca.html` (wizard com steps, Bootstrap 3):

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Contrato — AgilLock</title>
  <script>
    (function(){var t=localStorage.getItem('al-theme');if(t==='dark')document.documentElement.classList.add('dark-theme');})();
  </script>
  <link rel="stylesheet" href="../css/bootstrap.min.css">
  <link rel="stylesheet" href="../css/font-awesome.min.css">
  <link rel="stylesheet" href="../css/admin.css">
  <style>
    /* Wizard steps */
    .wizard-steps { display:flex; margin-bottom:24px; border-bottom:2px solid #ddd; }
    .wizard-step  { flex:1; text-align:center; padding:12px; cursor:pointer; color:#aaa; border-bottom:2px solid transparent; margin-bottom:-2px; }
    .wizard-step.active { color:#337ab7; border-bottom-color:#337ab7; font-weight:bold; }
    .wizard-step.done   { color:#5cb85c; }
    .step-panel { display:none; }
    .step-panel.active { display:block; }
    /* Tipo cards */
    .tipo-card { cursor:pointer; border:2px solid #ddd; border-radius:8px; padding:16px; text-align:center; transition:border-color .2s; }
    .tipo-card:hover { border-color:#337ab7; }
    .tipo-card.selected { border-color:#337ab7; background:#eaf3fb; }
    .tipo-card .fa { font-size:28px; color:#337ab7; margin-bottom:8px; }
    /* Fiador block */
    .fiador-block { border:1px solid #ddd; border-radius:6px; padding:12px; margin-bottom:12px; }
    /* Preview */
    #div-preview { border:1px solid #ddd; padding:16px; min-height:200px; background:#fff; overflow-y:auto; max-height:600px; }
    /* Signatarios panel */
    #panel-signatarios { display:none; }
  </style>
</head>
<body>
  <!-- Sidebar (copiar de contratos.html, sem active em Contratos pois estamos no form) -->
  <div class="admin-sidebar" id="sidebar">
    <div class="sidebar-brand">
      <img src="../img/logo_agillock_white_new.png" alt="AgilLock" style="height:36px;vertical-align:middle;" onerror="this.style.display='none'" />
    </div>
    <ul class="sidebar-nav">
      <li><a href="dashboard.html"><i class="fa fa-tachometer fa-fw"></i> Dashboard</a></li>
      <li><a href="clientes.html"><i class="fa fa-users fa-fw"></i> Clientes</a></li>
      <li><a href="dispositivos.html"><i class="fa fa-microchip fa-fw"></i> Dispositivos</a></li>
      <li><a href="gerar-cobranca.html"><i class="fa fa-file-text fa-fw"></i> Gerar Cobrança</a></li>
      <li><a href="cobrancas.html"><i class="fa fa-money fa-fw"></i> Cobranças</a></li>
      <li class="active"><a href="contratos.html"><i class="fa fa-pencil-square-o fa-fw"></i> Contratos</a></li>
      <li><a href="colaboradores.html"><i class="fa fa-user fa-fw"></i> Colaboradores</a></li>
      <li><a href="vendedores.html"><i class="fa fa-handshake-o fa-fw"></i> Vendedores</a></li>
      <li><a href="configuracoes.html"><i class="fa fa-cog fa-fw"></i> Configurações</a></li>
    </ul>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <span id="user-nome" class="sidebar-user-nome">—</span>
        <span id="user-badge" class="al-badge" style="margin-top:4px;"></span>
      </div>
      <button id="btn-tema" class="btn-tema-sidebar"></button>
      <button id="btn-logout" class="btn btn-link btn-logout">Sair</button>
    </div>
  </div>
  <div class="sidebar-overlay" id="sidebar-overlay"></div>

  <div class="admin-content">
    <div class="admin-topbar">
      <button class="sidebar-toggle" id="sidebar-toggle"><i class="fa fa-bars"></i></button>
      <span class="admin-topbar-title" id="topbar-title">Novo Contrato</span>
      <a href="contratos.html" class="btn btn-default btn-sm" style="margin-left:auto"><i class="fa fa-arrow-left"></i> Voltar</a>
    </div>
    <div class="container-fluid">

      <!-- Wizard Steps -->
      <div class="wizard-steps" id="wizard-steps">
        <div class="wizard-step active" data-step="1"><span class="badge">1</span> Tipo e Partes</div>
        <div class="wizard-step" data-step="2"><span class="badge">2</span> Testemunhas</div>
        <div class="wizard-step" data-step="3"><span class="badge">3</span> Prévia e Assinatura</div>
      </div>

      <!-- Step 1: Tipo, Cliente, Fiadores -->
      <div class="step-panel active" id="step-1">
        <h4>Tipo de Contrato</h4>
        <div class="row" id="tipos-container">
          <div class="col-sm-3">
            <div class="tipo-card" data-tipo="PF_COM_ASSISTENCIA">
              <i class="fa fa-user"></i>
              <div><strong>PF</strong></div>
              <small>Com Assistência Veicular</small>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="tipo-card" data-tipo="PF_SEM_ASSISTENCIA">
              <i class="fa fa-user-o"></i>
              <div><strong>PF</strong></div>
              <small>Sem Assistência Veicular</small>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="tipo-card" data-tipo="PJ_COM_ASSISTENCIA">
              <i class="fa fa-building"></i>
              <div><strong>PJ</strong></div>
              <small>Com Assistência Veicular</small>
            </div>
          </div>
          <div class="col-sm-3">
            <div class="tipo-card" data-tipo="PJ_SEM_ASSISTENCIA">
              <i class="fa fa-building-o"></i>
              <div><strong>PJ</strong></div>
              <small>Sem Assistência Veicular</small>
            </div>
          </div>
        </div>

        <hr>
        <h4>Cliente</h4>
        <div class="row">
          <div class="col-sm-6">
            <div class="form-group">
              <label>Buscar cliente</label>
              <input type="text" class="form-control" id="busca-cliente" placeholder="Digite o nome ou CPF/CNPJ...">
            </div>
          </div>
        </div>
        <div id="lista-clientes" style="display:none; max-height:200px; overflow-y:auto; border:1px solid #ddd; border-radius:4px; margin-bottom:12px;"></div>
        <div id="cliente-selecionado" style="display:none" class="alert alert-info">
          <strong id="cliente-nome">—</strong> <button type="button" class="btn btn-xs btn-default" id="btn-trocar-cliente">Trocar</button>
        </div>

        <!-- Fiadores (só PJ) -->
        <div id="bloco-fiadores" style="display:none">
          <hr>
          <h4>Fiadores</h4>
          <div class="form-group">
            <label>Número de fiadores</label>
            <select class="form-control" id="num-fiadores" style="width:auto">
              <option value="0">0 fiadores</option>
              <option value="1">1 fiador</option>
              <option value="2">2 fiadores</option>
              <option value="3">3 fiadores</option>
            </select>
          </div>
          <div id="fiadores-container"></div>
        </div>

        <hr>
        <h4>Método de Autenticação ClickSign</h4>
        <div class="form-group">
          <select class="form-control" id="metodo-autenticacao" style="width:auto">
            <option value="token_email">Token por e-mail</option>
            <option value="token_whatsapp">Token por WhatsApp</option>
            <option value="token_sms">Token por SMS</option>
            <option value="handwritten">Assinatura manuscrita</option>
          </select>
        </div>

        <button class="btn btn-primary" id="btn-step1-next">Próximo <i class="fa fa-arrow-right"></i></button>
      </div>

      <!-- Step 2: Testemunhas -->
      <div class="step-panel" id="step-2">
        <h4>Testemunhas</h4>
        <p class="text-muted">Preencha os dados das 2 testemunhas do contrato.</p>

        <div class="panel panel-default">
          <div class="panel-heading"><strong>Testemunha 1</strong></div>
          <div class="panel-body">
            <div class="row">
              <div class="col-sm-6"><div class="form-group"><label>Nome *</label><input type="text" class="form-control" id="t1-nome"></div></div>
              <div class="col-sm-6"><div class="form-group"><label>CPF *</label><input type="text" class="form-control" id="t1-cpf" maxlength="14"></div></div>
            </div>
            <div class="row">
              <div class="col-sm-6"><div class="form-group"><label>E-mail *</label><input type="email" class="form-control" id="t1-email"></div></div>
              <div class="col-sm-6"><div class="form-group"><label>Telefone *</label><input type="text" class="form-control" id="t1-telefone" maxlength="15"></div></div>
            </div>
            <div class="checkbox"><label><input type="checkbox" id="t1-digital"> Assinar digitalmente pelo ClickSign</label></div>
          </div>
        </div>

        <div class="panel panel-default">
          <div class="panel-heading"><strong>Testemunha 2</strong></div>
          <div class="panel-body">
            <div class="row">
              <div class="col-sm-6"><div class="form-group"><label>Nome *</label><input type="text" class="form-control" id="t2-nome"></div></div>
              <div class="col-sm-6"><div class="form-group"><label>CPF *</label><input type="text" class="form-control" id="t2-cpf" maxlength="14"></div></div>
            </div>
            <div class="row">
              <div class="col-sm-6"><div class="form-group"><label>E-mail *</label><input type="email" class="form-control" id="t2-email"></div></div>
              <div class="col-sm-6"><div class="form-group"><label>Telefone *</label><input type="text" class="form-control" id="t2-telefone" maxlength="15"></div></div>
            </div>
            <div class="checkbox"><label><input type="checkbox" id="t2-digital"> Assinar digitalmente pelo ClickSign</label></div>
          </div>
        </div>

        <button class="btn btn-default" id="btn-step2-prev"><i class="fa fa-arrow-left"></i> Anterior</button>
        <button class="btn btn-primary" id="btn-step2-next">Próximo <i class="fa fa-arrow-right"></i></button>
      </div>

      <!-- Step 3: Prévia e Assinatura -->
      <div class="step-panel" id="step-3">
        <div style="margin-bottom:12px">
          <button class="btn btn-default" id="btn-gerar-previa"><i class="fa fa-eye"></i> Gerar Prévia</button>
          <button class="btn btn-default" id="btn-salvar-rascunho"><i class="fa fa-save"></i> Salvar Rascunho</button>
          <button class="btn btn-success" id="btn-enviar-assinatura" disabled><i class="fa fa-send"></i> Enviar para Assinatura</button>
          <span id="spinner-envio" style="display:none"><i class="fa fa-spinner fa-spin"></i> Processando PDF e ClickSign...</span>
        </div>

        <div id="div-preview" contenteditable="false">
          <p class="text-muted text-center" style="margin-top:40px">Clique em "Gerar Prévia" para visualizar o contrato preenchido.</p>
        </div>

        <!-- Painel de signatários (após envio bem-sucedido) -->
        <div id="panel-signatarios" class="panel panel-success" style="margin-top:24px">
          <div class="panel-heading"><i class="fa fa-check"></i> <strong>Contrato enviado para assinatura!</strong></div>
          <div class="panel-body">
            <p class="text-muted">Compartilhe os links de assinatura com cada signatário:</p>
            <table class="table table-striped">
              <thead><tr><th>Signatário</th><th>Papel</th><th>Ações</th></tr></thead>
              <tbody id="tbody-signatarios"></tbody>
            </table>
          </div>
        </div>

        <div style="margin-top:12px">
          <button class="btn btn-default" id="btn-step3-prev"><i class="fa fa-arrow-left"></i> Anterior</button>
        </div>
      </div>

    </div>
  </div>

  <script src="../js/jquery.min.js"></script>
  <script src="../js/bootstrap.min.js"></script>
  <script src="../js/auth-guard.js"></script>
  <script>
    var _adminBase = '/AgillockSite/admin/contrato-form.html';
    var AL_ROLE_REQUIRED = ['ADMIN'];

    var state = {
      contratoId: null,
      tipo: null,
      clienteId: null,
      clienteObj: null,
      fiadores: [],
      metodoAutenticacao: 'token_email',
      htmlConteudo: null,
      previaGerada: false,
    };

    var params = new URLSearchParams(window.location.search);
    var editId = params.get('id');

    window.AL.onReady(function(user) {
      window.AL.initThemeToggle('btn-tema');
      document.getElementById('btn-logout').onclick = function() { window.AL.logout(); };
      document.getElementById('sidebar-toggle').addEventListener('click', function() {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebar-overlay').classList.toggle('open');
      });
      document.getElementById('sidebar-overlay').addEventListener('click', function() {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('open');
      });

      if (editId) {
        document.getElementById('topbar-title').textContent = 'Editar Contrato';
        state.contratoId = editId;
        carregarContrato(editId);
      }
      initWizard();
    });

    function initWizard() {
      // Tipo cards
      document.querySelectorAll('.tipo-card').forEach(function(card) {
        card.addEventListener('click', function() {
          document.querySelectorAll('.tipo-card').forEach(function(c) { c.classList.remove('selected'); });
          card.classList.add('selected');
          state.tipo = card.dataset.tipo;
          var isPJ = state.tipo && state.tipo.startsWith('PJ');
          document.getElementById('bloco-fiadores').style.display = isPJ ? '' : 'none';
        });
      });

      // Busca cliente
      var buscaTimer;
      document.getElementById('busca-cliente').addEventListener('input', function() {
        clearTimeout(buscaTimer);
        var q = this.value.trim();
        if (q.length < 2) { document.getElementById('lista-clientes').style.display = 'none'; return; }
        buscaTimer = setTimeout(function() { buscarClientes(q); }, 300);
      });

      // Fiadores
      document.getElementById('num-fiadores').addEventListener('change', function() {
        renderFiadores(parseInt(this.value));
      });

      // Navegação wizard
      document.getElementById('btn-step1-next').onclick = function() {
        if (!state.tipo) { window.AL.showAlert('Selecione o tipo de contrato.', 'warning'); return; }
        if (!state.clienteId) { window.AL.showAlert('Selecione um cliente.', 'warning'); return; }
        state.fiadores = coletarFiadores();
        irParaStep(2);
      };
      document.getElementById('btn-step2-prev').onclick = function() { irParaStep(1); };
      document.getElementById('btn-step2-next').onclick = function() {
        var ts = coletarTestemunhas();
        if (!ts) return;
        state.testemunhas = ts;
        irParaStep(3);
      };
      document.getElementById('btn-step3-prev').onclick = function() { irParaStep(2); };

      // Prévia
      document.getElementById('btn-gerar-previa').onclick = gerarPrevia;

      // Salvar rascunho
      document.getElementById('btn-salvar-rascunho').onclick = salvarRascunho;

      // Enviar assinatura
      document.getElementById('btn-enviar-assinatura').onclick = enviarAssinatura;

      // Editable preview
      document.getElementById('div-preview').addEventListener('input', function() {
        state.htmlConteudo = this.innerHTML;
      });
    }

    function irParaStep(n) {
      document.querySelectorAll('.step-panel').forEach(function(p) { p.classList.remove('active'); });
      document.getElementById('step-' + n).classList.add('active');
      document.querySelectorAll('.wizard-step').forEach(function(s) {
        var sn = parseInt(s.dataset.step);
        s.classList.remove('active', 'done');
        if (sn === n) s.classList.add('active');
        if (sn < n) s.classList.add('done');
      });
    }

    function buscarClientes(q) {
      window.AL.apiGet('/api/clientes?busca=' + encodeURIComponent(q), function(data) {
        var lista = document.getElementById('lista-clientes');
        if (!data.length) { lista.style.display = 'none'; return; }
        var html = '';
        data.forEach(function(c) {
          html += '<div class="cliente-item" data-id="' + c.id + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #eee">'
               + '<strong>' + window.AL.escHtml(c.nome) + '</strong>'
               + (c.cpfCnpj ? ' <small class="text-muted">' + window.AL.fmtCpfCnpj(c.cpfCnpj) + '</small>' : '')
               + ' <span class="label ' + (c.tipoPessoa === 'PJ' ? 'label-warning' : 'label-info') + '">' + (c.tipoPessoa || 'PF') + '</span>'
               + '</div>';
        });
        lista.innerHTML = html;
        lista.style.display = '';
        lista.querySelectorAll('.cliente-item').forEach(function(item) {
          item.addEventListener('click', function() {
            var id = item.dataset.id;
            var cliente = data.find(function(c) { return c.id === id; });
            selecionarCliente(cliente);
          });
        });
      });
    }

    function selecionarCliente(cliente) {
      state.clienteId = cliente.id;
      state.clienteObj = cliente;
      document.getElementById('lista-clientes').style.display = 'none';
      document.getElementById('busca-cliente').value = '';
      document.getElementById('cliente-nome').textContent = cliente.nome + (cliente.cpfCnpj ? ' — ' + window.AL.fmtCpfCnpj(cliente.cpfCnpj) : '');
      document.getElementById('cliente-selecionado').style.display = '';
      // Auto-selecionar tipo compatível
      var isPJ = cliente.tipoPessoa === 'PJ';
      document.getElementById('bloco-fiadores').style.display = isPJ ? '' : 'none';
      // Ocultar cards incompatíveis
      document.querySelectorAll('.tipo-card').forEach(function(card) {
        var tipoIsPJ = card.dataset.tipo.startsWith('PJ');
        card.style.display = (isPJ === tipoIsPJ) ? '' : 'none';
        if (state.tipo && card.dataset.tipo === state.tipo && isPJ !== tipoIsPJ) {
          card.classList.remove('selected');
          state.tipo = null;
        }
      });
    }

    document.addEventListener('DOMContentLoaded', function() {
      document.getElementById('btn-trocar-cliente') && (document.getElementById('btn-trocar-cliente').onclick = function() {
        state.clienteId = null; state.clienteObj = null;
        document.getElementById('cliente-selecionado').style.display = 'none';
        document.querySelectorAll('.tipo-card').forEach(function(c) { c.style.display = ''; });
      });
    });

    function renderFiadores(n) {
      var container = document.getElementById('fiadores-container');
      var html = '';
      for (var i = 1; i <= n; i++) {
        html += '<div class="fiador-block"><h5>Fiador ' + i + '</h5>'
          + '<div class="row">'
          + '<div class="col-sm-6"><div class="form-group"><label>Nome *</label><input type="text" class="form-control fiador-nome" data-idx="' + i + '"></div></div>'
          + '<div class="col-sm-6"><div class="form-group"><label>CPF *</label><input type="text" class="form-control fiador-cpf" data-idx="' + i + '" maxlength="14"></div></div>'
          + '</div>'
          + '<div class="row">'
          + '<div class="col-sm-3"><div class="form-group"><label>RG</label><input type="text" class="form-control fiador-rg" data-idx="' + i + '"></div></div>'
          + '<div class="col-sm-3"><div class="form-group"><label>Profissão</label><input type="text" class="form-control fiador-profissao" data-idx="' + i + '"></div></div>'
          + '<div class="col-sm-3"><div class="form-group"><label>Estado Civil</label><input type="text" class="form-control fiador-estadocivil" data-idx="' + i + '"></div></div>'
          + '<div class="col-sm-3"><div class="form-group"><label>Nascimento</label><input type="date" class="form-control fiador-nascimento" data-idx="' + i + '"></div></div>'
          + '</div>'
          + '<div class="row">'
          + '<div class="col-sm-6"><div class="form-group"><label>E-mail</label><input type="email" class="form-control fiador-email" data-idx="' + i + '"></div></div>'
          + '<div class="col-sm-6"><div class="form-group"><label>Telefone</label><input type="text" class="form-control fiador-telefone" data-idx="' + i + '" maxlength="15"></div></div>'
          + '</div>'
          + '<div class="row">'
          + '<div class="col-sm-4"><div class="form-group"><label>CEP</label><input type="text" class="form-control fiador-cep" data-idx="' + i + '" maxlength="9"></div></div>'
          + '<div class="col-sm-5"><div class="form-group"><label>Logradouro</label><input type="text" class="form-control fiador-logradouro" data-idx="' + i + '"></div></div>'
          + '<div class="col-sm-3"><div class="form-group"><label>Número</label><input type="text" class="form-control fiador-numero" data-idx="' + i + '"></div></div>'
          + '</div>'
          + '<div class="row">'
          + '<div class="col-sm-4"><div class="form-group"><label>Bairro</label><input type="text" class="form-control fiador-bairro" data-idx="' + i + '"></div></div>'
          + '<div class="col-sm-4"><div class="form-group"><label>Cidade</label><input type="text" class="form-control fiador-cidade" data-idx="' + i + '"></div></div>'
          + '<div class="col-sm-2"><div class="form-group"><label>UF</label><input type="text" class="form-control fiador-estado" data-idx="' + i + '" maxlength="2"></div></div>'
          + '</div>'
          + '</div>';
      }
      container.innerHTML = html;
    }

    function coletarFiadores() {
      var fiadores = [];
      document.querySelectorAll('.fiador-block').forEach(function(block) {
        var idx = block.querySelector('.fiador-nome').dataset.idx;
        var f = {
          nome:          block.querySelector('.fiador-nome').value.trim(),
          cpf:           block.querySelector('.fiador-cpf').value.trim(),
          rg:            block.querySelector('.fiador-rg').value.trim(),
          profissao:     block.querySelector('.fiador-profissao').value.trim(),
          estadoCivil:   block.querySelector('.fiador-estadocivil').value.trim(),
          dataNascimento: block.querySelector('.fiador-nascimento').value,
          email:         block.querySelector('.fiador-email').value.trim(),
          telefone:      block.querySelector('.fiador-telefone').value.trim(),
          cep:           block.querySelector('.fiador-cep').value.trim(),
          logradouro:    block.querySelector('.fiador-logradouro').value.trim(),
          numero:        block.querySelector('.fiador-numero').value.trim(),
          bairro:        block.querySelector('.fiador-bairro').value.trim(),
          cidade:        block.querySelector('.fiador-cidade').value.trim(),
          estado:        block.querySelector('.fiador-estado').value.trim(),
        };
        if (!f.nome || !f.cpf) { window.AL.showAlert('Preencha nome e CPF de todos os fiadores.', 'warning'); return; }
        fiadores.push(f);
      });
      return fiadores;
    }

    function coletarTestemunhas() {
      var ts = [
        {
          nome: document.getElementById('t1-nome').value.trim(),
          cpf:  document.getElementById('t1-cpf').value.trim(),
          email: document.getElementById('t1-email').value.trim(),
          telefone: document.getElementById('t1-telefone').value.trim(),
          assinarDigital: document.getElementById('t1-digital').checked,
        },
        {
          nome: document.getElementById('t2-nome').value.trim(),
          cpf:  document.getElementById('t2-cpf').value.trim(),
          email: document.getElementById('t2-email').value.trim(),
          telefone: document.getElementById('t2-telefone').value.trim(),
          assinarDigital: document.getElementById('t2-digital').checked,
        },
      ];
      for (var i = 0; i < ts.length; i++) {
        if (!ts[i].nome || !ts[i].cpf || !ts[i].email || !ts[i].telefone) {
          window.AL.showAlert('Preencha todos os campos das testemunhas (nome, CPF, e-mail, telefone).', 'warning');
          return null;
        }
      }
      return ts;
    }

    function coletarTestemunhasDoForm() {
      return [
        {
          nome: document.getElementById('t1-nome').value.trim(),
          cpf:  document.getElementById('t1-cpf').value.trim(),
          email: document.getElementById('t1-email').value.trim(),
          telefone: document.getElementById('t1-telefone').value.trim(),
          assinarDigital: document.getElementById('t1-digital').checked,
        },
        {
          nome: document.getElementById('t2-nome').value.trim(),
          cpf:  document.getElementById('t2-cpf').value.trim(),
          email: document.getElementById('t2-email').value.trim(),
          telefone: document.getElementById('t2-telefone').value.trim(),
          assinarDigital: document.getElementById('t2-digital').checked,
        },
      ];
    }

    function gerarPrevia() {
      if (!state.clienteObj) { window.AL.showAlert('Selecione um cliente antes de gerar a prévia.', 'warning'); return; }
      var ts = coletarTestemunhasDoForm();
      var payload = {
        tipo: state.tipo,
        cliente: state.clienteObj,
        fiadores: state.fiadores,
        testemunhas: ts,
        representante: {},  // backend busca das configurações na prévia se precisar — ou pode omitir
      };
      window.AL.apiPost('/api/contratos/preview', payload, function(data) {
        var div = document.getElementById('div-preview');
        div.innerHTML = data.html;
        div.contentEditable = 'true';
        state.htmlConteudo = data.html;
        state.previaGerada = true;
        document.getElementById('btn-enviar-assinatura').disabled = false;
        window.AL.showAlert('Prévia gerada. Você pode editar o texto antes de enviar.', 'info');
      }, function(err) {
        window.AL.showAlert('Erro ao gerar prévia: ' + err.message, 'danger');
      });
    }

    function salvarRascunho() {
      if (!state.htmlConteudo) { window.AL.showAlert('Gere a prévia antes de salvar.', 'warning'); return; }
      var ts = coletarTestemunhasDoForm();
      var payload = {
        tipo: state.tipo,
        clienteId: state.clienteId,
        fiadores: state.fiadores,
        testemunhas: ts,
        htmlConteudo: document.getElementById('div-preview').innerHTML || state.htmlConteudo,
        metodoAutenticacao: document.getElementById('metodo-autenticacao').value,
      };
      if (state.contratoId) {
        window.AL.apiPut('/api/contratos/' + state.contratoId, payload, function(data) {
          window.AL.showAlert('Rascunho salvo.', 'success');
        }, function(err) { window.AL.showAlert(err.message, 'danger'); });
      } else {
        window.AL.apiPost('/api/contratos', payload, function(data) {
          state.contratoId = data.id;
          window.AL.showAlert('Rascunho salvo.', 'success');
          window.history.replaceState({}, '', '?id=' + data.id);
        }, function(err) { window.AL.showAlert(err.message, 'danger'); });
      }
    }

    function enviarAssinatura() {
      if (!state.htmlConteudo && !document.getElementById('div-preview').innerHTML.trim()) {
        window.AL.showAlert('Gere a prévia antes de enviar.', 'warning'); return;
      }
      document.getElementById('btn-enviar-assinatura').disabled = true;
      document.getElementById('spinner-envio').style.display = '';

      var ts = coletarTestemunhasDoForm();
      var payload = {
        tipo: state.tipo,
        clienteId: state.clienteId,
        fiadores: state.fiadores,
        testemunhas: ts,
        htmlConteudo: document.getElementById('div-preview').innerHTML || state.htmlConteudo,
        metodoAutenticacao: document.getElementById('metodo-autenticacao').value,
      };

      var afterSave = function(contratoId) {
        window.AL.apiPost('/api/contratos/' + contratoId + '/enviar', {}, function(data) {
          document.getElementById('spinner-envio').style.display = 'none';
          renderSignatarios(data.signatarios);
        }, function(err) {
          document.getElementById('spinner-envio').style.display = 'none';
          document.getElementById('btn-enviar-assinatura').disabled = false;
          window.AL.showAlert('Erro: ' + err.message, 'danger');
        });
      };

      if (state.contratoId) {
        window.AL.apiPut('/api/contratos/' + state.contratoId, payload, function() {
          afterSave(state.contratoId);
        }, function(err) {
          document.getElementById('spinner-envio').style.display = 'none';
          document.getElementById('btn-enviar-assinatura').disabled = false;
          window.AL.showAlert(err.message, 'danger');
        });
      } else {
        window.AL.apiPost('/api/contratos', payload, function(data) {
          state.contratoId = data.id;
          afterSave(data.id);
        }, function(err) {
          document.getElementById('spinner-envio').style.display = 'none';
          document.getElementById('btn-enviar-assinatura').disabled = false;
          window.AL.showAlert(err.message, 'danger');
        });
      }
    }

    var PAPEL_LABEL = { cliente: 'Cliente', socio: 'Sócio', fiador: 'Fiador', testemunha: 'Testemunha', agillock: 'AgilLock' };

    function renderSignatarios(signatarios) {
      document.getElementById('panel-signatarios').style.display = '';
      var html = '';
      (signatarios || []).forEach(function(s) {
        html += '<tr>'
          + '<td>' + window.AL.escHtml(s.nome) + '</td>'
          + '<td>' + (PAPEL_LABEL[s.tipo] || s.tipo) + '</td>'
          + '<td>'
          + '<button class="btn btn-xs btn-default" onclick="navigator.clipboard.writeText(\'' + s.link + '\');window.AL.showAlert(\'Link copiado!\',\'success\')"><i class="fa fa-copy"></i> Copiar</button> '
          + '</td>'
          + '</tr>';
      });
      document.getElementById('tbody-signatarios').innerHTML = html;
    }

    function carregarContrato(id) {
      window.AL.apiGet('/api/contratos/' + id, function(c) {
        // Selecionar tipo
        state.tipo = c.tipo;
        document.querySelectorAll('.tipo-card').forEach(function(card) {
          if (card.dataset.tipo === c.tipo) card.classList.add('selected');
        });
        // Carregar cliente
        window.AL.apiGet('/api/clientes/' + c.clienteId, function(cliente) {
          selecionarCliente(cliente);
        });
        // Fiadores
        state.fiadores = c.fiadores || [];
        // Metodo
        document.getElementById('metodo-autenticacao').value = c.metodoAutenticacao || 'token_email';
        // Testemunhas
        var ts = c.testemunhas || [];
        if (ts[0]) {
          document.getElementById('t1-nome').value = ts[0].nome || '';
          document.getElementById('t1-cpf').value  = ts[0].cpf  || '';
          document.getElementById('t1-email').value = ts[0].email || '';
          document.getElementById('t1-telefone').value = ts[0].telefone || '';
          document.getElementById('t1-digital').checked = !!ts[0].assinarDigital;
        }
        if (ts[1]) {
          document.getElementById('t2-nome').value = ts[1].nome || '';
          document.getElementById('t2-cpf').value  = ts[1].cpf  || '';
          document.getElementById('t2-email').value = ts[1].email || '';
          document.getElementById('t2-telefone').value = ts[1].telefone || '';
          document.getElementById('t2-digital').checked = !!ts[1].assinarDigital;
        }
        // HTML editável
        if (c.htmlConteudo) {
          var div = document.getElementById('div-preview');
          div.innerHTML = c.htmlConteudo;
          state.htmlConteudo = c.htmlConteudo;
          state.previaGerada = true;
          if (c.status === 'RASCUNHO') {
            div.contentEditable = 'true';
            document.getElementById('btn-enviar-assinatura').disabled = false;
          } else {
            div.contentEditable = 'false';
            document.getElementById('btn-gerar-previa').disabled = true;
            document.getElementById('btn-salvar-rascunho').disabled = true;
            document.getElementById('btn-enviar-assinatura').disabled = true;
          }
        }
        // Ir direto ao step 3
        irParaStep(3);
        // Se já enviado, mostrar signatários
        if (c.signatarios) renderSignatarios(c.signatarios);
      });
    }

    // Helper escHtml se não existir em auth-guard
    if (!window.AL.escHtml) {
      window.AL.escHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Criar AgillockSite/colaborador/contrato-form.html**

Mesma estrutura, com:
- Sidebar colaborador (sem Dashboard/Colaboradores/Vendedores/Configurações)
- `AL_ROLE_REQUIRED = ['COLABORADOR']`
- `_adminBase = '/AgillockSite/colaborador/contrato-form.html'`
- Href para `contratos.html` (sem `../admin/`)

- [ ] **Step 3: Testar fluxo completo no browser**

1. Abrir `admin/contrato-form.html`
2. Selecionar tipo PF
3. Buscar e selecionar um cliente
4. Avançar para step 2, preencher testemunhas
5. Avançar para step 3, clicar "Gerar Prévia"
6. Verificar que o HTML do contrato aparece editável
7. Clicar "Salvar Rascunho" e confirmar que o contrato aparece em `contratos.html`

- [ ] **Step 4: Commit**

```bash
git add AgillockSite/admin/contrato-form.html AgillockSite/colaborador/contrato-form.html
git commit -m "feat: add contrato-form wizard with 3 steps, preview and ClickSign integration"
```

---

## Task 11: Atualizar sidebars em todas as páginas existentes

**Files (admin):**
- Modify: `AgillockSite/admin/dashboard.html`
- Modify: `AgillockSite/admin/dispositivos.html`
- Modify: `AgillockSite/admin/gerar-cobranca.html`
- Modify: `AgillockSite/admin/cobrancas.html`
- Modify: `AgillockSite/admin/colaboradores.html`
- Modify: `AgillockSite/admin/vendedores.html`
- Modify: `AgillockSite/admin/configuracoes.html`
- Modify: `AgillockSite/admin/cliente-form.html`
- Modify: `AgillockSite/admin/cliente-detalhe.html`

**Files (colaborador):**
- Modify: `AgillockSite/colaborador/clientes.html`
- Modify: `AgillockSite/colaborador/dispositivos.html`
- Modify: `AgillockSite/colaborador/gerar-cobranca.html`
- Modify: `AgillockSite/colaborador/cobrancas.html`
- Modify: `AgillockSite/colaborador/cliente-form.html`
- Modify: `AgillockSite/colaborador/cliente-detalhe.html`

- [ ] **Step 1: Adicionar item Contratos na sidebar admin**

Em cada página admin listada acima, localizar o `<ul class="sidebar-nav">` e adicionar após o item "Cobranças":

```html
<li><a href="contratos.html"><i class="fa fa-pencil-square-o fa-fw"></i> Contratos</a></li>
```

- [ ] **Step 2: Adicionar item Contratos na sidebar colaborador**

Em cada página colaborador listada acima, localizar o `<ul class="sidebar-nav">` e adicionar após o item "Cobranças":

```html
<li><a href="contratos.html"><i class="fa fa-pencil-square-o fa-fw"></i> Contratos</a></li>
```

- [ ] **Step 3: Verificar no browser**

Abrir `admin/clientes.html` e `colaborador/clientes.html`. Confirmar que o item "Contratos" aparece na sidebar e que o link funciona.

- [ ] **Step 4: Commit**

```bash
git add AgillockSite/
git commit -m "feat: add Contratos sidebar item to all existing pages"
```

---

## Task 12: Variáveis de ambiente e finalização

**Files:**
- Modify: `backend/.env` (ou `.env.example`)

- [ ] **Step 1: Adicionar variáveis de ambiente ao .env.example**

```bash
# ClickSign
CLICKSIGN_ACCESS_TOKEN=     # gerado em sandbox.clicksign.com → Configurações → API
CLICKSIGN_BASE_URL=https://sandbox.clicksign.com
CLICKSIGN_WEBHOOK_SECRET=   # gerado ao registrar webhook no ClickSign
```

- [ ] **Step 2: Verificar build final**

```bash
cd backend
npm run build
```

Esperado: sem erros de compilação.

- [ ] **Step 3: Verificar health do servidor**

```bash
npm run dev
curl http://localhost:3000/api/health
```

Esperado: `{"status":"ok",...}`.

- [ ] **Step 4: Commit final**

```bash
git add backend/.env.example
git commit -m "feat: add ClickSign env vars to .env.example"
```

---

## Notas de Integração ClickSign

> Antes de testar em produção, verificar no sandbox:
> 1. Criar conta em sandbox.clicksign.com
> 2. Gerar `CLICKSIGN_ACCESS_TOKEN` em Configurações → API
> 3. Registrar webhook para `https://<seu-dominio>/api/webhooks/clicksign` e copiar o secret
> 4. Testar fluxo completo: criar contrato, enviar, abrir link de signatário, assinar
> 5. Validar que webhook chega e que o status muda para ASSINADO no DB

> Os nomes de eventos `envelope.closed` / `envelope.canceled` foram validados contra a documentação ClickSign v3. Validar contra payload real no sandbox antes de ir a produção.
