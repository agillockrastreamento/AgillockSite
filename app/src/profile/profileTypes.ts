export type ClientePerfilVeiculo = {
  id: string;
  nome: string;
  placa: string | null;
};

export type ClientePerfil = {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  cpfCnpj: string | null;
  avatarUrl: string | null;
  logoUrl: string | null;
  veiculosFaturamento: ClientePerfilVeiculo[];
  veiculosVinculados: ClientePerfilVeiculo[];
};

export type AvatarUploadResponse = {
  message: string;
  avatarUrl: string;
};
