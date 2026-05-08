import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Icon } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import type { RootStackParamList } from '../navigation/routes';

type RouteProps = NativeStackScreenProps<RootStackParamList, 'Historico'>['route'];

type Period = 'hoje' | 'ontem' | '7dias';

type Viagem = {
  inicio: string;
  fim: string;
  distancia: number;
  velocidadeMaxima: number;
  duracao: number;
};

const DEFAULT_REGION = {
  latitude: -14.235,
  longitude: -51.9253,
  latitudeDelta: 24,
  longitudeDelta: 24,
};

function getDateRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'hoje') {
    return {
      from: today.toISOString(),
      to: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
    };
  }
  if (period === 'ontem') {
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    return {
      from: yesterday.toISOString(),
      to: new Date(today.getTime() - 1).toISOString(),
    };
  }
  return {
    from: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
  };
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDur(min: number) {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}min` : `${m}min`;
}

function isValidCoordinate(p: { latitude: number; longitude: number }) {
  return (
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude)
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function HistoricoScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProps>();
  const { dispositivoId, nome, placa } = route.params;

  const mapRef = useRef<MapView | null>(null);
  const [period, setPeriod] = useState<Period>('hoje');
  const [viagens, setViagens] = useState<Viagem[]>([]);
  const [positions, setPositions] = useState<{ latitude: number; longitude: number }[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<number | null>(null);
  const [tripPositions, setTripPositions] = useState<{ latitude: number; longitude: number }[]>([]);
  const [isLoadingTrip, setIsLoadingTrip] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const stats = useMemo(() => {
    const km = viagens.reduce((s, v) => s + (v.distancia || 0), 0);
    const velMax = viagens.reduce((m, v) => Math.max(m, v.velocidadeMaxima || 0), 0);
    const min = viagens.reduce((s, v) => s + (v.duracao || 0), 0);
    return { km, velMax, min, count: viagens.length };
  }, [viagens]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setSelectedTrip(null);
    setTripPositions([]);
    const { from, to } = getDateRange(period);
    try {
      const [tripsData, histData] = await Promise.all([
        apiRequest<Viagem[]>(
          `/cliente/rastreamento/dispositivos/${dispositivoId}/viagens?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        ).catch(() => [] as Viagem[]),
        apiRequest<{ posicoes: { latitude: number; longitude: number }[] }>(
          `/cliente/rastreamento/dispositivos/${dispositivoId}/historico?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        ).catch(() => ({ posicoes: [] })),
      ]);
      setViagens(tripsData ?? []);
      const pos = (histData?.posicoes ?? []).filter(isValidCoordinate);
      setPositions(pos);
      if (pos.length > 1) {
        setTimeout(() => {
          mapRef.current?.fitToCoordinates(pos, {
            edgePadding: { top: 24, right: 24, bottom: 24, left: 24 },
            animated: true,
          });
        }, 600);
      }
    } finally {
      setIsLoading(false);
    }
  }, [dispositivoId, period]);

  useEffect(() => { load(); }, [load]);

  const periodLabel: Record<Period, string> = { hoje: 'Hoje', ontem: 'Ontem', '7dias': '7 dias' };

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={DEFAULT_REGION}
      >
        {positions.length > 1 && (
          <Polyline
            coordinates={positions}
            strokeWidth={3}
            strokeColor="rgba(41,128,185,0.4)"
          />
        )}
        {tripPositions.length > 1 && (
          <Polyline
            coordinates={tripPositions}
            strokeWidth={4}
            strokeColor="rgba(230,126,34,0.9)"
          />
        )}
        {tripPositions.length > 0 ? (
          <>
            <Marker coordinate={tripPositions[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.tripStartDot} />
            </Marker>
            <Marker coordinate={tripPositions[tripPositions.length - 1]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.tripEndDot} />
            </Marker>
          </>
        ) : null}
        {positions.length > 0 && tripPositions.length === 0 && (
          <>
            <Marker coordinate={positions[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.startDot} />
            </Marker>
            <Marker coordinate={positions[positions.length - 1]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.endDot} />
            </Marker>
          </>
        )}
      </MapView>
      {positions.length === 0 && !isLoading && (
        <View style={styles.mapEmpty} pointerEvents="none">
          <Icon source="map-marker-off-outline" size={32} color={colors.textMuted} />
          <Text style={styles.mapEmptyText}>Sem posicoes</Text>
        </View>
      )}

      {/* Period selector */}
      <View style={styles.periodRow}>
        {(['hoje', 'ontem', '7dias'] as Period[]).map((p) => (
          <Pressable
            key={p}
            accessibilityRole="button"
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
              {periodLabel[p]}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <StatCard label="Distância" value={stats.km ? `${stats.km.toFixed(1)} km` : '—'} />
          <StatCard label="Vel. Máxima" value={stats.velMax ? `${stats.velMax} km/h` : '—'} />
          <StatCard label="Em Movimento" value={fmtDur(stats.min)} />
          <StatCard label="Viagens" value={String(stats.count)} />
        </View>

        {/* Trips list */}
        <View style={styles.tripsSection}>
          <Text style={styles.tripsSectionTitle}>VIAGENS DO PERÍODO</Text>

          {isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : viagens.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Icon source="road-variant" size={38} color={colors.textMuted} />
              <Text style={styles.emptyText}>Nenhuma viagem neste período</Text>
            </View>
          ) : (
            viagens.map((v, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                style={[styles.tripCard, selectedTrip === i && styles.tripCardSelected]}
                onPress={async () => {
                  if (i === selectedTrip) {
                    setSelectedTrip(null);
                    setTripPositions([]);
                    if (positions.length > 1) {
                      setTimeout(() => {
                        mapRef.current?.fitToCoordinates(positions, {
                          edgePadding: { top: 24, right: 24, bottom: 24, left: 24 },
                          animated: true,
                        });
                      }, 300);
                    }
                    return;
                  }
                  setSelectedTrip(i);
                  setIsLoadingTrip(true);
                  try {
                    const data = await apiRequest<{ posicoes: { latitude: number; longitude: number }[] }>(
                      `/cliente/rastreamento/dispositivos/${dispositivoId}/historico?from=${encodeURIComponent(v.inicio)}&to=${encodeURIComponent(v.fim)}`
                    );
                    const pos = (data?.posicoes ?? []).filter(isValidCoordinate);
                    setTripPositions(pos);
                    if (pos.length > 1) {
                      setTimeout(() => {
                        mapRef.current?.fitToCoordinates(pos, {
                          edgePadding: { top: 24, right: 24, bottom: 24, left: 24 },
                          animated: true,
                        });
                      }, 300);
                    }
                  } catch {
                    // ignore load error
                  } finally {
                    setIsLoadingTrip(false);
                  }
                }}
              >
                <View style={styles.tripLeft}>
                  <View style={styles.tripDotWrap}>
                    <View style={styles.tripDot} />
                  </View>
                  <View style={styles.tripInfo}>
                    <Text style={styles.tripTime}>
                      {fmtTime(v.inicio)} — {fmtTime(v.fim)}
                    </Text>
                    <Text style={styles.tripMeta}>
                      {(v.distancia || 0).toFixed(1)} km  ·  {fmtDur(v.duracao)}  ·  máx {v.velocidadeMaxima || 0} km/h
                    </Text>
                  </View>
                </View>
                {isLoadingTrip && selectedTrip === i ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Icon source="chevron-right" size={16} color={colors.textMuted} />
                )}
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  map: {
    height: 220,
    width: '100%',
  },
  startDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#27ae60',
    borderWidth: 2,
    borderColor: '#fff',
  },
  endDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#e74c3c',
    borderWidth: 2,
    borderColor: '#fff',
  },
  tripStartDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#e67e22',
    borderWidth: 2,
    borderColor: '#fff',
  },
  tripEndDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#e74c3c',
    borderWidth: 2,
    borderColor: '#fff',
  },
  mapEmpty: {
    position: 'absolute',
    alignSelf: 'center',
    top: 70,
    alignItems: 'center',
    gap: 6,
  },
  mapEmptyText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  periodBtnActive: {
    backgroundColor: colors.primary,
  },
  periodText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  periodTextActive: {
    color: colors.primaryText,
  },
  body: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2980b9',
  },
  statLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  tripsSection: {
    gap: spacing.sm,
  },
  tripsSectionTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  loadingWrap: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyWrap: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  tripCardSelected: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  tripLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tripDotWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eef2f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2980b9',
  },
  tripInfo: {
    flex: 1,
  },
  tripTime: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  tripMeta: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
});
