// Geração dos relatórios de rastreamento em XLSX (dados, filtrável) e PDF (visual,
// com gráficos). Substitui o export nativo do Traccar (que não conhece o cartão
// RFID vindo no atributo `serial`). Ver [[project_motorista_relatorio_viagens]].
import ExcelJS from 'exceljs';
import prisma from '../utils/prisma';
import {
  traccarGetDevices,
  traccarGetTrips,
  traccarGetStops,
  traccarGetEvents,
  traccarGetSummary,
  traccarGetPositionHistory,
  normalizeAttributes,
  cartaoDaPosicao,
  EVENT_TYPE_LABELS,
  ALARM_LABELS,
} from './traccar.service';
import type { TraccarPosition } from './traccar.service';
import {
  DISPOSITIVO_MEDIDORES_SELECT,
  aplicarViagensComMedidores,
  aplicarParadasComMedidores,
  aplicarResumoComMedidores,
} from './medidores.service';
import { carregarResolvedorMotoristas, cartaoDaViagem, cartaoAntesDe } from './motoristas.service';
import { htmlParaPdf } from './pdf.service';
import { reverseGeocode } from '../utils/reverse-geocode';

const FUSO = 'America/Sao_Paulo';
const COR = '#fab32c';       // laranja AgilLock
const COR_ESCURA = '1E2530'; // cabeçalho de tabela (sem #, formato ARGB usa FF prefixo)

export type TipoRelatorio = 'route' | 'events' | 'trips' | 'stops' | 'summary' | 'completo';

