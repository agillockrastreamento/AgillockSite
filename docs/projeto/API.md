# API REST — Endpoints

Base URL: `https://api.agillock.com.br/api`

> **Importante**: O frontend (`agillock.com.br`) fica no GitHub Pages. A API precisa de um subdomínio separado (`api.agillock.com.br`) apontando para o Droplet no DigitalOcean via DNS. Em desenvolvimento local, usar `http://localhost:3000/api`.

Todas as rotas protegidas exigem header: `Authorization: Bearer <token>`

---

## Auth

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| POST | `/auth/login` | Login — retorna JWT | Público |
| GET | `/auth/me` | Dados do usuário logado | Autenticado |
| PATCH | `/auth/change-password` | Alterar senha do usuário logado | Autenticado |

> Logout é client-side: basta descartar o token no frontend.

### POST /auth/login
**Body:**
```json
{ "email": "agillockrastreamento@gmail.com", "senha": "SuaSenha" }
```
**Response:**
```json
{
  "token": "eyJ...",
  "user": { "id": "uuid", "nome": "Admin", "role": "ADMIN" }
}
```

---

### PATCH /auth/change-password
**Body:**
```json
{ "senhaAtual": "SenhaAntiga", "senhaNova": "SenhaNova123" }
```
- `senhaNova` deve ter pelo menos 6 caracteres.
- Retorna `{ message: "Senha alterada com sucesso." }`.

---

## Dashboard (ADMIN)

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| GET | `/dashboard` | Cards: clientes, placas, recebimentos do dia, atrasados | ADMIN |

**Response:**
```json
{
  "totalClientesAtivos": 120,
  "totalPlacasAtivas": 185,
  "recebimentosHoje": 4500.00,
  "totalAtrasados": 12
}
```

> `recebimentosHoje` é calculado no fuso horário do Brasil (UTC-3) — boletos com `dataPagamento` entre meia-noite e 23:59 BRT do dia atual.

---

## Clientes

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| GET | `/clientes` | Listar clientes | ADMIN, COLABORADOR (todos os clientes) |
| GET | `/clientes/:id` | Buscar cliente | ADMIN, COLABORADOR (acesso total) |
| POST | `/clientes` | Criar cliente | ADMIN, COLABORADOR |
| PUT | `/clientes/:id` | Editar cliente | ADMIN; COLABORADOR (requer `podeEditarCliente`) |
| DELETE | `/clientes/:id` | Excluir cliente | ADMIN; COLABORADOR (requer `podeExcluirCliente`) |
| PATCH | `/clientes/:id/status` | Ativar/inativar | ADMIN; COLABORADOR (requer `podeInativarCliente`) |

**Body POST/PUT:**
```json
{
  "nome": "João Silva",
  "cpfCnpj": "123.456.789-00",
  "telefone": "(85) 99999-9999",
  "email": "joao@email.com",
  "notas": "Cliente VIP",
  "vendedorId": "uuid-do-vendedor",
  "cep": "60000-000",
  "logradouro": "Rua das Flores",
  "numero": "123",
  "complemento": "Apt 4",
  "bairro": "Centro",
  "cidade": "Fortaleza",
  "estado": "CE"
}
```

> **Validações do POST**: `nome` é obrigatório. `cep`, `logradouro`, `numero`, `bairro`, `cidade` e `estado` são obrigatórios na criação — o backend retorna 400 se qualquer um estiver ausente. `email` é opcional (mas se informado, o EFI envia o boleto por e-mail ao cliente).

---

## Placas

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| GET | `/clientes/:id/placas` | Listar placas do cliente | ADMIN, COLABORADOR |
| POST | `/clientes/:id/placas` | Adicionar placa | ADMIN, COLABORADOR |
| PUT | `/placas/:id` | Editar placa | ADMIN, COLABORADOR |
| PATCH | `/placas/:id/status` | Ativar/inativar placa | ADMIN; COLABORADOR (requer `podeInativarPlaca`) |
| PATCH | `/placas/:id/valor` | Salvar valor mensal padrão da placa | ADMIN, COLABORADOR |
| DELETE | `/placas/:id` | Excluir placa | ADMIN; COLABORADOR (requer `podeExcluirPlaca`) |

### PATCH /placas/:id/valor
Salva o valor padrão mensal da placa (usado como pré-preenchimento no wizard de gerar cobrança).

**Body:**
```json
{ "valor": 75.00 }
```

---

