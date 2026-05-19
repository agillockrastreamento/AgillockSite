export type ClienteTipo = 'responsavel' | 'vinculado';
export type TipoSessao = 'cliente' | 'resgate' | 'admin';

export type ClienteUser = {
  id: string;
  nome: string;
  email: string;
  role: 'CLIENTE';
  tipo: ClienteTipo;
};

export type ResgateUser = {
  id: string;
  nome: string;
  email: string;
  role: 'RESGATE';
};

export type AdminAppUser = {
  id: string;
  nome: string;
  email: string;
  role: 'ADMIN';
};

export type AppUser = ClienteUser | ResgateUser | AdminAppUser;

export type LoginResponse = {
  token: string;
  tipoSessao: TipoSessao;
  user: AppUser;
};

export type LoginCredentials = {
  email: string;
  senha: string;
};

export type StoredSession = {
  token: string;
  tipoSessao: TipoSessao;
  user: AppUser;
};
