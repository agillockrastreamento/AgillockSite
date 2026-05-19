import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { ActivityIndicator, Icon } from 'react-native-paper';
import Svg, {
  Circle as SvgCircle,
  Defs,
  RadialGradient,
  Stop,
} from 'react-native-svg';

import {
  type BleDevice,
  ensureBlePermissions,
  startBleScan,
  waitForBleReady,
} from '../ble/bleManager';
import {
  classifyProximity,
  classifyTrend,
  type ProximityInfo,
  RssiSmoother,
  rssiToDistance,
  type TrendDirection,
} from '../ble/distanceEstimator';
import {
  DEVICE_INSTALL_ID,
  isHighConfidence,
  type MatchConfidence,
  matchTagToScan,
} from '../ble/tagMatcher';
import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';

const AnimatedCircle = Animated.createAnimatedComponent(SvgCircle);

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

const STALE_TIMEOUT_MS = 12000;

// Pattern de vibração por zona
function getVibrationInterval(distance: number): number | null {
  if (distance < 2) return 400;
  if (distance < 5) return 900;
  if (distance < 15) return 1800;
  if (distance < 35) return 3000;
  return null;
}

function getTrendMessage(trend: TrendDirection, distance: number): string {
  if (distance < 2) return 'Olhe ao redor — a tag está bem perto!';
  if (trend === 'aproximando') return 'Continue na mesma direção…';
  if (trend === 'afastando') return 'Volte — você está se afastando.';
  return 'Caminhe em qualquer direção para detectar mudança.';
}

