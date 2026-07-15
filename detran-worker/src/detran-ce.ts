// Integração com o Detran CE (Central de Serviços "Taxas / Multas").
// Fluxo HTTP puro (sem captcha). Ver docs/multas/RECONHECIMENTO_DETRAN_CE.md.
// Este código roda no WORKER (máquina que alcança o Detran), não no backend.

import * as cheerio from 'cheerio';
import { fetch, Agent, type Response } from 'undici';

const BASE = 'https://sistemas.detran.ce.gov.br/central';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

// Aceita o certificado do Detran (equivalente ao `curl -k`), escopo apenas destas chamadas.
const detranAgent = new Agent({ connect: { rejectUnauthorized: false } });

export interface MultaItem {
  ait: string;
  aitOriginaria: string | null;
  motivo: string;
  dataInfracao: string | null;
  dataVencimento: string | null;
  valor: number; // "Valor"
  valorAPagar: number; // "Valor a Pagar"
  selecaoValue: string; // value do checkbox no Detran (ex "213890*VM00331695*5550*0")
}

export interface SituacaoVeiculo {
  qtdMultas: number;
  possuiDebitoIpva: boolean;
  licenciamentoPendente: boolean;
}

export interface Pagamento {
  extratoId: string;
  emv: string; // Pix copia-e-cola
  qrCodeBase64: string; // PNG do QR Pix em base64
}

export interface LicenciamentoItem {
  ano: string; // "Data" da tabela (na prática o ano, ex.: "2026")
  orgao: string | null;
  descricao: string; // ex.: "Licenciamento 2026", "Expedição de CRV/CRLV 2026"
  valor: number;
  valorAPagar: number;
}

export interface PagamentoLicenciamento {
  itens: LicenciamentoItem[];
  total: number;
  emv: string; // Pix copia-e-cola
  qrCodeBase64: string; // PNG do QR Pix em base64 (sem o prefixo data:)
}

export interface ConsultaCompleta {
  placa: string;
  renavam: string;
  situacao: SituacaoVeiculo;
  multas: MultaItem[];
  pagamentoTodas: Pagamento | null; // null quando não há multas
  boletoPdfBase64: string | null; // boleto de todas as multas (null se não há multas)
  pagamentoLicenciamento: PagamentoLicenciamento | null; // null quando licenciamento não está pendente
  boletoLicenciamentoPdfBase64: string | null; // boleto do licenciamento (null se não pendente)
  consultadoEm: string; // ISO
}

/** Placa/renavam divergentes ou veículo não encontrado no Detran. */
export class DadosInvalidosError extends Error {}

