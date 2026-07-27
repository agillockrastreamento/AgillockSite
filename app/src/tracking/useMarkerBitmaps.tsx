import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import type { TrackingDevice } from './trackingTypes';
import { VehicleIcon } from './VehicleIcon';
import { getMarkerColor } from './VehicleCards';

export const MARKER_ICON_SIZE = 58;
// Passo de 15°: no Android trocar o bitmap remonta o marcador nativo, então
// cada grau a menos de granularidade é uma remontagem a menos. A 15° a
// diferença de rotação não é perceptível no ícone.
const COURSE_STEP = 15;
const MARKER_BITMAP_VERSION = 2.5;

// Quantas capturas rodam ao mesmo tempo. `captureRef` é uma operação nativa
// cara (renderiza a view + lê o framebuffer); disparar centenas de uma vez
// estoura a memória e derruba o app no Android.
const MAX_CONCURRENT_CAPTURES = 6;

// Acima disto não capturamos a variante COM etiqueta (uma por veículo, já que
// a placa entra na chave). Só o ícone, cujas combinações são poucas e ficam em
// cache. Com centenas de veículos na tela a etiqueta é ilegível de qualquer
// forma, e capturar uma por veículo é o que travava o mapa.
const LABEL_BITMAP_LIMIT = 120;

// Agrupa as notificações de "bitmap pronto" — sem isso cada captura provocava
// um re-render da tela inteira do mapa (N capturas x N marcadores).
const BITMAP_FLUSH_MS = 220;

function roundCourse(course: number): number {
  return ((Math.round(course / COURSE_STEP) * COURSE_STEP) % 360 + 360) % 360;
}

export function makeCaptureKey(
  categoria: string | null | undefined,
  color: string,
  course: number,
  label: string | null | undefined,
  showLabel: boolean,
): string {
  const rc = roundCourse(course);
  const lbl = showLabel && label ? label : '';
  return `${MARKER_BITMAP_VERSION}|${categoria ?? ''}|${color}|${rc}|${lbl}`;
}

// Module-level cache — persists across re-mounts of MapScreen
const bitmapCache = new Map<string, string>();

// Per-device last-known bitmap URI (module-level, persists across re-mounts)
const lastBitmapByDevice = new Map<string, string>();

export type PendingCapture = {
  key: string;
  categoria: string | null | undefined;
  color: string;
  course: number;
  label: string | null | undefined;
  showLabel: boolean;
};

// ─── Fila global de capturas ─────────────────────────────────────────────────
// Vive fora do React: enfileirar/desenfileirar não pode re-renderizar a tela.

const captureQueue: PendingCapture[] = [];
const queuedKeys = new Set<string>();
const falhasPorChave = new Map<string, number>();
const queueSubscribers = new Set<() => void>();
const bitmapSubscribers = new Set<() => void>();

const MAX_TENTATIVAS = 3;

function enqueueCapture(entry: PendingCapture): boolean {
  if (bitmapCache.has(entry.key) || queuedKeys.has(entry.key)) return false;
  if ((falhasPorChave.get(entry.key) ?? 0) >= MAX_TENTATIVAS) return false;
  queuedKeys.add(entry.key);
  captureQueue.push(entry);
  return true;
}

function notifyQueue() {
  queueSubscribers.forEach((fn) => fn());
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBitmapFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    bitmapSubscribers.forEach((fn) => fn());
  }, BITMAP_FLUSH_MS);
}

// ─── OffscreenCapture ────────────────────────────────────────────────────────
// Renders one icon in a hidden view, captures it as PNG, calls onReady.