## Carnês e Boletos

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| GET | `/clientes/:id/carnes` | Listar carnês do cliente com boletos | ADMIN, COLABORADOR |
| POST | `/carnes` | Gerar carnê individual (1 placa) | ADMIN, COLABORADOR |
| GET | `/carnes/:id/pdf` | Link para PDF do carnê | ADMIN, COLABORADOR |
| DELETE | `/carnes/:id` | Cancelar carnê (no EFI + banco) | ADMIN; COLABORADOR (requer `podeCancelarCarne`) |
| POST | `/carnes/unificar` | Unificar carnês individuais (automático) | ADMIN, COLABORADOR |
| POST | `/carnes/unificar-placas` | Criar boleto unificado com placas/valores explícitos | ADMIN, COLABORADOR |
| GET | `/boletos` | Listar boletos (plano — tela Cobranças) | ADMIN, COLABORADOR |
| GET | `/boletos/:id` | Detalhe do boleto (inclui `linkBoleto`) | ADMIN, COLABORADOR, VENDEDOR |
| PATCH | `/boletos/:id/editar` | Alterar vencimento/valor | ADMIN; COLABORADOR (requer `podeAlterarVencimento`) |
| PATCH | `/boletos/:id/baixa` | Dar baixa manual | ADMIN; COLABORADOR (requer `podeBaixaManual`) |

### GET /boletos — Tela de Cobranças
**Query params:** `?busca=texto&status=PAGO|ATRASADO|PENDENTE|CANCELADO|aberto|hoje&tipo=INDIVIDUAL|UNIFICADO&dataVencDe=YYYY-MM-DD&dataVencAte=YYYY-MM-DD`

- `busca`: nome do cliente, CPF/CNPJ (apenas dígitos) ou ID do carnê (prefixo `#`)
- `status=aberto`: inclui PENDENTE + ATRASADO; `status=hoje`: vencimento = hoje
- Retorna até 500 boletos, ordenados por vencimento ascendente
- Inclui `carne.cliente`, `placa` e `placasUnificadas`

---

> `GET /clientes/:id` também retorna os carnês. `GET /clientes/:id/carnes` é mais detalhado (inclui placas por boleto).
>
> VENDEDOR em `GET /boletos/:id` só acessa boletos de clientes associados a ele.

### GET /clientes/:id/carnes
Retorna todos os carnês do cliente com seus boletos. Cada boleto inclui `linkBoleto` (link direto para o boleto no EFI) e as placas associadas.

### POST /carnes — Gerar Carnê Individual
**Body:**
```json
{
  "clienteId": "uuid",
  "placaId": "uuid",
  "valor": 50.00,
  "dataVencimento": "2025-05-10",
  "numeroParcelas": 12,
  "vendedorId": "uuid-do-vendedor"
}
```
- `vendedorId` (opcional): vendedor responsável por esta venda. Se a placa ainda não tiver dono, ela é atribuída a este vendedor. Se omitido, usa o vendedor associado ao cliente.

**Response:** objeto `Carne` com array `boletos` (cada boleto com `efiChargeId` e `linkBoleto`).

Se o cliente já tiver carnê unificado ativo, o campo `avisoUnificado` é retornado com mensagem de alerta.

### POST /carnes/unificar-placas — Criar Boleto Unificado com Placas Explícitas
Cancela qualquer carnê unificado ativo e carnês individuais das placas informadas, depois cria um novo carnê unificado com os valores fornecidos.

**Body:**
```json
{
  "clienteId": "uuid",
  "placas": [
    { "placaId": "uuid-placa-1", "valor": 50.00 },
    { "placaId": "uuid-placa-2", "valor": 75.00 }
  ],
  "dataVencimento": "2025-05-10",
  "numeroParcelas": 12,
  "vendedorId": "uuid-do-vendedor"
}
```
- Mínimo 2 placas.
- `vendedorId` (opcional): atribuído como dono das placas que ainda não têm dono.
- Placas que já têm dono (`Placa.vendedorId`) mantêm seu vendedor original.

### GET /boletos/:id
Retorna os detalhes do boleto incluindo `linkBoleto` (link direto para o boleto). VENDEDOR só pode acessar boletos de clientes vinculados a ele.

### PATCH /boletos/:id/editar
**Body (pelo menos um campo obrigatório):**
```json
{
  "dataVencimento": "2025-06-20",
  "valor": 75.00
}
```
- `dataVencimento`: atualiza vencimento no EFI e no banco.
- `valor`: atualiza o valor apenas no banco (EFI não permite editar valor de boleto já gerado).
- Apenas boletos com status `PENDENTE` ou `ATRASADO` podem ser editados.

### POST /carnes/unificar — Unificar Carnês
Busca automaticamente todos os carnês individuais ativos do cliente e os unifica em um único carnê EFI.