// ── Formatação ────────────────────────────────────────────────────────────────
function fmtDataHora(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pt-BR', { timeZone: FUSO });
}
function fmtDia(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
}
function fmtDuracaoMin(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${m}min` : `${m}min`;
}
function num(v: number): string { return (Math.round(v * 10) / 10).toLocaleString('pt-BR'); }
function escHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Endereços (reverse-geocode) ─────────────────────────────────────────────────
// O Traccar devolve endereço nulo; a tela resolve no navegador. Aqui resolvemos no
// servidor, com dedup por coordenada arredondada e um teto de chamadas por relatório.
function coordKey(lat: number, lon: number): string { return `${lat.toFixed(4)},${lon.toFixed(4)}`; }
function coordsFallback(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return '';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
async function preResolverEnderecos(pontos: { lat: number; lon: number }[], cache: Map<string, string>, maxChamadas: number): Promise<void> {
  const pendentes: { k: string; lat: number; lon: number }[] = [];
  const vistos = new Set<string>();
  for (const p of pontos) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || (p.lat === 0 && p.lon === 0)) continue;
    const k = coordKey(p.lat, p.lon);
    if (cache.has(k) || vistos.has(k)) continue;
    vistos.add(k);
    pendentes.push({ k, lat: p.lat, lon: p.lon });
  }
  const alvo = pendentes.slice(0, maxChamadas);
  let idx = 0;
  const worker = async (): Promise<void> => {
    while (idx < alvo.length) {
      const cur = alvo[idx++];
      const end = await reverseGeocode(cur.lat, cur.lon).catch(() => '');
      cache.set(cur.k, end);
    }
  };
  await Promise.all(Array.from({ length: 5 }, () => worker()));
}

// ── Dataset ───────────────────────────────────────────────────────────────────
export interface RelatorioDataset {
  periodo: { fromIso: string; toIso: string };
  geradoEm: Date;
  dispositivos: string[];
  viagens: { veiculo: string; motorista: string; inicio: string; fim: string; duracaoMin: number; distanciaKm: number; velMedia: number; velMax: number; origem: string; destino: string }[];
  paradas: { veiculo: string; inicio: string; fim: string; duracaoMin: number; endereco: string; horasMotor: number; combustivel: number }[];
  eventos: { veiculo: string; dataHora: string; tipo: string; motorista: string; detalhe: string }[];
  resumo: { veiculo: string; distanciaKm: number; velMedia: number; velMax: number; horasMotor: number; combustivel: number }[];
  rota: { veiculo: string; dataHora: string; lat: number; lon: number; velKmh: number; curso: number; ignicao: boolean | null; odometroKm: number | null; motorista: string; endereco: string }[];
  agregado: {
    totalKm: number; totalViagens: number; totalParadas: number; totalMotoristas: number; totalHorasMotor: number;
    kmPorDia: { label: string; valor: number }[];
    viagensPorMotorista: { label: string; valor: number }[];
    kmPorVeiculo: { label: string; valor: number }[];
  };
}

export async function coletarDadosRelatorio(traccarIds: number[], fromIso: string, toIso: string): Promise<RelatorioDataset> {
  const fromDate = new Date(fromIso), toDate = new Date(toIso);
  const [devices, trips, stops, events, summaries, positions, resolver] = await Promise.all([
    traccarGetDevices(),
    traccarGetTrips(traccarIds, fromDate, toDate).catch(() => []),
    traccarGetStops(traccarIds, fromDate, toDate).catch(() => []),
    traccarGetEvents(traccarIds, fromDate, toDate).catch(() => []),
    traccarGetSummary(traccarIds, fromDate, toDate).catch(() => []),
    traccarGetPositionHistory(traccarIds, fromDate, toDate).catch(() => []),
    carregarResolvedorMotoristas(),
  ]);

  const idSet = new Set(traccarIds);
  const devFiltrados = devices.filter(d => idSet.has(d.id));
  const nomePorId = new Map(devFiltrados.map(d => [d.id, d.name]));
  const locais = await prisma.dispositivo.findMany({
    where: { identificador: { in: devFiltrados.map(d => d.uniqueId) } },
    select: { identificador: true, ...DISPOSITIVO_MEDIDORES_SELECT },
  });
  const localPorUnique = new Map(locais.map(l => [l.identificador, l]));
  const localPorId = new Map(devFiltrados.map(d => [d.id, localPorUnique.get(d.uniqueId)]));

  const posPorId = new Map<number, TraccarPosition[]>();
  for (const p of positions) {
    const arr = posPorId.get(p.deviceId) || [];
    arr.push(p);
    posPorId.set(p.deviceId, arr);
  }
  const nomeMotorista = (cartao: string | null): string => {
    if (!cartao) return '';
    const m = resolver(cartao);
    return m ? m.nome : `ID ${cartao}`;
  };

  // Resolve endereços de início/fim das viagens e das paradas (Traccar vem nulo)
  const geoCache = new Map<string, string>();
  const pontosGeo: { lat: number; lon: number }[] = [];
  for (const t of trips) { pontosGeo.push({ lat: t.startLat, lon: t.startLon }, { lat: t.endLat, lon: t.endLon }); }
  for (const s of stops) { pontosGeo.push({ lat: s.lat, lon: s.lon }); }
  await preResolverEnderecos(pontosGeo, geoCache, 200);
  const enderecoDe = (lat: number, lon: number): string => geoCache.get(coordKey(lat, lon)) || coordsFallback(lat, lon);

  const viagens = trips.map(t => {
    const disp = localPorId.get(t.deviceId);
    const posDev = posPorId.get(t.deviceId) || [];
    const tm = disp ? aplicarViagensComMedidores(disp, [t], posDev)[0] : t;
    return {
      veiculo: t.deviceName,
      motorista: nomeMotorista(cartaoDaViagem(t, posDev)),
      inicio: t.startTime, fim: t.endTime,
      duracaoMin: Math.round(tm.duration / 60000),
      distanciaKm: Math.round(tm.distance / 100) / 10,
      velMedia: Math.round(t.averageSpeed * 1.852),
      velMax: Math.round(tm.maxSpeed * 1.852),
      origem: t.startAddress || enderecoDe(t.startLat, t.startLon),
      destino: t.endAddress || enderecoDe(t.endLat, t.endLon),
    };
  });

  const paradas = stops.map(s => {
    const posDev = posPorId.get(s.deviceId) || [];
    const sm = aplicarParadasComMedidores([s], posDev)[0];
    return {
      veiculo: s.deviceName, inicio: s.startTime, fim: s.endTime,
      duracaoMin: Math.round((s.duration || 0) / 60000), endereco: s.address || enderecoDe(s.lat, s.lon),
      horasMotor: Math.round((sm.engineHours || 0) / 3600000 * 10) / 10, combustivel: Math.round((s.spentFuel || 0) * 10) / 10,
    };
  });

  const eventos = events.map(e => {
    const posDev = posPorId.get(e.deviceId) || [];
    const cartao = cartaoAntesDe(posDev, new Date(e.eventTime).getTime());
    let detalhe = '';
    if (e.type === 'alarm' && e.attributes?.alarm) detalhe = ALARM_LABELS[String(e.attributes.alarm)] ?? String(e.attributes.alarm);
    return {
      veiculo: nomePorId.get(e.deviceId) || String(e.deviceId), dataHora: e.eventTime,
      tipo: EVENT_TYPE_LABELS[e.type] ?? e.type, motorista: nomeMotorista(cartao), detalhe,
    };
  });

  const resumo = summaries.map(s => {
    const disp = localPorId.get(s.deviceId);
    const posDev = posPorId.get(s.deviceId) || [];
    const sm = disp ? aplicarResumoComMedidores(disp, s, posDev) : s;
    return {
      veiculo: s.deviceName, distanciaKm: Math.round(sm.distance / 100) / 10,
      velMedia: Math.round(s.averageSpeed * 1.852), velMax: Math.round(sm.maxSpeed * 1.852),
      horasMotor: Math.round((sm.engineHours || 0) / 3600000 * 10) / 10, combustivel: Math.round((s.spentFuel || 0) * 10) / 10,
    };
  });

  const rota = positions.map(p => {
    const norm = normalizeAttributes(p.attributes);
    const cartao = cartaoDaPosicao(p.attributes);
    return {
      veiculo: nomePorId.get(p.deviceId) || String(p.deviceId), dataHora: p.deviceTime || p.fixTime,
      lat: p.latitude, lon: p.longitude, velKmh: Math.round((p.speed || 0) * 1.852), curso: Math.round(p.course || 0),
      ignicao: norm.ignicao, odometroKm: norm.odometro != null ? Math.round(norm.odometro / 1000) : null,
      motorista: nomeMotorista(cartao ? cartao.cartao : null),
      endereco: p.address || geoCache.get(coordKey(p.latitude, p.longitude)) || coordsFallback(p.latitude, p.longitude),
    };
  });

  // ── Agregados p/ gráficos ──
  const kmPorDiaMap = new Map<string, number>();
  for (const v of viagens) {
    const dia = fmtDia(v.inicio);
    kmPorDiaMap.set(dia, (kmPorDiaMap.get(dia) || 0) + v.distanciaKm);
  }
  const kmPorDia = [...kmPorDiaMap.entries()].map(([label, valor]) => ({ label, valor: Math.round(valor * 10) / 10 }));

  const vpmMap = new Map<string, number>();
  for (const v of viagens) {
    const chave = v.motorista || 'Não identificado';
    vpmMap.set(chave, (vpmMap.get(chave) || 0) + 1);
  }
  const viagensPorMotorista = [...vpmMap.entries()].map(([label, valor]) => ({ label, valor })).sort((a, b) => b.valor - a.valor).slice(0, 12);

  const kpvMap = new Map<string, number>();
  for (const v of viagens) kpvMap.set(v.veiculo, (kpvMap.get(v.veiculo) || 0) + v.distanciaKm);
  const kmPorVeiculo = [...kpvMap.entries()].map(([label, valor]) => ({ label, valor: Math.round(valor * 10) / 10 })).sort((a, b) => b.valor - a.valor).slice(0, 12);

  const totalKm = resumo.length ? resumo.reduce((s, r) => s + r.distanciaKm, 0) : viagens.reduce((s, v) => s + v.distanciaKm, 0);
  const totalHorasMotor = resumo.reduce((s, r) => s + r.horasMotor, 0);
  const motoristasDistintos = new Set(viagens.map(v => v.motorista).filter(Boolean));

  return {
    periodo: { fromIso, toIso },
    geradoEm: new Date(),
    dispositivos: devFiltrados.map(d => d.name),
    viagens, paradas, eventos, resumo, rota,
    agregado: {
      totalKm: Math.round(totalKm * 10) / 10, totalViagens: viagens.length, totalParadas: paradas.length,
      totalMotoristas: motoristasDistintos.size, totalHorasMotor: Math.round(totalHorasMotor * 10) / 10,
      kmPorDia, viagensPorMotorista, kmPorVeiculo,
    },
  };
}

// ── XLSX ──────────────────────────────────────────────────────────────────────
function estilizarCabecalho(ws: ExcelJS.Worksheet, numCols: number): void {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COR_ESCURA } };
  header.alignment = { vertical: 'middle' };
  header.height = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: numCols } };
}

export async function gerarRelatorioXlsx(ds: RelatorioDataset, tipo: TipoRelatorio): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AgilLock';
  wb.created = ds.geradoEm;

  const inc = (t: TipoRelatorio) => tipo === 'completo' || tipo === t;

  if (inc('summary')) {
    const ws = wb.addWorksheet('Resumo');
    ws.columns = [
      { header: 'Veículo', key: 'v', width: 28 }, { header: 'Distância (km)', key: 'km', width: 15 },
      { header: 'Vel. média (km/h)', key: 'vm', width: 16 }, { header: 'Vel. máx (km/h)', key: 'vx', width: 15 },
      { header: 'Horas de motor', key: 'hm', width: 15 }, { header: 'Combustível', key: 'c', width: 13 },
    ];
    ds.resumo.forEach(r => ws.addRow({ v: r.veiculo, km: r.distanciaKm, vm: r.velMedia, vx: r.velMax, hm: r.horasMotor, c: r.combustivel }));
    estilizarCabecalho(ws, 6);
  }
  if (inc('trips')) {
    const ws = wb.addWorksheet('Viagens');
    ws.columns = [
      { header: 'Veículo', key: 'v', width: 26 }, { header: 'Motorista', key: 'm', width: 26 },
      { header: 'Início', key: 'i', width: 20 }, { header: 'Fim', key: 'f', width: 20 }, { header: 'Duração', key: 'd', width: 12 },
      { header: 'Distância (km)', key: 'km', width: 14 }, { header: 'Vel. média (km/h)', key: 'vm', width: 16 },
      { header: 'Vel. máx (km/h)', key: 'vx', width: 15 }, { header: 'Origem', key: 'o', width: 46 }, { header: 'Destino', key: 'de', width: 46 },
    ];
    ds.viagens.forEach(v => ws.addRow({
      v: v.veiculo, m: v.motorista, i: fmtDataHora(v.inicio), f: fmtDataHora(v.fim), d: fmtDuracaoMin(v.duracaoMin),
      km: v.distanciaKm, vm: v.velMedia, vx: v.velMax, o: v.origem, de: v.destino,
    }));
    estilizarCabecalho(ws, 10);
  }
  if (inc('stops')) {
    const ws = wb.addWorksheet('Paradas');
    ws.columns = [
      { header: 'Veículo', key: 'v', width: 26 }, { header: 'Início', key: 'i', width: 20 }, { header: 'Fim', key: 'f', width: 20 },
      { header: 'Duração', key: 'd', width: 12 }, { header: 'Horas de motor', key: 'hm', width: 15 },
      { header: 'Combustível', key: 'c', width: 13 }, { header: 'Endereço', key: 'e', width: 50 },
    ];
    ds.paradas.forEach(p => ws.addRow({ v: p.veiculo, i: fmtDataHora(p.inicio), f: fmtDataHora(p.fim), d: fmtDuracaoMin(p.duracaoMin), hm: p.horasMotor, c: p.combustivel, e: p.endereco }));
    estilizarCabecalho(ws, 7);
  }
  if (inc('events')) {
    const ws = wb.addWorksheet('Eventos');
    ws.columns = [
      { header: 'Veículo', key: 'v', width: 26 }, { header: 'Data/Hora', key: 'dh', width: 20 },
      { header: 'Evento', key: 'ev', width: 24 }, { header: 'Motorista', key: 'm', width: 26 }, { header: 'Detalhes', key: 'd', width: 30 },
    ];
    ds.eventos.forEach(e => ws.addRow({ v: e.veiculo, dh: fmtDataHora(e.dataHora), ev: e.tipo, m: e.motorista, d: e.detalhe }));
    estilizarCabecalho(ws, 5);
  }
  if (inc('route')) {
    const ws = wb.addWorksheet('Rota');
    ws.columns = [
      { header: 'Veículo', key: 'v', width: 26 }, { header: 'Data/Hora', key: 'dh', width: 20 },
      { header: 'Latitude', key: 'lat', width: 12 }, { header: 'Longitude', key: 'lon', width: 12 },
      { header: 'Vel. (km/h)', key: 'vel', width: 11 }, { header: 'Ignição', key: 'ig', width: 9 },
      { header: 'Odômetro (km)', key: 'od', width: 14 }, { header: 'Motorista', key: 'm', width: 24 }, { header: 'Endereço', key: 'e', width: 50 },
    ];
    ds.rota.forEach(p => ws.addRow({
      v: p.veiculo, dh: fmtDataHora(p.dataHora), lat: p.lat, lon: p.lon, vel: p.velKmh,
      ig: p.ignicao == null ? '' : (p.ignicao ? 'Sim' : 'Não'), od: p.odometroKm, m: p.motorista, e: p.endereco,
    }));
    estilizarCabecalho(ws, 9);
  }

  if (wb.worksheets.length === 0) wb.addWorksheet('Relatório'); // evita xlsx inválido
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

// ── PDF (gráficos em SVG inline) ────────────────────────────────────────────────
function svgBarras(dados: { label: string; valor: number }[], cor: string): string {
  if (!dados.length) return '<div style="color:#999;font-size:12px;padding:20px 0">Sem dados para o período.</div>';
  const w = 760, h = 190, padL = 34, padR = 12, padT = 14, padB = 44;
  const max = Math.max(1, ...dados.map(d => d.valor));
  const areaW = w - padL - padR, areaH = h - padT - padB;
  const bw = areaW / dados.length;
  const barras = dados.map((d, i) => {
    const bh = areaH * (d.valor / max);
    const x = padL + i * bw + bw * 0.18;
    const y = padT + areaH - bh;
    const barW = bw * 0.64;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${cor}"/>`
      + `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#444">${num(d.valor)}</text>`
      + `<text x="${(x + barW / 2).toFixed(1)}" y="${(padT + areaH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="#777">${escHtml(d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg">`
    + `<line x1="${padL}" y1="${padT + areaH}" x2="${w - padR}" y2="${padT + areaH}" stroke="#ddd"/>${barras}</svg>`;
}

