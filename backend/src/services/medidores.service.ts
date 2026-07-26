import prisma from '../utils/prisma';
import type { TraccarPosition, TraccarSummary, TraccarStop, TraccarTrip } from './traccar.service';
import { normalizeAttributes, traccarGetPositions, traccarGetDeviceByImei, cartaoDaPosicao } from './traccar.service';

const MAX_ENGINE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MIN_DISTANCE_METERS = 10;
const MAX_METERS_PER_SECOND = 70;

export const DISPOSITIVO_MEDIDORES_SELECT = {
  ignorarOdometro: true,
  odometroSistemaMetros: true,
  horimetroSistemaSegundos: true,
  telemetriaUltimaPosicaoEm: true,
  telemetriaUltimaLatitude: true,
  telemetriaUltimaLongitude: true,
  telemetriaUltimaIgnicao: true,
  telemetriaUltimoBloqueio: true,
  ultimoCartaoMotorista: true,
  ultimoCartaoMotoristaEm: true,
} as const;

type DispositivoMedidores = {
  id: string;
  identificador: string;
  ignorarOdometro?: boolean;
  odometroSistemaMetros: number | null;
  horimetroSistemaSegundos: number;
  telemetriaUltimaPosicaoEm: Date | null;
  telemetriaUltimaLatitude: number | null;
  telemetriaUltimaLongitude: number | null;
  telemetriaUltimaIgnicao: boolean | null;
  telemetriaUltimoBloqueio: boolean | null;
  ultimoCartaoMotorista?: string | null;
  ultimoCartaoMotoristaEm?: Date | null;
};

type PosicaoDecorada = ReturnType<typeof normalizeAttributes> & {
  latitude: number;
  longitude: number;
  velocidade: number;
  curso: number;
  altitude: number;
  fixTime: string;
  deviceTime: string;
  serverTime: string;
  valida: boolean;
  endereco: string | null;
};

