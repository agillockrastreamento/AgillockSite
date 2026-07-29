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
  category?: string;
  lastUpdate?: string;
}

export interface DispositivoAlvo {
  id: number;
  name: string | null;
  uniqueId: string | null;
  status: string | null;
  cliente: string;
  contact: string | null;
  category: string | null; // categoria do Traccar antigo (car, motorcycle, ...) p/ normalizar na importação
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

// A conta do sistema anterior tem ~1000 dispositivos; um cache curto evita
// refazer a chamada a cada consulta e a cada carga do autocomplete de nomes.
let devicesCache: { at: number; data: DeviceAnterior[] } | null = null;
const DEVICES_TTL_MS = 120_000;

async function listarDispositivosCache(cfg: AnteriorConfig): Promise<DeviceAnterior[]> {
  if (devicesCache && Date.now() - devicesCache.at < DEVICES_TTL_MS) return devicesCache.data;
  const data = await listarDispositivos(cfg);
  devicesCache = { at: Date.now(), data };
  return data;
}

// ─── Usuários (contas do painel antigo) ─────────────────────────────────────
// Muitos clientes têm o `contact` do dispositivo genérico (nome da loja, ex.:
// "ATUAL CAR"), mas a CONTA de usuário tem o nome real do cliente. Buscar pela
// conta traz os devices exatos dela via /devices?userId=, sem misturar com
// outras contas que compartilham o mesmo texto de contato.
interface UsuarioAnterior {
  id: number;
  name: string;
  email?: string | null;
}

let usuariosCache: { at: number; data: UsuarioAnterior[] } | null = null;

async function listarUsuariosCache(cfg: AnteriorConfig): Promise<UsuarioAnterior[]> {
  if (usuariosCache && Date.now() - usuariosCache.at < DEVICES_TTL_MS) return usuariosCache.data;
  const res = await fetch(`${cfg.base}/users`, {
    headers: { Accept: 'application/json', Authorization: authHeader(cfg) },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Falha ao listar usuários do sistema anterior: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = ((await res.json()) as UsuarioAnterior[]).filter((u) => u && u.name);
  usuariosCache = { at: Date.now(), data };
  return data;
}

/** Invalida os caches locais da API antiga (usar depois de excluir algo lá). */
export function invalidarCacheAnterior(): void {
  devicesCache = null;
  usuariosCache = null;
  odometrosCache = null;
}

/** Dispositivos de uma conta específica do painel antigo (isola o cliente certo). */
async function devicesDoUsuario(cfg: AnteriorConfig, userId: number): Promise<DeviceAnterior[]> {
  const res = await fetch(`${cfg.base}/devices?userId=${encodeURIComponent(String(userId))}`, {
    headers: { Accept: 'application/json', Authorization: authHeader(cfg) },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Falha ao listar dispositivos do usuário ${userId}: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as DeviceAnterior[];
}

/**
 * Resolve um nome buscado para uma conta de usuário do sistema antigo.
 * Prioriza match exato (nome escolhido no autocomplete); cai para parcial só
 * quando houver exatamente 1 candidato (evita ambiguidade com 1000+ contas).
 */
function resolverUsuario(usuarios: UsuarioAnterior[], nome: string): UsuarioAnterior | null {
  const alvo = norm(nome);
  if (!alvo) return null;
  const exatos = usuarios.filter((u) => norm(u.name) === alvo);
  if (exatos.length) return exatos[0];
  if (alvo.length < 6) return null; // curto demais para um parcial seguro
  const parciais = usuarios.filter((u) => norm(u.name).includes(alvo));
  return parciais.length === 1 ? parciais[0] : null;
}

// ─── Odômetro (km) das últimas posições ─────────────────────────────────────
// O km fica em attributes.totalDistance (metros) da última posição de cada
// dispositivo. Um único GET /positions traz a última posição de todos.
let odometrosCache: { at: number; data: Map<number, number> } | null = null;

/** Mapa: id do dispositivo no sistema anterior → odômetro em METROS. */
export async function mapaOdometros(): Promise<Map<number, number>> {
  const cfg = anteriorConfig();
  if (!cfg) return new Map();
  if (odometrosCache && Date.now() - odometrosCache.at < DEVICES_TTL_MS) return odometrosCache.data;
  const res = await fetch(`${cfg.base}/positions`, {
    headers: { Accept: 'application/json', Authorization: authHeader(cfg) },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Falha ao listar posições do sistema anterior: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  const arr = (await res.json()) as Array<{ deviceId: number; attributes?: Record<string, unknown> }>;
  const map = new Map<number, number>();
  for (const p of arr) {
    const td = p?.attributes?.totalDistance;
    if (typeof td === 'number' && Number.isFinite(td) && td >= 0) map.set(p.deviceId, td);
  }
  odometrosCache = { at: Date.now(), data: map };
  return map;
}

/** Deriva o nome do cliente a partir do campo `contact` (prefixo antes da 1ª barra). */
function nomeDoContato(contact?: string | null): string | null {
  if (!contact) return null;
  const nome = contact
    .split('/')[0] // prefixo antes da 1ª barra
    .replace(/\d{5,}/g, ' ') // remove telefones/sequências longas de dígitos (colados ou no início)
    .replace(/\s+/g, ' ')
    .trim();
  // Precisa ter ao menos uma letra e 3+ caracteres (evita telefones/rótulos vazios).
  if (nome.length < 3 || !/[a-zA-ZÀ-ÿ]/.test(nome)) return null;
  return nome;
}

/**
 * Lista os nomes de clientes distintos do sistema anterior (para o autocomplete
 * da tela). Deriva do prefixo do campo `contact`, dedup por nome normalizado.
 */
export async function listarClientesAnteriores(): Promise<string[]> {
  const cfg = anteriorConfig();
  if (!cfg) throw new Error('Integração com o sistema anterior não configurada (ANTERIOR_API_URL/USER/PASS).');

  const vistos = new Map<string, string>(); // normalizado -> exibição

  // 1) Nomes das CONTAS de usuário do painel antigo (nome real do cliente).
  try {
    const usuarios = await listarUsuariosCache(cfg);
    for (const u of usuarios) {
      const chave = norm(u.name);
      if (chave && !vistos.has(chave)) vistos.set(chave, u.name.trim());
    }
  } catch {
    // se /users falhar, segue só com os nomes derivados do contato
  }

  // 2) Nomes derivados do `contact` dos dispositivos (compat / fallback).
  const devices = await listarDispositivosCache(cfg);
  for (const d of devices) {
    const nome = nomeDoContato(d.contact);
    if (!nome) continue;
    const chave = norm(nome);
    if (!vistos.has(chave)) vistos.set(chave, nome);
  }

  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
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
  const placasNorm = (opts.placas || []).map((p) => norm(p).replace(/\s+/g, '')).filter(Boolean);

  const todosDevices = await listarDispositivosCache(cfg);
  const usuarios = await listarUsuariosCache(cfg).catch(() => [] as UsuarioAnterior[]);

  // Monta os candidatos (dispositivo + rótulo do cliente) para cada nome buscado.
  // Se o nome casa uma CONTA de usuário, traz os devices exatos dela
  // (/devices?userId=); senão, casa pelo prefixo do `contact` (jeito antigo).
  const candidatos: Array<{ d: DeviceAnterior; label: string }> = [];
  const idsVistos = new Set<number>();

  for (const nomeBusca of clientes) {
    const user = resolverUsuario(usuarios, nomeBusca);
    if (user) {
      const devs = await devicesDoUsuario(cfg, user.id).catch(() => [] as DeviceAnterior[]);
      for (const d of devs) {
        if (idsVistos.has(d.id)) continue;
        idsVistos.add(d.id);
        candidatos.push({ d, label: user.name });
      }
    } else {
      const an = norm(nomeBusca);
      if (!an) continue;
      for (const d of todosDevices) {
        if (idsVistos.has(d.id)) continue;
        if (norm(d.contact).includes(an)) {
          idsVistos.add(d.id);
          candidatos.push({ d, label: nomeBusca });
        }
      }
    }
  }

  const alvos: DispositivoAlvo[] = [];
  let excluidosPorTamanho = 0;

  for (const { d, label } of candidatos) {
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
        cliente: label,
        contact: d.contact ?? null,
        category: d.category ?? null,
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
    totalNaConta: todosDevices.length,
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

// ─── Limpeza: apagar dados do sistema anterior ──────────────────────────────
// Usado pela aba "Apagar do Sistema Anterior". Tudo aqui é IRREVERSÍVEL no
// painel antigo — a validação de "só apaga o que já foi apontado para cá" fica
// na rota (precisa do banco), não neste serviço.

export interface UsuarioAnteriorResumo {
  id: number;
  name: string;
  email: string | null;
}

export interface MotoristaAnterior {
  id: number;
  name: string | null;
  uniqueId: string | null;
}

export interface GeocercaAnterior {
  id: number;
  name: string | null;
}

export interface DispositivoAnteriorDetalhe {
  id: number;
  name: string | null;
  uniqueId: string | null;
  status: string | null;
  lastUpdate: string | null;
  contact: string | null;
  category: string | null;
}

export interface DetalheClienteAnterior {
  usuario: UsuarioAnteriorResumo;
  dispositivos: DispositivoAnteriorDetalhe[];
  motoristas: MotoristaAnterior[];
  geocercas: GeocercaAnterior[];
}

/** Contas do sistema anterior (id + nome + e-mail) para o select com busca. */
export async function listarUsuariosAnteriores(): Promise<UsuarioAnteriorResumo[]> {
  const cfg = anteriorConfig();
  if (!cfg) throw new Error('Integração com o sistema anterior não configurada (ANTERIOR_API_URL/USER/PASS).');
  const usuarios = await listarUsuariosCache(cfg);
  return usuarios
    .map((u) => ({ id: u.id, name: (u.name || '').trim(), email: u.email ?? null }))
    .filter((u) => u.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function getJson<T>(cfg: AnteriorConfig, path: string, fallback: T): Promise<T> {
  const res = await fetch(`${cfg.base}${path}`, {
    headers: { Accept: 'application/json', Authorization: authHeader(cfg) },
  });
  if (!res.ok) return fallback;
  return (await res.json()) as T;
}

/**
 * Tudo o que a conta do sistema anterior tem: dispositivos, motoristas e
 * geocercas. Os motoristas vêm da conta e também dos dispositivos dela (no
 * painel antigo o vínculo às vezes é motorista↔dispositivo, não motorista↔conta).
 */
export async function detalharClienteAnterior(userId: number): Promise<DetalheClienteAnterior> {
  const cfg = anteriorConfig();
  if (!cfg) throw new Error('Integração com o sistema anterior não configurada (ANTERIOR_API_URL/USER/PASS).');

  const usuarios = await listarUsuariosCache(cfg);
  const usuario = usuarios.find((u) => u.id === userId);
  if (!usuario) throw new Error(`Conta ${userId} não encontrada no sistema anterior.`);

  const devices = await devicesDoUsuario(cfg, userId);

  const motoristas = new Map<number, MotoristaAnterior>();
  const daConta = await getJson<MotoristaAnterior[]>(cfg, `/drivers?userId=${userId}`, []);
  for (const d of daConta) motoristas.set(d.id, { id: d.id, name: d.name ?? null, uniqueId: d.uniqueId ?? null });
  // Vínculos por dispositivo (limitado para não explodir em contas com 50+ carros).
  for (const dev of devices.slice(0, 60)) {
    const doDevice = await getJson<MotoristaAnterior[]>(cfg, `/drivers?deviceId=${dev.id}`, []);
    for (const d of doDevice) {
      if (!motoristas.has(d.id)) motoristas.set(d.id, { id: d.id, name: d.name ?? null, uniqueId: d.uniqueId ?? null });
    }
  }

  const geo = await getJson<GeocercaAnterior[]>(cfg, `/geofences?userId=${userId}`, []);

  return {
    usuario: { id: usuario.id, name: (usuario.name || '').trim(), email: usuario.email ?? null },
    dispositivos: devices.map((d) => ({
      id: d.id,
      name: d.name ?? null,
      uniqueId: d.uniqueId ?? null,
      status: d.status ?? null,
      lastUpdate: d.lastUpdate ?? null,
      contact: d.contact ?? null,
      category: d.category ?? null,
    })),
    motoristas: [...motoristas.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')),
    geocercas: geo.map((g) => ({ id: g.id, name: g.name ?? null })),
  };
}

export interface ExclusaoItem {
  tipo: 'dispositivo' | 'motorista' | 'geocerca' | 'cliente';
  id: number;
  nome: string | null;
  uniqueId: string | null;
  ok: boolean;
  http: number | null;
  resp: string;
  // Só para dispositivos: se estava apontado para a AgilLock no momento da
  // exclusão. Guardado no histórico — é a prova de que o admin optou por
  // apagar um rastreador que ainda não estava reportando aqui.
  apontado?: boolean;
  motivo?: string | null;
}

/** DELETE genérico na API antiga. 204/200 = apagado; 404 = já não existia (conta como ok). */
async function excluirNoAnterior(
  tipo: ExclusaoItem['tipo'],
  path: string,
  id: number,
  nome: string | null,
  uniqueId: string | null,
): Promise<ExclusaoItem> {
  const cfg = anteriorConfig();
  if (!cfg) throw new Error('Integração com o sistema anterior não configurada (ANTERIOR_API_URL/USER/PASS).');
  try {
    const res = await fetch(`${cfg.base}${path}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: authHeader(cfg) },
    });
    const ok = res.status === 204 || res.status === 200 || res.status === 404;
    const resp = ok ? (res.status === 404 ? 'Já não existia no sistema anterior.' : '') : (await res.text().catch(() => '')).slice(0, 200);
    return { tipo, id, nome, uniqueId, ok, http: res.status, resp };
  } catch (e) {
    return { tipo, id, nome, uniqueId, ok: false, http: null, resp: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

export function excluirDispositivoAnterior(id: number, nome: string | null, uniqueId: string | null) {
  return excluirNoAnterior('dispositivo', `/devices/${id}`, id, nome, uniqueId);
}
export function excluirMotoristaAnterior(id: number, nome: string | null, uniqueId: string | null) {
  return excluirNoAnterior('motorista', `/drivers/${id}`, id, nome, uniqueId);
}
export function excluirGeocercaAnterior(id: number, nome: string | null) {
  return excluirNoAnterior('geocerca', `/geofences/${id}`, id, nome, null);
}
export function excluirUsuarioAnterior(id: number, nome: string | null) {
  return excluirNoAnterior('cliente', `/users/${id}`, id, nome, null);
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
