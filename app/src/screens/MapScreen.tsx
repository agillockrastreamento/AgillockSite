import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type LatLng,
  type MapType,
} from 'react-native-maps';
import { Icon, IconButton } from 'react-native-paper';

import { BottomSheet } from '../components/BottomSheet';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import {
  buildTraccarDeviceIndex,
  getTrackingAccessStatus,
  getTrackingSnapshot,
} from '../tracking/trackingService';
import type { TrackingAccessStatus, TrackingDevice } from '../tracking/trackingTypes';
import { VehicleIcon } from '../tracking/VehicleIcon';
import {
  formatSpeed,
  getStatusColor,
  MainVehicleCard,
  QuickVehicleCard,
} from '../tracking/VehicleCards';
import {
  deleteVehiclePhoto,
  uploadVehiclePhoto,
} from '../tracking/vehiclePhotoService';

const DEFAULT_REGION = {
  latitude: -14.235,
  longitude: -51.9253,
  latitudeDelta: 24,
  longitudeDelta: 24,
};

const MAP_TYPES: MapType[] = ['standard', 'satellite', 'terrain', 'hybrid'];
const SCREEN_HEIGHT = Dimensions.get('window').height;

type QuickSheetMode = 'closed' | 'peek' | 'expanded';

function getQuickSheetHeights(deviceCount: number) {
  if (deviceCount === 0) {
    return { closed: 46, peek: 46, expanded: 46 };
  }
  const rows = Math.ceil(deviceCount / 2);
  const neededHeight = 122 + (rows * 104); // 122 for paddings/headers + 104 per row
  const maxExpanded = Math.round(SCREEN_HEIGHT * 0.65);
  const maxPeek = Math.round(SCREEN_HEIGHT * 0.35);

  return {
    closed: 46,
    peek: rows <= 2 ? neededHeight : Math.min(neededHeight, maxPeek),
    expanded: Math.min(neededHeight, maxExpanded),
  };
}

