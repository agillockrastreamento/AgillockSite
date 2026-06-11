import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { ActivityIndicator, Icon } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import Svg, { Path } from 'react-native-svg';

import {
  type BleDevice,
  ensureBlePermissions,
  startBleScan,
  waitForBleReady,
} from '../ble/bleManager';
import {
  classifyTrend,
  RssiSmoother,
  rssiToDistance,
  type TrendDirection,
} from '../ble/distanceEstimator';
import {
  getDeviceInstallId,
  isHighConfidence,
  type MatchConfidence,
  matchTagToScan,
} from '../ble/tagMatcher';
import { apiRequest } from '../services/api/apiClient';
import { spacing } from '../theme/layout';

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

const STALE_TIMEOUT_MS = 10000;
const SOUND_PREF_KEY = '@agillock/rescue/sound_haptic_enabled';

// Heading buckets para correlação direção-RSSI
const HEADING_BUCKET_DEG = 15;
// Mostra a seta direcional assim que tem 1 heading registrado.
// Imprecisa no começo (só 1 amostra), melhora à medida que o usuário gira.
const HEADING_SAMPLES_MIN = 1;
// Decay menor para a seta seguir o movimento do usuário. Buckets antigos
// expiram rápido, então a estimativa sempre reflete os últimos segundos.
const HEADING_DECAY_MS = 4000;

function getVibrationInterval(distance: number): number | null {
  if (distance < 2) return 350;
  if (distance < 5) return 800;
  if (distance < 15) return 1600;
  if (distance < 35) return 2800;
  return null;
}

// Texto contextual baseado no ângulo relativo entre o telefone e a tag.
// relAngle: -180..+180  (0 = na frente, +90 = direita, -90 = esquerda, ±180 = atrás)
function getDirectionLabel(relAngle: number, distance: number): string {
  if (distance < 1.5) return 'Bem perto';
  const abs = Math.abs(relAngle);
  if (abs < 30) return 'em frente';
  if (abs < 75) return relAngle > 0 ? 'à direita' : 'à esquerda';
  if (abs < 135) return relAngle > 0 ? 'atrás à direita' : 'atrás à esquerda';
  return 'atrás de você';
}

function getStateMessage(hasDistance: boolean, hasDirection: boolean, isScanning: boolean): string {
  if (!isScanning) return 'Toque em \u{1F50D} para começar';
  if (!hasDistance) return 'Procurando tag…';
  if (!hasDirection) return 'Vire-se devagar para localizar';
  return '';
}

function colorForDistance(distance: number | null): string {
  if (distance == null) return '#2d4566';
  if (distance < 2) return '#1b8d3a';
  if (distance < 8) return '#22a043';
  if (distance < 20) return '#3aa84a';
  if (distance < 40) return '#3c6e93';
  return '#2f4e6e';
}