function parseDinheiro(txt: string): number {
  const limpo = txt.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

/** Jar de cookies mínimo (o fluxo usa `_central_session`). */
class CookieJar {
  private m = new Map<string, string>();
  capture(res: Response) {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookies) {
      const par = c.split(';')[0] ?? '';
      const i = par.indexOf('=');
      if (i > 0) this.m.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }
  header(): string {
    return [...this.m].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export class DetranCeSession {
  private jar = new CookieJar();
  private csrf = '';

  private async req(url: string, init: Parameters<typeof fetch>[1] = {}): Promise<Response> {
    const res = await fetch(url, {
      redirect: 'manual',
      dispatcher: detranAgent,
      ...init,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'pt-BR,pt;q=0.9',
        Cookie: this.jar.header(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    this.jar.capture(res);
    return res;
  }

  /** Passo 1: home → cookie de sessão + token CSRF. */
  async iniciar(): Promise<void> {
    const res = await this.req(BASE);
    const html = await res.text();
    const $ = cheerio.load(html);
    this.csrf = $('meta[name="csrf-token"]').attr('content') ?? '';
    if (!this.csrf) throw new Error('Token CSRF não encontrado na home do Detran (layout mudou?)');
  }

  /** Passo 2: informa o veículo. Lança DadosInvalidosError se recusado. */
  async login(placa: string, renavamOuChassi: string): Promise<void> {
    const body = new URLSearchParams();
    body.set('authenticity_token', this.csrf);
    body.set('veiculo[tipo_formulario]', '1');
    body.set('veiculo[placa]', placa.toUpperCase().trim());
    body.set('veiculo[renavam_chassi]', renavamOuChassi.trim());
    const res = await this.req(`${BASE}/veiculos/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: BASE,
      },
      body: body.toString(),
    });
    const txt = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(txt);
    } catch {
      /* resposta inesperada */
    }
    if (json?.status !== 'succ') {
      let msg = 'Placa/renavam recusados pelo Detran';
      const errs = json?.errors;
      if (typeof errs === 'string' && errs.trim()) msg = errs;
      else if (Array.isArray(errs) && errs.length) msg = errs.join('; ');
      else if (errs && typeof errs === 'object') {
        const vals = Object.values(errs as Record<string, unknown>).flat().filter(Boolean);
        if (vals.length) msg = vals.join('; ');
        else msg = JSON.stringify(errs);
      }
      throw new DadosInvalidosError(msg);
    }
  }

  /** Passo 3: resumo (multas, IPVA, licenciamento). */
  async consultarPrincipal(): Promise<SituacaoVeiculo> {
    const res = await this.req(`${BASE}/veiculos/principal`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const mMultas = $('body').text().replace(/\s+/g, ' ').match(/possui\s*(\d+)\s*multas?/i);
    const qtdMultas = mMultas ? parseInt(mMultas[1] ?? '0', 10) : 0;

    // Cada serviço é um `.links-veiculo.<servico>`; `alert-danger` = há débito/pendência
    // (alert-info/alert-success = sem débito). Fallback pela redação do texto.
    const temDebito = (servico: string): boolean => {
      const el = $(`.links-veiculo.${servico}`).first();
      if (!el.length) return false;
      if (/alert-danger/.test(el.attr('class') ?? '')) return true;
      return /d[ée]bito|pend[êe]nc|vencid|em\s*aberto/i.test(el.text());
    };
    return {
      qtdMultas,
      possuiDebitoIpva: temDebito('ipva'),
      licenciamentoPendente: temDebito('licenciamento'),
    };
  }

  /** Passo 4: tabela de multas. */
  async consultarMultas(): Promise<MultaItem[]> {
    const res = await this.req(`${BASE}/veiculos/multas`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${BASE}/veiculos/principal` },
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const multas: MultaItem[] = [];
    $('table tr').each((_i, tr) => {
      const $tr = $(tr);
      const chk = $tr.find('input[type="checkbox"][name^="multas["]').first();
      if (!chk.length) return;
      const selecaoValue = chk.attr('value') ?? '';
      const tds = $tr.find('td');
      const cell = (i: number) => $(tds[i]).text().trim();
      // 0=checkbox 1=AIT 2=originaria 3=motivo 4=infração 5=vencimento 6=valor 7=valorAPagar
      const ait = cell(1) || (selecaoValue.split('*')[1] ?? '');
      if (!ait) return;
      const orig = cell(2);
      multas.push({
        ait,
        aitOriginaria: orig && orig !== '--' ? orig : null,
        motivo: cell(3),
        dataInfracao: cell(4) || null,
        dataVencimento: cell(5) || null,
        valor: parseDinheiro(cell(6)),
        valorAPagar: parseDinheiro(cell(7)),
        selecaoValue,
      });
    });
    return multas;
  }

  /** Passo 5: gera o extrato/Pix das multas selecionadas. */
  async emitirExtrato(itens: { ait: string; selecaoValue: string }[]): Promise<Pagamento> {
    const body = new URLSearchParams();
    body.set('authenticity_token', this.csrf);
    for (const it of itens) body.append(`multas[${it.ait}]`, it.selecaoValue);
    const res = await this.req(`${BASE}/veiculos/emitir_extrato_multas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${BASE}/veiculos/principal`,
      },
      body: body.toString(),
    });
    const json: any = await res.json();
    if (!json?.extrato) throw new Error('Detran não retornou extrato (emitir_extrato_multas)');
    return { extratoId: String(json.extrato), emv: String(json.emv ?? ''), qrCodeBase64: String(json.qr_code ?? '') };
  }

  /** Passo 6: baixa o boleto PDF (usa o estado do passo 5). */
  async gerarBoleto(extratoId?: string): Promise<Buffer> {
    const url = extratoId
      ? `${BASE}/veiculos/gerar_boleto?extrato=${encodeURIComponent(extratoId)}`
      : `${BASE}/veiculos/gerar_boleto`;
    const res = await this.req(url, { headers: { Referer: `${BASE}/veiculos/principal` } });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? '';
    if (!/pdf/i.test(ct) && buf.subarray(0, 4).toString('latin1') !== '%PDF') {
      throw new Error(`gerar_boleto não retornou PDF (content-type: ${ct})`);
    }
    return buf;
  }

  /**
   * Passo licenciamento: `GET /veiculos/licenciamento` → itens + Pix (copia-e-cola) + QR.
   * O fragmento HTML já traz tudo (input#pix, img#qrCodeImage, tabela #emissao-multas) e
   * prepara a sessão para o `gerarBoleto()` seguinte devolver o PDF do licenciamento.
   */
  async emitirLicenciamento(): Promise<PagamentoLicenciamento> {
    const res = await this.req(`${BASE}/veiculos/licenciamento`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${BASE}/veiculos/principal` },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const emv = ($('#pix').attr('value') ?? '').trim();
    const qrCodeBase64 = ($('#qrCodeImage').attr('src') ?? '')
      .replace(/^data:image\/png;base64,\s*/i, '')
      .trim();
    if (!emv && !qrCodeBase64) {
      throw new Error('Licenciamento sem Pix/QR (layout mudou ou sem débito?)');
    }

    const itens: LicenciamentoItem[] = [];
    let total = 0;
    $('#emissao-multas tr').each((_i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 5) {
        // linha de TOTAL: <td colspan=4>TOTAL</td><td id="total">R$ ...</td>
        const t = $(tr).find('#total').text();
        if (t.trim()) total = parseDinheiro(t);
        return;
      }
      const cell = (i: number) => $(tds[i]).text().trim();
      itens.push({
        ano: cell(0),
        orgao: cell(1) || null,
        descricao: cell(2),
        valor: parseDinheiro(cell(3)),
        valorAPagar: parseDinheiro(cell(4)),
      });
    });
    if (!total) total = itens.reduce((s, it) => s + it.valorAPagar, 0);

    return { itens, total, emv, qrCodeBase64 };
  }
}

/** Consulta completa de um veículo — traz TUDO (situação + multas + pix/boleto de todas). */
export async function consultarVeiculoCompleto(placa: string, renavam: string): Promise<ConsultaCompleta> {
  const s = new DetranCeSession();
  await s.iniciar();
  await s.login(placa, renavam);
  const situacao = await s.consultarPrincipal();
  const multas = await s.consultarMultas();

  let pagamentoTodas: Pagamento | null = null;
  let boletoPdfBase64: string | null = null;
  if (multas.length > 0) {
    pagamentoTodas = await s.emitirExtrato(multas.map((m) => ({ ait: m.ait, selecaoValue: m.selecaoValue })));
    boletoPdfBase64 = (await s.gerarBoleto()).toString('base64');
  }

  // Licenciamento: só quando pendente. emitirLicenciamento prepara a sessão e o
  // gerarBoleto seguinte devolve o PDF do licenciamento (mantidos em par e nesta ordem,
  // depois do par de multas, pois cada emitir* redefine o estado do gerar_boleto).
  let pagamentoLicenciamento: PagamentoLicenciamento | null = null;
  let boletoLicenciamentoPdfBase64: string | null = null;
  if (situacao.licenciamentoPendente) {
    try {
      pagamentoLicenciamento = await s.emitirLicenciamento();
      boletoLicenciamentoPdfBase64 = (await s.gerarBoleto()).toString('base64');
    } catch (e) {
      // Não derruba a consulta inteira se o licenciamento falhar; multas/situação seguem.
      console.warn(`[detran-ce] Falha ao emitir licenciamento de ${placa}: ${(e as Error).message}`);
    }
  }

  return {
    placa: placa.toUpperCase().trim(),
    renavam,
    situacao,
    multas,
    pagamentoTodas,
    boletoPdfBase64,
    pagamentoLicenciamento,
    boletoLicenciamentoPdfBase64,
    consultadoEm: new Date().toISOString(),
  };
}

/** Gera Pix + boleto para um subconjunto de multas (à vista). aits vazio/omitido = todas. */
export async function gerarPagamento(
  placa: string,
  renavam: string,
  aits?: string[],
): Promise<{ pagamento: Pagamento; boletoPdfBase64: string }> {
  const s = new DetranCeSession();
  await s.iniciar();
  await s.login(placa, renavam);
  const multas = await s.consultarMultas();
  const alvo = aits && aits.length ? multas.filter((m) => aits.includes(m.ait)) : multas;
  if (!alvo.length) throw new Error('Nenhuma multa correspondente para gerar pagamento');
  const pagamento = await s.emitirExtrato(alvo.map((m) => ({ ait: m.ait, selecaoValue: m.selecaoValue })));
  const boletoPdfBase64 = (await s.gerarBoleto()).toString('base64');
  return { pagamento, boletoPdfBase64 };
}