**Body:**
```json
{
  "clienteId": "uuid",
  "dataVencimento": "2025-05-10",
  "numeroParcelas": 12
}
```
**Resultado:**
1. Cancela os carnês individuais ativos no EFI
2. Marca boletos pendentes dos individuais como `CANCELADO`
3. Cria novo carnê unificado no EFI (valor = soma de todas as placas)
4. Salva registros em `BoletoPlaca` com o valor por placa (para cálculo de comissão)

---

## Colaboradores (ADMIN)

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| GET | `/colaboradores` | Listar colaboradores | ADMIN |
| POST | `/colaboradores` | Criar colaborador | ADMIN |
| PUT | `/colaboradores/:id` | Editar colaborador | ADMIN |
| PATCH | `/colaboradores/:id/status` | Ativar/inativar | ADMIN |
| DELETE | `/colaboradores/:id` | Excluir colaborador | ADMIN |

---

## Vendedores

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| GET | `/vendedores` | Listar vendedores (suporta `?busca=`) | ADMIN, COLABORADOR |
| POST | `/vendedores` | Criar vendedor | ADMIN |
| PUT | `/vendedores/:id` | Editar vendedor | ADMIN |
| PATCH | `/vendedores/:id/status` | Ativar/inativar | ADMIN |
| DELETE | `/vendedores/:id` | Excluir vendedor | ADMIN |
| GET | `/vendedores/:id/clientes` | Clientes do vendedor (expansível) | ADMIN |
| GET | `/vendedores/:id/comissoes` | Comissões do vendedor | ADMIN |
| GET | `/vendedor/carteira` | Carteira do vendedor logado | VENDEDOR |

### GET /vendedor/carteira
**Query params:** `?mes=2026-03&vendedorId=uuid` (ADMIN pode passar `vendedorId` para ver carteira de outro vendedor)

Retorna os **três totais simultaneamente** (sem toggle): `garantido`, `atrasado` e `futuro`.

- **garantido**: boletos pagos no mês → usa `ComissaoVendedor` (valores confirmados)
- **atrasado**: boletos `ATRASADO` com vencimento no mês → comissão teórica calculada on-the-fly
- **futuro**: boletos `PENDENTE` com vencimento no mês → comissão teórica calculada on-the-fly (aparece imediatamente após criação da cobrança)

**Response:**
```json
{
  "mes": "2026-03",
  "garantido": { "total": 150.00, "pct12": 50.00, "pct18": 100.00 },
  "atrasado":  { "total": 80.00,  "pct12": 30.00, "pct18": 50.00  },
  "futuro":    { "total": 200.00, "pct12": 80.00, "pct18": 120.00 }
}
```

### GET /vendedor/carteira/detalhes
**Query params:** `?mes=2026-03&toggle=garantido|atrasado|futuro&busca=João&percentual=12|18`

- `toggle=garantido`: detalha boletos pagos no mês (usa `ComissaoVendedor`)
- `toggle=atrasado`: detalha boletos `ATRASADO` com vencimento no mês
- `toggle=futuro`: detalha boletos `PENDENTE` com vencimento no mês

**Response:** `{ mes, toggle, total, itens: [{ boletoId, cliente, telefone, placa, vencimento, dataPagamento, valorBoleto, comissao, percentual, linkBoleto }] }`

---

## Pagamento de Comissão ao Vendedor

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| GET | `/vendedor/pagamentos` | Consultar registro de pagamento (vendedor+mês) | VENDEDOR, ADMIN |
| POST | `/vendedor/pagamentos` | Registrar pagamento de comissão | ADMIN |
| POST | `/vendedor/pagamentos/:id/comprovante` | Upload do comprovante (PDF/JPG/PNG) | ADMIN |
| GET | `/vendedor/comprovante/:id` | Download/visualização do comprovante | VENDEDOR, ADMIN |

### GET /vendedor/pagamentos
**Query params:** `?vendedorId=uuid&mes=2026-03`

- ADMIN pode informar qualquer `vendedorId`; VENDEDOR só acessa o próprio
- Retorna o registro `PagamentoComissao` ou `null` se ainda não houver pagamento no mês

**Response:**
```json
{
  "id": "uuid",
  "vendedorId": "uuid",
  "mes": "2026-03",
  "valor": 350.00,
  "pago": true,
  "comprovante": "uploads/comprovantes/1711123456-abc.pdf",
  "comprovanteMime": "application/pdf",
  "createdAt": "...",
  "updatedAt": "..."
}
```

### POST /vendedor/pagamentos
Cria ou atualiza (upsert) o registro de pagamento para o par `vendedorId + mes`.

