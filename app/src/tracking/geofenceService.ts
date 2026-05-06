import { apiRequest } from '../services/api/apiClient';

export type Geofence = {
  id: string;
  nome: string;
  descricao?: string | null;
  area: string; // "CIRCLE(lat,lng,radius)" or "POLYGON(...)"
  tipo: string; // "circulo" | "poligono"
  visivelCliente: boolean;
  dispositivos?: { id: string; nome: string; placa: string | null }[];
};

export type CreateGeofencePayload = {
  nome: string;
  area: string;
  tipo: 'circulo' | 'poligono';
  dispositivos?: string[]; // dispositivoIds
  visivelCliente?: boolean;
  notificarCliente?: boolean;
  sistemasNotif?: {
    web?: boolean;
    app?: boolean;
    email?: boolean;
  };
};

export type DeviceGeofence = {
  id: string;
  nome: string;
  area: string;
  tipo: string;
};

export async function getGeofences(): Promise<Geofence[]> {
  try {
    return await apiRequest<Geofence[]>('/cliente/rastreamento/cercas');
  } catch {
    return [];
  }
}

export async function getDeviceGeofences(dispositivoId: string): Promise<DeviceGeofence[]> {
  try {
    return await apiRequest<DeviceGeofence[]>(`/cliente/rastreamento/dispositivos/${dispositivoId}/cercas`);
  } catch {
    return [];
  }
}

export async function createGeofence(payload: CreateGeofencePayload): Promise<Geofence> {
  return await apiRequest<Geofence>('/cliente/rastreamento/cercas', {
    method: 'POST',
    body: payload,
  });
}

export async function deleteGeofence(geofenceId: string): Promise<void> {
  await apiRequest(`/cliente/rastreamento/cercas/${geofenceId}`, {
    method: 'DELETE',
  });
}

export function parseCircleArea(area: string): { latitude: number; longitude: number; radius: number } | null {
  // Format: "CIRCLE(lat,lng,radius)" or "CIRCLE (lat, lng, radius)"
  const match = area.match(/CIRCLE\s*\(?\s*([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)\s*\)?/i);
  if (!match) return null;
  return {
    latitude: parseFloat(match[1]),
    longitude: parseFloat(match[2]),
    radius: parseFloat(match[3]),
  };
}