export function TagScanner({ veiculoAlvo }: TagScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Tag alvo
  const [alvoSmoother] = useState(() => new RssiSmoother(0.35, 8));
  const [alvoRssi, setAlvoRssi] = useState<number | null>(null);
  const [alvoDistance, setAlvoDistance] = useState<number | null>(null);
  const [alvoConfidence, setAlvoConfidence] = useState<MatchConfidence>('none');
  const [alvoLastSeenAt, setAlvoLastSeenAt] = useState<number | null>(null);
  const [alvoTrackingId, setAlvoTrackingId] = useState<string | null>(null);
  const [cacheSaved, setCacheSaved] = useState(false);
  const [trend, setTrend] = useState<TrendDirection>('estavel');

  const [outras, setOutras] = useState<Record<string, OutraTag>>({});

  // Rastreio manual: o usuário toca numa tag da lista "Tags próximas" para
  // rastreá-la diretamente, ignorando o matching automático. Recurso de
  // recuperação quando o fingerprint da tag pareada não casa (tag sem nome,
  // endereço BLE rotativo etc.) ou quando o veículo não tem tag associada.
  const [manualTargetId, setManualTargetId] = useState<string | null>(null);
  const manualTargetIdRef = useRef<string | null>(null);
  manualTargetIdRef.current = manualTargetId;

  // Painel "Tags próximas" — abre pelo botão de buscar tags
  const [outrasVisible, setOutrasVisible] = useState(false);

  // Heading do telefone + heading estimada da tag
  const [deviceHeading, setDeviceHeading] = useState(0);
  const deviceHeadingRef = useRef(0);
  deviceHeadingRef.current = deviceHeading;

  // Histórico (heading bucket → melhor RSSI recente)
  const headingRssiRef = useRef<Map<number, { rssi: number; ts: number }>>(new Map());
  const [estimatedTagHeading, setEstimatedTagHeading] = useState<number | null>(null);

  // Animações
  const arrowRotationAnim = useRef(new Animated.Value(0)).current;
  const arrowOpacityAnim = useRef(new Animated.Value(0)).current;
  const sphereOpacityAnim = useRef(new Animated.Value(1)).current;
  const spherePulse = useRef(new Animated.Value(1)).current;
  const backgroundColorAnim = useRef(new Animated.Value(0)).current; // 0=cinza, 1=verde
  const dotPosAnim = useRef(new Animated.Value(0.5)).current; // posição da bolinha pequena
  const trendArrowAnim = useRef(new Animated.Value(0)).current;

  const veiculoAlvoRef = useRef(veiculoAlvo);
  veiculoAlvoRef.current = veiculoAlvo;
  const soundEnabledRef = useRef(true);
  soundEnabledRef.current = soundEnabled;

  const stopScanRef = useRef<(() => void) | null>(null);
  const vibrationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const headingWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const lastAnyScanAtRef = useRef<number>(0);
  const restartWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveThrottlesRef = useRef<number>(0);

  // ── Preferência de som persistida ─────────────────────
  useEffect(() => {
    AsyncStorage.getItem(SOUND_PREF_KEY)
      .then((v) => { if (v !== null) setSoundEnabled(v === '1'); })
      .catch(() => {});
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      AsyncStorage.setItem(SOUND_PREF_KEY, next ? '1' : '0').catch(() => {});
      if (!next) Vibration.cancel();
      return next;
    });
  }, []);

  const resetTracking = useCallback(() => {
    alvoSmoother.reset();
    setAlvoRssi(null);
    setAlvoDistance(null);
    setAlvoConfidence('none');
    setAlvoLastSeenAt(null);
    setAlvoTrackingId(null);
    setCacheSaved(false);
    setTrend('estavel');
    setOutras({});
    setEstimatedTagHeading(null);
    headingRssiRef.current.clear();
  }, [alvoSmoother]);

  // ── Reset ao trocar de veículo ───────────────────────
  useEffect(() => {
    resetTracking();
    setManualTargetId(null);
    setOutrasVisible(false);
  }, [veiculoAlvo?.id, resetTracking]);

  const selecionarManual = useCallback((id: string) => {
    resetTracking();
    setManualTargetId(id);
  }, [resetTracking]);

  const cancelarManual = useCallback(() => {
    resetTracking();
    setManualTargetId(null);
  }, [resetTracking]);

  // ── Heading do telefone ─────────────────────────────
  useEffect(() => {
    if (!isScanning) {
      headingWatcherRef.current?.remove();
      headingWatcherRef.current = null;
      return;
    }
    let cancelled = false;
    Location.requestForegroundPermissionsAsync().then((perm) => {
      if (!perm.granted || cancelled) return;
      Location.watchHeadingAsync((h) => {
        // trueHeading compensa declinação magnética; se < 0 (não disponível), usa magnético
        const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        if (Number.isFinite(heading)) setDeviceHeading(heading);
      }).then((watcher) => {
        if (cancelled) {
          watcher.remove();
          return;
        }
        headingWatcherRef.current = watcher;
      }).catch(() => {});
    });
    return () => {
      cancelled = true;
      headingWatcherRef.current?.remove();
      headingWatcherRef.current = null;
    };
  }, [isScanning]);

  // ── Cleanup das tags antigas + atualizar heading estimada da tag ─
  useEffect(() => {
    if (!isScanning) return;
    const interval = setInterval(() => {
      const now = Date.now();
      // Limpa outras tags antigas
      setOutras((current) => {
        const next: Record<string, OutraTag> = {};
        let changed = false;
        for (const [id, t] of Object.entries(current)) {
          if (now - t.lastSeenAt < STALE_TIMEOUT_MS) next[id] = t;
          else changed = true;
        }
        return changed ? next : current;
      });
      // Decai buckets de heading antigos
      const map = headingRssiRef.current;
      for (const [k, v] of map) {
        if (now - v.ts > HEADING_DECAY_MS) map.delete(k);
      }
      // Tag alvo perdida
      if (alvoLastSeenAt && now - alvoLastSeenAt > STALE_TIMEOUT_MS) {
        alvoSmoother.reset();
        setAlvoRssi(null);
        setAlvoDistance(null);
        setEstimatedTagHeading(null);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isScanning, alvoLastSeenAt, alvoSmoother]);

  // ── Animação: transição esfera → seta (3 estados) ────
  // Esfera fica visível em: sem sinal + sinal sem direção (ela aquece de cor com bg).
  // Seta aparece sobre a esfera quando já temos direção.
  useEffect(() => {
    const hasDirection = estimatedTagHeading != null;
    Animated.parallel([
      Animated.timing(arrowOpacityAnim, {
        toValue: hasDirection ? 1 : 0,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(sphereOpacityAnim, {
        toValue: hasDirection ? 0 : 1,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [estimatedTagHeading, arrowOpacityAnim, sphereOpacityAnim]);

  // ── Pulse da esfera (visível enquanto não há direção) ─
  useEffect(() => {
    if (estimatedTagHeading != null) {
      spherePulse.stopAnimation();
      spherePulse.setValue(1);
      return;
    }
    // Quando já captou distância, pulso fica mais rápido pra dar feedback de "esquentou"
    const fast = alvoDistance != null;
    const dur = fast ? 600 : 900;
    const scale = fast ? 1.12 : 1.08;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(spherePulse, { toValue: scale, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(spherePulse, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [alvoDistance, estimatedTagHeading, spherePulse]);

  // ── Rotação da seta (apontando pra direção estimada) ─
  useEffect(() => {
    if (estimatedTagHeading == null) return;
    const rel = ((estimatedTagHeading - deviceHeading + 540) % 360) - 180;
    Animated.spring(arrowRotationAnim, {
      toValue: rel,
      useNativeDriver: true,
      friction: 8,
      tension: 60,
    }).start();
  }, [estimatedTagHeading, deviceHeading, arrowRotationAnim]);

  // ── Animação posição da bolinha pequena (perto = topo) ─
  useEffect(() => {
    if (alvoDistance == null) {
      Animated.timing(dotPosAnim, { toValue: 0.5, duration: 300, useNativeDriver: false }).start();
      return;
    }
    const target = Math.max(0.05, Math.min(1, 1 - alvoDistance / 40));
    Animated.spring(dotPosAnim, { toValue: target, useNativeDriver: false, friction: 7, tension: 50 }).start();
  }, [alvoDistance, dotPosAnim]);

  // ── Cor de fundo — depende SÓ da distância, não da direção ─
  // Assim a tela já fica verde assim que captou sinal, mesmo antes de a seta aparecer.
  useEffect(() => {
    const target = alvoDistance != null
      ? (alvoDistance < 2 ? 1 : alvoDistance < 8 ? 0.85 : alvoDistance < 20 ? 0.6 : 0.35)
      : 0;
    Animated.timing(backgroundColorAnim, { toValue: target, duration: 600, useNativeDriver: false }).start();
  }, [alvoDistance, backgroundColorAnim]);

  // ── Animação do trend arrow (cima/baixo) ────────────
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

  // ── Vibração progressiva ────────────────────────────
  useEffect(() => {
    if (vibrationTimerRef.current) {
      clearInterval(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }
    if (!soundEnabled || alvoDistance == null) return;
    const interval = getVibrationInterval(alvoDistance);
    if (interval == null) return;
    Vibration.vibrate(alvoDistance < 2 ? [0, 100, 60, 100] : 50);
    vibrationTimerRef.current = setInterval(() => {
      if (!soundEnabledRef.current) return;
      Vibration.vibrate(alvoDistance < 2 ? [0, 100, 60, 100] : 50);
    }, interval);
    return () => {
      if (vibrationTimerRef.current) {
        clearInterval(vibrationTimerRef.current);
        vibrationTimerRef.current = null;
      }
    };
  }, [alvoDistance, soundEnabled]);

  useEffect(() => {
    return () => {
      if (vibrationTimerRef.current) clearInterval(vibrationTimerRef.current);
      Vibration.cancel();
      headingWatcherRef.current?.remove();
    };
  }, []);

  // ── Atualiza heading estimada da tag a cada scan ────
  const updateEstimatedHeading = useCallback((rssi: number) => {
    const heading = deviceHeadingRef.current;
    const bucket = Math.round(heading / HEADING_BUCKET_DEG) * HEADING_BUCKET_DEG;
    const now = Date.now();
    const map = headingRssiRef.current;
    // SEMPRE atualiza com o RSSI mais recente — assim os buckets refletem
    // a situação atual, não o pico histórico. Quando o usuário afasta da tag,
    // o RSSI cai em todos os buckets e a estimativa se mantém coerente.
    map.set(bucket, { rssi, ts: now });

    // Estima a heading da tag: bucket com melhor RSSI atual (entre os recentes)
    if (map.size >= HEADING_SAMPLES_MIN) {
      let best: { heading: number; rssi: number } | null = null;
      for (const [h, v] of map) {
        if (!best || v.rssi > best.rssi) best = { heading: h, rssi: v.rssi };
      }
      if (best) setEstimatedTagHeading(best.heading);
    }
  }, []);

  // ── Processa cada peripheral detectado pelo scan ────
  const handleScannedDevice = useCallback((device: BleDevice) => {
    lastAnyScanAtRef.current = Date.now();
    const tag = veiculoAlvoRef.current?.tag ?? null;
    const manualId = manualTargetIdRef.current;
    const match = manualId
      ? (device.id === manualId
          ? { confidence: 'name-only' as MatchConfidence, device, trackingId: device.id }
          : null)
      : tag
        ? matchTagToScan(tag, device)
        : null;
    if (match) {
      consecutiveThrottlesRef.current = 0;
      const txPower = tag?.txPowerCalibrado ?? -59;
      const rawRssi = device.rssi ?? -100;
      const smoothed = alvoSmoother.push(rawRssi);
      const dist = rssiToDistance(smoothed, txPower, 2.5);
      setAlvoRssi(Math.round(smoothed));
      setAlvoDistance(dist);
      setAlvoConfidence(match.confidence);
      setAlvoTrackingId(match.trackingId);
      setAlvoLastSeenAt(Date.now());
      setTrend(classifyTrend(alvoSmoother.trend()));
      updateEstimatedHeading(rawRssi);
      return;
    }
    const id = device.id;
    const name = (device.localName ?? device.name ?? `Sem nome · ${id.slice(-5)}`).trim();
    const rssi = device.rssi ?? -100;
    const distance = rssiToDistance(rssi, -59, 2.5);
    setOutras((current) => ({
      ...current,
      [id]: { id, name, rssi, distance, lastSeenAt: Date.now() },
    }));
  }, [alvoSmoother, updateEstimatedHeading]);

  // ── Inicia scan ─────────────────────────────────────
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

    // Inicializa o watchdog antes do callback ser registrado
    lastAnyScanAtRef.current = Date.now();

    const stop = startBleScan(
      handleScannedDevice,
      {
        onlyTags: true,
        onError: (msg) => {
          // Rate limit transitório do Android — o watchdog reinicia, não polui UI
          if (msg.toLowerCase().includes('cannot start scanning')) return;
          setPermissionError(msg);
          setIsScanning(false);
        },
      },
    );
    // Watchdog: detecta throttle do Android e reinicia o scan.
    // O Android tem rate limit RIGOROSO: máx 5 startDeviceScan() por 30s.
    // Se ultrapassar, sistema responde "Cannot Start Scanning Operation".
    // Por isso: threshold de 8s (max ~4 restarts/30s) + delay entre stop/start.
    let currentStop: () => void = stop;
    const recentRestartsRef = { times: [] as number[] };
    consecutiveThrottlesRef.current = 0;
    if (restartWatchdogRef.current) clearInterval(restartWatchdogRef.current);
    restartWatchdogRef.current = setInterval(() => {
      const now = Date.now();
      const since = now - lastAnyScanAtRef.current;
      if (since <= 8000) return;

      // Limite hard: máximo 4 restarts a cada 30s (margem do rate limit do Android = 5/30s)
      recentRestartsRef.times = recentRestartsRef.times.filter((t) => now - t < 30000);
      if (recentRestartsRef.times.length >= 4) return;
      recentRestartsRef.times.push(now);

      consecutiveThrottlesRef.current++;
      try { currentStop(); } catch {}

      // Delay 600ms entre stop e novo start — dá tempo do Android liberar
      // o slot interno do scanner BLE antes de tentar reabrir.
      setTimeout(() => {
        const newStop = startBleScan(
          handleScannedDevice,
          {
            onlyTags: true,
            onError: (msg) => {
              // Não popula permissionError em erros transitórios de scan
              // (ex: rate limit) — apenas loga e o watchdog tenta de novo.
              if (msg.includes('Cannot start scanning')) return;
              setPermissionError(msg);
            },
          },
        );
        currentStop = newStop;
        lastAnyScanAtRef.current = Date.now();
      }, 600);
    }, 2000);

    const stopAll = () => {
      if (restartWatchdogRef.current) {
        clearInterval(restartWatchdogRef.current);
        restartWatchdogRef.current = null;
      }
      try { currentStop(); } catch {}
    };
    stopScanRef.current = stopAll;
    setIsScanning(true);
  }, [handleScannedDevice]);

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

  // ── Cache iOS fingerprint ───────────────────────────
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
        body: { iosPeripheralUuid: alvoTrackingId, iosDeviceId: getDeviceInstallId() },
      });
      setCacheSaved(true);
    } catch {}
  }, [alvoConfidence, alvoTrackingId, cacheSaved]);

  useEffect(() => {
    if (alvoConfidence !== 'none' && !isHighConfidence(alvoConfidence)) {
      saveCacheToBackend();
    }
  }, [alvoConfidence, saveCacheToBackend]);

  // ── Computed ────────────────────────────────────────
  const hasDistance = alvoDistance != null;
  const hasDirection = estimatedTagHeading != null;
  const relAngle = estimatedTagHeading != null
    ? ((estimatedTagHeading - deviceHeading + 540) % 360) - 180
    : 0;

  const directionLabel = useMemo(() => {
    if (alvoDistance == null) return '';
    return getDirectionLabel(relAngle, alvoDistance);
  }, [alvoDistance, relAngle]);

  const stateMessage = useMemo(
    () => getStateMessage(hasDistance, hasDirection, isScanning),
    [hasDistance, hasDirection, isScanning],
  );

  const outrasOrdenadas = useMemo(
    () => Object.values(outras).sort((a, b) => a.distance - b.distance),
    [outras],
  );

  // Background interpolado
  const bg = backgroundColorAnim.interpolate({
    inputRange: [0, 0.35, 0.6, 0.85, 1],
    outputRange: ['#142035', '#1f4a3a', '#23733a', '#1b9038', '#13a83c'],
  });

  // Rotação da seta em string graus
  const arrowRotateStr = arrowRotationAnim.interpolate({
    inputRange: [-180, 180],
    outputRange: ['-180deg', '180deg'],
  });

  // ── Sem veículo ─────────────────────────────────────
  if (!veiculoAlvo) {
    return (
      <View style={styles.containerIdle}>
        <View style={styles.placeholderBox}>
          <Icon source="cursor-default-click-outline" size={32} color="rgba(255,255,255,0.5)" />
          <Text style={styles.placeholderText}>
            Selecione um veículo no mapa para começar a busca.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { backgroundColor: bg }]}>
      {/* Título no topo (como na foto Find My) */}
      <Text style={styles.titleTop} numberOfLines={1}>
        {veiculoAlvo.nome}{veiculoAlvo.placa ? ` — ${veiculoAlvo.placa}` : ''}
      </Text>

      {permissionError ? (
        <View style={styles.errorBox}>
          <Icon source="alert-circle" size={16} color="#ff6b6b" />
          <Text style={styles.errorText}>{permissionError}</Text>
        </View>
      ) : null}

      {/* Veículo sem tag associada: a busca ainda funciona via seleção manual */}
      {!veiculoAlvo.tag && !manualTargetId ? (
        <View style={styles.alvoBox}>
          <Icon source="map-marker" size={18} color="#fff" />
          <Text style={styles.warningInlineText}>
            Sem tag BLE associada — use "Buscar tags próximas" para rastrear uma
            tag manualmente, ou a posição GPS no mapa.
          </Text>
        </View>
      ) : null}

      {/* Chip de rastreio manual ativo */}
      {manualTargetId ? (
        <View style={styles.manualChip}>
          <Icon source="target" size={14} color="#ffd966" />
          <Text style={styles.manualChipText}>Rastreando tag manual</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOutrasVisible(true)}
            hitSlop={8}
          >
            <Text style={styles.manualChipCancel}>buscar outra</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={cancelarManual} hitSlop={8}>
            <Text style={styles.manualChipCancel}>
              {veiculoAlvo.tag ? 'voltar à original' : 'cancelar'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Área central: esfera (idle) ou seta direcional (com sinal) */}
      <View style={styles.centerArea}>
        {/* Esfera idle */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.spheresLayer,
            { opacity: sphereOpacityAnim, transform: [{ scale: spherePulse }] },
          ]}
        >
          <IdleSphere />
        </Animated.View>

        {/* Bolinha pequena topo (igual foto Find My) — aparece com direção */}
        {hasDirection ? (
          <View style={styles.topDot} pointerEvents="none">
            <View style={styles.topDotInner} />
          </View>
        ) : null}

        {/* Seta direcional rotacionada */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.arrowLayer,
            { opacity: arrowOpacityAnim, transform: [{ rotate: arrowRotateStr }] },
          ]}
        >
          <Svg width={180} height={220} viewBox="0 0 180 220">
            <Path
              d={`
                M 90 18
                L 156 110
                L 116 110
                L 116 198
                L 64 198
                L 64 110
                L 24 110
                Z
              `}
              fill="#ffffff"
              strokeWidth={0}
            />
          </Svg>
        </Animated.View>
      </View>

      {/* Distância + texto contextual ou direção */}
      <View style={styles.bottomInfo}>
        {hasDistance ? (
          <>
            <View style={styles.distanceRow}>
              <Text style={styles.distanceValue}>
                {alvoDistance! < 1
                  ? Math.round(alvoDistance! * 100)
                  : alvoDistance! < 10
                  ? alvoDistance!.toFixed(1).replace('.', ',')
                  : Math.round(alvoDistance!)}
              </Text>
              <Text style={styles.distanceUnit}>
                {alvoDistance! < 1 ? ' cm' : ' m'}
              </Text>
            </View>
            <Text style={styles.directionText}>
              {hasDirection ? directionLabel : 'Vire-se devagar para localizar'}
            </Text>
            <TrendIndicator trend={trend} anim={trendArrowAnim} />
          </>
        ) : (
          <Text style={styles.idleText}>{stateMessage}</Text>
        )}
      </View>

      {/* Botão que abre o painel de tags próximas (inicia o scan se preciso) */}
      {!outrasVisible && !manualTargetId ? (
        <Pressable
          accessibilityRole="button"
          style={styles.outrasToggleBtn}
          onPress={() => {
            if (!isScanning) startScan();
            setOutrasVisible(true);
          }}
        >
          <Icon source="radar" size={15} color="#fff" />
          <Text style={styles.outrasToggleText}>Buscar tags próximas</Text>
        </Pressable>
      ) : null}

      {/* Painel de tags próximas — toque para rastrear manualmente.
          Garante que tudo o que aparece no pareador também aparece aqui,
          mesmo quando o matching automático da tag pareada falha. */}
      {outrasVisible ? (
        <View style={styles.outrasBox}>
          <View style={styles.outrasHeader}>
            <Text style={styles.outrasTitle}>
              Tags próximas ({outrasOrdenadas.length}) — toque para rastrear
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar lista de tags próximas"
              onPress={() => setOutrasVisible(false)}
              hitSlop={8}
            >
              <Icon source="close" size={16} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
          {outrasOrdenadas.length === 0 ? (
            <Text style={styles.outrasEmpty}>
              {isScanning ? 'Procurando tags ao redor…' : 'Inicie a busca para escanear tags.'}
            </Text>
          ) : (
            <ScrollView style={styles.outrasList} nestedScrollEnabled>
              {outrasOrdenadas.map((t) => (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  style={styles.outraRow}
                  onPress={() => {
                    selecionarManual(t.id);
                    setOutrasVisible(false);
                  }}
                >
                  <Icon source="bluetooth" size={14} color="rgba(255,255,255,0.6)" />
                  <Text style={styles.outraName} numberOfLines={1}>{t.name}</Text>
                  <Text style={styles.outraMeta}>
                    {t.distance < 1
                      ? `${Math.round(t.distance * 100)} cm`
                      : `~${t.distance.toFixed(1).replace('.', ',')} m`}
                    {' · '}{t.rssi} dBm
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}

      {/* Rodapé com controles (igual foto Find My) */}
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isScanning ? 'Parar busca' : 'Iniciar busca'}
          onPress={isScanning ? stopScan : startScan}
          style={styles.footerButton}
          hitSlop={10}
        >
          {isScanning ? (
            <Icon source="close" size={20} color="#fff" />
          ) : (
            <Icon source="magnify" size={20} color="#fff" />
          )}
        </Pressable>

        {hasDistance ? (
          <View style={styles.confidenceFooter}>
            <Icon
              source={isHighConfidence(alvoConfidence) ? 'check-decagram' : 'alert-decagram-outline'}
              size={11}
              color="rgba(255,255,255,0.5)"
            />
            <Text style={styles.confidenceFooterText}>
              {alvoConfidence === 'exact-mac' ? 'MAC' :
               alvoConfidence === 'cached-uuid' ? 'UUID cacheado' :
               alvoConfidence === 'fingerprint' ? 'Nome + dados' :
               'Só nome'}
              {alvoRssi != null ? ` · ${alvoRssi} dBm` : ''}
            </Text>
            <FreshnessTick lastSeenAt={alvoLastSeenAt} />
          </View>
        ) : <View style={{ flex: 1 }} />}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={soundEnabled ? 'Desativar vibração' : 'Ativar vibração'}
          onPress={toggleSound}
          style={styles.footerButton}
          hitSlop={10}
        >
          <Icon
            source={soundEnabled ? 'volume-high' : 'volume-off'}
            size={20}
            color={soundEnabled ? '#fff' : 'rgba(255,255,255,0.4)'}
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────
// Esfera idle (pré-sinal)
// ─────────────────────────────────────────────────────
/**
 * Pequeno dot pulsante + tempo desde a última leitura.
 * Verde quando recém-recebida, amarelo se passar de 1.5s, vermelho se passar de 4s.
 */
function FreshnessTick({ lastSeenAt }: { lastSeenAt: number | null }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);
  if (!lastSeenAt) return null;
  const age = Date.now() - lastSeenAt;
  const color = age < 1500 ? '#a8f5b8' : age < 4000 ? '#ffd966' : '#ff9c9c';
  const label = age < 1000 ? 'ao vivo' : `${(age / 1000).toFixed(1)}s atrás`;
  // tick é usado para re-render periódico
  void tick;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

function TrendIndicator({ trend, anim }: { trend: TrendDirection; anim: Animated.Value }) {
  if (trend === 'estavel') return null;
  const isUp = trend === 'aproximando';
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, isUp ? -6 : 6] });
  return (
    <View style={styles.trendBox}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Icon
          source={isUp ? 'arrow-up-bold' : 'arrow-down-bold'}
          size={18}
          color={isUp ? '#a8f5b8' : '#ff9c9c'}
        />
      </Animated.View>
      <Text style={[styles.trendLabel, { color: isUp ? '#a8f5b8' : '#ff9c9c' }]}>
        {isUp ? 'APROXIMANDO' : 'AFASTANDO'}
      </Text>
    </View>
  );
}

function IdleSphere() {
  return (
    <View style={styles.sphereOuter}>
      <View style={styles.sphereMid}>
        <View style={styles.sphereInner} />
      </View>
    </View>
  );
}

const SPHERE_OUTER = 180;
const SPHERE_MID = 130;
const SPHERE_INNER = 80;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: '#142035',
  },
  containerIdle: {
    flex: 1,
    padding: spacing.md,
    backgroundColor: '#142035',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleTop: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: 'rgba(255,107,107,0.18)',
    marginBottom: spacing.sm,
  },
  errorText: { flex: 1, color: '#fff', fontSize: 11, fontWeight: '700' },
  centerArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  spheresLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topDot: {
    position: 'absolute',
    top: 8,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  sphereOuter: {
    width: SPHERE_OUTER,
    height: SPHERE_OUTER,
    borderRadius: SPHERE_OUTER / 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sphereMid: {
    width: SPHERE_MID,
    height: SPHERE_MID,
    borderRadius: SPHERE_MID / 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sphereInner: {
    width: SPHERE_INNER,
    height: SPHERE_INNER,
    borderRadius: SPHERE_INNER / 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  bottomInfo: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  distanceValue: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: -1,
    lineHeight: 56,
  },
  distanceUnit: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
  },
  directionText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '500',
    marginTop: -4,
  },
  trendBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  trendLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  idleText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  footerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  confidenceFooter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  confidenceFooterText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '700',
  },
  placeholderBox: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textAlign: 'center',
  },
  alvoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  warningInlineText: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  manualChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,217,102,0.14)',
    marginBottom: spacing.sm,
  },
  manualChipText: {
    flex: 1,
    color: '#ffd966',
    fontSize: 11,
    fontWeight: '700',
  },
  manualChipCancel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  outrasToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginBottom: spacing.xs,
  },
  outrasToggleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  outrasBox: {
    maxHeight: 168,
    marginBottom: spacing.xs,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
  },
  outrasHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  outrasTitle: {
    flex: 1,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  outrasEmpty: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontStyle: 'italic',
    paddingVertical: 8,
    textAlign: 'center',
  },
  outrasList: {
    flexGrow: 0,
  },
  outraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  outraName: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  outraMeta: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '600',
  },
});
