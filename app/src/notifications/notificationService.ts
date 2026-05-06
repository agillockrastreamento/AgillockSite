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

export type NotificationChannelPrefs = {
  web: boolean;
  app: boolean;
  email: boolean;
};

export type NotificationPreferences = {
  [eventType: string]: NotificationChannelPrefs;
};

export type NotificationPreferencesResponse = {
  preferencias: NotificationPreferences;
  overspeedLimit?: number;
  kmExcedida?: {
    kmMaximo30Dias: number | null;
    diaRenovacaoMes: number | null;
  };
  kmReduzida?: {
    kmMinimo7Dias: number | null;
    diaSemanaRenovacao: number | null;
  };
  kmTrocaOleo?: number | null;
};

export type SaveNotificationPreferencesPayload = {
  dispositivoId: string;
  preferencias: NotificationPreferences;
  overspeedLimit?: number;
  kmExcedida?: {
    kmMaximo30Dias: number | null;
    diaRenovacaoMes: number | null;
  };
  kmReduzida?: {
    kmMinimo7Dias: number | null;
    diaSemanaRenovacao: number;
  };
  kmTrocaOleo?: number | null;
};

export type KmConfigResponse = {
  kmTrocaOleo?: number | null;
  proximaTrocaKm?: number | null;
  kmExcedida?: {
    kmMaximo30Dias: number | null;
    diaRenovacaoMes: number | null;
  };
  kmReduzida?: {
    kmMinimo7Dias: number | null;
    diaSemanaRenovacao: number | null;
  };
};

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

export async function getNotificationPreferences(dispositivoId: string): Promise<NotificationPreferencesResponse> {
  return await apiRequest<NotificationPreferencesResponse>(`/cliente/notificacoes/preferencias/${dispositivoId}`);
}

export async function saveNotificationPreferences(payload: SaveNotificationPreferencesPayload): Promise<void> {
  await apiRequest('/cliente/notificacoes/preferencias', {
    method: 'POST',
    body: payload,
  });
}

export async function getKmConfig(dispositivoId: string): Promise<KmConfigResponse> {
  return await apiRequest<KmConfigResponse>(`/cliente/notificacoes/km-config/${dispositivoId}`);
}

export async function patchKmTrocaOleo(dispositivoId: string, km: number): Promise<void> {
  await apiRequest(`/cliente/notificacoes/km-troca-oleo/${dispositivoId}`, {
    method: 'PATCH',
    body: { kmTrocaOleo: km },
  });
}

export async function confirmTrocaOleo(dispositivoId: string): Promise<void> {
  await apiRequest(`/cliente/notificacoes/confirmar-troca-oleo/${dispositivoId}`, {
    method: 'POST',
  });
}
