import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import type { TrackingDevice } from './trackingTypes';
import { VehicleIcon } from './VehicleIcon';
import { getMarkerColor } from './VehicleCards';

export const MARKER_ICON_SIZE = 58;
const COURSE_STEP = 10;
const MARKER_BITMAP_VERSION = 2.5;

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

export type PendingCapture = {
  key: string;
  categoria: string | null | undefined;
  color: string;
  course: number;
  label: string | null | undefined;
  showLabel: boolean;
};

// ─── OffscreenCapture ────────────────────────────────────────────────────────
// Renders one icon in a hidden view, captures it as PNG, calls onReady.

function OffscreenCapture({
  entry,
  onReady,
}: {
  entry: PendingCapture;
  onReady(key: string, uri: string): void;
}) {
  const viewRef = useRef<View>(null);
  const { key, categoria, color, course, label, showLabel } = entry;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!viewRef.current) return;
      captureRef(viewRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      })
        .then((uri) => onReady(key, uri))
        .catch(() => {});
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
// Renders all pending captures in a hidden, non-interactive container.

export function OffscreenCapturePool({
  pending,
  onReady,
}: {
  pending: PendingCapture[];
  onReady(key: string, uri: string): void;
}) {
  if (pending.length === 0) return null;
  return (
    <View style={styles.capturePool} pointerEvents="none">
      {pending.map((entry) => (
        <OffscreenCapture key={entry.key} entry={entry} onReady={onReady} />
      ))}
    </View>
  );
}

// ─── useMarkerBitmaps ────────────────────────────────────────────────────────

// Per-device last-known bitmap URI (module-level, persists across re-mounts)
const lastBitmapByDevice = new Map<string, string>();

export function useMarkerBitmaps(devices: TrackingDevice[], showLabels: boolean) {
  const [bitmaps, setBitmaps] = useState<ReadonlyMap<string, string>>(bitmapCache);
  const [pending, setPending] = useState<PendingCapture[]>([]);
  const pendingKeysRef = useRef(new Set<string>());

  // Queue any new icon configurations for capture
  useEffect(() => {
    const toAdd: PendingCapture[] = [];
    for (const device of devices) {
      const color = getMarkerColor(device);
      const course = device.posicao?.curso ?? 0;
      const label = device.placa ?? device.nome ?? null;
      const key = makeCaptureKey(device.categoria, color, course, label, showLabels);
      if (!bitmapCache.has(key) && !pendingKeysRef.current.has(key)) {
        pendingKeysRef.current.add(key);
        toAdd.push({ key, categoria: device.categoria, color, course, label, showLabel: showLabels });
      }
    }
    if (toAdd.length > 0) {
      setPending((prev) => [...prev, ...toAdd]);
    }
  }, [devices, showLabels]);

  const onReady = useCallback((key: string, uri: string) => {
    bitmapCache.set(key, uri);
    pendingKeysRef.current.delete(key);
    setBitmaps(new Map(bitmapCache));
    setPending((prev) => prev.filter((e) => e.key !== key));
  }, []);

  const getBitmap = useCallback(
    (device: TrackingDevice): string | undefined => {
      const color = getMarkerColor(device);
      const course = device.posicao?.curso ?? 0;
      const label = device.placa ?? device.nome ?? null;
      const key = makeCaptureKey(device.categoria, color, course, label, showLabels);
      const uri = bitmaps.get(key);
      if (uri) {
        // Update last-known bitmap for this device
        lastBitmapByDevice.set(device.dispositivoId, uri);
        return uri;
      }
      // Cache miss: return the previous bitmap to prevent flickering while
      // the new bitmap (e.g. updated course angle) is being captured
      return lastBitmapByDevice.get(device.dispositivoId);
    },
    [bitmaps, showLabels],
  );

  return { getBitmap, pending, onReady };
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
