import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import MapView, { AnimatedRegion, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

const MarkerAnimated = Animated.createAnimatedComponent(Marker);
import Svg, { G, Line, Path, Text as SvgText } from 'react-native-svg';
import { Icon, IconButton } from 'react-native-paper';
import { captureRef } from 'react-native-view-shot';

import {
  calcularIntervalo,
  getEventos,
  getExportUrl,
  getHistorico,
  getParadas,
  getResumo,
  getViagens,
  isoComFuso,
} from '../reporting/reportService';
import type {
  Evento,
  ExportType,
  HistoricoResponse,
  Parada,
  ReportPeriodo,
  ReportTab,
  Resumo,
  Viagem,
} from '../reporting/reportTypes';
import { getTrackingSnapshot } from '../tracking/trackingService';
import type { TrackingDevice } from '../tracking/trackingTypes';
import { VehicleIcon } from '../tracking/VehicleIcon';
import { SearchBottomSheet } from '../components/SearchBottomSheet';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';

// ─── Constants ───────────────────────────────────────────────────────────────

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'rota', label: 'Rota' },
  { key: 'eventos', label: 'Eventos' },
  { key: 'viagens', label: 'Viagens' },
  { key: 'paradas', label: 'Paradas' },
  { key: 'resumo', label: 'Resumo' },
  { key: 'grafico', label: 'Gráfico' },
];

const PERIODO_LABELS: Record<ReportPeriodo, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7dias': '7 dias',
  custom: 'Personalizado',
};

const EXPORT_OPTIONS: { label: string; value: ExportType }[] = [
  { label: 'Rota / Trajeto', value: 'route' },
  { label: 'Eventos', value: 'events' },
  { label: 'Viagens', value: 'trips' },
  { label: 'Paradas', value: 'stops' },
  { label: 'Resumo / Totais', value: 'summary' },
];

