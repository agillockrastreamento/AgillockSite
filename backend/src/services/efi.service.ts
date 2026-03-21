import fs from 'fs';
import path from 'path';

// SDK é CommonJS sem tipos TypeScript
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EfiPay = require('sdk-node-apis-efi');

let _client: any = null;

function getClient() {
  if (_client) return _client;

  const certPath = path.resolve(process.env.EFI_CERT_PATH || './cert/certificado.p12');

  if (!process.env.EFI_CLIENT_ID || !process.env.EFI_CLIENT_SECRET) {
    throw new Error('EFI_CLIENT_ID e EFI_CLIENT_SECRET não configurados.');
  }
  if (!fs.existsSync(certPath)) {
    throw new Error(`Certificado EFI não encontrado: ${certPath}`);
  }

  _client = new EfiPay({
    client_id: process.env.EFI_CLIENT_ID,
    client_secret: process.env.EFI_CLIENT_SECRET,
    certificate: fs.readFileSync(certPath),
    sandbox: process.env.EFI_SANDBOX !== 'false',
  });

  return _client;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface EfiCustomer {
  name: string;
  cpf?: string;
  phone_number?: string;
  email?: string;
}

export interface EfiItem {
  name: string;
  value: number; // centavos
  amount: number;
}

export interface EfiCharge {
  charge_id: number;
  parcel: string;
  status: string;
  value: number;
  expire_at: string;
  url: string;
}

export interface EfiCarneResult {
  carnet_id: number;
  link: string;
  charges: EfiCharge[];
}

export interface EfiNotificationItem {
  id: number;
  type: string;
  status: { current: string; previous: string };
  identifiers: { charge_id?: number; carnet_id?: number; parcel?: string };
  created_at: string;
}

// ─── Normaliza erros do SDK EFI ───────────────────────────────────────────────
// O SDK pode lançar a string bruta da resposta HTTP (ex: HTML de 504 Gateway Timeout)
// em vez de um objeto Error. Esta função converte para um Error com mensagem legível.
function normalizeEfiError(err: unknown): Error {
  if (err instanceof Error) return err;

  const raw = typeof err === 'string' ? err : JSON.stringify(err);

  // Resposta HTML (ex: 504 Gateway Timeout da Cloudflare)
  if (raw.trimStart().startsWith('<')) {
    const match = raw.match(/<title>([^<]+)<\/title>/i);
    const title = match ? match[1].trim() : 'Gateway Timeout';
    return new Error(`EFI indisponível no momento (${title}). Tente novamente em instantes.`);
  }

  // Resposta JSON de erro da EFI
  try {
    const parsed = JSON.parse(raw);
    console.error('[EFI raw error]', parsed);
    const errCode  = parsed?.error;
    const desc     = parsed?.error_description;
    const descStr  = desc
      ? (typeof desc === 'string' ? desc : JSON.stringify(desc))
      : null;
    const msg = parsed?.message
      || (errCode && descStr ? `${errCode}: ${descStr}` : errCode || descStr)
      || parsed?.mensagem
      || raw;
    return new Error(String(msg));
  } catch {
    return new Error(raw || 'Erro desconhecido na API EFI.');
  }
}

// ─── Funções ──────────────────────────────────────────────────────────────────

export async function criarCarne(params: {
  customer: EfiCustomer;
  items: EfiItem[];
  expire_at: string; // YYYY-MM-DD
  repeats: number;
  split_items?: boolean;
  configurations?: {
    fine?: number;
    interest?: { type: string; value: number };
  };
}): Promise<EfiCarneResult> {
  const client = getClient();
  const body: Record<string, unknown> = {
    items: params.items,
    customer: params.customer,
    expire_at: params.expire_at,
    repeats: params.repeats,
    split_items: params.split_items ?? false,
  };
  if (params.configurations) {
    body.configurations = params.configurations;
  }
  try {
    const response = await client.createCarnet({}, body);
    return response.data as EfiCarneResult;
  } catch (err) {
    throw normalizeEfiError(err);
  }
}

export async function cancelarCarne(efiCarneId: number): Promise<void> {
  const client = getClient();
  try {
    await client.cancelCarnet({ id: efiCarneId });
  } catch (err) {
    throw normalizeEfiError(err);
  }
}

export async function liquidarParcela(efiCarneId: number, parcela: number): Promise<void> {
  const client = getClient();
  try {
    await client.settleCarnetParcel({ id: efiCarneId, parcel: String(parcela) });
  } catch (err) {
    throw normalizeEfiError(err);
  }
}

export async function atualizarParcela(efiCarneId: number, parcela: number, novoVencimento: string): Promise<void> {
  const client = getClient();
  try {
    await client.updateCarnetParcel({ id: efiCarneId, parcel: String(parcela) }, { expire_at: novoVencimento });
  } catch (err) {
    throw normalizeEfiError(err);
  }
}

export async function getNotification(token: string): Promise<EfiNotificationItem[]> {
  const client = getClient();
  try {
    const response = await client.getNotification({ token });
    return (response.data || []) as EfiNotificationItem[];
  } catch (err) {
    throw normalizeEfiError(err);
  }
}

// ─── Tipos e funções para migração histórica ──────────────────────────────────
// listCharges com charge_type='carnet' retorna uma entrada por parcela (não por carnê).
// Cada entrada tem o customer e payment.carnet com parcel/expire_at/link.
// O mesmo link identifica todas as parcelas do mesmo carnê.

export interface EfiChargeListItem {
  id: number;     // charge_id da parcela
  total: number;  // valor em centavos
  status: string; // waiting | paid | unpaid | cancelled | settled
  customer: {
    phone_number?: string | null;
    cpf?: string;
    cnpj?: string;
    name?: string;
    corporate_name?: string;
    email?: string;
  };
  payment?: {
    payment_method?: string;
    paid_at?: string | null;
    carnet?: {
      parcel: number;
      expire_at: string;  // YYYY-MM-DD
      link: string;       // URL individual do boleto (única por parcela)
    };
  };
}

// A API limita a diferença entre begin_date e end_date a no máximo 1 ano.
// Esta função divide automaticamente o intervalo em fatias anuais.
export async function listarCarnetCharges(params: {
  begin_date: string;
  end_date: string;
}): Promise<EfiChargeListItem[]> {
  const client = getClient();
  const all: EfiChargeListItem[] = [];

  const start = new Date(params.begin_date + 'T00:00:00');
  const end   = new Date(params.end_date   + 'T00:00:00');

  let cursor = new Date(start);
  while (cursor <= end) {
    // Próxima fatia: até 1 ano a partir de cursor, sem ultrapassar end
    const sliceEnd = new Date(cursor);
    sliceEnd.setFullYear(sliceEnd.getFullYear() + 1);
    sliceEnd.setDate(sliceEnd.getDate() - 1); // 1 ano - 1 dia
    const effectiveEnd = sliceEnd <= end ? sliceEnd : end;

    const sliceBeginStr = cursor.toISOString().split('T')[0];
    const sliceEndStr   = effectiveEnd.toISOString().split('T')[0];

    try {
      const response = await client.listCharges({
        begin_date:  sliceBeginStr,
        end_date:    sliceEndStr,
        charge_type: 'carnet',
      });
      const data = (response.data ?? []) as EfiChargeListItem[];
      all.push(...data);
    } catch (err) {
      throw normalizeEfiError(err);
    }

    // Avança cursor para o dia seguinte ao fim desta fatia
    cursor = new Date(effectiveEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return all;
}

export async function obterDetalheCharge(chargeId: number): Promise<any> {
  const client = getClient();
  try {
    const response = await client.detailCharge({ id: chargeId });
    return response.data;
  } catch (err) {
    throw normalizeEfiError(err);
  }
}
