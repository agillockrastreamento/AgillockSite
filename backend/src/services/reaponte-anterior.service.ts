/**
 * Integração com o SISTEMA ANTERIOR (monitorando.me) para trazer dispositivos
 * para a AgilLock.
 *
 * É o equivalente, no servidor, do script manual `DadosDoSistemaAnterior/reapontar.py`:
 * consulta os dispositivos de um cliente no sistema antigo e envia o comando GT06
 * de troca de servidor (SERVER,...) para que os rastreadores passem a reportar
 * para a VPS da AgilLock.
 *
 * A credencial do sistema antigo (Basic Auth) fica SOMENTE aqui no servidor,
 * lida do .env — nunca vai para o navegador.
 */

// Comando GT06 padrão de troca de servidor (IP/porta da VPS da AgilLock).
// Pode ser sobrescrito por request (ex.: Suntech com ${dispositivo}).
const COMANDO_PADRAO = process.env.ANTERIOR_REAPONTE_COMANDO || 'SERVER,0,72.62.13.73,5023,0#';

interface AnteriorConfig {
  base: string;
  user: string;
  pass: string;
}

function anteriorConfig(): AnteriorConfig | null {
  const base = (process.env.ANTERIOR_API_URL || 'https://server.monitorando.me/api').replace(/\/+$/, '');
  const user = process.env.ANTERIOR_USER || '';
  const pass = process.env.ANTERIOR_PASS || '';
  if (!base || !user || !pass) return null;
  return { base, user, pass };
}

export function integracaoAnteriorConfigurada(): boolean {
  return anteriorConfig() !== null;
}

function authHeader(cfg: AnteriorConfig): string {
  // IMPORTANTE: a API do sistema antigo exige HTTP Basic Auth. Login por cookie NÃO funciona.
  return 'Basic ' + Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');
}

