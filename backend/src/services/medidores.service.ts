import prisma from '../utils/prisma';
import type { TraccarPosition, TraccarSummary, TraccarStop, TraccarTrip } from './traccar.service';
import { normalizeAttributes } from './traccar.service';

const MAX_ENGINE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MIN_DISTANCE_METERS = 10;
const MAX_METERS_PER_SECOND = 70;

export const DISPOSITIVO_MEDIDORES_SELECT = {
  odometroSistemaMetros: true,
  horimetroSistemaSegundos: true,
  telemetriaUltimaPosicaoEm: true,
  telemetriaUltimaLatitude: true,
  telemetriaUltimaLongitude: true,
  telemetriaUltimaIgnicao: true,
} as const;

type DispositivoMedidores = {
  id: string;
  identificador: string;
  odometroSistemaMetros: number | null;
  horimetroSistemaSegundos: number;
  telemetriaUltimaPosicaoEm: Date | null;
  telemetriaUltimaLatitude: number | null;
  telemetriaUltimaLongitude: number | null;
  telemetriaUltimaIgnicao: boolean | null;
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

export function usaOdometroSistema(dispositivo: Pick<DispositivoMedidores, 'odometroSistemaMetros'>): boolean {
  return dispositivo.odometroSistemaMetros != null;
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

  return {
    ...dispositivo,
    odometroSistemaMetros,
    horimetroSistemaSegundos,
    telemetriaUltimaPosicaoEm: instanteAtual,
    telemetriaUltimaLatitude: posicao.valid ? posicao.latitude : dispositivo.telemetriaUltimaLatitude,
    telemetriaUltimaLongitude: posicao.valid ? posicao.longitude : dispositivo.telemetriaUltimaLongitude,
    telemetriaUltimaIgnicao: toBoolean(posicao.attributes?.ignition) ?? dispositivo.telemetriaUltimaIgnicao ?? false,
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
      || proximoEstado.telemetriaUltimaIgnicao !== dispositivo.telemetriaUltimaIgnicao;

    if (!mudou) continue;

    updates.push(prisma.dispositivo.update({
      where: { id: dispositivo.id },
      data: {
        odometroSistemaMetros: proximoEstado.odometroSistemaMetros,
        horimetroSistemaSegundos: proximoEstado.horimetroSistemaSegundos,
        telemetriaUltimaPosicaoEm: proximoEstado.telemetriaUltimaPosicaoEm,
        telemetriaUltimaLatitude: proximoEstado.telemetriaUltimaLatitude,
        telemetriaUltimaLongitude: proximoEstado.telemetriaUltimaLongitude,
        telemetriaUltimaIgnicao: proximoEstado.telemetriaUltimaIgnicao,
      },
    }));
  }

  if (updates.length) {
    await prisma.$transaction(updates);
  }

  return atualizados;
}

export function decorarPosicaoComMedidores(
  dispositivo: Pick<DispositivoMedidores, 'odometroSistemaMetros' | 'horimetroSistemaSegundos' | 'telemetriaUltimaIgnicao'>,
  posicao: TraccarPosition,
): PosicaoDecorada {
  const normalizado = normalizeAttributes(posicao.attributes ?? {});
  
  // Garantir que campos cruciais não fiquem nulos se o dispositivo tiver a informação no banco
  const odometro = usaOdometroSistema(dispositivo) 
    ? dispositivo.odometroSistemaMetros 
    : (normalizado.odometro ?? (dispositivo as any).odometro_snapshot);

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
  dispositivo: Pick<DispositivoMedidores, 'odometroSistemaMetros'>,
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
  dispositivo: Pick<DispositivoMedidores, 'odometroSistemaMetros'>,
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