const EVENTO_CONFIG: Record<string, { label: string; bg: string; fg: string }> = {
  deviceOnline:    { label: 'Online',               bg: '#d4edda', fg: '#155724' },
  deviceOffline:   { label: 'Offline',              bg: '#f8d7da', fg: '#721c24' },
  deviceUnknown:   { label: 'Desconhecido',         bg: '#e2e3e5', fg: '#383d41' },
  deviceMoving:    { label: 'Em movimento',         bg: '#cce5ff', fg: '#004085' },
  deviceStopped:   { label: 'Parado',               bg: '#fff3cd', fg: '#856404' },
  deviceOverspeed: { label: 'Vel. excessiva',       bg: '#f8d7da', fg: '#721c24' },
  ignitionOn:      { label: 'Ignição ligada',       bg: '#d1ecf1', fg: '#0c5460' },
  ignitionOff:     { label: 'Ignição desligada',    bg: '#d1ecf1', fg: '#0c5460' },
  alarm:           { label: 'Alarme',               bg: '#f8d7da', fg: '#721c24' },
  geofenceEnter:   { label: 'Entrou na cerca',      bg: '#cce5ff', fg: '#004085' },
  geofenceExit:    { label: 'Saiu da cerca',        bg: '#fff3cd', fg: '#856404' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtHora(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return (
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
}

function fmtDataHora(d: Date): string {
  return (
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
}

function fmtDuracao(mins?: number): string {
  if (mins == null || isNaN(Number(mins))) return '—';
  const m = Number(mins);
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
}

function getViagemInicio(v: Viagem) { return v.inicio ?? v.startTime; }
function getViagemFim(v: Viagem)    { return v.fim    ?? v.endTime; }
function getViagemOrigem(v: Viagem) { return v.origem ?? v.startAddress; }
function getViagemDestino(v: Viagem){ return v.destino ?? v.endAddress; }
function getViagemDist(v: Viagem): number {
  if (v.distancia != null) return Number(v.distancia) || 0;
  return (Number(v.distance) || 0) / 1000;
}
function getViagemDurMin(v: Viagem): number {
  if (v.duracao != null) return Number(v.duracao) || 0;
  return Math.round((Number(v.duration) || 0) / 60000);
}
function getViagemVelMax(v: Viagem): number {
  if (v.velocidadeMaxima != null) return Number(v.velocidadeMaxima) || 0;
  return Math.round((Number(v.maxSpeed) || 0) * 1.852);
}

function getParadaInicio(p: Parada)  { return p.inicio ?? p.startTime; }
function getParadaFim(p: Parada)     { return p.fim    ?? p.endTime; }
function getParadaEndereco(p: Parada){ return p.endereco ?? p.address; }
function getParadaDurMin(p: Parada): number {
  if (p.duracao != null) return Number(p.duracao) || 0;
  return Math.round((Number(p.duration) || 0) / 60000);
}
function getParadaLat(p: Parada): number { return Number(p.latitude ?? p.lat) || 0; }
function getParadaLon(p: Parada): number { return Number(p.longitude ?? p.lon) || 0; }

function getResumoDist(r: Resumo): string {
  const v = r.distancia ?? (r.distance != null ? Number(r.distance) / 1000 : undefined);
  return v != null ? v.toFixed(1) : '—';
}
function getResumoVelMedia(r: Resumo): string {
  const v = r.velocidadeMedia ?? (r.averageSpeed != null ? Math.round(Number(r.averageSpeed) * 1.852) : undefined);
  return v != null ? String(v) : '—';
}
function getResumoVelMax(r: Resumo): string {
  const v = r.velocidadeMaxima ?? (r.maxSpeed != null ? Math.round(Number(r.maxSpeed) * 1.852) : undefined);
  return v != null ? String(v) : '—';
}
function getResumoMotor(r: Resumo): string {
  const v = r.horasMotor ?? (r.engineHours != null ? Number(r.engineHours) / 3600000 : undefined);
  return v != null ? v.toFixed(1) + 'h' : '—';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <Icon source="information-outline" size={32} color={colors.textSubtle} />
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

function LoadingState() {
  return (
    <View style={styles.emptyState}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Route Tab ────────────────────────────────────────────────────────────────

const ROUTE_MARKER_SIZE = 48;
const SPEED_MULTIPLIERS = [1, 2, 4, 8] as const;
const PLAYER_TICK_MS = 80;

function RouteTab({
  historico,
  paradas,
  device,
}: {
  historico: HistoricoResponse | null;
  paradas: Parada[];
  device: TrackingDevice | null;
}) {
  const mapRef = useRef<MapView>(null);
  const vehicleIconRef = useRef<View>(null);
  const stopPinRef = useRef<View>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [vehicleBitmap, setVehicleBitmap] = useState<string | null>(null);
  const [stopBitmap, setStopBitmap] = useState<string | null>(null);
  const [playerActive, setPlayerActive] = useState(false);
  const [playerIndex, setPlayerIndex] = useState(0);
  const [playerSpeedMult, setPlayerSpeedMult] = useState(1);

  // AnimatedRegion interpola lat/lng nativamente entre cada par de pontos GPS
  const animCoordinate = useRef(
    new AnimatedRegion({ latitude: 0, longitude: 0, latitudeDelta: 0, longitudeDelta: 0 })
  ).current;

  const markerColor = device?.cor ?? '#2980b9';

  const valid = useMemo(
    () =>
      (historico?.posicoes ?? []).filter(
        (p) => p.valida !== false && p.latitude && p.longitude,
      ),
    [historico],
  );

  const stopMarkers = useMemo(
    () =>
      paradas
        .map((p, i) => ({
          lat: getParadaLat(p),
          lon: getParadaLon(p),
          label: getParadaEndereco(p) ?? `Parada ${i + 1}`,
        }))
        .filter((s) => Math.abs(s.lat) > 0.00001 || Math.abs(s.lon) > 0.00001),
    [paradas],
  );

  // Capture vehicle icon bitmap for map markers
  useEffect(() => {
    setVehicleBitmap(null);
    const timer = setTimeout(() => {
      if (!vehicleIconRef.current) return;
      captureRef(vehicleIconRef, { format: 'png', quality: 1, result: 'tmpfile' })
        .then((uri) => setVehicleBitmap(uri))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [device?.categoria, markerColor]);

  // Capture stop pin bitmap once on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!stopPinRef.current) return;
      captureRef(stopPinRef, { format: 'png', quality: 1, result: 'tmpfile' })
        .then((uri) => setStopBitmap(uri))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  // Fit map to route
  useEffect(() => {
    if (valid.length < 2 || !mapRef.current) return;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        valid.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
        { edgePadding: { top: 80, right: 24, bottom: 80, left: 24 }, animated: true },
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [valid.length]);

  // Reset player and snap animCoordinate to first point when a new route loads
  useEffect(() => {
    if (valid.length === 0) return;
    setPlayerActive(false);
    setPlayerIndex(0);
    const pos = valid[0]!;
    animCoordinate.timing({
      latitude: pos.latitude,
      longitude: pos.longitude,
      duration: 0,
      useNativeDriver: false,
    } as any).start();
  }, [valid]);

  // Route player tick
  useEffect(() => {
    if (!playerActive || valid.length < 2) return;
    intervalRef.current = setInterval(() => {
      setPlayerIndex((prev) => {
        const next = prev + playerSpeedMult;
        if (next >= valid.length - 1) {
          setPlayerActive(false);
          return valid.length - 1;
        }
        return next;
      });
    }, PLAYER_TICK_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playerActive, playerSpeedMult, valid.length]);

  // Animate marker coordinate and pan camera to follow player
  useEffect(() => {
    const pos = valid[playerIndex];
    if (!pos || !playerActive) return;
    animCoordinate.timing({
      latitude: pos.latitude,
      longitude: pos.longitude,
      duration: PLAYER_TICK_MS,
      useNativeDriver: false,
    } as any).start();
    mapRef.current?.animateCamera(
      { center: { latitude: pos.latitude, longitude: pos.longitude } },
      { duration: PLAYER_TICK_MS - 10 },
    );
  }, [playerIndex, playerActive, valid]);

  const playerPos = valid[playerIndex] ?? null;

  const offscreenPool = (
    <View style={styles.offscreenPool} pointerEvents="none">
      <View ref={vehicleIconRef} collapsable={false} style={{ alignSelf: 'flex-start' }}>
        <VehicleIcon
          categoria={device?.categoria}
          color={markerColor}
          course={0}
          size={ROUTE_MARKER_SIZE}
        />
      </View>
      <View ref={stopPinRef} collapsable={false} style={{ alignSelf: 'flex-start' }}>
        <Svg width={28} height={36} viewBox="0 0 28 36">
          <Path
            d="M14 2 C7.4 2 2 7.4 2 14 C2 23 14 34 14 34 C14 34 26 23 26 14 C26 7.4 20.6 2 14 2 Z"
            fill="#2f3640"
          />
          <SvgText x="14" y="18" fontSize={12} fill="white" textAnchor="middle" fontWeight="bold">
            P
          </SvgText>
        </Svg>
      </View>
    </View>
  );

  if (!historico) {
    return (
      <View style={{ flex: 1 }}>
        {offscreenPool}
        <EmptyState message="Selecione um veículo e período para visualizar o trajeto." />
      </View>
    );
  }
  if (valid.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        {offscreenPool}
        <EmptyState message="Nenhuma posição encontrada para o período selecionado." />
      </View>
    );
  }

  const first = valid[0]!;
  const last = valid[valid.length - 1]!;
  const coords = valid.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));

  return (
    <View style={{ flex: 1 }}>
      {offscreenPool}
      <View style={styles.routeContainer}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.routeMap}
          initialRegion={{
            latitude: first.latitude,
            longitude: first.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          scrollEnabled
          zoomEnabled
          pitchEnabled={false}
          rotateEnabled={false}
        >
          <Polyline coordinates={coords} strokeColor={colors.accent} strokeWidth={3} geodesic />
          {vehicleBitmap ? (
            <Marker
              coordinate={{ latitude: first.latitude, longitude: first.longitude }}
              title="Início"
              description={fmtHora(first.fixTime)}
              image={{ uri: vehicleBitmap }}
            />
          ) : (
            <Marker
              coordinate={{ latitude: first.latitude, longitude: first.longitude }}
              title="Início"
              description={fmtHora(first.fixTime)}
              pinColor={colors.success}
            />
          )}
          {vehicleBitmap ? (
            <Marker
              coordinate={{ latitude: last.latitude, longitude: last.longitude }}
              title="Fim"
              description={fmtHora(last.fixTime)}
              image={{ uri: vehicleBitmap }}
            />
          ) : (
            <Marker
              coordinate={{ latitude: last.latitude, longitude: last.longitude }}
              title="Fim"
              description={fmtHora(last.fixTime)}
              pinColor={colors.danger}
            />
          )}
          {stopMarkers.map((s, i) =>
            stopBitmap ? (
              <Marker
                key={`stop-${i}`}
                coordinate={{ latitude: s.lat, longitude: s.lon }}
                title={`Parada ${i + 1}`}
                description={s.label}
                image={{ uri: stopBitmap }}
              />
            ) : (
              <Marker
                key={`stop-${i}`}
                coordinate={{ latitude: s.lat, longitude: s.lon }}
                title={`Parada ${i + 1}`}
                description={s.label}
                pinColor="#2f3640"
              />
            ),
          )}
          {playerActive && playerPos ? (
            vehicleBitmap ? (
              <MarkerAnimated
                key="player-pos"
                coordinate={animCoordinate as any}
                zIndex={10}
                rotation={playerPos.curso ?? 0}
                anchor={{ x: 0.5, y: 0.5 }}
                image={{ uri: vehicleBitmap }}
                tracksViewChanges={false}
              />
            ) : (
              <MarkerAnimated
                key="player-pos"
                coordinate={animCoordinate as any}
                zIndex={10}
                rotation={playerPos.curso ?? 0}
                anchor={{ x: 0.5, y: 0.5 }}
                pinColor={markerColor}
                tracksViewChanges={false}
              />
            )
          ) : null}
        </MapView>

        <View style={styles.playerControl} pointerEvents="box-none">
          <Pressable
            style={styles.playerPlayBtn}
            onPress={() => {
              if (!playerActive && playerIndex >= valid.length - 1) setPlayerIndex(0);
              setPlayerActive((a) => !a);
            }}
          >
            <Icon source={playerActive ? 'pause' : 'play'} size={22} color={colors.surface} />
          </Pressable>
          <View style={styles.playerSpeeds}>
            {SPEED_MULTIPLIERS.map((m) => (
              <Pressable
                key={m}
                style={[styles.playerSpeedBtn, playerSpeedMult === m && styles.playerSpeedBtnActive]}
                onPress={() => setPlayerSpeedMult(m)}
              >
                <Text style={[styles.playerSpeedText, playerSpeedMult === m && styles.playerSpeedTextActive]}>
                  {m}x
                </Text>
              </Pressable>
            ))}
          </View>
          {playerPos?.velocidade != null && (
            <View style={styles.playerSpeedDisplay}>
              <Text style={styles.playerSpeedDisplayText}>
                {Math.round(playerPos.velocidade)} km/h
              </Text>
            </View>
          )}
        </View>

        <View style={styles.routeStats}>
          <Text style={styles.routeStatsText}>
            {fmtHora(first.fixTime)} → {fmtHora(last.fixTime)} · {valid.length} pontos
            {stopMarkers.length > 0 ? ` · ${stopMarkers.length} parada(s)` : ''}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Eventos Tab ──────────────────────────────────────────────────────────────

function EventosBadge({ tipo, label }: { tipo: string; label: string }) {
  const cfg = EVENTO_CONFIG[tipo] ?? { bg: '#e2e3e5', fg: '#383d41' };
  return (
    <View style={[styles.eventoBadge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.eventoBadgeText, { color: cfg.fg }]}>{label}</Text>
    </View>
  );
}

function EventosTab({ eventos }: { eventos: Evento[] }) {
  if (eventos.length === 0) return <EmptyState message="Nenhum evento encontrado para o período." />;
  return (
    <FlatList
      data={eventos}
      keyExtractor={(item, i) => item.id ?? String(i)}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => {
        const cfg = EVENTO_CONFIG[item.tipo] ?? { label: item.tipoLabel ?? item.tipo, bg: '#e2e3e5', fg: '#383d41' };
        const label = item.tipoLabel ?? cfg.label ?? item.tipo;
        const attrs = Object.entries(item.atributos ?? {})
          .filter(([k]) => !['protocol', 'alarm'].includes(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        return (
          <View style={styles.eventoRow}>
            <View style={styles.eventoLeft}>
              <Text style={styles.eventoHora}>{fmtHora(item.hora)}</Text>
              <EventosBadge tipo={item.tipo} label={label} />
            </View>
            {attrs ? <Text style={styles.eventoAttrs} numberOfLines={2}>{attrs}</Text> : null}
          </View>
        );
      }}
    />
  );
}

// ─── Viagens Tab ──────────────────────────────────────────────────────────────

function ViagensTab({ viagens }: { viagens: Viagem[] }) {
  if (viagens.length === 0) return <EmptyState message="Nenhuma viagem encontrada para o período." />;

  const totalKm = viagens.reduce((acc, v) => acc + getViagemDist(v), 0);
  const totalMin = viagens.reduce((acc, v) => acc + getViagemDurMin(v), 0);
  const velMax = Math.max(...viagens.map(getViagemVelMax), 0);

  return (
    <FlatList
      data={viagens}
      keyExtractor={(_, i) => String(i)}
      ListHeaderComponent={
        <View style={styles.summaryRow}>
          <StatCard value={String(viagens.length)} label="Viagens" />
          <StatCard value={totalKm.toFixed(1)} label="km total" />
          <StatCard value={fmtDuracao(totalMin)} label="Tempo" />
          <StatCard value={String(velMax)} label="km/h máx" />
        </View>
      }
      contentContainerStyle={styles.listContent}
      renderItem={({ item, index }) => {
        const origem = getViagemOrigem(item);
        const destino = getViagemDestino(item);
        return (
          <View style={styles.tripCard}>
            <View style={styles.tripHeader}>
              <Text style={styles.tripIndex}>#{index + 1}</Text>
              <Text style={styles.tripTime}>
                {fmtHora(getViagemInicio(item))} → {fmtHora(getViagemFim(item))}
              </Text>
            </View>
            <View style={styles.tripStats}>
              <Text style={styles.tripStat}>{getViagemDist(item).toFixed(1)} km</Text>
              <Text style={styles.tripStat}>{fmtDuracao(getViagemDurMin(item))}</Text>
              <Text style={styles.tripStat}>{getViagemVelMax(item)} km/h</Text>
            </View>
            {(origem || destino) && (
              <View style={styles.tripRoute}>
                {origem ? <Text style={styles.tripAddress} numberOfLines={1}>↑ {origem}</Text> : null}
                {destino ? <Text style={styles.tripAddress} numberOfLines={1}>↓ {destino}</Text> : null}
              </View>
            )}
          </View>
        );
      }}
    />
  );
}

// ─── Paradas Tab ──────────────────────────────────────────────────────────────

function ParadasTab({ paradas }: { paradas: Parada[] }) {
  if (paradas.length === 0) return <EmptyState message="Nenhuma parada encontrada para o período." />;
  return (
    <FlatList
      data={paradas}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={styles.listContent}
      renderItem={({ item, index }) => {
        const endereco = getParadaEndereco(item);
        return (
          <View style={styles.stopCard}>
            <View style={styles.stopHeader}>
              <View style={styles.stopPin}>
                <Text style={styles.stopPinText}>P</Text>
              </View>
              <View style={styles.stopInfo}>
                <Text style={styles.stopTitle}>Parada {index + 1}</Text>
                {endereco ? (
                  <Text style={styles.stopAddress} numberOfLines={2}>{endereco}</Text>
                ) : null}
              </View>
              <Text style={styles.stopDuration}>{fmtDuracao(getParadaDurMin(item))}</Text>
            </View>
            <Text style={styles.stopTime}>
              {fmtHora(getParadaInicio(item))} → {fmtHora(getParadaFim(item))}
            </Text>
          </View>
        );
      }}
    />
  );
}

// ─── Resumo Tab ───────────────────────────────────────────────────────────────

function ResumoTab({
  resumo,
  viagens,
  paradas,
}: {
  resumo: Resumo | null;
  viagens: Viagem[];
  paradas: Parada[];
}) {
  const totalParadaMin = paradas.reduce((acc, p) => acc + getParadaDurMin(p), 0);

  if (!resumo && viagens.length === 0 && paradas.length === 0) {
    return <EmptyState message="Sem dados disponíveis para o período." />;
  }

  return (
    <ScrollView contentContainerStyle={styles.listContent}>
      <View style={styles.statGrid}>
        <StatCard value={resumo ? getResumoDist(resumo) : '—'} label="km percorridos" />
        <StatCard value={resumo ? getResumoVelMax(resumo) : '—'} label="km/h máxima" />
        <StatCard value={resumo ? getResumoVelMedia(resumo) : '—'} label="km/h média" />
        <StatCard value={resumo ? getResumoMotor(resumo) : '—'} label="Horas motor" />
        <StatCard value={String(viagens.length)} label="Viagens" />
        <StatCard value={String(paradas.length)} label="Paradas" />
        <StatCard value={fmtDuracao(totalParadaMin)} label="Tempo parado" />
      </View>
    </ScrollView>
  );
}

// ─── Grafico Tab ──────────────────────────────────────────────────────────────

function GraficoTab({ historico }: { historico: HistoricoResponse | null }) {
  const posicoes = historico?.posicoes ?? [];
  let samples = posicoes.filter(p => p.fixTime && p.velocidade != null);
  if (samples.length > 200) {
    const step = Math.ceil(samples.length / 200);
    samples = samples.filter((_, i) => i % step === 0);
  }

  if (samples.length < 2) {
    return <EmptyState message="Dados insuficientes para exibir o gráfico de velocidade." />;
  }

  const { width } = Dimensions.get('window');
  const W = width - spacing.lg * 2;
  const H = 200;
  const PAD = { top: 16, right: 12, bottom: 32, left: 40 };
  const pw = W - PAD.left - PAD.right;
  const ph = H - PAD.top - PAD.bottom;

  const speeds = samples.map(p => p.velocidade ?? 0);
  const maxSpd = Math.max(...speeds, 20);
  const roundedMax = Math.ceil(maxSpd / 10) * 10;

  const pts = samples.map((p, i) => ({
    x: PAD.left + (i / (samples.length - 1)) * pw,
    y: PAD.top + ph - ((p.velocidade ?? 0) / roundedMax) * ph,
  }));

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fillPath = [
    linePath,
    `L${pts[pts.length - 1].x.toFixed(1)},${(PAD.top + ph).toFixed(1)}`,
    `L${pts[0].x.toFixed(1)},${(PAD.top + ph).toFixed(1)}`,
    'Z',
  ].join(' ');

  const xCount = Math.min(5, samples.length);
  const xLabels = Array.from({ length: xCount }, (_, i) => {
    const idx = Math.round((i / (xCount - 1)) * (samples.length - 1));
    return { x: pts[idx].x, label: fmtHora(samples[idx].fixTime) };
  });

  const yTicks = [0, Math.round(roundedMax / 2), roundedMax];

  return (
    <ScrollView contentContainerStyle={styles.listContent}>
      <Text style={styles.chartTitle}>Velocidade (km/h) no período</Text>
      <View style={styles.chartWrap}>
        <Svg width={W} height={H}>
          <Path d={fillPath} fill={colors.accent} opacity={0.15} />
          <Path d={linePath} fill="none" stroke={colors.accent} strokeWidth={1.5} />
          {yTicks.map(v => {
            const y = PAD.top + ph - (v / roundedMax) * ph;
            return (
              <G key={v}>
                <Line
                  x1={PAD.left} y1={y}
                  x2={PAD.left + pw} y2={y}
                  stroke={colors.border} strokeWidth={0.5}
                />
                <SvgText
                  x={PAD.left - 6} y={y + 4}
                  fontSize={9} fill={colors.textMuted} textAnchor="end"
                >
                  {v}
                </SvgText>
              </G>
            );
          })}
          {xLabels.map((lbl, i) => (
            <SvgText
              key={i}
              x={lbl.x} y={H - 4}
              fontSize={9} fill={colors.textMuted} textAnchor="middle"
            >
              {lbl.label}
            </SvgText>
          ))}
          <Line
            x1={PAD.left} y1={PAD.top}
            x2={PAD.left} y2={PAD.top + ph}
            stroke={colors.border} strokeWidth={1}
          />
          <Line
            x1={PAD.left} y1={PAD.top + ph}
            x2={PAD.left + pw} y2={PAD.top + ph}
            stroke={colors.border} strokeWidth={1}
          />
        </Svg>
      </View>
    </ScrollView>
  );
}


// ─── Export Modal ─────────────────────────────────────────────────────────────

function ExportModal({
  visible,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  onConfirm(tipo: ExportType): void;
  onClose(): void;
}) {
  const [tipo, setTipo] = useState<ExportType>('route');
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.exportCard}>
          <Text style={styles.exportTitle}>Exportar Relatório (XLSX)</Text>
          <Text style={styles.exportSubtitle}>Tipo de relatório</Text>
          {EXPORT_OPTIONS.map(opt => (
            <Pressable
              key={opt.value}
              style={[styles.exportOption, tipo === opt.value && styles.exportOptionSelected]}
              onPress={() => setTipo(opt.value)}
            >
              <View style={[styles.exportRadio, tipo === opt.value && styles.exportRadioSelected]} />
              <Text style={[styles.exportOptionLabel, tipo === opt.value && styles.exportOptionLabelSelected]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
          <View style={styles.exportActions}>
            <Pressable style={styles.exportCancel} onPress={onClose}>
              <Text style={styles.exportCancelText}>Cancelar</Text>
            </Pressable>
            <Pressable style={styles.exportConfirm} onPress={() => onConfirm(tipo)}>
              <Icon source="download" size={16} color={colors.surface} />
              <Text style={styles.exportConfirmText}>Baixar</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export function ReportScreen() {
  const navigation = useNavigation();
  const toast = useToast();

  const [devices, setDevices] = useState<TrackingDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<TrackingDevice | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(true);

  const [periodo, setPeriodo] = useState<ReportPeriodo>('hoje');
  const [customFrom, setCustomFrom] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [customTo, setCustomTo] = useState<Date>(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 0);
    return d;
  });
  const [datePickerState, setDatePickerState] = useState<{ field: 'from' | 'to'; mode: 'date' | 'time' | 'datetime' } | null>(null);

  const [activeTab, setActiveTab] = useState<ReportTab>('rota');
  const [historico, setHistorico] = useState<HistoricoResponse | null>(null);
  const [viagens, setViagens] = useState<Viagem[]>([]);
  const [paradas, setParadas] = useState<Parada[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Load devices once on mount
  useEffect(() => {
    setDevicesLoading(true);
    getTrackingSnapshot()
      .then(snapshot => {
        if (snapshot === 'blocked') return;
        const sorted = [...snapshot].sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? ''));
        setDevices(sorted);
        if (sorted.length === 1) {
          setSelectedDevice(sorted[0]);
        } else if (sorted.length > 1) {
          setShowDeviceSelector(true);
        }
      })
      .catch(() => {})
      .finally(() => setDevicesLoading(false));
  }, []);

  // Refs para acessar valores correntes dentro do useFocusEffect sem disparar
  // re-render do effect (que viraria loop).
  const selectedDeviceRef = useRef(selectedDevice);
  selectedDeviceRef.current = selectedDevice;
  const devicesCountRef = useRef(devices.length);
  devicesCountRef.current = devices.length;

  // Ao sair da tela limpa a seleção; ao voltar, se houver mais de 1 veículo,
  // reabre o SearchBottomSheet para escolha.
  useFocusEffect(
    useCallback(() => {
      if (devicesCountRef.current > 1 && !selectedDeviceRef.current) {
        setShowDeviceSelector(true);
      }
      return () => {
        setSelectedDevice(null);
        setShowDeviceSelector(false);
      };
    }, []),
  );

  const loadReport = useCallback(async (device: TrackingDevice, p: ReportPeriodo, from: Date, to: Date) => {
    setIsLoading(true);
    setHistorico(null);
    setViagens([]);
    setParadas([]);
    setEventos([]);
    setResumo(null);

    const id = device.dispositivoId;
    const [hist, viag, par, ev, res] = await Promise.allSettled([
      getHistorico(id, from, to),
      getViagens(id, from, to),
      getParadas(id, from, to),
      getEventos(id, from, to),
      getResumo(id, from, to),
    ]);

    if (hist.status === 'fulfilled') setHistorico(hist.value);
    if (viag.status === 'fulfilled') setViagens(Array.isArray(viag.value) ? viag.value : []);
    if (par.status === 'fulfilled') setParadas(Array.isArray(par.value) ? par.value : []);
    if (ev.status === 'fulfilled') setEventos(Array.isArray(ev.value) ? ev.value : []);
    if (res.status === 'fulfilled') setResumo(res.value);

    setIsLoading(false);
  }, []);

  // Auto-load when device or non-custom period changes
  useEffect(() => {
    if (!selectedDevice || devicesLoading) return;
    if (periodo === 'custom') return;
    const { from, to } = calcularIntervalo(periodo);
    loadReport(selectedDevice, periodo, from, to);
  }, [selectedDevice, periodo, devicesLoading, loadReport]);

  // Export button in header
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton
          icon={isExporting ? 'loading' : 'export-variant'}
          iconColor={colors.surface}
          size={22}
          disabled={!selectedDevice || isLoading || isExporting}
          accessibilityLabel="Exportar relatório"
          onPress={() => setShowExportModal(true)}
        />
      ),
    });
  }, [navigation, selectedDevice, isLoading, isExporting]);

  const handlePeriodoChange = (p: ReportPeriodo) => {
    setPeriodo(p);
  };

  const handleCustomLoad = () => {
    if (!selectedDevice) return;
    loadReport(selectedDevice, 'custom', customFrom, customTo);
  };

  const handleExport = async (tipo: ExportType) => {
    if (!selectedDevice) return;
    setIsExporting(true);
    setShowExportModal(false);
    try {
      const { from, to } = periodo === 'custom'
        ? { from: customFrom, to: customTo }
        : calcularIntervalo(periodo);
      const { url, token } = await getExportUrl(selectedDevice.dispositivoId, from, to, tipo);

      const cacheDir = new FileSystem.Directory(FileSystem.Paths.cache);
      const downloaded = await FileSystem.File.downloadFileAsync(url, cacheDir, {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloaded.uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: 'Salvar relatório',
          UTI: 'com.microsoft.excel.xlsx',
        });
      } else {
        toast.show({ message: 'Compartilhamento não disponível neste dispositivo.', type: 'info' });
      }
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao exportar relatório.',
        type: 'error',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // ─── Render ───

  if (devicesLoading) {
    return (
      <View style={styles.root}>
        <LoadingState />
      </View>
    );
  }

  if (devices.length === 0) {
    return (
      <View style={styles.root}>
        <EmptyState message="Nenhum veículo disponível." />
      </View>
    );
  }

  if (!selectedDevice && devices.length > 1) {
    return (
      <View style={styles.root}>
        <View style={styles.selectEmpty}>
          <Icon source="car-multiple" size={48} color={colors.textMuted} />
          <Text style={styles.selectEmptyTitle}>Selecione um veículo</Text>
          <Text style={styles.selectEmptySubtitle}>
            Escolha um veículo para visualizar o relatório.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.selectEmptyBtn}
            onPress={() => setShowDeviceSelector(true)}
          >
            <Icon source="magnify" size={16} color={colors.primaryText} />
            <Text style={styles.selectEmptyBtnText}>Selecionar veículo</Text>
          </Pressable>
        </View>
        <SearchBottomSheet
          visible={showDeviceSelector}
          devices={devices}
          title="Selecione o veículo"
          onClose={() => setShowDeviceSelector(false)}
          onSelectDevice={(device) => {
            setSelectedDevice(device);
            setShowDeviceSelector(false);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── Toolbar ── */}
      <View style={styles.toolbar}>
        {devices.length > 1 && (
          <Pressable style={styles.deviceBtn} onPress={() => setShowDeviceSelector(true)}>
            <View style={styles.deviceBtnInfo}>
              <Text style={styles.deviceBtnText} numberOfLines={1}>
                {selectedDevice
                  ? selectedDevice.nome + (selectedDevice.placa ? ` (${selectedDevice.placa})` : '')
                  : 'Selecionar veículo'}
              </Text>
            </View>
            <View style={styles.deviceBtnSwap}>
              <Icon source="swap-horizontal" size={16} color={colors.primary} />
              <Text style={styles.deviceBtnSwapText}>Trocar</Text>
            </View>
          </Pressable>
        )}
        <View style={styles.periodRow}>
          {(Object.keys(PERIODO_LABELS) as ReportPeriodo[]).map(p => (
            <Pressable
              key={p}
              style={[styles.periodBtn, periodo === p && styles.periodBtnActive]}
              onPress={() => handlePeriodoChange(p)}
            >
              <Text style={[styles.periodBtnText, periodo === p && styles.periodBtnTextActive]}>
                {PERIODO_LABELS[p]}
              </Text>
            </Pressable>
          ))}
        </View>
        {periodo === 'custom' && (
          <View style={styles.customDateRow}>
            <Pressable style={styles.customDateBtn} onPress={() => setDatePickerState({ field: 'from', mode: Platform.OS === 'ios' ? 'datetime' : 'date' })}>
              <Text style={styles.customDateText}>{fmtDataHora(customFrom)}</Text>
            </Pressable>
            <Text style={styles.customDateSep}>até</Text>
            <Pressable style={styles.customDateBtn} onPress={() => setDatePickerState({ field: 'to', mode: Platform.OS === 'ios' ? 'datetime' : 'date' })}>
              <Text style={styles.customDateText}>{fmtDataHora(customTo)}</Text>
            </Pressable>
            <Pressable style={styles.customLoadBtn} onPress={handleCustomLoad} disabled={isLoading}>
              <Icon source="magnify" size={18} color={colors.surface} />
            </Pressable>
          </View>
        )}
      </View>

      {/* ── Tab bar ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map(tab => (
          <Pressable
            key={tab.key}
            style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabBtnText, activeTab === tab.key && styles.tabBtnTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Content ── */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <View style={styles.content}>
          {activeTab === 'rota'    && <RouteTab historico={historico} paradas={paradas} device={selectedDevice} />}
          {activeTab === 'eventos' && <EventosTab eventos={eventos} />}
          {activeTab === 'viagens' && <ViagensTab viagens={viagens} />}
          {activeTab === 'paradas' && <ParadasTab paradas={paradas} />}
          {activeTab === 'resumo'  && <ResumoTab resumo={resumo} viagens={viagens} paradas={paradas} />}
          {activeTab === 'grafico' && <GraficoTab historico={historico} />}
        </View>
      )}

      {/* ── Exporting overlay ── */}
      {isExporting && (
        <View style={styles.exportingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.exportingText}>Gerando arquivo...</Text>
        </View>
      )}

      {/* ── Modals ── */}
      <SearchBottomSheet
        visible={showDeviceSelector}
        devices={devices}
        title="Selecione o veículo"
        onClose={() => setShowDeviceSelector(false)}
        onSelectDevice={(device) => {
          setSelectedDevice(device);
          setShowDeviceSelector(false);
        }}
      />
      <ExportModal
        visible={showExportModal}
        onConfirm={handleExport}
        onClose={() => setShowExportModal(false)}
      />
      {datePickerState && (
        <DateTimePicker
          value={datePickerState.field === 'from' ? customFrom : customTo}
          mode={datePickerState.mode as any}
          display={Platform.OS === 'ios' ? (datePickerState.mode === 'date' ? 'inline' : 'spinner') : 'default'}
          maximumDate={new Date()}
          onChange={(_, date) => {
            if (!date) {
              setDatePickerState(null);
              return;
            }
            const { field, mode } = datePickerState;

            if (mode === 'datetime') {
              if (field === 'from') setCustomFrom(date);
              else setCustomTo(date);
              setDatePickerState(null);
            } else if (mode === 'date') {
              if (field === 'from') {
                const newDate = new Date(customFrom);
                newDate.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                setCustomFrom(newDate);
              } else {
                const newDate = new Date(customTo);
                newDate.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                setCustomTo(newDate);
              }
              setDatePickerState({ field, mode: 'time' });
            } else if (mode === 'time') {
              if (field === 'from') {
                const newDate = new Date(customFrom);
                newDate.setHours(date.getHours(), date.getMinutes(), 0, 0);
                setCustomFrom(newDate);
              } else {
                const newDate = new Date(customTo);
                newDate.setHours(date.getHours(), date.getMinutes(), 59, 0);
                setCustomTo(newDate);
              }
              setDatePickerState(null);
            }
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SCREEN_HEIGHT = Dimensions.get('window').height;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Toolbar
  toolbar: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  deviceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  deviceBtnInfo: {
    flex: 1,
    minWidth: 0,
  },
  deviceBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  deviceBtnSwap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  deviceBtnSwapText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  selectEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  selectEmptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
    marginTop: spacing.xs,
  },
  selectEmptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  selectEmptyBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  selectEmptyBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primaryText,
  },
  periodRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  periodBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  periodBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  periodBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  periodBtnTextActive: {
    color: colors.primaryText,
  },
  customDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  customDateBtn: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  customDateText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  customDateSep: {
    fontSize: 12,
    color: colors.textMuted,
  },
  customLoadBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tab bar
  tabBar: {
    flexGrow: 0,
    backgroundColor: colors.surface,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  tabBarContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  tabBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -2,
  },
  tabBtnActive: {
    borderBottomColor: colors.primary,
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tabBtnTextActive: {
    color: colors.primary,
  },

  // Content
  content: {
    flex: 1,
  },

  // Empty / Loading
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // List shared
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },

  // Summary row (viagens header)
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.md,
    flexWrap: 'wrap',
  },

  // Stat card
  statCard: {
    flex: 1,
    minWidth: 72,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  // Route tab
  routeContainer: {
    flex: 1,
  },
  routeMap: {
    flex: 1,
  },
  routeStats: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  routeStatsText: {
    fontSize: 12,
    color: colors.textMuted,
  },

  // Offscreen capture pool
  offscreenPool: {
    position: 'absolute',
    left: -9999,
    top: 0,
    opacity: 0,
  },

  // Route player overlay
  playerControl: {
    position: 'absolute',
    bottom: 40,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  playerPlayBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerSpeeds: {
    flexDirection: 'row',
    gap: 4,
  },
  playerSpeedBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  playerSpeedBtnActive: {
    backgroundColor: colors.primary,
  },
  playerSpeedText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
  },
  playerSpeedTextActive: {
    color: colors.surface,
  },
  playerSpeedDisplay: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  playerSpeedDisplayText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.surface,
  },

  // Evento row
  eventoRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  eventoLeft: {
    gap: spacing.xs,
  },
  eventoHora: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
  },
  eventoBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  eventoBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  eventoAttrs: {
    flex: 1,
    fontSize: 11,
    color: colors.textMuted,
  },

  // Trip card
  tripCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  tripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tripIndex: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '700',
    minWidth: 24,
  },
  tripTime: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  tripStats: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingLeft: 24 + spacing.sm,
  },
  tripStat: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '700',
  },
  tripRoute: {
    paddingLeft: 24 + spacing.sm,
    gap: 2,
  },
  tripAddress: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // Stop card
  stopCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stopPin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.loginBackgroundStart,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stopPinText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: '900',
  },
  stopInfo: {
    flex: 1,
    gap: 2,
  },
  stopTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  stopAddress: {
    fontSize: 11,
    color: colors.textMuted,
  },
  stopDuration: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
    flexShrink: 0,
  },
  stopTime: {
    fontSize: 10,
    color: colors.textSubtle,
    paddingLeft: 26 + spacing.md,
  },

  // Chart
  chartTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  chartWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },

  // Device selector modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  deviceSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.bottomSheet,
    borderTopRightRadius: radius.bottomSheet,
    maxHeight: SCREEN_HEIGHT * 0.75,
    paddingBottom: spacing.xl,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  deviceRowSelected: {
    backgroundColor: `${colors.primary}18`,
  },
  deviceRowContent: {
    flex: 1,
    gap: 2,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  deviceNameSelected: {
    color: colors.primaryText,
  },
  devicePlate: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // Export modal
  exportCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    margin: spacing.xl,
    padding: spacing.xl,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  exportTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
  },
  exportSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  exportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  exportOptionSelected: {},
  exportRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.border,
  },
  exportRadioSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  exportOptionLabel: {
    fontSize: 14,
    color: colors.text,
  },
  exportOptionLabelSelected: {
    fontWeight: '700',
    color: colors.primaryText,
  },
  exportActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  exportCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  exportCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
  },
  exportConfirm: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.success,
  },
  exportConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.surface,
  },

  // Exporting overlay
  exportingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  exportingText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
});
