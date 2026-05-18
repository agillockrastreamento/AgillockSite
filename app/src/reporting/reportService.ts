import { apiRequest } from '../services/api/apiClient';
import { tokenStorage } from '../storage/tokenStorage';
import { environment } from '../config/environment';
import type { HistoricoResponse, Viagem, Parada, Evento, Resumo, ReportPeriodo } from './reportTypes';

export function isoComFuso(d: Date): string {
  const off = d.getTimezoneOffset();
  const abs = Math.abs(off);
  const sign = off <= 0 ? '+' : '-';
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`
  );
}

export function calcularIntervalo(
  periodo: ReportPeriodo,
  customFrom?: Date,
  customTo?: Date,
): { from: Date; to: Date } {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const amanha = new Date(hoje);
  amanha.setDate(amanha.getDate() + 1);

  if (periodo === 'hoje') return { from: hoje, to: amanha };
  if (periodo === 'ontem') {
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);
    return { from: ontem, to: hoje };
  }
  if (periodo === '7dias') {
    const sete = new Date(hoje);
    sete.setDate(sete.getDate() - 7);
    return { from: sete, to: amanha };
  }
  return { from: customFrom ?? hoje, to: customTo ?? amanha };
}

const BASE = '/cliente/rastreamento/dispositivos';

function buildQs(from: Date, to: Date): string {
  return `from=${encodeURIComponent(isoComFuso(from))}&to=${encodeURIComponent(isoComFuso(to))}`;
}

export async function getHistorico(id: string, from: Date, to: Date): Promise<HistoricoResponse> {
  return apiRequest<HistoricoResponse>(`${BASE}/${id}/historico?${buildQs(from, to)}`);
}

export async function getViagens(id: string, from: Date, to: Date): Promise<Viagem[]> {
  return apiRequest<Viagem[]>(`${BASE}/${id}/viagens?${buildQs(from, to)}`);
}

export async function getParadas(id: string, from: Date, to: Date): Promise<Parada[]> {
  return apiRequest<Parada[]>(`${BASE}/${id}/paradas?${buildQs(from, to)}`);
}

export async function getEventos(id: string, from: Date, to: Date): Promise<Evento[]> {
  return apiRequest<Evento[]>(`${BASE}/${id}/eventos?${buildQs(from, to)}`);
}

export async function getResumo(id: string, from: Date, to: Date): Promise<Resumo | null> {
  return apiRequest<Resumo | null>(`${BASE}/${id}/resumo?${buildQs(from, to)}`);
}

// ─── Reverse geocoding helpers (espelha relatorio-cliente.js) ────────────────

const _reverseGeocodeCache: Record<string, string> = {};

function enderecoPareceCoordenada(valor: string): boolean {
  const texto = valor.trim();
  if (!texto || texto === '0.00000, 0.00000') return true;
  return !!extrairCoords(texto);
}

function enderecoValido(valor: unknown): valor is string {
  return typeof valor === 'string' && !!valor.trim() && !enderecoPareceCoordenada(valor);
}

function extrairCoords(valor: string): { lat: number; lng: number } | null {
  const texto = valor.trim();
  const padroes = [
    /^\(?\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*\)?$/,
    /^\(?\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)?$/,
    /^lat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)\D+lon(?:gitude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)$/i,
  ];
  for (const padrao of padroes) {
    const m = texto.match(padrao);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

function coordsValidas(lat?: number | null, lng?: number | null): boolean {
  const nLat = Number(lat);
  const nLng = Number(lng);
  return Number.isFinite(nLat) && Number.isFinite(nLng) && (Math.abs(nLat) > 0.00001 || Math.abs(nLng) > 0.00001);
}

function fmtCoordsFallback(lat: number, lng: number): string {
  return `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
}

export async function resolverEndereco(
  valor: unknown,
  lat?: number | null,
  lng?: number | null,
): Promise<string> {
  if (enderecoValido(valor)) return valor.trim();
  const coordsTexto = typeof valor === 'string' ? extrairCoords(valor) : null;
  const finalLat = coordsValidas(lat, lng) ? Number(lat) : coordsTexto?.lat;
  const finalLng = coordsValidas(lat, lng) ? Number(lng) : coordsTexto?.lng;
  if (finalLat == null || finalLng == null || !coordsValidas(finalLat, finalLng)) {
    return 'Endereço não identificado';
  }
  const chave = `${finalLat.toFixed(5)},${finalLng.toFixed(5)}`;
  if (_reverseGeocodeCache[chave]) return _reverseGeocodeCache[chave];
  try {
    const data = await apiRequest<{ endereco?: string }>(
      `/cliente/rastreamento/geocode/reverse?lat=${encodeURIComponent(finalLat)}&lon=${encodeURIComponent(finalLng)}`,
    );
    const end = (data?.endereco && data.endereco.trim()) || fmtCoordsFallback(finalLat, finalLng);
    _reverseGeocodeCache[chave] = end;
    return end;
  } catch {
    return fmtCoordsFallback(finalLat, finalLng);
  }
}

export async function getExportUrl(
  id: string,
  from: Date,
  to: Date,
  tipo: string,
): Promise<{ url: string; token: string }> {
  const token = (await tokenStorage.get()) ?? '';
  const url = `${environment.apiUrl}${BASE}/${id}/exportar?${buildQs(from, to)}&type=${tipo}`;
  return { url, token };
}
