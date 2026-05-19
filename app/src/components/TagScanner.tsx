import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { ActivityIndicator, Icon } from 'react-native-paper';

import {
  type BleDevice,
  ensureBlePermissions,
  startBleScan,
  waitForBleReady,
} from '../ble/bleManager';
import {
  classifyProximity,
  RssiSmoother,
  rssiToDistance,
} from '../ble/distanceEstimator';
import {
  bufferBase64ToHex,
  DEVICE_INSTALL_ID,
  isHighConfidence,
  type MatchConfidence,
  matchTagToScan,
} from '../ble/tagMatcher';
import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';

export type RescueVehicleTag = {
  id: string;
  apelido?: string | null;
  mac?: string | null;
  nomeBleAdvertised?: string | null;
  manufacturerCompanyId?: number | null;
  manufacturerDataHex?: string | null;
  serviceUuids?: unknown;
  txPowerCalibrado?: number | null;
  iosPeripheralUuidCache?: unknown;
};

export type RescueVehicle = {
  id: string;
  nome: string;
  placa?: string | null;
  tag?: RescueVehicleTag | null;
};

type TagScannerProps = {
  veiculoAlvo: RescueVehicle | null;
};

type OutraTag = {
  id: string;
  name: string;
  rssi: number;
  distance: number;
  lastSeenAt: number;
};

const STALE_TIMEOUT_MS = 8000;