function getDeviceCoordinate(device: TrackingDevice): LatLng | null {
  const latitude = device.posicao?.latitude;
  const longitude = device.posicao?.longitude;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
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
  const [isLocating, setIsLocating] = useState(false);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const [mapTypeIndex, setMapTypeIndex] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const [showFences, setShowFences] = useState(false);
  const [quickSheetMode, setQuickSheetMode] = useState<QuickSheetMode>('peek');
  const [mainSheetVisible, setMainSheetVisible] = useState(false);

  const quickSheetHeights = useMemo(() => getQuickSheetHeights(devices.length), [devices.length]);
  const quickSheetHeight = useRef(new Animated.Value(Math.round(SCREEN_HEIGHT * 0.3))).current;

  // Adjust height when device count changes
  useEffect(() => {
    if (devices.length > 0) {
      Animated.spring(quickSheetHeight, {
        toValue: quickSheetHeights[quickSheetMode],
        useNativeDriver: false,
        friction: 8,
        tension: 82,
      }).start();
    }
  }, [devices.length, quickSheetHeights, quickSheetHeight, quickSheetMode]);

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

  const animateMapForPanel = useCallback((device: TrackingDevice | null, panelHeight: number) => {
    if (!device) return;
    const coordinate = getDeviceCoordinate(device);
    if (!coordinate) return;

    const latitudeOffset = (panelHeight / SCREEN_HEIGHT) * 0.011;
    mapRef.current?.animateCamera(
      {
        center: {
          latitude: coordinate.latitude - latitudeOffset,
          longitude: coordinate.longitude,
        },
        zoom: 16,
      },
      { duration: 420 },
    );
  }, []);

  const updateDevice = useCallback((dispositivoId: string, patch: Partial<TrackingDevice>) => {
    setDevices((current) =>
      current.map((device) =>
        device.dispositivoId === dispositivoId ? { ...device, ...patch } : device,
      ),
    );
  }, []);

  const moveQuickSheet = useCallback(
    (mode: QuickSheetMode) => {
      setQuickSheetMode(mode);
      Animated.spring(quickSheetHeight, {
        toValue: quickSheetHeights[mode],
        useNativeDriver: false,
        friction: 8,
        tension: 82,
      }).start();
      if (!mainSheetVisible) {
        animateMapForPanel(selectedDevice, mode === 'closed' ? 0 : quickSheetHeights[mode]);
      }
    },
    [animateMapForPanel, mainSheetVisible, quickSheetHeight, selectedDevice, quickSheetHeights],
  );

  const toggleQuickSheet = useCallback(() => {
    if (quickSheetMode === 'closed') {
      moveQuickSheet('peek');
      return;
    }

    if (quickSheetMode === 'peek') {
      moveQuickSheet('expanded');
      return;
    }

    moveQuickSheet('peek');
  }, [moveQuickSheet, quickSheetMode]);

  const quickSheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Math.abs(gestureState.dy) > 2 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onMoveShouldSetPanResponderCapture: (_event, gestureState) =>
          Math.abs(gestureState.dy) > 2 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_event, gestureState) => {
          const baseHeight = quickSheetHeights[quickSheetMode];
          const nextHeight = Math.min(
            quickSheetHeights.expanded,
            Math.max(quickSheetHeights.closed, baseHeight - gestureState.dy),
          );
          quickSheetHeight.setValue(nextHeight);
        },
        onPanResponderRelease: (_event, gestureState) => {
          if (gestureState.dy < -42 || gestureState.vy < -0.7) {
            moveQuickSheet(quickSheetMode === 'closed' ? 'peek' : 'expanded');
            return;
          }

          if (gestureState.dy > 42 || gestureState.vy > 0.7) {
            moveQuickSheet(quickSheetMode === 'expanded' ? 'peek' : 'closed');
            return;
          }

          moveQuickSheet(quickSheetMode);
        },
      }),
    [moveQuickSheet, quickSheetHeight, quickSheetMode, quickSheetHeights],
  );

  const focusDevice = useCallback((device: TrackingDevice, openMain = false) => {
    const coordinate = getDeviceCoordinate(device);
    if (!coordinate) {
      toast.show({
        message: 'Este dispositivo ainda não possui posição válida.',
        type: 'info',
      });
      return;
    }

    setSelectedDeviceId(device.dispositivoId);
    if (openMain) {
      setMainSheetVisible(true);
      moveQuickSheet('closed');
    }
    const panelHeight = openMain ? Math.round(SCREEN_HEIGHT * 0.55) : 0;
    const center = openMain
      ? {
          latitude: coordinate.latitude - (panelHeight / SCREEN_HEIGHT) * 0.011,
          longitude: coordinate.longitude,
        }
      : coordinate;
    mapRef.current?.animateCamera(
      {
        center,
        zoom: 16,
      },
      { duration: 520 },
    );
  }, [moveQuickSheet, toast]);

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

      const currentHeights = getQuickSheetHeights(nextDevices.length);

      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: 120, right: 60, bottom: currentHeights.peek + 40, left: 60 },
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

  const handleUploadPhoto = useCallback(async () => {
    if (!selectedDevice) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show({
        message: 'Permita acesso às fotos para escolher a imagem do veículo.',
        type: 'error',
      });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.84,
    });

    if (result.canceled || !result.assets[0]) return;

    try {
      setIsPhotoUploading(true);
      const response = await uploadVehiclePhoto(
        selectedDevice.dispositivoId,
        result.assets[0],
      );
      updateDevice(selectedDevice.dispositivoId, {
        imagemUrlCliente: response.imagemUrlCliente,
      });
      toast.show({ message: 'Foto do veículo atualizada.', type: 'success' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro ao enviar foto do veículo.';
      toast.show({ message, type: 'error' });
    } finally {
      setIsPhotoUploading(false);
    }
  }, [selectedDevice, toast, updateDevice]);

  const handleRemovePhoto = useCallback(async () => {
    if (!selectedDevice) return;

    try {
      setIsPhotoUploading(true);
      await deleteVehiclePhoto(selectedDevice.dispositivoId);
      updateDevice(selectedDevice.dispositivoId, { imagemUrlCliente: null });
      toast.show({ message: 'Foto do veículo removida.', type: 'success' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro ao remover foto do veículo.';
      toast.show({ message, type: 'error' });
    } finally {
      setIsPhotoUploading(false);
    }
  }, [selectedDevice, toast, updateDevice]);

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
              tracksViewChanges
              onPress={() => focusDevice(device, true)}
            >
              <View collapsable={false} style={styles.markerContainer}>
                <View collapsable={false} style={styles.markerWrap}>
                  <VehicleIcon
                    categoria={device.categoria}
                    color={device.cor}
                    course={device.posicao?.curso}
                    size={52}
                  />
                </View>
                {showLabels ? (
                  <View collapsable={false} style={styles.markerLabel}>
                    <Text style={styles.markerLabelText} numberOfLines={1}>
                      {device.placa ?? device.nome}
                    </Text>
                  </View>
                ) : null}
              </View>
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
        <Animated.View
          style={[
            styles.quickSheet,
            { height: quickSheetHeight },
          ]}
        >
          <View style={styles.quickHandleArea} {...quickSheetPanResponder.panHandlers}>
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              style={styles.quickHandleButton}
              onPress={toggleQuickSheet}
            >
              <View style={styles.quickHandle} />
            </Pressable>
          </View>
          {quickSheetMode !== 'closed' ? (
            <>
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
              <ScrollView
                showsVerticalScrollIndicator={quickSheetMode === 'expanded'}
                contentContainerStyle={[
                  styles.quickList,
                  devices.length === 1 && styles.quickListCenter,
                ]}
              >
                {devices.map((device) => (
                  <QuickVehicleCard
                    key={device.dispositivoId}
                    device={device}
                    selected={selectedDeviceId === device.dispositivoId}
                    onPress={() => focusDevice(device, true)}
                  />
                ))}
              </ScrollView>
            </>
          ) : null}
        </Animated.View>
      ) : null}

      {selectedDevice ? (
        <BottomSheet
          visible={mainSheetVisible}
          titleMainVehicleCard={selectedDevice.nome +  (selectedDevice.placa ? ' - ' + selectedDevice.placa : '')}
          heightPercent={0.60}
          dimBackdrop={false}
          closeOnBackdropPress={false}
          statusBarOverlay={false}
          onClose={() => {
            setMainSheetVisible(false);
            setSelectedDeviceId(null);
            animateMapForPanel(null, 0);
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <MainVehicleCard
              device={selectedDevice}
              onUploadPhoto={handleUploadPhoto}
              onRemovePhoto={handleRemovePhoto}
              isUploading={isPhotoUploading}
            />
          </ScrollView>
        </BottomSheet>
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
  markerContainer: {
    width: 76,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerWrap: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
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
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopLeftRadius: radius.bottomSheet,
    borderTopRightRadius: radius.bottomSheet,
    backgroundColor: colors.surface,
    elevation: 5,
  },
  quickSheetClosed: {
    height: 34,
    paddingBottom: 0,
  },
  quickHandleArea: {
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickHandleButton: {
    width: 88,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  quickHeader: {
    display: 'none',
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
  quickList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  quickListCenter: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
