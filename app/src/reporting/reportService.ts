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
