/**
 * Estima distância em metros a partir do RSSI medido e do TxPower
 * calibrado em 1 metro. Usa o modelo log-distance:
 *
 *   distancia = 10 ^ ((TxPower - RSSI) / (10 * n))
 *
 * onde `n` é o expoente de perda de propagação:
 *   - 2.0 em espaço aberto
 *   - 2.5 ambiente urbano comum (carro estacionado, vegetação leve)
 *   - 3.0+ ambientes muito obstruídos (estofamento denso, paredes)
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

  constructor(private readonly alpha: number = 0.3) {}

  push(rssi: number): number {
    if (this.value === null) {
      this.value = rssi;
    } else {
      this.value = this.alpha * rssi + (1 - this.alpha) * this.value;
    }
    return this.value;
  }

  get current(): number | null {
    return this.value;
  }

  reset() {
    this.value = null;
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

const ZONES: Array<{
  minDistance: number;
  zone: ProximityZone;
  label: string;
  color: string;
  intensity: number;
}> = [
  { minDistance: 0,  zone: 'muito-quente', label: 'Muito perto', color: '#e74c3c', intensity: 1.0 },
  { minDistance: 3,  zone: 'quente',       label: 'Quente',      color: '#f39c12', intensity: 0.75 },
  { minDistance: 10, zone: 'morno',        label: 'Morno',       color: '#27ae60', intensity: 0.5 },
  { minDistance: 20, zone: 'frio',         label: 'Frio',        color: '#3498db', intensity: 0.25 },
];

export function classifyProximity(distanceMeters: number): ProximityInfo {
  // Itera do mais frio pro mais quente — o último que satisfizer fica
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
