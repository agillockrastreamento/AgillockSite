import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type LatLng,
  type MapType,
} from 'react-native-maps';
import { Icon, IconButton } from 'react-native-paper';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import {
  buildTraccarDeviceIndex,
  getTrackingAccessStatus,
  getTrackingSnapshot,
} from '../tracking/trackingService';
import type { TrackingAccessStatus, TrackingDevice } from '../tracking/trackingTypes';

const DEFAULT_REGION = {
  latitude: -14.235,
  longitude: -51.9253,
  latitudeDelta: 24,
  longitudeDelta: 24,
};

const MAP_TYPES: MapType[] = ['standard', 'satellite', 'terrain', 'hybrid'];

function getDeviceCoordinate(device: TrackingDevice): LatLng | null {
  const latitude = device.posicao?.latitude;
  const longitude = device.posicao?.longitude;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function getStatusColor(status: string) {
  if (status === 'online') return colors.success;
  if (status === 'offline') return colors.danger;
  return colors.textMuted;
}

function formatSpeed(device: TrackingDevice) {
  const speed = device.posicao?.velocidade;
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return 'Sem velocidade';
  return `${Math.round(speed)} km/h`;
}

function MapFloatingButton({
  icon,
  active,
  onPress,
}: {
  icon: string;
  active?: boolean;
  onPress(): void;
}) {
  return (
    <IconButton
      icon={icon}
      size={21}
      mode="contained"
      containerColor={active ? colors.primary : colors.surface}
      iconColor={active ? colors.primaryText : colors.text}
      style={styles.mapButton}
      onPress={onPress}
    />
  );
}

export function MapScreen() {
  const toast = useToast();
  const mapRef = useRef<MapView | null>(null);
  const [accessStatus, setAccessStatus] = useState<TrackingAccessStatus | null>(null);
  const [devices, setDevices] = useState<TrackingDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapTypeIndex, setMapTypeIndex] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const [showFences, setShowFences] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  const locatedDevices = useMemo(
    () => devices.filter((device) => !!getDeviceCoordinate(device)),
    [devices],
  );
  const selectedDevice = useMemo(
    () => devices.find((device) => device.dispositivoId === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );
  const traccarDeviceIndex = useMemo(
    () => buildTraccarDeviceIndex(devices),
    [devices],
  );

  const focusDevice = useCallback((device: TrackingDevice) => {
    const coordinate = getDeviceCoordinate(device);
    if (!coordinate) {
      toast.show({
        message: 'Este dispositivo ainda não possui posição válida.',
        type: 'info',
      });
      return;
    }

    setSelectedDeviceId(device.dispositivoId);
    mapRef.current?.animateCamera(
      {
        center: coordinate,
        zoom: 16,
      },
      { duration: 520 },
    );
  }, [toast]);

  const fitAllDevices = useCallback((nextDevices: TrackingDevice[]) => {
    const coordinates = nextDevices
      .map(getDeviceCoordinate)
      .filter((coordinate): coordinate is LatLng => !!coordinate);

    if (!coordinates.length) return;

    requestAnimationFrame(() => {
      if (coordinates.length === 1) {
        mapRef.current?.animateCamera(
          { center: coordinates[0], zoom: 15 },
          { duration: 450 },
        );
        return;
      }

      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: 96, right: 56, bottom: 176, left: 56 },
        animated: true,
      });
    });
  }, []);

  const loadSnapshot = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const status = await getTrackingAccessStatus();
      setAccessStatus(status);

      if (status.bloqueado) {
        setDevices([]);
        return;
      }

      const snapshot = await getTrackingSnapshot();
      if (snapshot === 'blocked') {
        setAccessStatus({ bloqueado: true });
        setDevices([]);
        return;
      }

      setDevices(snapshot);
      fitAllDevices(snapshot);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar o rastreamento.';
      toast.show({ message, type: 'error' });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [fitAllDevices, toast]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const focusUserLocation = useCallback(async () => {
    try {
      setIsLocating(true);
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        toast.show({
          message: 'Permita acesso à localização para centralizar sua posição.',
          type: 'error',
        });
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      mapRef.current?.animateCamera(
        {
          center: {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          },
          zoom: 15,
        },
        { duration: 520 },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível obter sua localização.';
      toast.show({ message, type: 'error' });
    } finally {
      setIsLocating(false);
    }
  }, [toast]);

  const currentMapType = MAP_TYPES[mapTypeIndex];

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        mapType={currentMapType}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {locatedDevices.map((device) => {
          const coordinate = getDeviceCoordinate(device);
          if (!coordinate) return null;

          const isSelected = selectedDeviceId === device.dispositivoId;
          return (
            <Marker
              key={device.dispositivoId}
              coordinate={coordinate}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => focusDevice(device)}
            >
              <View
                style={[
                  styles.marker,
                  {
                    borderColor: isSelected ? colors.primary : colors.surface,
                    backgroundColor: getStatusColor(device.status),
                  },
                ]}
              >
                <Icon source="car" size={18} color="#ffffff" />
              </View>
              {showLabels ? (
                <View style={styles.markerLabel}>
                  <Text style={styles.markerLabelText} numberOfLines={1}>
                    {device.placa ?? device.nome}
                  </Text>
                </View>
              ) : null}
            </Marker>
          );
        })}
      </MapView>

      <View style={styles.mapControls}>
        <MapFloatingButton
          icon="map"
          active={currentMapType !== 'standard'}
          onPress={() => setMapTypeIndex((current) => (current + 1) % MAP_TYPES.length)}
        />
        <MapFloatingButton
          icon="layers-outline"
          active={currentMapType === 'satellite' || currentMapType === 'hybrid'}
          onPress={() => setMapTypeIndex((current) => (current + 1) % MAP_TYPES.length)}
        />
        <MapFloatingButton
          icon={isLocating ? 'crosshairs-question' : 'crosshairs-gps'}
          active={isLocating}
          onPress={focusUserLocation}
        />
        <MapFloatingButton
          icon="tune-variant"
          active={showLabels || showFences}
          onPress={() => {
            setShowLabels((current) => !current);
            setShowFences((current) => !current);
          }}
        />
      </View>

      <View style={styles.indexBadge}>
        <Text style={styles.indexBadgeText}>
          {Object.keys(traccarDeviceIndex).length} online no índice
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.primaryText} />
          <Text style={styles.loadingText}>Carregando rastreamento...</Text>
        </View>
      ) : null}

      {accessStatus?.bloqueado ? (
        <View style={styles.blockedPanel}>
          <Icon source="lock-alert-outline" size={28} color={colors.danger} />
          <Text style={styles.blockedTitle}>Rastreamento bloqueado</Text>
          <Text style={styles.blockedText}>
            Existe pendência financeira com mais de 10 dias. Regularize os
            pagamentos para voltar a acompanhar os veículos.
          </Text>
          {typeof accessStatus.diasAtraso === 'number' ? (
            <Text style={styles.blockedMeta}>
              Dias em atraso: {accessStatus.diasAtraso}
            </Text>
          ) : null}
        </View>
      ) : null}

      {!isLoading && !accessStatus?.bloqueado && !devices.length ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>Nenhum veículo disponível</Text>
          <Text style={styles.emptyText}>
            Não encontramos dispositivos ativos vinculados ao seu acesso.
          </Text>
        </View>
      ) : null}

      {!accessStatus?.bloqueado && devices.length ? (
        <View style={styles.quickSheet}>
          <View style={styles.quickHeader}>
            <View>
              <Text style={styles.quickTitle}>Veículos</Text>
              <Text style={styles.quickMeta}>
                {locatedDevices.length} com posição de {devices.length}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              style={styles.refreshButton}
              disabled={isRefreshing}
              onPress={() => loadSnapshot(true)}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color={colors.primaryText} />
              ) : (
                <Icon source="refresh" size={18} color={colors.primaryText} />
              )}
            </Pressable>
          </View>

          {selectedDevice ? (
            <View style={styles.selectedCard}>
              <Text style={styles.selectedName} numberOfLines={1}>
                {selectedDevice.nome}
              </Text>
              <Text style={styles.selectedMeta} numberOfLines={1}>
                {selectedDevice.placa ?? 'Sem placa'} - {formatSpeed(selectedDevice)}
              </Text>
            </View>
          ) : null}

          <View style={styles.quickList}>
            {devices.slice(0, 4).map((device) => (
              <Pressable
                key={device.dispositivoId}
                accessibilityRole="button"
                style={[
                  styles.devicePill,
                  selectedDeviceId === device.dispositivoId && styles.devicePillActive,
                ]}
                onPress={() => focusDevice(device)}
              >
                <View
                  style={[
                    styles.deviceDot,
                    { backgroundColor: getStatusColor(device.status) },
                  ]}
                />
                <View style={styles.devicePillText}>
                  <Text style={styles.deviceName} numberOfLines={1}>
                    {device.placa ?? device.nome}
                  </Text>
                  <Text style={styles.deviceStatus} numberOfLines={1}>
                    {device.status}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mapControls: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.md,
    gap: spacing.sm,
  },
  mapButton: {
    margin: 0,
    elevation: 3,
  },
  marker: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 3,
    elevation: 4,
  },
  markerLabel: {
    maxWidth: 96,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    elevation: 2,
  },
  markerLabelText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  indexBadge: {
    position: 'absolute',
    left: spacing.md,
    top: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 2,
  },
  indexBadgeText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  loadingOverlay: {
    position: 'absolute',
    top: '42%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 4,
  },
  loadingText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  blockedPanel: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '28%',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    elevation: 4,
  },
  blockedTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  blockedText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  blockedMeta: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
  },
  emptyPanel: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    elevation: 4,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptyText: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  quickSheet: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    elevation: 5,
  },
  quickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  quickMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  refreshButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: colors.primary,
  },
  selectedCard: {
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  selectedName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  selectedMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  quickList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  devicePill: {
    width: '48%',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  devicePillActive: {
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  deviceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  devicePillText: {
    flex: 1,
    minWidth: 0,
  },
  deviceName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  deviceStatus: {
    marginTop: 1,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
});
