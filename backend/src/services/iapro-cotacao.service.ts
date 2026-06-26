import prisma from '../utils/prisma';

/**
 * Cotação IAPRO a partir do portal/app do cliente da Ágil Lock.
 *
 * O cliente logado faz uma cotação de proteção veicular usando uma placa (própria,
 * já cadastrada no rastreamento, ou digitada manualmente). O backend consulta os
 * endpoints PÚBLICOS da IAPRO para trazer os dados do veículo + valores e, quando o
 * cliente decide concluir na web, orquestra a criação da sessão de cotação na IAPRO
 * até a etapa de pagamento da adesão (LINK_PAGANDO_ADESAO), devolvendo a URL de retomada.
 *
 * Endpoints públicos da IAPRO usados (montados sob IAPRO_API_URL, que já inclui /api/v1):
 *  - GET   /public/plates/:placa                          → dados do veículo + FIPE
 *  - GET   /public/pricing?vehicleType=&fipeValue=         → tabela de preço (adesão/mensalidade)
 *  - GET   /public/app-settings                            → WhatsApp comercial
 *  - POST  /public/quotation-link/start                    → sessionId
 *  - PATCH /public/quotation-link/:sid/step                → etapas (cliente/veículo)
 *  - POST  /public/quotation-link/:sid/enter-contracting   → cria contrato e vai p/ pagamento
 */

const IAPRO_TIMEOUT_MS = 12000;

function iaproBaseUrl(): string | null {
  const url = (process.env.IAPRO_API_URL || '').replace(/\/+$/, '');
  return url || null;
}

/**
 * URL pública do site da IAPRO (frontend da cotação).
 * Não precisa de env: em produção é sempre https://iaproprotecaoveicular.tech; em dev, quando a API
 * aponta para localhost/docker, o site roda em http://localhost:3000.
 * (IAPRO_PUBLIC_URL continua aceito como override opcional, mas é dispensável.)
 */
function iaproSiteUrl(): string {
  const override = process.env.IAPRO_PUBLIC_URL;
  if (override) return override.replace(/\/+$/, '');
  const api = process.env.IAPRO_API_URL || '';
  if (/localhost|127\.0\.0\.1|host\.docker\.internal/i.test(api)) return 'http://localhost:3000';
  return 'https://iaproprotecaoveicular.tech';
}

type IaproResposta<T = unknown> = { ok: boolean; status: number; data: T };