**Body:**
```json
{ "vendedorId": "uuid", "mes": "2026-03", "valor": 350.00 }
```

### POST /vendedor/pagamentos/:id/comprovante
Upload via `multipart/form-data`. Campo: `comprovante`.
- Formatos aceitos: PDF, JPG, PNG, WebP
- Tamanho máximo: 10 MB
- Arquivo anterior é removido automaticamente se já existia

### GET /vendedor/comprovante/:id
Serve o arquivo do comprovante com o `Content-Type` correto.

**Autenticação especial**: aceita JWT via header `Authorization: Bearer <token>` **ou** via query param `?token=<jwt>`. O query param é necessário para abrir o arquivo em nova aba no browser (onde não é possível definir headers HTTP).

- VENDEDOR só pode acessar o comprovante do seu próprio registro
- ADMIN pode acessar qualquer comprovante

---

## Configurações (ADMIN)

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| GET | `/configuracoes` | Buscar configurações atuais | ADMIN, VENDEDOR |
| PUT | `/configuracoes` | Atualizar percentuais | ADMIN |

**Body PUT:**
```json
{
  "percentualMenor": 12.50,
  "percentualMaior": 18.00,
  "valorReferencia": 50.00
}
```

---

## Segunda Via (Público)

| Método | Rota | Descrição | Auth |
|---|---|---|---|
| GET | `/segunda-via?busca=CPF_CNPJ_ou_PLACA` | Busca boletos em aberto para self-service | Público |

Usado na landing page para clientes consultarem seus próprios boletos.

---

## EFI Webhook e Migração

| Método | Rota | Descrição | Auth |
|---|---|---|---|
| POST | `/efi/webhook` | Receber notificação de pagamento | Público (chamado pelo EFI) |
| GET | `/admin/migrar-efi/preview` | Visualizar carnês do EFI prontos para importar | ADMIN |
| POST | `/admin/migrar-efi` | Importar histórico do EFI para o banco | ADMIN |
| POST | `/admin/corrigir-links-efi` | Preencher `linkBoleto` em boletos importados sem PDF | ADMIN |

### POST /efi/webhook
Chamado automaticamente pelo EFI Bank quando um boleto é pago. **Não requer autenticação.**

**Body enviado pelo EFI:**
```json
{ "notification_token": "abc123xyz" }
```

O backend responde `200 { ok: true }` imediatamente e processa em background:
1. Chama a API EFI para obter detalhes da notificação (`getNotification`)
2. Encontra o boleto pelo `charge_id` retornado
3. Atualiza status para `PAGO`, registra `dataPagamento` e `valorPago`
4. Calcula e salva comissão por placa: cria `ComissaoVendedor` para cada `Placa.vendedorId` (dono da placa, não necessariamente o vendedor do cliente)

> Configurar no painel EFI: `https://api.agillock.com.br/api/efi/webhook`

---

## Permissões Granulares de Colaborador

Ao criar/editar um colaborador (ADMIN), é possível configurar 8 permissões booleanas. Todas têm `default: true`.

| Campo | Descrição |
|---|---|
| `podeExcluirCliente` | Pode excluir clientes |
| `podeEditarCliente` | Pode editar dados do cliente |
| `podeInativarCliente` | Pode ativar/inativar clientes |
| `podeExcluirPlaca` | Pode excluir placas |
| `podeInativarPlaca` | Pode ativar/inativar placas |
| `podeBaixaManual` | Pode dar baixa manual em boletos |
| `podeCancelarCarne` | Pode cancelar/excluir carnês |
| `podeAlterarVencimento` | Pode alterar data de vencimento de boletos |

**Como funciona:**
- Ao fazer login com role `COLABORADOR`, todas as permissões são embutidas no JWT
- O backend verifica cada permissão na rota correspondente; retorna `403` se negada
- O frontend lê as permissões do JWT e oculta/exibe botões condicionalmente
- Tokens ADMIN não contêm esses campos → `perm !== false` trata `undefined` como `true`

**Body POST/PUT `/colaboradores`** (campos de permissão, todos opcionais):
```json
{
  "nome": "...", "email": "...", "senha": "...",
  "podeExcluirCliente": true,
  "podeEditarCliente": true,
  "podeInativarCliente": true,
  "podeExcluirPlaca": true,
  "podeInativarPlaca": true,
  "podeBaixaManual": true,
  "podeCancelarCarne": true,
  "podeAlterarVencimento": true
}
```

---

## Exportação CSV

| Método | Rota | Descrição | Roles |
|---|---|---|---|
| GET | `/vendedor/carteira/exportar` | Exportar dados da carteira em CSV | VENDEDOR, ADMIN |
