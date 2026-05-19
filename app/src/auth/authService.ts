import { apiRequest } from '../services/api/apiClient';
import type { AppUser, LoginCredentials, LoginResponse, TipoSessao } from './authTypes';

/**
 * Faz login unificado pelo app (cliente, resgate ou admin pareador).
 * O backend distingue automaticamente o tipo a partir do e-mail
 * (User com role ADMIN/RESGATE vs ClienteLogin) e devolve `tipoSessao`.
 */
export async function loginApp(credentials: LoginCredentials) {
  const response = await apiRequest<LoginResponse>('/auth/login-app', {
    method: 'POST',
    auth: false,
    body: credentials,
  });

  if (!response.token || !response.user || !response.tipoSessao) {
    throw new Error('Resposta de login inválida.');
  }

  return {
    token: response.token,
    tipoSessao: response.tipoSessao as TipoSessao,
    user: response.user as AppUser,
  };
}