async function chamarIapro<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<IaproResposta<T>> {
  const base = iaproBaseUrl();
  if (!base) {
    return { ok: false, status: 0, data: { message: 'Integração IAPRO não configurada (IAPRO_API_URL).' } as T };
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // As rotas /public são abertas, mas enviar a chave é inofensivo e mantém o padrão.
  if (process.env.IAPRO_API_KEY) headers['x-api-key'] = process.env.IAPRO_API_KEY;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(IAPRO_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

export function normalizarPlaca(placa?: string | null): string {
  if (!placa) return '';
  return String(placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Resolve o e-mail do cliente para o fluxo da IAPRO. Cliente PJ normalmente não tem o
 * campo `email` preenchido (é da pessoa física); o e-mail fica em `emailCobranca` ou no
 * primeiro sócio (`socios[0].email`). Prioridade: email → emailCobranca → 1º sócio.
 */
export function resolverEmailCliente(c: {
  email?: string | null;
  emailCobranca?: string | null;
  socios?: unknown;
}): string | null {
  const candidatos: Array<string | null | undefined> = [c.email, c.emailCobranca];
  const socios = Array.isArray(c.socios) ? (c.socios as Array<Record<string, unknown>>) : [];
  for (const s of socios) {
    const e = s && typeof s.email === 'string' ? s.email : null;
    if (e) candidatos.push(e);
  }
  for (const e of candidatos) {
    const v = (e || '').trim();
    if (v && /\S+@\S+\.\S+/.test(v)) return v;
  }
  return null;
}

/**
 * Normaliza um telefone/WhatsApp para o formato do wa.me: só dígitos com DDI.
 * "(85) 99201-0562" → "5585992010562". Mantém números que já tenham DDI 55.
 */
export function normalizarWhatsapp(numero?: string | null): string | null {
  let d = (numero || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11 && !d.startsWith('55')) d = '55' + d;
  return d;
}

/** Converte um valor FIPE formatado ("R$ 89.990,00") para número (89990.0). */
export function parseValorFipe(valor?: string | number | null): number | null {
  if (valor == null) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const limpo = String(valor)
    .replace(/[R$\s]/gi, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

// ─── Tipos da IAPRO ─────────────────────────────────────────────────────────

interface PlacaIapro {
  plate: string;
  type: string;
  brand: string;
  model: string;
  yearModel: number;
  yearManufacture: number;
  color: string;
  transmission: string;
  chassis: string;
  renavam: string;
  fipeCode: string;
  fipeValue: string | null;
  fipeDisplay: string | null;
  fipeMonthRef: string | null;
  fipeBrandId: string;
  fipeModelId: string;
  fipeYearCode: string;
  fipeBrandName: string;
  fipeModelName: string;
}

interface PrecoIapro {
  id: string;
  vehicleType: string;
  adhesionValue: number;
  monthlyValue: number;
  minValue: number;
  maxValue: number;
  maxDiscountPct: number;
}

export interface VeiculoCotado {
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  ano: number | null;
  cor: string;
  fipeValor: number | null;
  fipeFormatado: string | null;
  fipeMesReferencia: string | null;
  // dados crus para a orquestração web (não expostos ao cliente)
  _raw: PlacaIapro;
}

export interface ResultadoCotacao {
  veiculo: VeiculoCotado;
  preco: PrecoCotacao | null;
  whatsappComercial: string | null;
  /** Sessão criada na IAPRO (cotação já gravada no painel). null se não foi possível criar. */
  sessionId: string | null;
}

// ─── Consultas ──────────────────────────────────────────────────────────────

/** Consulta a placa na IAPRO e devolve os dados do veículo. */
export async function consultarPlaca(placa: string): Promise<VeiculoCotado> {
  const limpa = normalizarPlaca(placa);
  if (limpa.length < 7) throw new Error('Placa inválida.');

  const resp = await chamarIapro<{ success: boolean; data?: PlacaIapro; message?: string }>(
    'GET',
    `/public/plates/${limpa}`,
  );
  if (!resp.ok || !resp.data?.data) {
    const msg = resp.data?.message || 'Não foi possível consultar a placa na IAPRO.';
    throw new Error(msg);
  }
  const raw = resp.data.data;
  const fipeFormatado = raw.fipeDisplay || raw.fipeValue || null;
  return {
    placa: raw.plate || limpa,
    tipo: raw.type || 'CARRO',
    marca: raw.brand || '',
    modelo: raw.model || '',
    ano: raw.yearModel || null,
    cor: raw.color || '',
    fipeValor: parseValorFipe(fipeFormatado),
    fipeFormatado,
    fipeMesReferencia: raw.fipeMonthRef || null,
    _raw: raw,
  };
}

/**
 * Busca a tabela de preço (adesão + mensalidade) para o tipo/valor FIPE.
 * `descontoPct` = desconto de pontualidade da tabela (pagamento até 1 dia antes do vencimento).
 */
export interface PrecoCotacao {
  adesao: number;
  mensalidade: number;
  descontoPct: number;
  /** Id da tabela de preço (usado para gravar a cotação na IAPRO). */
  fixedTableId: string | null;
}

export async function consultarPreco(
  vehicleType: string,
  fipeValor: number | null,
): Promise<PrecoCotacao | null> {
  const params = new URLSearchParams({ vehicleType: vehicleType || 'CARRO' });
  if (fipeValor && fipeValor > 0) params.set('fipeValue', String(fipeValor));

  const resp = await chamarIapro<{ success: boolean; data?: PrecoIapro | null }>(
    'GET',
    `/public/pricing?${params.toString()}`,
  );
  const tabela = resp.ok ? resp.data?.data : null;
  if (!tabela) return null;
  return {
    adesao: Number(tabela.adhesionValue),
    mensalidade: Number(tabela.monthlyValue),
    descontoPct: Number(tabela.maxDiscountPct ?? 0) || 0,
    fixedTableId: tabela.id ?? null,
  };
}

/** Retorna o número de WhatsApp comercial da IAPRO (fallback: empresa → proteção). */
export async function consultarWhatsappComercial(): Promise<string | null> {
  const resp = await chamarIapro<{
    success: boolean;
    data?: { commercialWhatsapp?: string | null; companyWhatsapp?: string | null; protectionWhatsapp?: string | null };
  }>('GET', '/public/app-settings');
  if (!resp.ok || !resp.data?.data) return null;
  const s = resp.data.data;
  return normalizarWhatsapp(s.commercialWhatsapp || s.companyWhatsapp || s.protectionWhatsapp);
}

/**
 * Cotação completa de uma placa: veículo + preço + contato comercial.
 * Já GRAVA a cotação na IAPRO (aparece no painel) e devolve o sessionId.
 */
export async function cotarPlaca(
  clienteId: string,
  placa: string,
  sessionIdExistente?: string,
): Promise<ResultadoCotacao> {
  const veiculo = await consultarPlaca(placa);
  const [preco, whatsappComercial] = await Promise.all([
    consultarPreco(veiculo.tipo, veiculo.fipeValor).catch(() => null),
    consultarWhatsappComercial().catch(() => null),
  ]);
  const raw = veiculo._raw;
  const sessionId = await orquestrarCotacao(clienteId, {
    plate: veiculo.placa,
    type: veiculo.tipo,
    brand: raw.brand,
    model: raw.model,
    yearModel: raw.yearModel,
    color: raw.color,
    transmission: raw.transmission,
    chassis: raw.chassis,
    renavam: raw.renavam,
    fipeCode: raw.fipeCode,
    fipeValue: veiculo.fipeValor ?? undefined,
    fipeBrandId: raw.fipeBrandId,
    fipeModelId: raw.fipeModelId,
    fipeYearCode: raw.fipeYearCode,
    fipeBrandName: raw.fipeBrandName,
    fipeModelName: raw.fipeModelName,
    isZeroKm: false,
  }, preco, sessionIdExistente).catch(() => null);
  return { veiculo, preco, whatsappComercial, sessionId };
}

// ─── FIPE (veículo 0 km) ────────────────────────────────────────────────────

export interface FipeOpcao {
  codigo: string;
  nome: string;
}

const TIPOS_VALIDOS = ['CARRO', 'MOTO', 'CAMINHAO'];
export function normalizarTipo(tipo?: string): string {
  const t = String(tipo || '').toUpperCase();
  return TIPOS_VALIDOS.includes(t) ? t : 'CARRO';
}

export async function listarFipeMarcas(tipo: string): Promise<FipeOpcao[]> {
  const resp = await chamarIapro<{ success: boolean; data?: FipeOpcao[] }>(
    'GET',
    `/public/fipe/brands?type=${encodeURIComponent(normalizarTipo(tipo))}`,
  );
  const arr = resp.ok && Array.isArray(resp.data?.data) ? resp.data!.data! : [];
  return arr.map((m) => ({ codigo: String(m.codigo), nome: m.nome }));
}

export async function listarFipeModelos(tipo: string, brandId: string): Promise<FipeOpcao[]> {
  const resp = await chamarIapro<{ success: boolean; data?: { codigo: number | string; nome: string }[] }>(
    'GET',
    `/public/fipe/brands/${encodeURIComponent(brandId)}/models?type=${encodeURIComponent(normalizarTipo(tipo))}`,
  );
  const arr = resp.ok && Array.isArray(resp.data?.data) ? resp.data!.data! : [];
  return arr.map((m) => ({ codigo: String(m.codigo), nome: m.nome }));
}

export async function listarFipeAnos(tipo: string, brandId: string, modelId: string): Promise<FipeOpcao[]> {
  const resp = await chamarIapro<{ success: boolean; data?: FipeOpcao[] }>(
    'GET',
    `/public/fipe/brands/${encodeURIComponent(brandId)}/models/${encodeURIComponent(modelId)}/years?type=${encodeURIComponent(normalizarTipo(tipo))}`,
  );
  const arr = resp.ok && Array.isArray(resp.data?.data) ? resp.data!.data! : [];
  return arr.map((m) => ({ codigo: String(m.codigo), nome: m.nome }));
}

interface FipeValor {
  valor: number | null;
  valorFormatado: string | null;
  fipeCode: string;
  marca: string;
  modelo: string;
  ano: number | null;
  mesRef: string | null;
}

/** Resolve o valor FIPE a partir da seleção (tipo/marca/modelo/ano) — fonte autoritativa do servidor. */
export async function consultarFipeValor(
  tipo: string,
  brandId: string,
  modelId: string,
  yearCode: string,
): Promise<FipeValor> {
  const resp = await chamarIapro<{
    success: boolean;
    data?: { Valor: string; Marca: string; Modelo: string; AnoModelo: number; CodigoFipe: string; MesReferencia: string };
  }>(
    'GET',
    `/public/fipe/value/${encodeURIComponent(brandId)}/${encodeURIComponent(modelId)}/${encodeURIComponent(yearCode)}?type=${encodeURIComponent(normalizarTipo(tipo))}`,
  );
  const d = resp.data?.data;
  if (!resp.ok || !d) throw new Error('Não foi possível consultar o valor FIPE.');
  return {
    valor: parseValorFipe(d.Valor),
    valorFormatado: d.Valor || null,
    fipeCode: d.CodigoFipe || '',
    marca: d.Marca || '',
    modelo: d.Modelo || '',
    ano: d.AnoModelo || null,
    mesRef: d.MesReferencia || null,
  };
}

/** Monta o VeiculoCotado a partir da seleção FIPE (0 km — sem placa). */
function veiculoDeFipe(tipo: string, brandId: string, modelId: string, yearCode: string, fipe: FipeValor): VeiculoCotado {
  const raw: PlacaIapro = {
    plate: '', type: tipo, brand: fipe.marca, model: fipe.modelo, yearModel: fipe.ano || 0, yearManufacture: 0,
    color: '', transmission: '', chassis: '', renavam: '', fipeCode: fipe.fipeCode,
    fipeValue: fipe.valorFormatado, fipeDisplay: fipe.valorFormatado, fipeMonthRef: fipe.mesRef,
    fipeBrandId: brandId, fipeModelId: modelId, fipeYearCode: yearCode,
    fipeBrandName: fipe.marca, fipeModelName: fipe.modelo,
  };
  return {
    placa: '', tipo, marca: fipe.marca, modelo: fipe.modelo, ano: fipe.ano, cor: '',
    fipeValor: fipe.valor, fipeFormatado: fipe.valorFormatado, fipeMesReferencia: fipe.mesRef, _raw: raw,
  };
}

/** Cotação de um veículo 0 km (sem placa) a partir da seleção FIPE. Grava na IAPRO e devolve sessionId. */
export async function cotarZero(
  clienteId: string,
  tipo: string,
  brandId: string,
  modelId: string,
  yearCode: string,
  sessionIdExistente?: string,
): Promise<ResultadoCotacao> {
  const t = normalizarTipo(tipo);
  const fipe = await consultarFipeValor(t, brandId, modelId, yearCode);
  const veiculo = veiculoDeFipe(t, brandId, modelId, yearCode, fipe);
  const [preco, whatsappComercial] = await Promise.all([
    consultarPreco(t, fipe.valor).catch(() => null),
    consultarWhatsappComercial().catch(() => null),
  ]);
  const sessionId = await orquestrarCotacao(clienteId, {
    plate: '',
    type: t,
    brand: fipe.marca,
    model: fipe.modelo,
    yearModel: fipe.ano ?? undefined,
    fipeCode: fipe.fipeCode,
    fipeValue: fipe.valor ?? undefined,
    fipeBrandId: brandId,
    fipeModelId: modelId,
    fipeYearCode: yearCode,
    fipeBrandName: fipe.marca,
    fipeModelName: fipe.modelo,
    isZeroKm: true,
  }, preco, sessionIdExistente).catch(() => null);
  return { veiculo, preco, whatsappComercial, sessionId };
}

// ─── Veículos do cliente logado ─────────────────────────────────────────────

/**
 * Lista os veículos (dispositivos com placa) do cliente para o seletor da cotação.
 * Respeita as permissões de dispositivo de sub-usuários (vinculado).
 */
export async function listarVeiculosDoCliente(
  clienteId: string,
  dispositivoIdsPermitidos: string[] | null,
) {
  const dispositivos = await prisma.dispositivo.findMany({
    where: {
      clienteId,
      ativo: true,
      placa: { not: null },
      ...(dispositivoIdsPermitidos ? { id: { in: dispositivoIdsPermitidos } } : {}),
    },
    select: {
      id: true,
      nome: true,
      apelidoCliente: true,
      placa: true,
      marca: true,
      modeloVeiculo: true,
      cor: true,
      ano: true,
    },
    orderBy: { nome: 'asc' },
  });

  return dispositivos
    .filter((d) => normalizarPlaca(d.placa).length >= 7)
    .map((d) => ({
      dispositivoId: d.id,
      nome: d.apelidoCliente || d.nome,
      placa: normalizarPlaca(d.placa),
      marca: d.marca,
      modelo: d.modeloVeiculo,
      cor: d.cor,
      ano: d.ano,
    }));
}

// ─── Gravar a cotação na IAPRO (aparece no painel) ──────────────────────────

/**
 * Cria/atualiza a sessão de cotação na IAPRO e deixa em AGUARDANDO (aparece no painel
 * "Cotação" com os valores). Passos: [start] → LINK_ETAPA_1 → LINK_ETAPA_1_OK (cliente) →
 * LINK_ETAPA_2_OK (veículo) → AGUARDANDO (adesão/mensalidade/tabela).
 *
 * `sessionIdExistente` reaproveita a sessão da mesma página (evita duplicar no painel a cada
 * nova cotação). Retorna o sessionId, ou null se não der para criar (ex.: cliente sem e-mail).
 */
async function orquestrarCotacao(
  clienteId: string,
  dadosVeiculo: Record<string, unknown>,
  preco: PrecoCotacao | null,
  sessionIdExistente?: string,
): Promise<string | null> {
  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { nome: true, email: true, emailCobranca: true, socios: true, telefone: true },
  });
  // Sem e-mail/nome não conseguimos criar/associar o cliente na IAPRO pelo fluxo público.
  // Cliente PJ guarda o e-mail em emailCobranca/sócios, não no campo `email`.
  const email = cliente ? resolverEmailCliente(cliente) : null;
  if (!email || !cliente?.nome) return null;
  const whatsapp = (cliente.telefone || '').replace(/\D/g, '');

  async function rodarPassos(sid: string): Promise<boolean> {
    const stepPath = `/public/quotation-link/${sid}/step`;
    const r1 = await chamarIapro('PATCH', stepPath, { status: 'LINK_ETAPA_1' });
    if (!r1.ok) return false; // sessão inexistente/expirada → sinaliza para recriar
    await chamarIapro('PATCH', stepPath, {
      status: 'LINK_ETAPA_1_OK',
      data: { name: cliente!.nome, email, whatsapp, acceptedTerms: true },
    });
    await chamarIapro('PATCH', stepPath, { status: 'LINK_ETAPA_2_OK', data: dadosVeiculo });
    await chamarIapro('PATCH', stepPath, {
      status: 'AGUARDANDO',
      ...(preco
        ? { data: { adhesionValue: preco.adesao, monthlyValue: preco.mensalidade, planType: 'PREFIXADA', fixedTableId: preco.fixedTableId } }
        : {}),
    });
    return true;
  }

  try {
    if (sessionIdExistente && (await rodarPassos(sessionIdExistente))) {
      return sessionIdExistente;
    }
    const start = await chamarIapro<{ success: boolean; data?: { sessionId?: string } }>(
      'POST',
      '/public/quotation-link/start',
      {},
    );
    const sid = start.data?.data?.sessionId;
    if (!start.ok || !sid) return null;
    await rodarPassos(sid);
    return sid;
  } catch {
    return null;
  }
}

// ─── Contratar: envia os dados do cliente e vai ao pagamento da adesão (etapa 4) ──

export interface ContratarResultado {
  url: string;
  /** true quando entrou na contratação (etapa de pagamento). */
  orquestrada: boolean;
  /** true quando a placa já tem contrato/dono na IAPRO (precisa falar com a administração). */
  placaJaCadastrada?: boolean;
}

function digitsOnly(v?: string | null): string {
  return v ? String(v).replace(/\D/g, '') : '';
}

/** AgilLock dataNascimento → 'YYYY-MM-DD' (aceita dd/mm/aaaa); senão undefined. */
function paraDataIso(s?: string | null): string | undefined {
  const t = (s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

/** AgilLock estadoCivil (livre) → enum IAPRO; undefined se não reconhecer. */
function paraEstadoCivil(s?: string | null): string | undefined {
  const t = (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (t.includes('SOLTEIR')) return 'SOLTEIRO';
  if (t.includes('CASAD')) return 'CASADO';
  if (t.includes('DIVORC')) return 'DIVORCIADO';
  if (t.includes('VIUV')) return 'VIUVO';
  if (t.includes('UNIAO') || t.includes('ESTAVEL')) return 'UNIAO_ESTAVEL';
  return undefined;
}

type ClienteCompleto = {
  nome: string; email: string | null; emailCobranca: string | null; socios: unknown; telefone: string | null; cpfCnpj: string | null;
  tipoPessoa: string | null; dataNascimento: string | null; rg: string | null; estadoCivil: string | null;
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; estado: string | null;
};

/** Mapeia o cliente da AgilLock para o payload de dados da contratação da IAPRO. */
function mapearClienteParaIapro(c: ClienteCompleto): Record<string, unknown> {
  const doc = digitsOnly(c.cpfCnpj);
  const temEndereco = !!(c.cep || c.logradouro || c.cidade);
  return {
    name: c.nome,
    email: resolverEmailCliente(c) || undefined,
    whatsapp: digitsOnly(c.telefone) || undefined,
    phone: c.telefone || undefined,
    cpf: doc.length === 11 ? doc : undefined,
    cnpj: doc.length === 14 ? doc : undefined,
    razaoSocial: doc.length === 14 ? c.nome : undefined,
    rg: c.rg || undefined,
    birthDate: paraDataIso(c.dataNascimento),
    maritalStatus: paraEstadoCivil(c.estadoCivil),
    ...(temEndereco
      ? {
          address: {
            cep: c.cep || undefined,
            logradouro: c.logradouro || undefined,
            number: c.numero || undefined,
            complement: c.complemento || undefined,
            neighborhood: c.bairro || undefined,
            city: c.cidade || undefined,
            state: c.estado || undefined,
          },
        }
      : {}),
  };
}

/**
 * Contratar proteção: envia os dados que o cliente já tem na AgilLock (CPF, endereço, etc.)
 * para a IAPRO (contracting-draft) e entra na contratação (enter-contracting → pagamento da
 * adesão). Devolve a URL `?cotacao=<sessionId>` que retoma o site na etapa 4 (pagamento).
 */
export async function contratar(clienteId: string, sessionId: string): Promise<ContratarResultado> {
  const urlLimpa = `${iaproSiteUrl()}/cotacao`;
  if (!sessionId) return { url: urlLimpa, orquestrada: false };

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: {
      nome: true, email: true, emailCobranca: true, socios: true, telefone: true, cpfCnpj: true, tipoPessoa: true,
      dataNascimento: true, rg: true, estadoCivil: true,
      cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true,
    },
  });
  if (!cliente) throw new Error('Cliente não encontrado.');

  const cotacaoUrl = `${iaproSiteUrl()}/cotacao?cotacao=${sessionId}`;
  try {
    // Envia os dados do cliente (best-effort — a IAPRO ignora campos inválidos/fora de enum).
    await chamarIapro('PATCH', `/public/quotation-link/${sessionId}/contracting-draft`, mapearClienteParaIapro(cliente));

    // Entra na contratação → status LINK_PAGANDO_ADESAO (etapa 4 pagamento da adesão).
    const enter = await chamarIapro<{ success: boolean; code?: string; message?: string }>(
      'POST',
      `/public/quotation-link/${sessionId}/enter-contracting`,
      {},
    );
    if (!enter.ok) {
      if (enter.status === 409 || enter.data?.code === 'PLATE_EXISTS') {
        return { url: cotacaoUrl, orquestrada: false, placaJaCadastrada: true };
      }
      if (enter.status === 404) return { url: urlLimpa, orquestrada: false };
      return { url: cotacaoUrl, orquestrada: false };
    }
    return { url: cotacaoUrl, orquestrada: true };
  } catch {
    return { url: cotacaoUrl, orquestrada: false };
  }
}
