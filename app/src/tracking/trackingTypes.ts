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
};

export type TrackingDevice = {
  dispositivoId: string;
  nome: string;
  placa: string | null;
  categoria: string | null;
  imagemUrlCliente: string | null;
  marca: string | null;
  modeloVeiculo: string | null;
  cor: string | null;
  limiteVelocidade: number | null;
  podeGerenciarManutencao: boolean;
  cliente: {
    id: string;
    nome: string;
  } | null;
  traccarId: number | null;
  status: string;
  lastUpdate: string | null;
  posicao: TrackingPosition | null;
};

export type TrackingSnapshot = TrackingDevice[];

export type TraccarDeviceIndex = Record<number, string>;
