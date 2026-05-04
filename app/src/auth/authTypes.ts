export type ClienteTipo = 'responsavel' | 'vinculado';

export type ClienteUser = {
  id: string;
  nome: string;
  email: string;
  role: 'CLIENTE';
  tipo: ClienteTipo;
};

export type LoginResponse = {
  token: string;
  user: ClienteUser | {
    id: string;
    nome: string;
    email: string;
    role: string;
    tipo?: string;
  };
};

export type LoginCredentials = {
  email: string;
  senha: string;
};
