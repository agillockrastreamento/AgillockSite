import { apiRequest } from '../services/api/apiClient';
import type { ClienteUser, LoginCredentials, LoginResponse } from './authTypes';

export async function loginCliente(credentials: LoginCredentials) {
  const response = await apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    auth: false,
    body: credentials,
  });

  if (!response.token || response.user?.role !== 'CLIENTE') {
    throw new Error('Este aplicativo é exclusivo para clientes.');
  }

  if (response.user.tipo !== 'responsavel' && response.user.tipo !== 'vinculado') {
    throw new Error('Perfil de cliente inválido para o aplicativo.');
  }

  return {
    token: response.token,
    user: response.user as ClienteUser,
  };
}
