// Helpers compartilhados entre o CRUD de dispositivos do admin (dispositivos.routes.ts)
// e o CRUD do portal/app do cliente (cliente-dispositivos.routes.ts).
import {
  traccarUpdateDeviceAccumulators,
  type TraccarDeviceSyncData,
} from '../services/traccar.service';

export function parseOptionalKm(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const numero = Number(value);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numero = Number(value);
  return Number.isFinite(numero) ? numero : null;
}

export function mapDispositivoResponse(dispositivo: Record<string, unknown>) {
  return {
    ...dispositivo,
    odometro: typeof dispositivo.odometroSistemaMetros === 'number' ? Math.round(dispositivo.odometroSistemaMetros) / 1000 : null,
    horimetro: typeof dispositivo.horimetroSistemaSegundos === 'number' ? Math.round((dispositivo.horimetroSistemaSegundos / 3600) * 10) / 10 : 0,
  };
}

export function buildTraccarDeviceSyncData(dispositivo: Record<string, unknown>): TraccarDeviceSyncData {
  const odometroMetros = numberOrNull(dispositivo.odometroSistemaMetros);
  const limiteVelocidade = numberOrNull(dispositivo.limiteVelocidade);
  return {
    name: (() => {
      const nome = String(dispositivo.nome || '').trim();
      const placa = dispositivo.placa ? String(dispositivo.placa).trim() : '';
      return placa ? `${nome} (${placa})` : nome;
    })(),
    uniqueId: String(dispositivo.identificador || '').trim(),
    category: dispositivo.categoria ? String(dispositivo.categoria) : 'car',
    model: dispositivo.modeloRastreador ? String(dispositivo.modeloRastreador) : null,
    phone: dispositivo.telefoneRastreador ? String(dispositivo.telefoneRastreador) : null,
    attributes: {
      iccid: dispositivo.iccid || null,
      operadoraChip: dispositivo.operadora || null,
      odometroAtualKm: odometroMetros != null ? Math.round((odometroMetros / 1000) * 10) / 10 : null,
      consumo: dispositivo.consumo || null,
      limiteVelocidadeKmh: limiteVelocidade,
      speedLimit: limiteVelocidade,
      senha: dispositivo.senha || null,
    },
  };
}

export async function syncTraccarAccumulators(traccarId: number, dispositivo: Record<string, unknown>): Promise<void> {
  const odometroMetros = numberOrNull(dispositivo.odometroSistemaMetros);
  const horimetroSegundos = numberOrNull(dispositivo.horimetroSistemaSegundos);
  if (odometroMetros == null) return;
  await traccarUpdateDeviceAccumulators(
    traccarId,
    odometroMetros,
    horimetroSegundos != null ? horimetroSegundos * 1000 : null,
  );
}
