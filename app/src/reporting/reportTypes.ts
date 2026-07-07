export interface ReportPosition {
  latitude: number;
  longitude: number;
  velocidade?: number;
  curso?: number;
  fixTime?: string;
  deviceTime?: string;
  valida?: boolean;
  deviceId?: string;
}

export interface OciosoSegmento {
  inicio: string;
  fim: string;
  latitude: number;
  longitude: number;
  duracaoMin: number;
  deviceId?: number | string;
}

export interface HistoricoResponse {
  dispositivo?: string;
  total?: number;
  posicoes: ReportPosition[];
  ociosos?: OciosoSegmento[];
}

export interface Viagem {
  inicio?: string;
  fim?: string;
  origem?: string;
  destino?: string;
  origemLat?: number;
  origemLng?: number;
  destinoLat?: number;
  destinoLng?: number;
  distancia?: number;
  velocidadeMedia?: number;
  velocidadeMaxima?: number;
  duracao?: number;
  startTime?: string;
  endTime?: string;
  startAddress?: string;
  endAddress?: string;
  startLat?: number;
  startLon?: number;
  endLat?: number;
  endLon?: number;
  distance?: number;
  averageSpeed?: number;
  maxSpeed?: number;
  duration?: number;
  deviceId?: string;
  motorista?: { id: string; nome: string } | null;
  motorista_id?: string | null;
}

export interface Parada {
  inicio?: string;
  fim?: string;
  endereco?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lon?: number;
  duracao?: number;
  duration?: number;
  horasMotor?: number;
  startTime?: string;
  endTime?: string;
  deviceId?: string;
}

export interface Evento {
  id?: string;
  tipo: string;
  tipoLabel?: string;
  hora: string;
  atributos?: Record<string, unknown>;
  deviceId?: string;
}

export interface Resumo {
  distancia?: number;
  velocidadeMedia?: number;
  velocidadeMaxima?: number;
  horasMotor?: number;
  deviceId?: string;
  distance?: number;
  averageSpeed?: number;
  maxSpeed?: number;
  engineHours?: number;
}

export type ReportPeriodo = 'hoje' | 'ontem' | '7dias' | 'custom';
export type ReportTab = 'rota' | 'viagens' | 'paradas' | 'eventos' | 'resumo' | 'grafico';
export type ExportType = 'route' | 'events' | 'trips' | 'stops' | 'summary';