export function TagScanner({ veiculoAlvo }: TagScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Estado da tag alvo
  const [alvoSmoother] = useState(() => new RssiSmoother(0.3, 8));
  const [alvoRssi, setAlvoRssi] = useState<number | null>(null);
  const [alvoDistance, setAlvoDistance] = useState<number | null>(null);
  const [alvoConfidence, setAlvoConfidence] = useState<MatchConfidence>('none');
  const [alvoLastSeenAt, setAlvoLastSeenAt] = useState<number | null>(null);
  const [alvoTrackingId, setAlvoTrackingId] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendDirection>('estavel');
  const [cacheSaved, setCacheSaved] = useState(false);

  const [outras, setOutras] = useState<Record<string, OutraTag>>({});

  // Animações
  const corePulse = useRef(new Animated.Value(1)).current;
  const ring1Anim = useRef(new Animated.Value(0)).current;
  const ring2Anim = useRef(new Animated.Value(0)).current;
  const ring3Anim = useRef(new Animated.Value(0)).current;
  const trendArrowAnim = useRef(new Animated.Value(0)).current;
  const colorIntensity = useRef(new Animated.Value(0)).current;

  const veiculoAlvoRef = useRef(veiculoAlvo);
  veiculoAlvoRef.current = veiculoAlvo;

  const stopScanRef = useRef<(() => void) | null>(null);
  const vibrationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset ao trocar de veículo
  useEffect(() => {
    alvoSmoother.reset();
    setAlvoRssi(null);
    setAlvoDistance(null);
    setAlvoConfidence('none');
    setAlvoLastSeenAt(null);
    setAlvoTrackingId(null);
    setTrend('estavel');
    setCacheSaved(false);
    setOutras({});
  }, [veiculoAlvo?.id, alvoSmoother]);

  // Limpa tags antigas
  useEffect(() => {
    if (!isScanning) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setOutras((current) => {
        const next: Record<string, OutraTag> = {};
        let changed = false;
        for (const [id, t] of Object.entries(current)) {
          if (now - t.lastSeenAt < STALE_TIMEOUT_MS) next[id] = t;
          else changed = true;
        }
        return changed ? next : current;
      });
      if (alvoLastSeenAt && now - alvoLastSeenAt > STALE_TIMEOUT_MS) {
        alvoSmoother.reset();
        setAlvoRssi(null);
        setAlvoDistance(null);
        setTrend('estavel');
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isScanning, alvoLastSeenAt, alvoSmoother]);

  // Anéis concêntricos pulsando (estilo radar)
  useEffect(() => {
    if (alvoDistance == null) {
      ring1Anim.stopAnimation();
      ring2Anim.stopAnimation();
      ring3Anim.stopAnimation();
      ring1Anim.setValue(0);
      ring2Anim.setValue(0);
      ring3Anim.setValue(0);
      return;
    }
    // Velocidade dos anéis baseada na distância (perto = rápido)
    const duration = Math.max(900, Math.min(2800, alvoDistance * 90));
    const makeLoop = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: false,
          }),
        ]),
      );
    const l1 = makeLoop(ring1Anim, 0);
    const l2 = makeLoop(ring2Anim, duration * 0.33);
    const l3 = makeLoop(ring3Anim, duration * 0.66);
    l1.start();
    l2.start();
    l3.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, [alvoDistance, ring1Anim, ring2Anim, ring3Anim]);

  // Pulse do núcleo
  useEffect(() => {
    if (alvoDistance == null) {
      corePulse.stopAnimation();
      corePulse.setValue(1);
      return;
    }
    const duration = Math.max(450, Math.min(1400, alvoDistance * 70));
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(corePulse, { toValue: 1.12, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(corePulse, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [alvoDistance, corePulse]);

  // Cor de fundo animada
  useEffect(() => {
    if (alvoDistance == null) {
      Animated.timing(colorIntensity, { toValue: 0, duration: 400, useNativeDriver: false }).start();
      return;
    }
    const i = alvoDistance < 5 ? 1 :
              alvoDistance < 15 ? 0.6 :
              alvoDistance < 35 ? 0.3 : 0.1;
    Animated.timing(colorIntensity, { toValue: i, duration: 600, useNativeDriver: false }).start();
  }, [alvoDistance, colorIntensity]);

  // Animação da seta de trend
  useEffect(() => {
    if (trend === 'estavel') {
      trendArrowAnim.stopAnimation();
      trendArrowAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(trendArrowAnim, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(trendArrowAnim, { toValue: 0, duration: 500, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [trend, trendArrowAnim]);

  // Vibração progressiva
  useEffect(() => {
    if (vibrationTimerRef.current) {
      clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }
    if (alvoDistance == null) return;
    const interval = getVibrationInterval(alvoDistance);
    if (interval == null) return;
    Vibration.vibrate(alvoDistance < 2 ? [0, 100, 60, 100] : 50);
    vibrationTimerRef.current = setInterval(() => {
      Vibration.vibrate(alvoDistance < 2 ? [0, 100, 60, 100] : 50);
    }, interval);
    return () => {
      if (vibrationTimerRef.current) {
        clearInterval(vibrationTimerRef.current);
        vibrationTimerRef.current = null;
      }
    };
  }, [alvoDistance]);

  useEffect(() => {
    return () => {
      if (vibrationTimerRef.current) clearInterval(vibrationTimerRef.current);
      Vibration.cancel();
    };
  }, []);

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
        const match = tag ? matchTagToScan(tag, device) : null;
        if (match) {
          const txPower = tag?.txPowerCalibrado ?? -65;
          const smoothed = alvoSmoother.push(device.rssi ?? -100);
          const dist = rssiToDistance(smoothed, txPower, 3.0);
          setAlvoRssi(Math.round(smoothed));
          setAlvoDistance(dist);
          setAlvoConfidence(match.confidence);
          setAlvoTrackingId(match.trackingId);
          setAlvoLastSeenAt(Date.now());
          setTrend(classifyTrend(alvoSmoother.trend()));
          return;
        }
        const id = device.id;
        const name = (device.localName ?? device.name ?? `Sem nome · ${id.slice(-5)}`).trim();
        const rssi = device.rssi ?? -100;
        const distance = rssiToDistance(rssi, -65, 3.0);
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
    Vibration.cancel();
    if (vibrationTimerRef.current) {
      clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopScanRef.current?.();
      stopScanRef.current = null;
    };
  }, []);

  const saveCacheToBackend = useCallback(async () => {
    const tag = veiculoAlvoRef.current?.tag;
    if (!tag || cacheSaved || !alvoTrackingId) return;
    if (alvoConfidence === 'exact-mac' || alvoConfidence === 'cached-uuid') return;
    if (Platform.OS !== 'ios') {
      setCacheSaved(true);
      return;
    }
    try {
      await apiRequest(`/tags/${tag.id}`, {
        method: 'PUT',
        body: { iosPeripheralUuid: alvoTrackingId, iosDeviceId: DEVICE_INSTALL_ID },
      });
      setCacheSaved(true);
    } catch {}
  }, [alvoConfidence, alvoTrackingId, cacheSaved]);

  useEffect(() => {
    if (alvoConfidence !== 'none' && !isHighConfidence(alvoConfidence)) {
      saveCacheToBackend();
    }
  }, [alvoConfidence, saveCacheToBackend]);

  const proximity: ProximityInfo | null = useMemo(
    () => (alvoDistance != null ? classifyProximity(alvoDistance) : null),
    [alvoDistance],
  );

  const outrasOrdenadas = useMemo(
    () => Object.values(outras).sort((a, b) => a.distance - b.distance).slice(0, 6),
    [outras],
  );

  // Background interpolado: do azul-marinho frio ao quase-vermelho quente (estilo Find My)
  const backgroundColor = colorIntensity.interpolate({
    inputRange: [0, 0.3, 0.6, 1],
    outputRange: ['#0c1830', '#0e3460', '#225e3a', '#7a3a1f'],
  });

  // ── Sem veículo selecionado ────────────────────────────
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

  // ── Veículo sem tag ────────────────────────────────────
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

  return (
    <Animated.View style={[styles.container, { backgroundColor }]}>
      <View style={styles.header}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {veiculoAlvo.nome}{veiculoAlvo.placa ? ` — ${veiculoAlvo.placa}` : ''}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {veiculoAlvo.tag.apelido ?? veiculoAlvo.tag.nomeBleAdvertised ?? veiculoAlvo.tag.mac}
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

      {/* ── Display principal — estilo Find My ─────────── */}
      <View style={styles.findMyArea}>
        {alvoDistance != null && proximity ? (
          <FindMyCircle
            distance={alvoDistance}
            color={proximity.color}
            corePulse={corePulse}
            ring1Anim={ring1Anim}
            ring2Anim={ring2Anim}
            ring3Anim={ring3Anim}
          />
        ) : (
          <FindMyCircleIdle scanning={isScanning} />
        )}

        {alvoDistance != null && proximity ? (
          <>
            <Text style={[styles.zoneLabel, { color: proximity.color }]}>
              {proximity.label.toUpperCase()}
            </Text>
            <TrendIndicator trend={trend} anim={trendArrowAnim} />
            <Text style={styles.trendMessage}>
              {getTrendMessage(trend, alvoDistance)}
            </Text>
            <View style={styles.confidenceRow}>
              <Icon
                source={
                  alvoConfidence === 'exact-mac' || alvoConfidence === 'cached-uuid'
                    ? 'check-decagram'
                    : 'alert-decagram-outline'
                }
                size={11}
                color="rgba(255,255,255,0.55)"
              />
              <Text style={styles.confidenceText}>
                {alvoConfidence === 'exact-mac' ? 'Match por MAC'
                  : alvoConfidence === 'cached-uuid' ? 'Match cacheado'
                  : alvoConfidence === 'fingerprint' ? 'Match por nome + dados'
                  : alvoConfidence === 'name-only' ? 'Match só por nome (incerto)'
                  : ''}
                {alvoRssi != null ? ` · ${alvoRssi} dBm` : ''}
              </Text>
            </View>
          </>
        ) : isScanning ? (
          <>
            <Text style={styles.searchingText}>Procurando tag…</Text>
            <Text style={styles.searchingHint}>
              Caminhe lentamente em volta do veículo
            </Text>
          </>
        ) : (
          <Text style={styles.idleText}>Pressione "Buscar" para iniciar</Text>
        )}
      </View>

      {/* ── Outras tags próximas ──────────────────────── */}
      {isScanning && outrasOrdenadas.length > 0 ? (
        <View style={styles.outrasSection}>
          <Text style={styles.outrasTitle}>Outras tags ({outrasOrdenadas.length})</Text>
          {outrasOrdenadas.map((t) => (
            <View key={t.id} style={styles.outraRow}>
              <Icon source="bluetooth" size={12} color="rgba(255,255,255,0.5)" />
              <Text style={styles.outraName} numberOfLines={1}>{t.name}</Text>
              <Text style={styles.outraDist}>
                {t.distance < 1 ? `${Math.round(t.distance * 100)} cm` : `~${t.distance.toFixed(0)} m`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

// ════════════════════════════════════════════════════════
// COMPONENTES VISUAIS
// ════════════════════════════════════════════════════════

const CIRCLE_SIZE = 200;
const CENTER = CIRCLE_SIZE / 2;

function FindMyCircle({
  distance,
  color,
  corePulse,
  ring1Anim,
  ring2Anim,
  ring3Anim,
}: {
  distance: number;
  color: string;
  corePulse: Animated.Value;
  ring1Anim: Animated.Value;
  ring2Anim: Animated.Value;
  ring3Anim: Animated.Value;
}) {
  const distLabel = distance < 1
    ? `${Math.round(distance * 100)}`
    : distance < 10
    ? distance.toFixed(1)
    : Math.round(distance).toString();
  const distUnit = distance < 1 ? 'cm' : 'm';

  // Anéis: raio varia de 35 → 90 com opacidade caindo
  const radiusFor = (anim: Animated.Value) =>
    anim.interpolate({ inputRange: [0, 1], outputRange: [35, 90] });
  const opacityFor = (anim: Animated.Value) =>
    anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.7, 0] });

  return (
    <View style={styles.circleWrap}>
      <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}>
        <Defs>
          <RadialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.95} />
            <Stop offset="70%" stopColor={color} stopOpacity={0.55} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* Anéis (pulsando pra fora) */}
        <AnimatedCircle
          cx={CENTER}
          cy={CENTER}
          r={radiusFor(ring1Anim) as unknown as number}
          stroke={color}
          strokeWidth={2}
          fill="none"
          opacity={opacityFor(ring1Anim) as unknown as number}
        />
        <AnimatedCircle
          cx={CENTER}
          cy={CENTER}
          r={radiusFor(ring2Anim) as unknown as number}
          stroke={color}
          strokeWidth={2}
          fill="none"
          opacity={opacityFor(ring2Anim) as unknown as number}
        />
        <AnimatedCircle
          cx={CENTER}
          cy={CENTER}
          r={radiusFor(ring3Anim) as unknown as number}
          stroke={color}
          strokeWidth={2}
          fill="none"
          opacity={opacityFor(ring3Anim) as unknown as number}
        />
        {/* Halo de fundo */}
        <SvgCircle cx={CENTER} cy={CENTER} r={80} fill="url(#coreGrad)" />
      </Svg>
      {/* Núcleo central com pulse */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.coreOverlay,
          { transform: [{ scale: corePulse }] },
        ]}
      >
        <Text style={[styles.distanceValue, { color: '#fff' }]}>{distLabel}</Text>
        <Text style={[styles.distanceUnit, { color: '#fff' }]}>{distUnit}</Text>
      </Animated.View>
    </View>
  );
}

function FindMyCircleIdle({ scanning }: { scanning: boolean }) {
  return (
    <View style={styles.circleWrap}>
      <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}>
        <SvgCircle cx={CENTER} cy={CENTER} r={70} stroke="rgba(255,255,255,0.1)" strokeWidth={2} fill="rgba(255,255,255,0.04)" />
        <SvgCircle cx={CENTER} cy={CENTER} r={50} stroke="rgba(255,255,255,0.08)" strokeWidth={1.5} fill="none" />
        <SvgCircle cx={CENTER} cy={CENTER} r={30} stroke="rgba(255,255,255,0.06)" strokeWidth={1} fill="none" />
      </Svg>
      <View style={styles.coreOverlay} pointerEvents="none">
        {scanning ? (
          <ActivityIndicator color="rgba(255,255,255,0.6)" />
        ) : (
          <Icon source="bluetooth-settings" size={42} color="rgba(255,255,255,0.4)" />
        )}
      </View>
    </View>
  );
}

function TrendIndicator({ trend, anim }: { trend: TrendDirection; anim: Animated.Value }) {
  if (trend === 'estavel') {
    return (
      <View style={styles.trendBox}>
        <Icon source="circle-medium" size={18} color="rgba(255,255,255,0.5)" />
        <Text style={styles.trendStable}>Estável</Text>
      </View>
    );
  }
  const isUp = trend === 'aproximando';
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, isUp ? -6 : 6] });
  return (
    <View style={styles.trendBox}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Icon
          source={isUp ? 'arrow-up-bold' : 'arrow-down-bold'}
          size={22}
          color={isUp ? '#2ecc71' : '#e74c3c'}
        />
      </Animated.View>
      <Text style={[styles.trendLabel, { color: isUp ? '#2ecc71' : '#e74c3c' }]}>
        {isUp ? 'APROXIMANDO' : 'AFASTANDO'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.md,
    backgroundColor: '#0c1830', // azul-marinho frio
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.6)',
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
  findMyArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  circleWrap: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreOverlay: {
    position: 'absolute',
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  distanceValue: {
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -2,
  },
  distanceUnit: {
    fontSize: 22,
    fontWeight: '900',
    marginLeft: 4,
    marginBottom: 8,
    alignSelf: 'flex-end',
  },
  zoneLabel: {
    marginTop: spacing.sm,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  trendBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  trendLabel: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  trendStable: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '800',
  },
  trendMessage: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  confidenceText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: '700',
  },
  searchingText: {
    marginTop: spacing.md,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '800',
  },
  searchingHint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: 4,
  },
  idleText: {
    marginTop: spacing.md,
    color: 'rgba(255,255,255,0.55)',
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
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    textAlign: 'center',
  },
  alvoBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  warningInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  warningInlineText: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  outrasSection: {
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  outrasTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  outraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  outraName: {
    flex: 1,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
  },
  outraDist: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: '700',
  },
});
