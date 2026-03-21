# Integração EFI Bank

## SDK

```bash
npm install sdk-node-apis-efi
```

Pacote oficial: [`sdk-node-apis-efi`](https://github.com/efipay/sdk-node-apis-efi) v1.3.1 (CommonJS, sem tipos TypeScript).

---

## Certificado p12

O certificado de homologação está em:
```
backend/cert/certificado.p12
```

A pasta `backend/cert/` está no `.gitignore` (nunca versionar certificados). No Docker, o volume `.:/app` já monta a pasta automaticamente.

Para produção, copiar o certificado de produção para o servidor e ajustar `EFI_CERT_PATH` no `.env`.

---

## Variáveis de Ambiente

```env
EFI_CLIENT_ID=seu_client_id
EFI_CLIENT_SECRET=seu_client_secret
EFI_SANDBOX=true          # false em produção
EFI_CERT_PATH=./cert/certificado.p12   # relativo ao working dir /app no container
```

> `EFI_CERT_PASSWORD` não é necessário — o SDK lê o p12 sem senha pelo `fs.readFileSync`.

---

## Configuração do Client (`src/services/efi.service.ts`)

```typescript
// SDK é CommonJS sem tipos — usar require()
const EfiPay = require('sdk-node-apis-efi');

const client = new EfiPay({
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: fs.readFileSync(certPath),  // Buffer, não caminho string
  sandbox: process.env.EFI_SANDBOX !== 'false',
});
```

O cliente é criado como **singleton lazy** (uma instância reutilizada entre requests).

---

## Tratamento de Erros do SDK

O SDK pode lançar a **resposta HTTP bruta** como erro (ex: página HTML de 504 Gateway Timeout da Cloudflare) em vez de um objeto `Error` com `.message`.

Todos os métodos do `efi.service.ts` passam pelo normalizador `normalizeEfiError()`:

```typescript
function normalizeEfiError(err: unknown): Error {
  if (err instanceof Error) return err;
  const raw = typeof err === 'string' ? err : JSON.stringify(err);

  // HTML de gateway timeout → extrai o <title>
  if (raw.trimStart().startsWith('<')) {
    const match = raw.match(/<title>([^<]+)<\/title>/i);
    const title = match ? match[1].trim() : 'Gateway Timeout';
    return new Error(`EFI indisponível no momento (${title}). Tente novamente em instantes.`);
  }

  // JSON de erro da EFI → extrai message/error
  try {
    const parsed = JSON.parse(raw);
    return new Error(String(parsed?.message || parsed?.error || raw));
  } catch {
    return new Error(raw || 'Erro desconhecido na API EFI.');
  }
}
```

> **Causa comum**: `efipay.com.br | 504: Gateway time-out` — a API EFI fica indisponível temporariamente. O sistema retorna `502` com mensagem legível ao invés de logar HTML gigante.

---

## Métodos Utilizados

### 1. Criar Carnê

```typescript
const response = await client.createCarnet({}, {
  items: [
    { name: "Rastreamento ABC1234", value: 5000, amount: 1 }, // value em centavos
  ],
  customer: {
    name: "João Silva",
    cpf: "94271564656",        // opcional
    phone_number: "31912345678", // opcional
    email: "joao@email.com",   // opcional
  },
  expire_at: "2025-05-10",     // data do 1º vencimento (YYYY-MM-DD)
  repeats: 12,                  // número de parcelas
  split_items: false,           // false = um boleto por mês com total dos itens
});

// response.data.carnet_id  → ID do carnê no EFI (número)
// response.data.link        → link para PDF do carnê completo
// response.data.charges[]   → array de boletos:
//   .charge_id              → ID do boleto individual
//   .parcel                 → número da parcela ("1", "2", ...)
//   .expire_at              → vencimento da parcela
//   .url                    → link para o boleto individual
```

### 2. Cancelar Carnê

```typescript
await client.cancelCarnet({ id: carnet_id }); // carnet_id é número
```

### 3. Dar Baixa em Parcela (baixa manual)

```typescript
await client.settleCarnetParcel({ id: carnet_id, parcel: numeroParcela });
// parcel é número (1, 2, 3, ...)
```

### 4. Alterar Vencimento de Parcela

```typescript
await client.updateCarnetParcel(
  { id: carnet_id, parcel: numeroParcela },
  { expire_at: "2025-06-20" } // YYYY-MM-DD
);
```

### 5. Obter Detalhes de Notificação (webhook)

```typescript
const response = await client.getNotification({ token: notification_token });
// response.data → array de notificações:
//   .status.current          → "paid", "waiting", "cancelled", ...
//   .identifiers.charge_id   → ID do boleto pago
```

---

## Webhook de Pagamento

### Configuração no Painel EFI

URL a configurar: `https://api.agillock.com.br/api/efi/webhook`

### Payload recebido

O EFI envia `POST` com:
```json
{ "notification_token": "abc123xyz" }
```

O backend responde `200 { ok: true }` **imediatamente** (para o EFI não retentar) e processa em background via `setImmediate`:

1. Chama `getNotification({ token })` para obter os detalhes
2. Filtra notificações com `status.current === "paid"`
3. Encontra o boleto pelo `charge_id` em `Boleto.efiChargeId`
4. Atualiza: `status = PAGO`, `dataPagamento`, `valorPago`
5. Se o cliente tem vendedor: calcula e salva `ComissaoVendedor`

### Rota sem autenticação

O webhook é chamado diretamente pelo EFI Bank, sem Bearer token. Por isso a rota `/api/efi/webhook` não passa pelo `authMiddleware` e deve ser registrada em `app.ts` **antes** de `app.use('/api', placasRoutes)`.

---

## Lógica de Comissão (`src/services/comissao.service.ts`)

O split de comissão é **totalmente interno** — o EFI não sabe sobre isso. O EFI vê apenas um único boleto com o valor total.

**Regra do dono da placa:**
- Cada `Placa` tem um campo `vendedorId` que é definido na **primeira cobrança** gerada para ela.
- Uma vez definido, o `vendedorId` da placa não muda — todas as cobranças futuras da mesma placa comissionam sempre o mesmo vendedor.
- Se o operador selecionar outro vendedor em uma nova cobrança da mesma placa, o novo vendedor recebe a comissão das placas **novas** que ele trouxe; as placas antigas continuam comissionando o vendedor original.

**Para boleto individual (1 placa):**
- Vendedor = `Placa.vendedorId` (dono da placa)
- `valorReferencia = boleto.valor`
- Se `valorReferencia >= configs.valorReferencia (R$50)` → aplica `percentualMaior (18%)`
- Caso contrário → aplica `percentualMenor (12.5%)`
- Se a placa não tiver vendedor (`vendedorId = null`), nenhuma comissão é gerada.

**Para boleto unificado (múltiplas placas):**
- Itera sobre `BoletoPlaca` (junção boleto × placa com `valorPlaca` de cada placa)
- Vendedor de cada placa = `BoletoPlaca.placa.vendedorId`
- Calcula comissão separadamente por placa com a mesma lógica acima
- Cria um `ComissaoVendedor` por placa — um único boleto unificado pode gerar comissões para múltiplos vendedores

**Webhook e baixa manual:**
- Passo 5 do webhook: "Se o cliente tem vendedor: calcula comissão" — **corrigido**: a comissão agora é calculada com base no `Placa.vendedorId`, não no `cliente.vendedorId`.

---

## Ambiente de Homologação vs Produção

| Variável | Homologação | Produção |
|---|---|---|
| `EFI_SANDBOX` | `true` | `false` |
| `EFI_CLIENT_ID` | client_id de homologação | client_id de produção |
| `EFI_CLIENT_SECRET` | secret de homologação | secret de produção |
| Certificado | `homologacao-381777-AgilLockRastreamento.p12` | certificado de produção (obter no painel EFI) |

---

## Migração de Dados Históricos (Etapa 10)

**Endpoints implementados** (acessíveis pelo Dashboard do admin):

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/admin/migrar-efi/preview` | Lista carnês do EFI ainda não importados |
| POST | `/api/admin/migrar-efi` | Importa os carnês listados no preview |
| POST | `/api/admin/corrigir-links-efi` | Preenche `linkBoleto` em boletos sem PDF |

**Estratégia de importação:**
1. `GET /preview`: chama `listCarnets` no EFI e cruza com boletos já existentes no banco pelo `efiChargeId`; retorna resumo de novos/já importados
2. `POST /migrar-efi`: para cada carnê novo, cria `Cliente` + `Placa` + `Carne` + `Boleto` no banco usando CPF como chave de unicidade do cliente
3. Ambos protegidos por role `ADMIN`