export function TagScanner({ veiculoAlvo }: TagScannerProps) {
  const toast = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Estado da tag alvo
  const [alvoSmoother] = useState(() => new RssiSmoother(0.3));
  const [alvoRssi, setAlvoRssi] = useState<number | null>(null);
  const [alvoDistance, setAlvoDistance] = useState<number | null>(null);
  const [alvoConfidence, setAlvoConfidence] = useState<MatchConfidence>('none');
  const [alvoLastSeenAt, setAlvoLastSeenAt] = useState<number | null>(null);
  const [alvoTrackingId, setAlvoTrackingId] = useState<string | null>(null);
  const [cacheSaved, setCacheSaved] = useState(false);

  // Outras tags próximas
  const [outras, setOutras] = useState<Record<string, OutraTag>>({});

  // Refs pra acesso dentro do callback do scan
  const veiculoAlvoRef = useRef(veiculoAlvo);
  veiculoAlvoRef.current = veiculoAlvo;
  const alvoRssiRef = useRef<number | null>(null);
  alvoRssiRef.current = alvoRssi;

  const stopScanRef = useRef<(() => void) | null>(null);
  const vibrationCooldownRef = useRef(0);

  // Reset ao trocar de veículo
  useEffect(() => {
    alvoSmoother.reset();
    setAlvoRssi(null);
    setAlvoDistance(null);
    setAlvoConfidence('none');
    setAlvoLastSeenAt(null);
    setAlvoTrackingId(null);
    setCacheSaved(false);
    setOutras({});
  }, [veiculoAlvo?.id, alvoSmoother]);

  // Tira do conjunto "outras" tags que não foram vistas há muito tempo
  useEffect(() => {
    if (!isScanning) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setOutras((current) => {
        const next: Record<string, OutraTag> = {};
        let changed = false;
        for (const [id, t] of Object.entries(current)) {
          if (now - t.lastSeenAt < STALE_TIMEOUT_MS) {
            next[id] = t;
          } else {
            changed = true;
          }
        }
        return changed ? next : current;
      });
      // Tag alvo perdida
      if (alvoLastSeenAt && now - alvoLastSeenAt > STALE_TIMEOUT_MS) {
        alvoSmoother.reset();
        setAlvoRssi(null);
        setAlvoDistance(null);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isScanning, alvoLastSeenAt, alvoSmoother]);

  // Vibração quando muito perto (< 3m) — espaçada por 1.2s
  useEffect(() => {
    if (alvoDistance == null || alvoDistance >= 3) return;
    const now = Date.now();
    if (now - vibrationCooldownRef.current < 1200) return;
    vibrationCooldownRef.current = now;
    Vibration.vibrate(80);
  }, [alvoDistance]);

  const startScan = useCallback(async () => {
    setPermissionError(null);
    const perm = await ensureBlePermissions();
    if (!perm.granted) {
      setPermissionError(perm.reason ?? 'Sem permissão para Bluetooth.');
      return;
    }
    const state = await waitForBleReady(4000);
    if (String(state) !== 'PoweredOn') {
      setPermissionError('Ative o Bluetooth do aparelho para escanear.');
      return;
    }

    const stop = startBleScan(
      (device: BleDevice) => {
        const tag = veiculoAlvoRef.current?.tag ?? null;
        // 1. É a tag alvo?
        const match = tag ? matchTagToScan(tag, device) : null;
        if (match) {
          const txPower = tag?.txPowerCalibrado ?? -59;
          const smoothed = alvoSmoother.push(device.rssi ?? -100);
          const dist = rssiToDistance(smoothed, txPower, 2.5);
          setAlvoRssi(Math.round(smoothed));
          setAlvoDistance(dist);
          setAlvoConfidence(match.confidence);
          setAlvoTrackingId(match.trackingId);
          setAlvoLastSeenAt(Date.now());
          return;
        }
        // 2. É outra tag — entra no painel "outras"
        const id = device.id;
        const name = (device.localName ?? device.name ?? 'Tag sem nome').trim();
        const rssi = device.rssi ?? -100;
        const distance = rssiToDistance(rssi, -59, 2.5);
        setOutras((current) => ({
          ...current,
          [id]: { id, name, rssi, distance, lastSeenAt: Date.now() },
        }));
      },
      {
        onlyTags: true,
        onError: (msg) => {
          setPermissionError(msg);
          setIsScanning(false);
        },
      },
    );
    stopScanRef.current = stop;
    setIsScanning(true);
  }, [alvoSmoother]);

  const stopScan = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    setIsScanning(false);
  }, []);

  // Para o scan ao desmontar
  useEffect(() => {
    return () => {
      stopScanRef.current?.();
      stopScanRef.current = null;
    };
  }, []);

  // Salva fingerprint no backend após encontrar alvo por nome/manufacturer (sem MAC bater).
  // No iOS, isso cacheia o peripheralUUID dessa instalação pra próxima busca ser instantânea.
  const saveCacheToBackend = useCallback(async () => {
    const tag = veiculoAlvoRef.current?.tag;
    if (!tag || cacheSaved || !alvoTrackingId) return;
    if (alvoConfidence === 'exact-mac' || alvoConfidence === 'cached-uuid') return;
    // Só faz sentido cachear no iOS — Android usa MAC direto, mais confiável
    if (Platform.OS !== 'ios') {
      setCacheSaved(true);
      return;
    }
    try {
      await apiRequest(`/tags/${tag.id}`, {
        method: 'PUT',
        body: {
          iosPeripheralUuid: alvoTrackingId,
          iosDeviceId: DEVICE_INSTALL_ID,
        },
      });
      setCacheSaved(true);
    } catch {
      // silencioso — não é crítico
    }
  }, [alvoConfidence, alvoTrackingId, cacheSaved]);

  useEffect(() => {
    if (alvoConfidence !== 'none' && !isHighConfidence(alvoConfidence)) {
      saveCacheToBackend();
    }
  }, [alvoConfidence, saveCacheToBackend]);

  const proximity = useMemo(
    () => (alvoDistance != null ? classifyProximity(alvoDistance) : null),
    [alvoDistance],
  );

  const outrasOrdenadas = useMemo(
    () => Object.values(outras).sort((a, b) => a.distance - b.distance).slice(0, 5),
    [outras],
  );

  // ── Estado: sem veículo selecionado ─────────────────────────
  if (!veiculoAlvo) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderBox}>
          <Icon source="cursor-default-click-outline" size={32} color={colors.textMuted} />
          <Text style={styles.placeholderText}>
            Selecione um veículo no mapa para começar a busca.
          </Text>
        </View>
      </View>
    );
  }

  // ── Estado: veículo sem tag ────────────────────────────────
  if (!veiculoAlvo.tag) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Icon source="bluetooth-off" size={22} color={colors.textMuted} />
          <Text style={styles.headerTitle}>{veiculoAlvo.nome}</Text>
        </View>
        <View style={styles.alvoBox}>
          <View style={styles.warningInline}>
            <Icon source="map-marker" size={18} color={colors.primary} />
            <Text style={styles.warningInlineText}>
              Sem tag BLE — use a posição GPS no mapa para localizar.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Estado normal: tag disponível ──────────────────────────
  return (
    <View style={[styles.container, proximity ? { backgroundColor: proximity.color + '20' } : null]}>
      <View style={styles.header}>
        <Icon source="bluetooth-audio" size={22} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {veiculoAlvo.nome}
            {veiculoAlvo.placa ? ` — ${veiculoAlvo.placa}` : ''}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            Tag: {veiculoAlvo.tag.apelido ?? veiculoAlvo.tag.nomeBleAdvertised ?? veiculoAlvo.tag.mac}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={isScanning ? stopScan : startScan}
          style={[styles.scanButton, isScanning && styles.scanButtonStop]}
        >
          {isScanning ? (
            <>
              <ActivityIndicator size={14} color="#fff" />
              <Text style={styles.scanButtonText}>Parar</Text>
            </>
          ) : (
            <>
              <Icon source="magnify" size={16} color="#fff" />
              <Text style={styles.scanButtonText}>Buscar</Text>
            </>
          )}
        </Pressable>
      </View>

      {permissionError ? (
        <View style={styles.errorBox}>
          <Icon source="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{permissionError}</Text>
        </View>
      ) : null}

      {/* ── Display principal: distância + zona ───────────────── */}
      <View style={styles.mainDisplay}>
        {alvoDistance != null && proximity ? (
          <>
            <Text style={[styles.distanceValue, { color: proximity.color }]}>
              {alvoDistance < 1
                ? `${Math.round(alvoDistance * 100)} cm`
                : `${alvoDistance.toFixed(1)} m`}
            </Text>
            <Text style={[styles.zoneLabel, { color: proximity.color }]}>
              {proximity.label.toUpperCase()}
            </Text>
            <View style={styles.confidenceRow}>
              <Icon
                source={
                  alvoConfidence === 'exact-mac' || alvoConfidence === 'cached-uuid'
                    ? 'check-decagram'
                    : 'alert-decagram-outline'
                }
                size={12}
                color={colors.textMuted}
              />
              <Text style={styles.confidenceText}>
                {alvoConfidence === 'exact-mac'
                  ? 'Match por MAC'
                  : alvoConfidence === 'cached-uuid'
                  ? 'Match cacheado'
                  : alvoConfidence === 'fingerprint'
                  ? 'Match por nome + dados'
                  : alvoConfidence === 'name-only'
                  ? 'Match só por nome (incerto)'
                  : ''}
              </Text>
            </View>
            <Text style={styles.rssiText}>RSSI: {alvoRssi} dBm</Text>
          </>
        ) : isScanning ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.searchingText}>Procurando tag…</Text>
            <Text style={styles.searchingHint}>Caminhe pelo veículo para captar o sinal.</Text>
          </>
        ) : (
          <>
            <Icon source="bluetooth-settings" size={42} color={colors.textMuted} />
            <Text style={styles.idleText}>Pressione "Buscar" para iniciar.</Text>
          </>
        )}
      </View>

      {/* ── Lista de outras tags próximas ────────────────────── */}
      {isScanning && outrasOrdenadas.length > 0 ? (
        <View style={styles.outrasSection}>
          <Text style={styles.outrasTitle}>Outras tags próximas</Text>
          {outrasOrdenadas.map((t) => (
            <View key={t.id} style={styles.outraRow}>
              <Icon source="bluetooth" size={14} color={colors.textMuted} />
              <Text style={styles.outraName} numberOfLines={1}>{t.name}</Text>
              <Text style={styles.outraDist}>
                {t.distance < 1 ? `${Math.round(t.distance * 100)} cm` : `~${t.distance.toFixed(0)} m`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  headerSub: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  scanButtonStop: {
    backgroundColor: colors.danger,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: '#fff1ef',
    marginBottom: spacing.sm,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 11,
    fontWeight: '700',
  },
  mainDisplay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.md,
  },
  distanceValue: {
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -2,
  },
  zoneLabel: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  confidenceText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  rssiText: {
    marginTop: 4,
    color: colors.textMuted,
    fontSize: 10,
  },
  searchingText: {
    marginTop: 8,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  searchingHint: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  idleText: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 13,
  },
  placeholderBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  alvoBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 1,
  },
  warningInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  warningInlineText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  outrasSection: {
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  outrasTitle: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  outraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  outraName: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  outraDist: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
});