function OffscreenCapture({
  entry,
  onReady,
}: {
  entry: PendingCapture;
  onReady(key: string, uri: string | null): void;
}) {
  const viewRef = useRef<View>(null);
  const { key, categoria, color, course, label, showLabel } = entry;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!viewRef.current) {
        onReady(key, null);
        return;
      }
      captureRef(viewRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      })
        .then((uri) => onReady(key, uri))
        .catch(() => onReady(key, null));
    }, 100);
    return () => clearTimeout(timer);
  }, [key, onReady]);

  return (
    <View ref={viewRef} collapsable={false} style={styles.captureItem}>
      <VehicleIcon
        categoria={categoria}
        color={color}
        course={course}
        size={MARKER_ICON_SIZE}
      />
      {showLabel && label ? (
        <View style={styles.captureLabelWrap}>
          <View style={styles.captureLabelPointer} />
          <View style={styles.captureLabel}>
            <Text style={styles.captureLabelText} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ─── OffscreenCapturePool ────────────────────────────────────────────────────
// Consome a fila global mantendo no máximo MAX_CONCURRENT_CAPTURES capturas em
// voo. O estado fica aqui dentro para que o avanço da fila não re-renderize a
// tela do mapa (só este componente).

export function OffscreenCapturePool({ enabled = true }: { enabled?: boolean }) {
  const [inflight, setInflight] = useState<PendingCapture[]>([]);
  const inflightRef = useRef(inflight);
  inflightRef.current = inflight;

  const pump = useCallback(() => {
    const livres = MAX_CONCURRENT_CAPTURES - inflightRef.current.length;
    if (livres <= 0 || captureQueue.length === 0) return;
    const next = captureQueue.splice(0, livres);
    if (next.length > 0) setInflight((prev) => [...prev, ...next]);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    queueSubscribers.add(pump);
    pump();
    return () => {
      queueSubscribers.delete(pump);
    };
  }, [enabled, pump]);

  // Ao liberar um slot, puxa os próximos da fila.
  useEffect(() => {
    if (enabled) pump();
  }, [inflight, enabled, pump]);

  // Ao sair da tela, devolve as capturas em voo para a fila — do contrário
  // suas chaves ficariam marcadas como "já enfileiradas" para sempre e o ícone
  // nunca mais seria gerado.
  useEffect(() => () => {
    for (const entry of inflightRef.current) {
      queuedKeys.delete(entry.key);
    }
  }, []);

  const handleReady = useCallback((key: string, uri: string | null) => {
    if (uri) bitmapCache.set(key, uri);
    // Falha: libera a chave para nova tentativa, até MAX_TENTATIVAS — sem isso
    // uma captura que sempre falha seria re-enfileirada para sempre.
    else falhasPorChave.set(key, (falhasPorChave.get(key) ?? 0) + 1);
    queuedKeys.delete(key);
    setInflight((prev) => prev.filter((e) => e.key !== key));
    if (uri) scheduleBitmapFlush();
  }, []);

  if (!enabled || inflight.length === 0) return null;
  return (
    <View style={styles.capturePool} pointerEvents="none">
      {inflight.map((entry) => (
        <OffscreenCapture key={entry.key} entry={entry} onReady={handleReady} />
      ))}
    </View>
  );
}

// ─── useMarkerBitmaps ────────────────────────────────────────────────────────

export function useMarkerBitmaps(
  devices: TrackingDevice[],
  showLabels: boolean,
  enabled = true,
) {
  // Contador de versão em vez de copiar o Map inteiro a cada bitmap pronto.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const notificar = () => setVersion((v) => v + 1);
    bitmapSubscribers.add(notificar);
    return () => {
      bitmapSubscribers.delete(notificar);
    };
  }, []);

  const comEtiqueta = showLabels && devices.length <= LABEL_BITMAP_LIMIT;

  // Enfileira as configurações de ícone que ainda não estão em cache.
  // No iOS os marcadores renderizam o ícone como filho (sem bitmap), então não
  // capturamos nada — evita captureRef em massa (custo/crash sob Fabric).
  useEffect(() => {
    if (!enabled) return;
    let adicionou = false;

    // 1º as variantes SEM etiqueta: são poucas combinações (categoria x cor x
    // curso), aquecem o cache rápido e servem de fallback imediato para todos
    // os marcadores — é o que evita o mapa aparecer só com "pontinhos".
    for (const device of devices) {
      const color = getMarkerColor(device);
      const course = device.posicao?.curso ?? 0;
      const key = makeCaptureKey(device.categoria, color, course, null, false);
      if (enqueueCapture({ key, categoria: device.categoria, color, course, label: null, showLabel: false })) {
        adicionou = true;
      }
    }

    // 2º as variantes COM etiqueta (uma por veículo).
    if (comEtiqueta) {
      for (const device of devices) {
        const color = getMarkerColor(device);
        const course = device.posicao?.curso ?? 0;
        const label = device.placa ?? device.nome ?? null;
        if (!label) continue;
        const key = makeCaptureKey(device.categoria, color, course, label, true);
        if (enqueueCapture({ key, categoria: device.categoria, color, course, label, showLabel: true })) {
          adicionou = true;
        }
      }
    }

    if (adicionou) notifyQueue();
  }, [devices, comEtiqueta, enabled]);

  const getBitmap = useCallback(
    (device: TrackingDevice): string | undefined => {
      const color = getMarkerColor(device);
      const course = device.posicao?.curso ?? 0;
      const label = device.placa ?? device.nome ?? null;

      const uri =
        (comEtiqueta && label
          ? bitmapCache.get(makeCaptureKey(device.categoria, color, course, label, true))
          : undefined) ??
        bitmapCache.get(makeCaptureKey(device.categoria, color, course, null, false));

      if (uri) {
        // Update last-known bitmap for this device
        lastBitmapByDevice.set(device.dispositivoId, uri);
        return uri;
      }
      // Cache miss: return the previous bitmap to prevent flickering while
      // the new bitmap (e.g. updated course angle) is being captured
      return lastBitmapByDevice.get(device.dispositivoId);
    },
    // `version` entra de propósito: renova a identidade quando chegam bitmaps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comEtiqueta, version],
  );

  return { getBitmap };
}

const styles = StyleSheet.create({
  capturePool: {
    position: 'absolute',
    left: -9999,
    top: 0,
    opacity: 0,
  },
  captureItem: {
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  captureLabel: {
    maxWidth: 96,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  captureLabelWrap: {
    marginTop: -5,
    alignItems: 'center',
  },
  captureLabelPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.surface,
    marginBottom: -1,
  },
  captureLabelText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
});
