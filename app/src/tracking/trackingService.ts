import { ApiError, apiRequest } from '../services/api/apiClient';
import type {
  TrackingAccessStatus,
  TrackingSnapshot,
  TraccarDeviceIndex,
} from './trackingTypes';

export function getTrackingAccessStatus() {
  return apiRequest<TrackingAccessStatus>('/cliente/rastreamento/status-acesso');
}

export async function getTrackingSnapshot() {
  try {
    return await apiRequest<TrackingSnapshot>('/cliente/rastreamento/posicoes');
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      typeof error.payload === 'object' &&
      error.payload !== null &&
      'error' in error.payload &&
      error.payload.error === 'acesso_bloqueado'
    ) {
      return 'blocked' as const;
    }
    throw error;
  }
}

export function buildTraccarDeviceIndex(snapshot: TrackingSnapshot) {
  return snapshot.reduce<TraccarDeviceIndex>((acc, item) => {
    if (typeof item.traccarId === 'number') {
      acc[item.traccarId] = item.dispositivoId;
    }
    return acc;
  }, {});
}
