import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import Svg, { Circle as SvgCircle, Text as SvgText } from 'react-native-svg';

const CLUSTER_BITMAP_VERSION = 1;

const clusterBitmapCache = new Map<number, string>();

export type PendingClusterCapture = {
  count: number;
};

function ClusterCapture({
  count,
  onReady,
}: {
  count: number;
  onReady(count: number, uri: string): void;
}) {
  const viewRef = useRef<View>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!viewRef.current) return;
      captureRef(viewRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      })
        .then((uri) => onReady(count, uri))
        .catch(() => {});
    }, 100);
    return () => clearTimeout(timer);
  }, [count, onReady]);

  return (
    <View ref={viewRef} collapsable={false} style={styles.captureItem}>
      <Svg width={64} height={64} viewBox="0 0 64 64">
        <SvgCircle cx={32} cy={35} r={25} fill="rgba(0,0,0,0.22)" />
        <SvgCircle cx={32} cy={32} r={24} fill="#ffffff" />
        <SvgCircle cx={32} cy={32} r={21} fill="#8e44ad" />
        <SvgText
          x={32}
          y={37}
          textAnchor="middle"
          fontSize={16}
          fontWeight="700"
          fill="#ffffff"
        >
          {String(count)}
        </SvgText>
      </Svg>
    </View>
  );
}

export function ClusterCapturePool({
  pending,
  onReady,
}: {
  pending: PendingClusterCapture[];
  onReady(count: number, uri: string): void;
}) {
  if (pending.length === 0) return null;
  return (
    <View style={styles.capturePool} pointerEvents="none">
      {pending.map((entry) => (
        <ClusterCapture key={entry.count} count={entry.count} onReady={onReady} />
      ))}
    </View>
  );
}

export function useClusterBitmaps(counts: number[]) {
  const [bitmaps, setBitmaps] = useState<ReadonlyMap<number, string>>(clusterBitmapCache);
  const [pending, setPending] = useState<PendingClusterCapture[]>([]);
  const pendingCountsRef = useRef(new Set<number>());

  const distinctCounts = useMemo(() => Array.from(new Set(counts)), [counts]);

  useEffect(() => {
    const toAdd: PendingClusterCapture[] = [];
    for (const count of distinctCounts) {
      if (!clusterBitmapCache.has(count) && !pendingCountsRef.current.has(count)) {
        pendingCountsRef.current.add(count);
        toAdd.push({ count });
      }
    }
    if (toAdd.length > 0) {
      setPending((prev) => [...prev, ...toAdd]);
    }
  }, [distinctCounts]);

  const onReady = useCallback((count: number, uri: string) => {
    clusterBitmapCache.set(count, uri);
    pendingCountsRef.current.delete(count);
    setBitmaps(new Map(clusterBitmapCache));
    setPending((prev) => prev.filter((e) => e.count !== count));
  }, []);

  const getClusterBitmap = useCallback(
    (count: number): string | undefined => bitmaps.get(count),
    [bitmaps],
  );

  return { getClusterBitmap, pending, onReady };
}

// Mantém referência à versão para invalidar cache se necessário em iterações futuras
void CLUSTER_BITMAP_VERSION;

const styles = StyleSheet.create({
  capturePool: {
    position: 'absolute',
    left: -9999,
    top: 0,
    opacity: 0,
  },
  captureItem: {
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
  },
});
