import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import Svg, { Circle as SvgCircle, Text as SvgText } from 'react-native-svg';

const CLUSTER_BITMAP_VERSION = 1;

// Mesma razão do pool de marcadores: `captureRef` em rajada estoura a memória.
// Com muitos veículos aparecem clusters de dezenas de tamanhos diferentes.
const MAX_CONCURRENT_CLUSTER_CAPTURES = 4;

const clusterBitmapCache = new Map<number, string>();

export type PendingClusterCapture = {
  count: number;
};

// Ícone do cluster (reutilizado na captura do Android e como filho no iOS).
export function ClusterIcon({ count }: { count: number }) {
  return (
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
  );
}

function ClusterCapture({
  count,
  onReady,
}: {
  count: number;
  onReady(count: number, uri: string | null): void;
}) {
  const viewRef = useRef<View>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!viewRef.current) {
        onReady(count, null);
        return;
      }
      captureRef(viewRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      })
        .then((uri) => onReady(count, uri))
        // Falha não pode deixar a entrada presa na fila (ela bloquearia os
        // próximos clusters, já que só capturamos alguns por vez).
        .catch(() => onReady(count, null));
    }, 100);
    return () => clearTimeout(timer);
  }, [count, onReady]);

  return (
    <View ref={viewRef} collapsable={false} style={styles.captureItem}>
      <ClusterIcon count={count} />
    </View>
  );
}

export function ClusterCapturePool({
  pending,
  onReady,
}: {
  pending: PendingClusterCapture[];
  onReady(count: number, uri: string | null): void;
}) {
  if (pending.length === 0) return null;
  return (
    <View style={styles.capturePool} pointerEvents="none">
      {pending.slice(0, MAX_CONCURRENT_CLUSTER_CAPTURES).map((entry) => (
        <ClusterCapture key={entry.count} count={entry.count} onReady={onReady} />
      ))}
    </View>
  );
}

export function useClusterBitmaps(counts: number[], enabled = true) {
  const [bitmaps, setBitmaps] = useState<ReadonlyMap<number, string>>(clusterBitmapCache);
  const [pending, setPending] = useState<PendingClusterCapture[]>([]);
  const pendingCountsRef = useRef(new Set<number>());

  const distinctCounts = useMemo(() => Array.from(new Set(counts)), [counts]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [distinctCounts, enabled]);

  const onReady = useCallback((count: number, uri: string | null) => {
    if (uri) clusterBitmapCache.set(count, uri);
    pendingCountsRef.current.delete(count);
    setPending((prev) => prev.filter((e) => e.count !== count));
    if (uri) setBitmaps(new Map(clusterBitmapCache));
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
