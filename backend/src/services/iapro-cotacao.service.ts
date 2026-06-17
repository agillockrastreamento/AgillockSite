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
  preco: {
    adesao: number;
    mensalidade: number;
  } | null;
  whatsappComercial: string | null;
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

/** Busca a tabela de preço (adesão + mensalidade) para o tipo/valor FIPE. */
export async function consultarPreco(
  vehicleType: string,
  fipeValor: number | null,
): Promise<{ adesao: number; mensalidade: number } | null> {
  const params = new URLSearchParams({ vehicleType: vehicleType || 'CARRO' });
  if (fipeValor && fipeValor > 0) params.set('fipeValue', String(fipeValor));

  const resp = await chamarIapro<{ success: boolean; data?: PrecoIapro | null }>(
    'GET',
    `/public/pricing?${params.toString()}`,
  );
  const tabela = resp.ok ? resp.data?.data : null;
  if (!tabela) return null;
  return { adesao: Number(tabela.adhesionValue), mensalidade: Number(tabela.monthlyValue) };
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

/** Cotação completa de uma placa: veículo + preço + contato comercial. */
export async function cotarPlaca(placa: string): Promise<ResultadoCotacao> {
  const veiculo = await consultarPlaca(placa);
  const [preco, whatsappComercial] = await Promise.all([
    consultarPreco(veiculo.tipo, veiculo.fipeValor).catch(() => null),
    consultarWhatsappComercial().catch(() => null),
  ]);
  return { veiculo, preco, whatsappComercial };
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

// ─── Concluir na web: orquestra a sessão IAPRO até o pagamento da adesão ──────

export interface ConcluirWebResultado {
  url: string;
  /** true quando a sessão foi orquestrada até a etapa de pagamento. */
  orquestrada: boolean;
  /** true quando a placa já tem contrato/dono na IAPRO (precisa falar com a administração). */
  placaJaCadastrada?: boolean;
}

/**
 * Cria (ou não) a sessão de cotação na IAPRO e devolve a URL do site da cotação.
 *
 * Caminho feliz: start → LINK_ETAPA_1 → LINK_ETAPA_1_OK (cliente) → LINK_ETAPA_2_OK (veículo)
 * → enter-contracting (LINK_PAGANDO_ADESAO). A URL `?cotacao=<sessionId>` faz o site da IAPRO
 * retomar direto na etapa 4 (pagamento da adesão).
 *
 * Fallbacks: se faltar e-mail do cliente, ou alguma etapa falhar, devolve a URL "limpa"
 * (/cotacao) para o cliente preencher manualmente.
 */
export async function concluirWeb(clienteId: string, placa: string): Promise<ConcluirWebResultado> {
  const urlLimpa = `${iaproSiteUrl()}/cotacao`;

  const cliente = await prisma.cliente.findUnique({
    where: { id: clienteId },
    select: { nome: true, email: true, telefone: true },
  });
  if (!cliente) throw new Error('Cliente não encontrado.');

  // Dados do veículo (autoritativos do servidor — não confiamos no payload do cliente).
  const veiculo = await consultarPlaca(placa);

  const whatsapp = (cliente.telefone || '').replace(/\D/g, '');
  // Sem e-mail não conseguimos criar/associar o cliente na IAPRO pelo fluxo público.
  if (!cliente.email || !cliente.nome) {
    return { url: urlLimpa, orquestrada: false };
  }

  try {
    // 1) start
    const start = await chamarIapro<{ success: boolean; data?: { sessionId?: string } }>(
      'POST',
      '/public/quotation-link/start',
      {},
    );
    const sessionId = start.data?.data?.sessionId;
    if (!start.ok || !sessionId) return { url: urlLimpa, orquestrada: false };

    const stepPath = `/public/quotation-link/${sessionId}/step`;

    // 2) LINK_ETAPA_1 — cria a cotação no painel
    await chamarIapro('PATCH', stepPath, { status: 'LINK_ETAPA_1' });

    // 3) LINK_ETAPA_1_OK — cria/associa o cliente
    await chamarIapro('PATCH', stepPath, {
      status: 'LINK_ETAPA_1_OK',
      data: { name: cliente.nome, email: cliente.email, whatsapp, acceptedTerms: true },
    });

    // 4) LINK_ETAPA_2_OK — cria/associa o veículo
    const raw = veiculo._raw;
    await chamarIapro('PATCH', stepPath, {
      status: 'LINK_ETAPA_2_OK',
      data: {
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
      },
    });

    // 5) enter-contracting — cria o contrato e move para o pagamento da adesão
    const enter = await chamarIapro<{ success: boolean; code?: string; message?: string }>(
      'POST',
      `/public/quotation-link/${sessionId}/enter-contracting`,
      {},
    );

    if (!enter.ok) {
      if (enter.status === 409 || enter.data?.code === 'PLATE_EXISTS') {
        return { url: `${iaproSiteUrl()}/cotacao?cotacao=${sessionId}`, orquestrada: false, placaJaCadastrada: true };
      }
      // Falhou ao entrar na contratação, mas a sessão existe — o site retoma pelo sessionId.
      return { url: `${iaproSiteUrl()}/cotacao?cotacao=${sessionId}`, orquestrada: false };
    }

    return { url: `${iaproSiteUrl()}/cotacao?cotacao=${sessionId}`, orquestrada: true };
  } catch {
    return { url: urlLimpa, orquestrada: false };
  }
}
