export type TrackingAccessStatus = {
  bloqueado: boolean;
  diasAtraso?: number;
};

export type TrackingPosition = {
  latitude?: number | null;
  longitude?: number | null;
  velocidade?: number | null;
  curso?: number | null;
  fixTime?: string | null;
  deviceTime?: string | null;
  serverTime?: string | null;
  ignition?: boolean | null;
  ignicao?: boolean | null;
  emMovimento?: boolean | null;
  endereco?: string | null;
  bateria_nivel?: number | null;
  tensao?: number | null;
  odometro?: number | null;
  horas_motor?: number | null;
  bloqueado?: boolean | null;
  alarme?: string | null;
  sinal?: number | null;
};

export type TrackingDevice = {
  dispositivoId: string;
  nome: string;
  placa: string | null;
  categoria: string | null;
  /** Apelido do veículo definido pelo cliente (via web). Opcional. */
  apelidoCliente?: string | null;
  imagemUrlCliente: string | null;
  marca: string | null;
  modeloVeiculo: string | null;
  cor: string | null;
  limiteVelocidade: number | null;
  podeGerenciarManutencao: boolean;
  /** Habilita o cliente a editar odômetro/horímetro do dispositivo (definido pelo admin). */
  podeEditarMedidores?: boolean;
  cliente: {
    id: string;
    nome: string;
  } | null;
  /** Motorista vinculado ao dispositivo, quando houver. */
  motorista?: {
    id: string;
    nome: string;
  } | null;
  traccarId: number | null;
  status: string;
  lastUpdate: string | null;
  posicao: TrackingPosition | null;
  mapa?: number | null;
  _recorrencias?: Array<{
    id: string;
    titulo: string;
    intervaloKm: number;
    kmBase: number;
  }>;
};

export type TrackingSnapshot = TrackingDevice[];

export type TraccarDeviceIndex = Record<number, string>;
