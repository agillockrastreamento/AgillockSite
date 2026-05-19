import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, type Device, type ScanOptions, State } from 'react-native-ble-plx';

/**
 * Wrapper singleton do react-native-ble-plx com utilitários
 * de permissão e filtro inicial focado em tags BLE.
 */

let _manager: BleManager | null = null;
function getManager(): BleManager {
  if (!_manager) _manager = new BleManager();
  return _manager;
}

/**
 * Service UUIDs e patterns conhecidos de fabricantes de tags BLE.
 * Usados para filtrar resultados do scan e excluir periféricos
 * que não são tags (fones, caixas, celulares, smartwatches etc.).
 *
 * Lista é expansível — adicionar conforme novas tags forem identificadas.
 */
export const KNOWN_TAG_SERVICE_UUIDS = [
  // Genéricos / chineses (iTAG, Nut, similares)
  'fff0', 'ffe0',
  // Tile
  'feed', 'fec9',
  // Chipolo / similares
  'fe07', 'fd5a',
  // Immediate Alert (perfil padrão de muitas tags BLE)
  '1802',
  // Find My Device service (Google Find My — varia, alguns IDs comuns)
  'feaa',
  // Samsung SmartTag (parcialmente, depende do firmware)
  'fd5a',
];

/**
 * Perfis BLE que indicam dispositivos NÃO-tag (áudio, HID).
 * Usado para filtrar fones, caixas, joysticks, teclados, etc.
 */
const EXCLUDED_SERVICE_UUIDS = [
  '110a', '110b', '110c', '110d', '110e', '110f', // A2DP
  '111e', '111f', '1108', // HFP / Headset
  '1124', '1812', // HID
  'fef3', 'fef5', // Google Nearby (Android Quick Pair)
];

/**
 * Heurísticas de nome que indicam periféricos a IGNORAR.
 */
const EXCLUDED_NAME_PATTERNS = [
  /headphone/i, /earbud/i, /buds/i, /airpods/i,
  /speaker/i, /jbl/i, /sony/i, /bose/i,
  /tv/i, /mi band/i, /watch/i, /amazfit/i, /redmi/i, /iphone/i, /galaxy/i, /pixel/i,
  /soundbar/i, /soundlink/i, /beats/i, /sonos/i,
];

function normalizeUuid(uuid: string | null | undefined): string {
  return String(uuid ?? '').toLowerCase().replace(/-/g, '').slice(-4);
}

/**
 * Filtra um peripheral retornado pelo scan, decidindo se é
 * provavelmente uma tag BLE útil para a busca de resgate.
 *
 * Lógica defensiva: bloqueia apenas o que é claramente NÃO-tag
 * (áudio, smartphones, smartwatches). Tudo o mais passa, porque
 * tags chinesas genéricas podem advertir sem nome e sem serviços
 * conhecidos — bloqueá-las cegamente esconde o que o resgatador
 * está tentando encontrar.
 */
export function looksLikeTag(device: Device): boolean {
  const services = (device.serviceUUIDs ?? []).map(normalizeUuid);
  const name = (device.localName ?? device.name ?? '').trim();

  // Bloqueio explícito por nome (áudio, watches, celulares).
  // Padrões devem ser específicos para não bloquear tags com nomes acidentais.
  if (name && EXCLUDED_NAME_PATTERNS.some((re) => re.test(name))) {
    return false;
  }
  // Bloqueio por service UUID de áudio/HID.
  if (services.some((u) => EXCLUDED_SERVICE_UUIDS.includes(u))) {
    return false;
  }

  // Tudo o mais passa. Inclui:
  //  - tags genéricas sem nome e sem services conhecidos (chinesas)
  //  - tags com service UUID conhecido (iTAG, Tile, Chipolo, etc.)
  //  - dispositivos não identificados que podem ser a tag procurada
  return true;
}

/**
 * Versão mais agressiva: aceita TUDO (inclusive áudio).
 * Útil para o modo debug do admin parear uma tag obscura.
 */
export function passthroughAll(_device: Device): boolean {
  return true;
}

/**
 * Pede as permissões necessárias para BLE no Android e iOS.
 * No iOS, basta a permissão de Bluetooth (concedida automaticamente
 * via Info.plist). No Android 12+ exige BLUETOOTH_SCAN / BLUETOOTH_CONNECT;
 * versões anteriores exigem ACCESS_FINE_LOCATION.
 */
export async function ensureBlePermissions(): Promise<{ granted: boolean; reason?: string }> {
  if (Platform.OS === 'ios') {
    return { granted: true };
  }
  if (Platform.OS !== 'android') {
    return { granted: false, reason: 'Plataforma não suportada.' };
  }
  // Android
  const apiLevel = Platform.Version;
  try {
    if (typeof apiLevel === 'number' && apiLevel >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      const scan = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN];
      const connect = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT];
      const granted =
        scan === PermissionsAndroid.RESULTS.GRANTED &&
        connect === PermissionsAndroid.RESULTS.GRANTED;
      if (!granted) {
        return {
          granted: false,
          reason: 'Permissão de Bluetooth negada. Conceda nas configurações do app para usar o scanner.',
        };
      }
    } else {
      const loc = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      if (loc !== PermissionsAndroid.RESULTS.GRANTED) {
        return {
          granted: false,
          reason: 'O Android exige permissão de localização para escanear Bluetooth.',
        };
      }
    }
    return { granted: true };
  } catch (err) {
    return {
      granted: false,
      reason: err instanceof Error ? err.message : 'Falha ao solicitar permissões.',
    };
  }
}

/**
 * Espera o adapter Bluetooth ficar pronto (estado PoweredOn).
 * Retorna o estado final em até `timeoutMs`.
 */
export async function waitForBleReady(timeoutMs = 5000): Promise<State> {
  const manager = getManager();
  const currentState = await manager.state();
  if (currentState === State.PoweredOn) return currentState;

  return new Promise<State>((resolve) => {
    const timer = setTimeout(() => {
      subscription.remove();
      resolve(currentState);
    }, timeoutMs);

    const subscription = manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        clearTimeout(timer);
        subscription.remove();
        resolve(state);
      }
    }, true);
  });
}

export type ScanCallback = (device: Device) => void;

/**
 * Inicia um scan BLE contínuo. Chama `onDevice` cada vez que um peripheral
 * é detectado (mesmo periférico pode ser visto várias vezes, com RSSI atualizado).
 * Retorna uma função para parar o scan.
 */
export function startBleScan(
  onDevice: ScanCallback,
  options?: { onlyTags?: boolean; onError?: (msg: string) => void },
): () => void {
  const manager = getManager();
  const scanOptions: ScanOptions = {
    allowDuplicates: true, // queremos updates de RSSI
    scanMode: 2, // SCAN_MODE_LOW_LATENCY (Android)
  };

  manager.startDeviceScan(null, scanOptions, (error, device) => {
    if (error) {
      options?.onError?.(error.message ?? 'Erro no scan BLE.');
      return;
    }
    if (!device) return;
    if (options?.onlyTags !== false && !looksLikeTag(device)) return;
    onDevice(device);
  });

  return () => {
    try {
      manager.stopDeviceScan();
    } catch {
      // silencioso — pode ser chamado mesmo se já parado
    }
  };
}

export function destroyBleManager() {
  if (_manager) {
    _manager.destroy();
    _manager = null;
  }
}

export { State as BleState } from 'react-native-ble-plx';
export type { Device as BleDevice } from 'react-native-ble-plx';
