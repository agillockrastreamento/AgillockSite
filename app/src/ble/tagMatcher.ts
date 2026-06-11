import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BleDevice } from './bleManager';
import type { RescueVehicleTag } from '../components/TagScanner';

export type MatchConfidence = 'exact-mac' | 'cached-uuid' | 'fingerprint' | 'name-only' | 'none';

export type MatchResult = {
  confidence: MatchConfidence;
  device: BleDevice;
  /**
   * Identificador a ser usado para tracking persistente do peripheral.
   * - Android: MAC (device.id)
   * - iOS: peripheral UUID (device.id) — randômico por instalação do app
   */
  trackingId: string;
};

const INSTALL_ID_KEY = '@agillock/ble/install_id';
const LEGACY_INSTALL_ID = `${Platform.OS}-install`;

// Identificador único POR INSTALAÇÃO do app — é a chave do cache de peripheral
// UUID iOS no backend. A string fixa anterior ('ios-install') colidia entre
// aparelhos: o UUID gravado pelo telefone do admin nunca batia no telefone da
// equipe de resgate (peripheral UUID é aleatório por aparelho) e cada um
// sobrescrevia o cache do outro.
let deviceInstallId = LEGACY_INSTALL_ID; // fallback até o AsyncStorage responder
AsyncStorage.getItem(INSTALL_ID_KEY)
  .then((stored) => {
    if (stored) {
      deviceInstallId = stored;
      return;
    }
    const novo = `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    deviceInstallId = novo;
    return AsyncStorage.setItem(INSTALL_ID_KEY, novo);
  })
  .catch(() => {});

export function getDeviceInstallId(): string {
  return deviceInstallId;
}

function normalizeMac(mac: string | null | undefined): string {
  return String(mac ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

function hasCachedUuidForThisDevice(tag: RescueVehicleTag, deviceId: string): boolean {
  const cache = tag.iosPeripheralUuidCache as Record<string, string> | undefined;
  if (!cache || typeof cache !== 'object') return false;
  // Chave legada mantida: válida apenas no aparelho que pareou antes da correção
  return cache[getDeviceInstallId()] === deviceId || cache[LEGACY_INSTALL_ID] === deviceId;
}

/**
 * Decide se um peripheral detectado no scan é a tag alvo do veículo.
 * Aplica camadas de prioridade:
 *   1. MAC bate exatamente (Android, alta confiança)
 *   2. UUID iOS cacheado para esta instalação (alta confiança)
 *   3. Fingerprint cross-platform (nome + manufacturer data)
 *   4. Apenas nome (baixa confiança)
 */
export function matchTagToScan(tag: RescueVehicleTag, scanned: BleDevice): MatchResult | null {
  // 1. MAC exato (Android expõe MAC; iOS NÃO — device.id no iOS é UUID)
  if (Platform.OS === 'android' && tag.mac) {
    const tagMac = normalizeMac(tag.mac);
    const scannedMac = normalizeMac(scanned.id);
    if (tagMac && tagMac === scannedMac) {
      return { confidence: 'exact-mac', device: scanned, trackingId: scanned.id };
    }
  }

  // 2. iOS: peripheral UUID cacheado
  if (Platform.OS === 'ios' && hasCachedUuidForThisDevice(tag, scanned.id)) {
    return { confidence: 'cached-uuid', device: scanned, trackingId: scanned.id };
  }

  // 3. Fingerprint cross-platform: nome BLE + manufacturer data
  if (tag.nomeBleAdvertised) {
    const scannedName = (scanned.localName ?? scanned.name ?? '').trim();
    if (scannedName && scannedName === tag.nomeBleAdvertised.trim()) {
      // Reforça com manufacturer data se houver
      if (tag.manufacturerDataHex && scanned.manufacturerData) {
        const scannedMfgHex = bufferBase64ToHex(scanned.manufacturerData);
        if (scannedMfgHex.startsWith(tag.manufacturerDataHex.toUpperCase())) {
          return { confidence: 'fingerprint', device: scanned, trackingId: scanned.id };
        }
      }
      return { confidence: 'name-only', device: scanned, trackingId: scanned.id };
    }
  }

  // 4. Tag SEM nome advertised: manufacturer data é o único fingerprint restante.
  // Essencial para tag pareada no iOS (sem MAC) que não anuncia nome — sem este
  // caminho ela fica impossível de casar se o peripheral UUID mudar (endereço
  // BLE rotativo) ou em outro aparelho. Exige prefixo mútuo de >= 8 hex (4 bytes)
  // para reduzir falso positivo entre tags do mesmo fabricante.
  if (!tag.nomeBleAdvertised && tag.manufacturerDataHex && scanned.manufacturerData) {
    const scannedMfgHex = bufferBase64ToHex(scanned.manufacturerData);
    const tagMfgHex = tag.manufacturerDataHex.toUpperCase();
    const minLen = Math.min(scannedMfgHex.length, tagMfgHex.length);
    if (
      minLen >= 8 &&
      (scannedMfgHex.startsWith(tagMfgHex) || tagMfgHex.startsWith(scannedMfgHex))
    ) {
      return { confidence: 'fingerprint', device: scanned, trackingId: scanned.id };
    }
  }

  return null;
}

/**
 * Converte string base64 (formato em que o react-native-ble-plx entrega
 * manufacturerData) para hex maiúsculo. Aceita também null/undefined.
 */
export function bufferBase64ToHex(b64: string | null | undefined): string {
  if (!b64) return '';
  try {
    // React Native fornece atob global em runtime modernos
    const binary = globalThis.atob ? globalThis.atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    let hex = '';
    for (let i = 0; i < binary.length; i++) {
      hex += binary.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase();
    }
    return hex;
  } catch {
    return '';
  }
}

export function isHighConfidence(confidence: MatchConfidence): boolean {
  return confidence === 'exact-mac' || confidence === 'cached-uuid';
}
