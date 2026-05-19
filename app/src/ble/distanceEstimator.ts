/**
 * Estima distância em metros a partir do RSSI medido e do TxPower
 * calibrado em 1 metro. Usa o modelo log-distance:
 *
 *   distancia = 10 ^ ((TxPower - RSSI) / (10 * n))
 *
 * onde `n` é o expoente de perda de propagação:
 *   - 2.0 espaço aberto
 *   - 3.0 ambiente urbano com obstáculos (default — uso de resgate na rua)
 *   - 3.5+ ambientes muito obstruídos (estofamento denso, paredes)
 */
export function rssiToDistance(
  rssi: number,
  txPower: number = -59,
  pathLossExponent: number = 2.5,
): number {
  if (!Number.isFinite(rssi)) return Infinity;
  return Math.pow(10, (txPower - rssi) / (10 * pathLossExponent));
}

/**
 * Suaviza RSSI ruidoso com média móvel exponencial (EMA).
 * `alpha` é o peso da nova amostra (0..1) — quanto maior, mais reativo
 * (e mais ruidoso); quanto menor, mais estável (e mais lento).
 */
export class RssiSmoother {
  private value: number | null = null;
  private history: number[] = [];

  constructor(private readonly alpha: number = 0.3, private readonly historySize: number = 8) {}

  push(rssi: number): number {
    if (this.value === null) {
      this.value = rssi;
    } else {
      this.value = this.alpha * rssi + (1 - this.alpha) * this.value;
    }
    this.history.push(this.value);
    if (this.history.length > this.historySize) this.history.shift();
    return this.value;
  }

  get current(): number | null {
    return this.value;
  }

  /**
   * Compara a média dos últimos pontos com a média dos pontos anteriores.
   * Retorna a variação em dBm — positivo = esquentando (sinal melhorou),
   * negativo = esfriando, ~0 = estável. Requer pelo menos 2 amostras.
   */
  trend(): number {
    if (this.history.length < 2) return 0;
    const mid = Math.max(1, Math.floor(this.history.length / 2));
    const oldHalf = this.history.slice(0, mid);
    const newHalf = this.history.slice(mid);
    if (newHalf.length === 0) return 0;
    const avgOld = oldHalf.reduce((s, v) => s + v, 0) / oldHalf.length;
    const avgNew = newHalf.reduce((s, v) => s + v, 0) / newHalf.length;
    return avgNew - avgOld;
  }

  reset() {
    this.value = null;
    this.history = [];
  }
}

export type ProximityZone = 'frio' | 'morno' | 'quente' | 'muito-quente';

export type ProximityInfo = {
  zone: ProximityZone;
  label: string;
  color: string;
  /** 0..1 — intensidade visual (1 = mais quente) */
  intensity: number;
};

/**
 * Zonas calibradas para uso de resgate em RUA aberta — não em ambiente
 * doméstico próximo. As distâncias são mais amplas para acomodar a
 * dificuldade típica do cenário (veículo estacionado ao longe).
 */
const ZONES: Array<{
  minDistance: number;
  zone: ProximityZone;
  label: string;
  color: string;
  intensity: number;
}> = [
  { minDistance: 0,   zone: 'muito-quente', label: 'Muito perto', color: '#e74c3c', intensity: 1.0 },
  { minDistance: 5,   zone: 'quente',       label: 'Quente',      color: '#f39c12', intensity: 0.75 },
  { minDistance: 15,  zone: 'morno',        label: 'Morno',       color: '#27ae60', intensity: 0.5 },
  { minDistance: 35,  zone: 'frio',         label: 'Frio',        color: '#3498db', intensity: 0.25 },
];

export function classifyProximity(distanceMeters: number): ProximityInfo {
  let match = ZONES[ZONES.length - 1];
  for (let i = ZONES.length - 1; i >= 0; i--) {
    if (distanceMeters >= ZONES[i].minDistance) {
      match = ZONES[i];
      break;
    }
  }
  return {
    zone: match.zone,
    label: match.label,
    color: match.color,
    intensity: match.intensity,
  };
}

export type TrendDirection = 'aproximando' | 'afastando' | 'estavel';

export function classifyTrend(deltaDbm: number): TrendDirection {
  if (deltaDbm > 1.5) return 'aproximando';
  if (deltaDbm < -1.5) return 'afastando';
  return 'estavel';
}
