import { ApiError, apiRequest } from '../services/api/apiClient';

export type NotificationEvent = {
  id: string;
  dispositivoId: string | null;
  tipo: string;
  tipoLabel?: string;
  titulo: string;
  mensagem: string;
  data: string;
  serverTime?: string;
  lido: boolean;
  prioridade?: string;
  lat?: number | null;
  lng?: number | null;
  endereco?: string | null;
  velocidade?: number | null;
  dispositivoNome?: string | null;
  dispositivoPlaca?: string | null;
};

export type NotificationEventsResponse = NotificationEvent[];

export async function getNotificationEvents(params?: {
  periodo?: string;
  limite?: number;
}) {
  const query = new URLSearchParams();
  if (params?.periodo) query.set('periodo', params.periodo);
  if (params?.limite) query.set('limite', String(params.limite));

  const url = `/cliente/notificacoes/eventos${query.toString() ? '?' + query : ''}`;
  try {
    return await apiRequest<NotificationEventsResponse>(url);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

export async function getUnreadCount(): Promise<number> {
  try {
    const result = await apiRequest<{ count: number }>('/cliente/notificacoes/nao-lidas/count');
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function markAllAsRead(until?: string): Promise<void> {
  await apiRequest('/cliente/notificacoes/marcar-lidas', {
    method: 'POST',
    body: until ? { ate: until } : {},
  });
}