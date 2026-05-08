import { apiRequest } from '../services/api/apiClient';

export type Geofence = {
  id: number; // traccarId
  name: string;
  description?: string;
  area: string;
};

export type DeviceGeofence = {
  id: number; // traccarId
  name: string;
  area: string;
  description?: string;
};

export type CreateGeofencePayload = {
  nome: string;
  area: string;
  dispositivoId?: string;
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

export async function deleteGeofence(geofenceId: number): Promise<void> {
  await apiRequest(`/cliente/rastreamento/cercas/${geofenceId}`, {
    method: 'DELETE',
  });
}

// Builds the WKT circle area string expected by Traccar/backend
export function buildCircleArea(lat: number, lng: number, radiusMeters: number): string {
  return `CIRCLE (${lat} ${lng}, ${radiusMeters})`;
}

// Parses "CIRCLE (lat lon, radius)" or legacy "CIRCLE(lat, lon, radius)"
export function parseCircleArea(area: string): { latitude: number; longitude: number; radius: number } | null {
  if (!area) return null;
  // Standard Traccar format: CIRCLE (lat lon, radius)
  const m1 = area.match(/CIRCLE\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([\d.]+)\s*\)/i);
  if (m1) return { latitude: parseFloat(m1[1]), longitude: parseFloat(m1[2]), radius: parseFloat(m1[3]) };
  // Legacy comma format: CIRCLE(lat, lon, radius)
  const m2 = area.match(/CIRCLE\s*\(?\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)?/i);
  if (m2) return { latitude: parseFloat(m2[1]), longitude: parseFloat(m2[2]), radius: parseFloat(m2[3]) };
  return null;
}