/** minúsculas, sem acento, espaços colapsados — para casar nomes com segurança. */
function norm(s?: string | null): string {
  return (s || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Exposto para casar o nome do cliente do sistema antigo com o cadastro daqui. */
export function normalizarNome(s?: string | null): string {
  return norm(s);
}

function soDigitos(v?: string | null): string {
  return (v || '').replace(/\D/g, '');
}

// ─── Tipos ──────────────────────────────────────────────────────────────────

/** Device cru como vem da API do sistema antigo (campos que usamos). */
interface DeviceAnterior {
  id: number;
  name?: string;
  uniqueId?: string;
  status?: string;
  contact?: string;
  lastUpdate?: string;
}

export interface DispositivoAlvo {
  id: number;
  name: string | null;
  uniqueId: string | null;
  status: string | null;
  cliente: string;
  contact: string | null;
  // Preenchido no endpoint: se o IMEI já existe como Dispositivo na AgilLock.
  existeAqui?: boolean;
}

export interface ConsultaClienteResultado {
  clientes: string[];
  placas: string[];
  digitos: number;
  totalNaConta: number;
  encontrados: number;
  excluidosPorTamanho: number;
  online: number;
  offline: number;
  alvos: DispositivoAlvo[];
}

export interface ReaponteItem {
  id: number;
  name: string | null;
  uniqueId: string | null;
  status: string | null;
  cliente: string;
  http: number | null;
  ok: boolean;
  entrega: 'imediata' | 'enfileirado' | '—';
  resp: string;
}

export interface ReaponteResultado {
  comando: string;
  total: number;
  ok: number;
  erro: number;
  itens: ReaponteItem[];
}

// ─── Chamadas à API do sistema anterior ─────────────────────────────────────

/** O nome do cliente fica no PREFIXO do campo `contact` do dispositivo. */
function clienteDoDispositivo(dev: DeviceAnterior, alvosNorm: Array<[string, string]>): string | null {
  const c = norm(dev.contact);
  for (const [orig, an] of alvosNorm) {
    if (an && c.includes(an)) return orig;
  }
  return null;
}

async function listarDispositivos(cfg: AnteriorConfig): Promise<DeviceAnterior[]> {
  const res = await fetch(`${cfg.base}/devices?all=true`, {
    headers: { Accept: 'application/json', Authorization: authHeader(cfg) },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Falha ao listar dispositivos do sistema anterior: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as DeviceAnterior[];
}

/**
 * Consulta (dry-run) os dispositivos de um ou mais clientes no sistema anterior,
 * aplicando o filtro de dígitos do IMEI e, opcionalmente, de placas específicas.
 */
export async function consultarCliente(
  clientes: string[],
  opts: { digitos?: number; placas?: string[] } = {},
): Promise<ConsultaClienteResultado> {
  const cfg = anteriorConfig();
  if (!cfg) throw new Error('Integração com o sistema anterior não configurada (ANTERIOR_API_URL/USER/PASS).');

  const digitos = opts.digitos ?? 15;
  const alvosNorm: Array<[string, string]> = clientes.map((c) => [c, norm(c)]);
  const placasNorm = (opts.placas || []).map((p) => norm(p).replace(/\s+/g, '')).filter(Boolean);

  const devices = await listarDispositivos(cfg);

  const alvos: DispositivoAlvo[] = [];
  let excluidosPorTamanho = 0;

  for (const d of devices) {
    const cli = clienteDoDispositivo(d, alvosNorm);
    if (!cli) continue;

    if (placasNorm.length) {
      const nomeNorm = norm(d.name).replace(/\s+/g, '');
      if (!placasNorm.some((p) => nomeNorm.includes(p))) continue;
    }

    if (digitos === 0 || soDigitos(d.uniqueId).length === digitos) {
      alvos.push({
        id: d.id,
        name: d.name ?? null,
        uniqueId: d.uniqueId ?? null,
        status: d.status ?? null,
        cliente: cli,
        contact: d.contact ?? null,
      });
    } else {
      excluidosPorTamanho++;
    }
  }

  alvos.sort((a, b) => (a.cliente + (a.name || '')).localeCompare(b.cliente + (b.name || '')));

  const online = alvos.filter((a) => a.status === 'online').length;

  return {
    clientes,
    placas: opts.placas || [],
    digitos,
    totalNaConta: devices.length,
    encontrados: alvos.length,
    excluidosPorTamanho,
    online,
    offline: alvos.length - online,
    alvos,
  };
}

function aplicarVariavelComando(comando: string, uniqueId: string): string {
  return comando.split('{$dispositivo}').join(uniqueId).split('${dispositivo}').join(uniqueId);
}

/**
 * Envia o comando de reapontamento para uma lista de dispositivos (por id do
 * sistema antigo). Retorna o resultado item a item + resumo (X OK, Y erro).
 */
export async function reapontarDispositivos(
  alvos: Array<{ id: number; name?: string | null; uniqueId?: string | null; status?: string | null; cliente?: string | null }>,
  opts: { comando?: string } = {},
): Promise<ReaponteResultado> {
  const cfg = anteriorConfig();
  if (!cfg) throw new Error('Integração com o sistema anterior não configurada (ANTERIOR_API_URL/USER/PASS).');

  const comando = (opts.comando || COMANDO_PADRAO).trim();
  const itens: ReaponteItem[] = [];

  for (const d of alvos) {
    const cmdFinal = aplicarVariavelComando(comando, String(d.uniqueId ?? ''));
    const body = { deviceId: d.id, type: 'custom', attributes: { data: cmdFinal } };
    try {
      const rr = await fetch(`${cfg.base}/commands/send`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authHeader(cfg),
        },
        body: JSON.stringify(body),
      });
      const ok = [200, 201, 202].includes(rr.status);
      const entrega: ReaponteItem['entrega'] =
        rr.status === 200 ? 'imediata' : rr.status === 202 ? 'enfileirado' : '—';
      const resp = ok ? '' : (await rr.text().catch(() => '')).slice(0, 200);
      itens.push({
        id: d.id,
        name: d.name ?? null,
        uniqueId: d.uniqueId ?? null,
        status: d.status ?? null,
        cliente: d.cliente ?? '',
        http: rr.status,
        ok,
        entrega,
        resp,
      });
    } catch (e) {
      itens.push({
        id: d.id,
        name: d.name ?? null,
        uniqueId: d.uniqueId ?? null,
        status: d.status ?? null,
        cliente: d.cliente ?? '',
        http: null,
        ok: false,
        entrega: '—',
        resp: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
    // pequeno respiro entre envios (igual ao script)
    await new Promise((r) => setTimeout(r, 200));
  }

  const ok = itens.filter((i) => i.ok).length;
  return { comando, total: itens.length, ok, erro: itens.length - ok, itens };
}

// ─── Planilha do resultado (.xlsx) ──────────────────────────────────────────

/**
 * Gera a planilha do envio, no mesmo espírito do `gerar-planilha.py`:
 * verde = entregue na hora (200), amarelo = enfileirado (202), vermelho = erro.
 */
export async function gerarPlanilhaReaponte(
  itens: ReaponteItem[],
  meta: { clienteNome?: string; comando?: string } = {},
): Promise<Buffer> {
  // import dinâmico para não pesar o boot do serviço com o exceljs
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reapontamento');

  ws.columns = [
    { header: 'Cliente', key: 'cliente', width: 32 },
    { header: 'Veículo', key: 'name', width: 26 },
    { header: 'IMEI', key: 'uniqueId', width: 20 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'HTTP', key: 'http', width: 8 },
    { header: 'Resultado', key: 'resultado', width: 22 },
    { header: 'Detalhe', key: 'resp', width: 40 },
  ];

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203040' } };

  const VERDE = 'FFC6EFCE';
  const AMARELO = 'FFFFEB9C';
  const VERMELHO = 'FFFFC7CE';

  for (const i of itens) {
    const resultado = !i.ok
      ? 'ERRO'
      : i.entrega === 'imediata'
        ? 'OK (imediata)'
        : i.entrega === 'enfileirado'
          ? 'OK (enfileirado)'
          : 'OK';
    const row = ws.addRow({
      cliente: i.cliente,
      name: i.name || '',
      uniqueId: i.uniqueId || '',
      status: i.status || '',
      http: i.http ?? '',
      resultado,
      resp: i.resp || '',
    });
    const cor = !i.ok ? VERMELHO : i.entrega === 'enfileirado' ? AMARELO : VERDE;
    row.getCell('resultado').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
  }

  // Rodapé com resumo
  const ok = itens.filter((i) => i.ok).length;
  ws.addRow({});
  const resumo = ws.addRow({ cliente: `RESUMO: ${ok} OK, ${itens.length - ok} com erro (de ${itens.length})` });
  resumo.font = { bold: true };
  if (meta.comando) ws.addRow({ cliente: `Comando: ${meta.comando}` });

  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