function parsePositionTime(posicao: Pick<TraccarPosition, 'deviceTime' | 'fixTime' | 'serverTime'>): Date | null {
  const raw = posicao.deviceTime || posicao.fixTime || posicao.serverTime;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (deg: number) => deg * Math.PI / 180;
  const R = 6371000;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPlausibleDistance(distanceMeters: number, deltaMs: number): boolean {
  if (distanceMeters < MIN_DISTANCE_METERS) return false;
  const maxDistance = Math.max(50, (deltaMs / 1000) * MAX_METERS_PER_SECOND);
  return distanceMeters <= maxDistance;
}

export function usaOdometroSistema(dispositivo: Pick<DispositivoMedidores, 'ignorarOdometro' | 'odometroSistemaMetros'>): boolean {
  return dispositivo.ignorarOdometro !== true && dispositivo.odometroSistemaMetros != null;
}

// ── Odômetro efetivo para manutenções ──────────────────────────────────────────
// O "km atual" usado nas recorrências de manutenção precisa vir SEMPRE da mesma
// fonte que o kmBase registrado: usa o odômetro do sistema quando definido;
// caso contrário, o totalDistance acumulado no Traccar. Se a captura do kmBase e
// o cálculo do km atual usarem fontes diferentes, o "km percorrido" fica negativo
// (ex.: veículo novo com odômetro do sistema ainda nulo — o kmBase é capturado do
// Traccar (ex.: 1.638 km), mas a tela calculava com 0 → -1.638 km percorridos).

/** Odômetro efetivo (km) de um único dispositivo. Faz fallback por IMEI quando não há traccarId. */
export async function calcularKmAtualDispositivo(
  odometroSistemaMetros: number | null,
  traccarId?: number | null,
  identificador?: string,
): Promise<number> {
  if (odometroSistemaMetros != null) return odometroSistemaMetros / 1000;
  try {
    const deviceId = traccarId ?? (identificador ? (await traccarGetDeviceByImei(identificador))?.id : undefined);
    if (!deviceId) return 0;
    const posicoes = await traccarGetPositions([deviceId]);
    return ((posicoes[0]?.attributes?.totalDistance as number | undefined) ?? 0) / 1000;
  } catch {
    return 0;
  }
}

/**
 * Odômetro efetivo (km) de vários dispositivos, com no máximo UMA chamada ao
 * Traccar (em lote) para os que não têm odômetro de sistema. Retorna
 * dispositivoId -> km. Usar no GET de recorrências para que a tela e o card
 * comparem o km atual com o kmBase na mesma escala.
 */
export async function calcularKmAtualPorDispositivo(
  dispositivos: Array<{ id: string; traccarId?: number | null; odometroSistemaMetros: number | null }>,
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const semSistema: Array<{ id: string; traccarId: number }> = [];

  for (const d of dispositivos) {
    if (d.odometroSistemaMetros != null) {
      mapa.set(d.id, d.odometroSistemaMetros / 1000);
    } else if (d.traccarId != null) {
      semSistema.push({ id: d.id, traccarId: d.traccarId });
    } else {
      mapa.set(d.id, 0);
    }
  }

  if (semSistema.length) {
    try {
      const posicoes = await traccarGetPositions(semSistema.map(d => d.traccarId));
      const totalPorDeviceId = new Map<number, number>(
        posicoes.map(p => [p.deviceId, ((p.attributes?.totalDistance as number | undefined) ?? 0)]),
      );
      for (const d of semSistema) {
        mapa.set(d.id, (totalPorDeviceId.get(d.traccarId) ?? 0) / 1000);
      }
    } catch {
      for (const d of semSistema) mapa.set(d.id, 0);
    }
  }

  return mapa;
}

/**
 * Re-ancora as recorrências de manutenção (por km) quando o odômetro do
 * dispositivo é corrigido para um valor MENOR que o kmBase registrado — o que
 * tornaria o "km percorrido" negativo. Trata a correção como um novo ponto de
 * partida (equivalente a "serviço feito agora") e reinicia os alertas.
 */
export async function reancorarRecorrenciasSeOdometroMenor(
  dispositivoId: string,
  novoOdometroMetros: number | null,
): Promise<void> {
  if (novoOdometroMetros == null) return;
  const novoKm = novoOdometroMetros / 1000;
  await prisma.manutencaoRecorrencia.updateMany({
    where: { dispositivoId, ativa: true, kmBase: { gt: novoKm } },
    data: {
      kmBase: novoKm,
      alerta50Enviado: false,
      alerta25Enviado: false,
      alerta0Enviado: false,
      ultimaAlertaPostDueKm: -1,
    },
  });
}

function aplicarPosicaoAoEstado(
  dispositivo: DispositivoMedidores,
  posicao: TraccarPosition,
): DispositivoMedidores {
  const instanteAtual = parsePositionTime(posicao);
  if (!instanteAtual) return dispositivo;

  const ultimoInstante = dispositivo.telemetriaUltimaPosicaoEm;
  if (ultimoInstante && instanteAtual.getTime() <= ultimoInstante.getTime()) {
    return dispositivo;
  }

  let horimetroSistemaSegundos = dispositivo.horimetroSistemaSegundos ?? 0;
  let odometroSistemaMetros = dispositivo.odometroSistemaMetros;

  if (ultimoInstante) {
    const deltaMs = instanteAtual.getTime() - ultimoInstante.getTime();
    if (deltaMs > 0 && deltaMs <= MAX_ENGINE_INTERVAL_MS && dispositivo.telemetriaUltimaIgnicao === true) {
      horimetroSistemaSegundos += Math.round(deltaMs / 1000);
    }

    if (
      odometroSistemaMetros != null
      && posicao.valid
      && dispositivo.telemetriaUltimaLatitude != null
      && dispositivo.telemetriaUltimaLongitude != null
    ) {
      const distanceMeters = haversineMeters(
        dispositivo.telemetriaUltimaLatitude,
        dispositivo.telemetriaUltimaLongitude,
        posicao.latitude,
        posicao.longitude,
      );
      if (isPlausibleDistance(distanceMeters, deltaMs)) {
        odometroSistemaMetros += distanceMeters;
      }
    }
  }

  // Cartão RFID: o leitor só envia no login/logout da jornada, então a maioria das
  // posições não traz nada — nesse caso mantém o cartão já registrado. No logout
  // (fim de jornada) o cartão é zerado, pois não há mais motorista ao volante.
  const leitura = cartaoDaPosicao(posicao.attributes);
  let ultimoCartaoMotorista = dispositivo.ultimoCartaoMotorista ?? null;
  let ultimoCartaoMotoristaEm = dispositivo.ultimoCartaoMotoristaEm ?? null;
  if (leitura) {
    ultimoCartaoMotorista = leitura.inicio ? leitura.cartao : null;
    ultimoCartaoMotoristaEm = instanteAtual;
  }

  return {
    ...dispositivo,
    odometroSistemaMetros,
    horimetroSistemaSegundos,
    ultimoCartaoMotorista,
    ultimoCartaoMotoristaEm,
    telemetriaUltimaPosicaoEm: instanteAtual,
    telemetriaUltimaLatitude: posicao.valid ? posicao.latitude : dispositivo.telemetriaUltimaLatitude,
    telemetriaUltimaLongitude: posicao.valid ? posicao.longitude : dispositivo.telemetriaUltimaLongitude,
    telemetriaUltimaIgnicao: toBoolean(posicao.attributes?.ignition) ?? dispositivo.telemetriaUltimaIgnicao ?? false,
    // 'blocked' não vem em todo pacote (some no movimento). Guarda o último estado
    // REAL conhecido; fica null até o rastreador reportar pela 1ª vez (não fabrica "desbloqueado").
    telemetriaUltimoBloqueio: toBoolean(posicao.attributes?.blocked) ?? dispositivo.telemetriaUltimoBloqueio ?? null,
  };
}

export async function sincronizarDispositivosComPosicoes<T extends DispositivoMedidores>(
  dispositivos: T[],
  posicaoPorIdentificador: Map<string, TraccarPosition>,
): Promise<Map<string, T>> {
  const atualizados = new Map<string, T>();
  const updates: Array<ReturnType<typeof prisma.dispositivo.update>> = [];

  for (const dispositivo of dispositivos) {
    const posicao = posicaoPorIdentificador.get(dispositivo.identificador);
    if (!posicao) {
      atualizados.set(dispositivo.identificador, dispositivo);
      continue;
    }

    const proximoEstado = aplicarPosicaoAoEstado(dispositivo, posicao) as T;
    atualizados.set(dispositivo.identificador, proximoEstado);

    const mudou =
      proximoEstado.odometroSistemaMetros !== dispositivo.odometroSistemaMetros
      || proximoEstado.horimetroSistemaSegundos !== dispositivo.horimetroSistemaSegundos
      || proximoEstado.telemetriaUltimaPosicaoEm?.getTime() !== dispositivo.telemetriaUltimaPosicaoEm?.getTime()
      || proximoEstado.telemetriaUltimaLatitude !== dispositivo.telemetriaUltimaLatitude
      || proximoEstado.telemetriaUltimaLongitude !== dispositivo.telemetriaUltimaLongitude
      || proximoEstado.telemetriaUltimaIgnicao !== dispositivo.telemetriaUltimaIgnicao
      || proximoEstado.telemetriaUltimoBloqueio !== dispositivo.telemetriaUltimoBloqueio
      || proximoEstado.ultimoCartaoMotorista !== dispositivo.ultimoCartaoMotorista;

    if (!mudou) continue;

    updates.push(prisma.dispositivo.update({
      where: { id: dispositivo.id },
      data: {
        odometroSistemaMetros: proximoEstado.odometroSistemaMetros,
        horimetroSistemaSegundos: proximoEstado.horimetroSistemaSegundos,
        ultimoCartaoMotorista: proximoEstado.ultimoCartaoMotorista ?? null,
        ultimoCartaoMotoristaEm: proximoEstado.ultimoCartaoMotoristaEm ?? null,
        telemetriaUltimaPosicaoEm: proximoEstado.telemetriaUltimaPosicaoEm,
        telemetriaUltimaLatitude: proximoEstado.telemetriaUltimaLatitude,
        telemetriaUltimaLongitude: proximoEstado.telemetriaUltimaLongitude,
        telemetriaUltimaIgnicao: proximoEstado.telemetriaUltimaIgnicao,
        telemetriaUltimoBloqueio: proximoEstado.telemetriaUltimoBloqueio,
      },
    }));
  }

  if (updates.length) {
    await prisma.$transaction(updates);
  }

  return atualizados;
}

export function decorarPosicaoComMedidores(
  dispositivo: Pick<DispositivoMedidores, 'ignorarOdometro' | 'odometroSistemaMetros' | 'horimetroSistemaSegundos' | 'telemetriaUltimaIgnicao' | 'telemetriaUltimoBloqueio'>,
  posicao: TraccarPosition,
): PosicaoDecorada {
  const normalizado = normalizeAttributes(posicao.attributes ?? {});
  
  // Garantir que campos cruciais não fiquem nulos se o dispositivo tiver a informação no banco
  const odometro = dispositivo.ignorarOdometro === true
    ? null
    : (usaOdometroSistema(dispositivo)
      ? dispositivo.odometroSistemaMetros
      : (normalizado.odometro ?? (dispositivo as any).odometro_snapshot));

  const horas_motor = Math.round(((dispositivo.horimetroSistemaSegundos ?? 0) / 3600) * 10) / 10;
  
  // O Traccar pode não enviar 'blocked' em todos os pacotes de movimento.
  // Se estiver nulo na posição atual, podemos manter o que está no banco (se tivéssemos essa coluna)
  // Como 'bloqueado' não está no DISPOSITIVO_MEDIDORES_SELECT, ele depende do 'normalizado'.
  // Para resolver o "sumir e voltar", o ideal é que o frontend ou o backend mantenham o último estado.

  return {
    latitude: posicao.latitude,
    longitude: posicao.longitude,
    velocidade: Math.round(posicao.speed * 1.852),
    curso: posicao.course,
    altitude: posicao.altitude,
    fixTime: posicao.fixTime,
    deviceTime: posicao.deviceTime,
    serverTime: posicao.serverTime,
    valida: posicao.valid,
    endereco: posicao.address,
    ...normalizado,
    odometro,
    horas_motor,
    // Se o 'ignicao' veio nulo no normalizado (Traccar não enviou no pacote), usamos o do sistema
    ignicao: normalizado.ignicao !== null ? normalizado.ignicao : dispositivo.telemetriaUltimaIgnicao,
    // Idem 'bloqueado': se a posição atual não trouxe 'blocked', usa o último estado persistido
    bloqueado: normalizado.bloqueado !== null ? normalizado.bloqueado : dispositivo.telemetriaUltimoBloqueio,
  };
}

type MetricasPeriodo = {
  distanciaMetros: number;
  horasMotorMs: number;
  velocidadeMaximaNos: number | null;
};

export function calcularMetricasPeriodo(posicoes: TraccarPosition[]): MetricasPeriodo {
  if (!posicoes.length) {
    return { distanciaMetros: 0, horasMotorMs: 0, velocidadeMaximaNos: null };
  }

  const ordenadas = [...posicoes].sort((a, b) => {
    const ta = parsePositionTime(a)?.getTime() ?? 0;
    const tb = parsePositionTime(b)?.getTime() ?? 0;
    return ta - tb;
  });

  let distanciaMetros = 0;
  let horasMotorMs = 0;
  let velocidadeMaximaNos = 0;
  let temVelocidade = false;

  for (const posicao of ordenadas) {
    if (posicao.valid === false) continue;
    const velocidade = Number(posicao.speed);
    if (!Number.isFinite(velocidade) || velocidade < 0) continue;
    velocidadeMaximaNos = Math.max(velocidadeMaximaNos, velocidade);
    temVelocidade = true;
  }

  for (let i = 1; i < ordenadas.length; i += 1) {
    const anterior = ordenadas[i - 1];
    const atual = ordenadas[i];
    const tAnterior = parsePositionTime(anterior);
    const tAtual = parsePositionTime(atual);
    if (!tAnterior || !tAtual) continue;

    const deltaMs = tAtual.getTime() - tAnterior.getTime();
    if (deltaMs <= 0 || deltaMs > MAX_ENGINE_INTERVAL_MS) continue;

    if (anterior.attributes?.ignition === true) {
      horasMotorMs += deltaMs;
    }

    if (anterior.valid && atual.valid) {
      const trecho = haversineMeters(anterior.latitude, anterior.longitude, atual.latitude, atual.longitude);
      if (isPlausibleDistance(trecho, deltaMs)) {
        distanciaMetros += trecho;
      }
    }
  }

  return { distanciaMetros, horasMotorMs, velocidadeMaximaNos: temVelocidade ? velocidadeMaximaNos : null };
}

export interface SegmentoOcioso {
  inicio: string;       // ISO
  fim: string;          // ISO
  latitude: number;
  longitude: number;
  duracaoMs: number;
}

// Considera o veículo "parado" (para fins de ociosidade) quando o atributo
// `motion` indica parado. Se o protocolo do rastreador não enviar `motion`,
// usamos a velocidade como fallback (< 3 km/h ≈ parado).
function posicaoParada(posicao: TraccarPosition): boolean {
  const motion = posicao.attributes?.motion;
  if (typeof motion === 'boolean') return motion === false;
  const kmh = Number(posicao.speed) * 1.852;
  return Number.isFinite(kmh) ? kmh < 3 : true;
}

// Tempo ocioso = motor ligado (ignição) com o veículo parado. Retorna o total
// (ms) e os segmentos contíguos de ociosidade — usados para marcar os pontos
// ociosos no mapa do relatório. Cada segmento aponta para o local onde o
// veículo ficou parado com o motor ligado.
export function calcularOciosidade(posicoes: TraccarPosition[]): { totalMs: number; segmentos: SegmentoOcioso[] } {
  if (posicoes.length < 2) return { totalMs: 0, segmentos: [] };

  const ordenadas = [...posicoes].sort((a, b) => {
    const ta = parsePositionTime(a)?.getTime() ?? 0;
    const tb = parsePositionTime(b)?.getTime() ?? 0;
    return ta - tb;
  });

  let totalMs = 0;
  const segmentos: SegmentoOcioso[] = [];
  let atual: { inicioMs: number; fimMs: number; latitude: number; longitude: number; duracaoMs: number } | null = null;

  const fecharSegmento = () => {
    if (!atual) return;
    segmentos.push({
      inicio: new Date(atual.inicioMs).toISOString(),
      fim: new Date(atual.fimMs).toISOString(),
      latitude: atual.latitude,
      longitude: atual.longitude,
      duracaoMs: atual.duracaoMs,
    });
    atual = null;
  };

  for (let i = 1; i < ordenadas.length; i += 1) {
    const anterior = ordenadas[i - 1];
    const tAnterior = parsePositionTime(anterior);
    const tAtual = parsePositionTime(ordenadas[i]);
    if (!tAnterior || !tAtual) { fecharSegmento(); continue; }

    const deltaMs = tAtual.getTime() - tAnterior.getTime();
    if (deltaMs <= 0 || deltaMs > MAX_ENGINE_INTERVAL_MS) { fecharSegmento(); continue; }

    const ocioso = anterior.attributes?.ignition === true && posicaoParada(anterior);
    if (!ocioso) { fecharSegmento(); continue; }

    totalMs += deltaMs;
    if (!atual) {
      atual = {
        inicioMs: tAnterior.getTime(),
        fimMs: tAtual.getTime(),
        latitude: anterior.latitude,
        longitude: anterior.longitude,
        duracaoMs: deltaMs,
      };
    } else {
      atual.fimMs = tAtual.getTime();
      atual.duracaoMs += deltaMs;
    }
  }
  fecharSegmento();

  return { totalMs, segmentos };
}

function aplicarVelocidadeMaximaPeriodo<T extends { maxSpeed: number }>(
  base: T,
  metricas: MetricasPeriodo,
): T {
  if (metricas.velocidadeMaximaNos == null) return base;
  return { ...base, maxSpeed: metricas.velocidadeMaximaNos };
}

function filtrarPosicoesNoIntervalo(
  posicoes: TraccarPosition[],
  inicio: string,
  fim: string,
): TraccarPosition[] {
  const inicioMs = new Date(inicio).getTime();
  const fimMs = new Date(fim).getTime();
  return posicoes.filter(posicao => {
    const tempo = parsePositionTime(posicao)?.getTime();
    return tempo != null && tempo >= inicioMs && tempo <= fimMs;
  });
}

export function aplicarResumoComMedidores(
  dispositivo: Pick<DispositivoMedidores, 'ignorarOdometro' | 'odometroSistemaMetros'>,
  resumo: TraccarSummary,
  posicoes: TraccarPosition[],
): TraccarSummary {
  const metricas = calcularMetricasPeriodo(posicoes);
  return aplicarVelocidadeMaximaPeriodo({
    ...resumo,
    distance: usaOdometroSistema(dispositivo) ? Math.round(metricas.distanciaMetros) : resumo.distance,
    engineHours: Math.round(metricas.horasMotorMs),
  }, metricas);
}

export function aplicarViagensComMedidores(
  dispositivo: Pick<DispositivoMedidores, 'ignorarOdometro' | 'odometroSistemaMetros'>,
  viagens: TraccarTrip[],
  posicoes: TraccarPosition[],
): TraccarTrip[] {
  return viagens.map(viagem => {
    const metricas = calcularMetricasPeriodo(filtrarPosicoesNoIntervalo(posicoes, viagem.startTime, viagem.endTime));
    return aplicarVelocidadeMaximaPeriodo({
      ...viagem,
      distance: usaOdometroSistema(dispositivo) ? Math.round(metricas.distanciaMetros) : viagem.distance,
    }, metricas);
  });
}

export function aplicarParadasComMedidores(
  paradas: TraccarStop[],
  posicoes: TraccarPosition[],
): TraccarStop[] {
  return paradas.map(parada => {
    const metricas = calcularMetricasPeriodo(filtrarPosicoesNoIntervalo(posicoes, parada.startTime, parada.endTime));
    return {
      ...parada,
      engineHours: Math.round(metricas.horasMotorMs),
    };
  });
}