function tabelaHtml(titulo: string, colunas: string[], linhas: string[][], vazio: string): string {
  const ths = colunas.map(c => `<th>${escHtml(c)}</th>`).join('');
  const trs = linhas.length
    ? linhas.map(l => `<tr>${l.map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${colunas.length}" style="text-align:center;color:#999;padding:16px">${escHtml(vazio)}</td></tr>`;
  return `<h2>${escHtml(titulo)}</h2><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

export async function gerarRelatorioPdf(ds: RelatorioDataset): Promise<Buffer> {
  const a = ds.agregado;
  const periodo = `${fmtDataHora(ds.periodo.fromIso)} — ${fmtDataHora(ds.periodo.toIso)}`;
  const kpi = (valor: string, rotulo: string) =>
    `<div class="kpi"><div class="kpi-v">${escHtml(valor)}</div><div class="kpi-l">${escHtml(rotulo)}</div></div>`;

  const viagensRows = ds.viagens.slice(0, 300).map(v => [v.veiculo, v.motorista || '—', fmtDataHora(v.inicio), fmtDuracaoMin(v.duracaoMin), num(v.distanciaKm) + ' km', v.velMax + ' km/h', v.origem + ' → ' + v.destino]);
  const paradasRows = ds.paradas.slice(0, 200).map(p => [p.veiculo, fmtDataHora(p.inicio), fmtDuracaoMin(p.duracaoMin), num(p.horasMotor) + ' h', p.endereco]);
  const eventosRows = ds.eventos.slice(0, 300).map(e => [e.veiculo, fmtDataHora(e.dataHora), e.tipo, e.motorista || '—', e.detalhe]);
  const resumoRows = ds.resumo.map(r => [r.veiculo, num(r.distanciaKm) + ' km', r.velMedia + ' km/h', r.velMax + ' km/h', num(r.horasMotor) + ' h']);

  const html = `
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #263238; font-size: 12px; }
    .capa { border-left: 6px solid ${COR}; padding: 8px 0 8px 14px; margin-bottom: 18px; }
    .capa h1 { margin: 0 0 4px; font-size: 22px; }
    .capa .sub { color: #607d8b; font-size: 12px; }
    .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin: 6px 0 20px; }
    .kpi { flex: 1; min-width: 120px; background: #f6f8fa; border-radius: 10px; padding: 12px 14px; border-top: 3px solid ${COR}; }
    .kpi-v { font-size: 22px; font-weight: 700; color: #1e2530; }
    .kpi-l { font-size: 11px; color: #78909c; text-transform: uppercase; letter-spacing: .03em; }
    .card { background: #fff; border: 1px solid #eceff1; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; page-break-inside: avoid; }
    .card h3 { margin: 0 0 4px; font-size: 13px; color: #37474f; }
    h2 { font-size: 15px; margin: 22px 0 8px; color: #1e2530; border-bottom: 2px solid ${COR}; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    thead th { background: #1e2530; color: #fff; text-align: left; padding: 6px 8px; font-weight: 600; }
    tbody td { padding: 5px 8px; border-bottom: 1px solid #eceff1; vertical-align: top; }
    tbody tr:nth-child(even) { background: #fafbfc; }
    .muted { color: #90a4ae; font-size: 10px; }
    .page-break { page-break-before: always; }
  </style>

  <div class="capa">
    <h1>Relatório de Rastreamento</h1>
    <div class="sub">${escHtml(ds.dispositivos.length)} veículo(s) · ${escHtml(periodo)}</div>
    <div class="muted">Gerado em ${fmtDataHora(ds.geradoEm.toISOString())}</div>
  </div>

  <div class="kpis">
    ${kpi(num(a.totalKm) + ' km', 'Distância total')}
    ${kpi(String(a.totalViagens), 'Viagens')}
    ${kpi(String(a.totalParadas), 'Paradas')}
    ${kpi(String(a.totalMotoristas), 'Motoristas')}
    ${kpi(num(a.totalHorasMotor) + ' h', 'Horas de motor')}
  </div>

  <div class="card"><h3>Distância por dia (km)</h3>${svgBarras(a.kmPorDia, COR)}</div>
  <div class="card"><h3>Viagens por motorista</h3>${svgBarras(a.viagensPorMotorista, '#2980b9')}</div>
  <div class="card"><h3>Distância por veículo (km)</h3>${svgBarras(a.kmPorVeiculo, '#27ae60')}</div>

  <div class="page-break"></div>
  ${tabelaHtml('Resumo por veículo', ['Veículo', 'Distância', 'Vel. média', 'Vel. máx', 'Horas motor'], resumoRows, 'Sem dados.')}
  ${tabelaHtml('Viagens', ['Veículo', 'Motorista', 'Início', 'Duração', 'Distância', 'Vel. máx', 'Origem → Destino'], viagensRows, 'Nenhuma viagem no período.')}
  ${ds.viagens.length > 300 ? '<div class="muted">Exibindo as primeiras 300 viagens. Use o XLSX para a lista completa.</div>' : ''}
  ${tabelaHtml('Paradas', ['Veículo', 'Início', 'Duração', 'Horas motor', 'Endereço'], paradasRows, 'Nenhuma parada no período.')}
  ${tabelaHtml('Eventos', ['Veículo', 'Data/Hora', 'Evento', 'Motorista', 'Detalhes'], eventosRows, 'Nenhum evento no período.')}
  `;

  return htmlParaPdf(html);
}
