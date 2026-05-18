import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapView, {
  Circle,
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type LatLng,
  type MapType,
} from 'react-native-maps';
import { Icon, IconButton } from 'react-native-paper';

import { SearchBottomSheet } from '../components/SearchBottomSheet';
import { NotificationsBottomSheet } from '../components/NotificationsBottomSheet';
import { useConfirmDialog } from '../components/ConfirmDialogProvider';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import { useTrackingWebSocket, updateDeviceFromMessage } from '../tracking/useTrackingWebSocket';
import {
  buildTraccarDeviceIndex,
  getTrackingAccessStatus,
  getTrackingSnapshot,
} from '../tracking/trackingService';
import { apiRequest } from '../services/api/apiClient';
import {
  getGeofences,
  deleteGeofence,
  parseCircleArea,
  type Geofence,
} from '../tracking/geofenceService';
import type { TrackingAccessStatus, TrackingDevice } from '../tracking/trackingTypes';
import { VehicleIcon } from '../tracking/VehicleIcon';
import { useMarkerBitmaps, OffscreenCapturePool } from '../tracking/useMarkerBitmaps';
import { useClusterBitmaps, ClusterCapturePool } from '../tracking/useClusterBitmaps';
import {
  formatSpeed,
  getStatusColor,
  getMarkerColor,
  MainVehicleCard,
  QuickVehicleCard,
} from '../tracking/VehicleCards';
import {
  deleteVehiclePhoto,
  uploadVehiclePhoto,
} from '../tracking/vehiclePhotoService';
import type { ClienteDrawerParamList, RootStackParamList } from '../navigation/routes';

const DEFAULT_REGION = {
  latitude: -14.235,
  longitude: -51.9253,
  latitudeDelta: 24,
  longitudeDelta: 24,
};

const MAP_TYPES: MapType[] = ['standard', 'satellite', 'terrain', 'hybrid'];
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;
const MAIN_CARD_HEIGHT = Math.round(SCREEN_HEIGHT * 0.60);
const MAIN_CARD_PEEK_HEIGHT = 76; // mostra apenas alça + header (nome/placa + X)
const MAP_PREFERENCES_KEY = 'agillock_map_preferences_v1';
const CLUSTER_PX = 40;
const SPIDER_RADIUS_PX = 55;

type QuickSheetMode = 'closed' | 'peek' | 'expanded';

function getQuickSheetHeights(deviceCount: number) {
  if (deviceCount === 0) {
    return { closed: 46, peek: 46, expanded: 46 };
  }
  const rows = Math.ceil(deviceCount / 2);
  const neededHeight = 122 + rows * 104;
  const maxExpanded = Math.round(SCREEN_HEIGHT * 0.65);
  const maxPeek = Math.round(SCREEN_HEIGHT * 0.35);
  const expanded = Math.min(neededHeight, maxExpanded);
  const peek = rows <= 1
    ? expanded
    : Math.min(Math.max(neededHeight - 72, 220), maxPeek, expanded - 48);

  return {
    closed: 46,
    peek,
    expanded,
  };
}

function getDeviceCoordinate(device: TrackingDevice): LatLng | null {
  const latitude = device.posicao?.latitude;
  const longitude = device.posicao?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function ClusterMarker({
  lat,
  lng,
  count,
  bitmapUri,
  onPress,
}: {
  lat: number;
  lng: number;
  count: number;
  bitmapUri: string | undefined;
  onPress(): void;
}) {
  return (
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      image={bitmapUri ? { uri: bitmapUri } : undefined}
      tracksViewChanges={!bitmapUri}
      zIndex={500}
      onPress={onPress}
    />
  );
}

function MapFloatingButton({ icon, active, onPress }: { icon: string; active?: boolean; onPress(): void }) {
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

function LayerOption({ icon, label, active, onPress }: { icon: string; label: string; active: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.layerOption, active && styles.layerOptionActive]}
      onPress={onPress}
    >
      <Icon source={icon} size={18} color={active ? colors.primaryText : '#fff'} />
      <Text style={[styles.layerOptionText, active && styles.layerOptionTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function MapScreen() {
  const navigation = useNavigation<DrawerNavigationProp<ClienteDrawerParamList>>();
  const route = useRoute<NativeStackScreenProps<RootStackParamList, 'Map'>['route']>();
  const toast = useToast();
  const confirm = useConfirmDialog();
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
  const [showTracks, setShowTracks] = useState(false);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [tracks, setTracks] = useState<{ deviceId: string; coords: { latitude: number; longitude: number }[] }[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [quickSheetMode, setQuickSheetMode] = useState<QuickSheetMode>('peek');
  const [mainCardVisible, setMainCardVisible] = useState(false);
  const [mainCardPeeked, setMainCardPeeked] = useState(false);
  const mainCardPeekedRef = useRef(false);
  mainCardPeekedRef.current = mainCardPeeked;
  const selectedDeviceRef = useRef<TrackingDevice | null>(null);
  const [searchSheetVisible, setSearchSheetVisible] = useState(false);
  const [notificationsSheetVisible, setNotificationsSheetVisible] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [layersDrawerVisible, setLayersDrawerVisible] = useState(false);
  const [currentRegion, setCurrentRegion] = useState<{
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  }>(DEFAULT_REGION);
  const [spiderClusterKey, setSpiderClusterKey] = useState<string | null>(null);
  const lastSpiderInteractionRef = useRef(0);
  const quickSheetModeBeforeFocusRef = useRef<QuickSheetMode | null>(null);
  const moveQuickSheetRef = useRef<((mode: QuickSheetMode) => void) | null>(null);
  const mapPreferencesHydrated = useRef(false);

  // Main card animation
  const mainCardAnim = useRef(new Animated.Value(MAIN_CARD_HEIGHT)).current;
  // Track last centered position to avoid redundant map moves
  const lastCenteredKey = useRef('');

  const { getBitmap, pending, onReady } = useMarkerBitmaps(devices, showLabels);

  useEffect(() => {
    let cancelled = false;
    const loadMapPreferences = async () => {
      try {
        const raw = await AsyncStorage.getItem(MAP_PREFERENCES_KEY);
        if (!raw || cancelled) return;
        const prefs = JSON.parse(raw) as Partial<{
          showLabels: boolean;
          showFences: boolean;
          showTracks: boolean;
        }>;
        if (typeof prefs.showLabels === 'boolean') setShowLabels(prefs.showLabels);
        if (typeof prefs.showFences === 'boolean') setShowFences(prefs.showFences);
        if (typeof prefs.showTracks === 'boolean') setShowTracks(prefs.showTracks);
      } catch {
        await AsyncStorage.removeItem(MAP_PREFERENCES_KEY);
      } finally {
        if (!cancelled) mapPreferencesHydrated.current = true;
      }
    };
    loadMapPreferences();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapPreferencesHydrated.current) return;
    AsyncStorage.setItem(
      MAP_PREFERENCES_KEY,
      JSON.stringify({ showLabels, showFences, showTracks }),
    ).catch(() => {});
  }, [showLabels, showFences, showTracks]);

  // Push notification navigation
  useEffect(() => {
    const targetDeviceId = route.params?.dispositivoId;
    if (targetDeviceId && devices.length > 0) {
      const device = devices.find(d => d.dispositivoId === targetDeviceId);
      if (device) focusDevice(device, true);
      if (route.params?.highlight) {
        toast.show({ message: 'Notificação do veículo', type: 'info' });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params, devices]);

  useEffect(() => {
    if (route.params?.dispositivoId) {
      navigation.setParams({ dispositivoId: undefined, highlight: undefined } as any);
    }
  }, [route.params, navigation]);

  useEffect(() => {
    const loadUnreadCount = async () => {
      const { getUnreadCount } = await import('../notifications/notificationService');
      const count = await getUnreadCount();
      setUnreadCount(count);
    };
    loadUnreadCount();
  }, []);

  useEffect(() => {
    if (notificationsSheetVisible) setUnreadCount(0);
  }, [notificationsSheetVisible]);

  const quickSheetHeights = useMemo(() => getQuickSheetHeights(devices.length), [devices.length]);
  const quickSheetHeight = useRef(new Animated.Value(Math.round(SCREEN_HEIGHT * 0.3))).current;

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
  selectedDeviceRef.current = selectedDevice;
  const traccarDeviceIndex = useMemo(
    () => buildTraccarDeviceIndex(devices),
    [devices],
  );

  const pxToLatDeg = currentRegion.latitudeDelta / SCREEN_HEIGHT;
  const pxToLngDeg = currentRegion.longitudeDelta / SCREEN_WIDTH;

  const clusterGroups = useMemo(() => {
    if (!locatedDevices.length) return [] as Array<{
      key: string;
      devices: TrackingDevice[];
      lat: number;
      lng: number;
    }>;

    const visited = new Set<string>();
    const groups: Array<{
      key: string;
      devices: TrackingDevice[];
      lat: number;
      lng: number;
    }> = [];

    locatedDevices.forEach((device) => {
      if (visited.has(device.dispositivoId)) return;
      const baseCoord = getDeviceCoordinate(device);
      if (!baseCoord) return;
      const group: TrackingDevice[] = [device];
      visited.add(device.dispositivoId);
      locatedDevices.forEach((other) => {
        if (visited.has(other.dispositivoId)) return;
        const otherCoord = getDeviceCoordinate(other);
        if (!otherCoord) return;
        const dxPx = (otherCoord.longitude - baseCoord.longitude) / (pxToLngDeg || 1);
        const dyPx = (otherCoord.latitude - baseCoord.latitude) / (pxToLatDeg || 1);
        if (Math.hypot(dxPx, dyPx) <= CLUSTER_PX) {
          group.push(other);
          visited.add(other.dispositivoId);
        }
      });
      const lat = group.reduce((s, d) => s + (d.posicao?.latitude ?? 0), 0) / group.length;
      const lng = group.reduce((s, d) => s + (d.posicao?.longitude ?? 0), 0) / group.length;
      const key = group.map((d) => d.dispositivoId).sort().join('|');
      groups.push({ key, devices: group, lat, lng });
    });

    return groups;
  }, [locatedDevices, pxToLatDeg, pxToLngDeg]);

  const clusterCounts = useMemo(
    () => clusterGroups.filter((g) => g.devices.length > 1).map((g) => g.devices.length),
    [clusterGroups],
  );
  const {
    getClusterBitmap,
    pending: clusterPending,
    onReady: onClusterReady,
  } = useClusterBitmaps(clusterCounts);

  const spiderPositions = useMemo(() => {
    if (!spiderClusterKey) return null;
    const cluster = clusterGroups.find((g) => g.key === spiderClusterKey);
    if (!cluster || cluster.devices.length < 2) return null;
    return cluster.devices.map((device, index) => {
      const angle = (2 * Math.PI * index) / cluster.devices.length - Math.PI / 2;
      const offsetLng = SPIDER_RADIUS_PX * Math.cos(angle) * pxToLngDeg;
      const offsetLat = -SPIDER_RADIUS_PX * Math.sin(angle) * pxToLatDeg;
      return {
        device,
        latitude: cluster.lat + offsetLat,
        longitude: cluster.lng + offsetLng,
        centerLat: cluster.lat,
        centerLng: cluster.lng,
      };
    });
  }, [spiderClusterKey, clusterGroups, pxToLatDeg, pxToLngDeg]);

  const handleRegionChangeComplete = useCallback(
    (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => {
      setCurrentRegion(region);
      // onRegionChangeComplete às vezes dispara logo depois de re-renderizar
      // os marcadores. Não fechamos o spider nessa janela.
      if (Date.now() - lastSpiderInteractionRef.current < 1200) return;
      setSpiderClusterKey(null);
    },
    [],
  );

  const handleMapPress = useCallback(() => {
    // No Android, o onPress do MapView dispara em sequência ao onPress do
    // Marker; ignoramos qualquer toque que chegue logo após abrir o spider.
    if (Date.now() - lastSpiderInteractionRef.current < 1200) return;
    setSpiderClusterKey(null);
  }, []);

  const openSpider = useCallback((key: string) => {
    lastSpiderInteractionRef.current = Date.now();
    setSpiderClusterKey(key);
  }, []);

  const closeSpiderFromMarker = useCallback(() => {
    lastSpiderInteractionRef.current = Date.now();
    setSpiderClusterKey(null);
  }, []);

  const animateToDevice = useCallback((device: TrackingDevice, cardHeight: number) => {
    const coordinate = getDeviceCoordinate(device);
    if (!coordinate) return;
    const latitudeOffset = (cardHeight / SCREEN_HEIGHT) * 0.011;
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

  // Follow selected vehicle when main card is open
  useEffect(() => {
    if (!mainCardVisible || !selectedDevice?.posicao) return;
    const { latitude, longitude } = selectedDevice.posicao;
    if (!latitude || !longitude) return;
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    if (lastCenteredKey.current === key) return;
    lastCenteredKey.current = key;
    mapRef.current?.animateCamera(
      {
        center: {
          latitude: latitude - (MAIN_CARD_HEIGHT / SCREEN_HEIGHT) * 0.011,
          longitude,
        },
        zoom: 16,
      },
      { duration: 300 },
    );
  }, [selectedDevice?.posicao?.latitude, selectedDevice?.posicao?.longitude, mainCardVisible, selectedDevice]);

  const openMainCard = useCallback(() => {
    setMainCardVisible(true);
    setMainCardPeeked(false);
    Animated.spring(mainCardAnim, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
      tension: 90,
    }).start();
  }, [mainCardAnim]);

  const expandMainCard = useCallback(() => {
    setMainCardPeeked(false);
    Animated.spring(mainCardAnim, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
      tension: 90,
    }).start();
  }, [mainCardAnim]);

  const peekMainCard = useCallback(() => {
    setMainCardPeeked(true);
    Animated.spring(mainCardAnim, {
      toValue: MAIN_CARD_HEIGHT - MAIN_CARD_PEEK_HEIGHT,
      useNativeDriver: true,
      friction: 8,
      tension: 90,
    }).start();
  }, [mainCardAnim]);

  const focusSelectedDevice = useCallback(() => {
    const device = selectedDeviceRef.current;
    if (!device) return;
    const cardHeight = mainCardPeekedRef.current ? MAIN_CARD_PEEK_HEIGHT : MAIN_CARD_HEIGHT;
    const coordinate = getDeviceCoordinate(device);
    if (coordinate) {
      lastCenteredKey.current = `${coordinate.latitude.toFixed(5)},${coordinate.longitude.toFixed(5)}`;
    }
    animateToDevice(device, cardHeight);
  }, [animateToDevice]);

  const expandAndFocusMainCard = useCallback(() => {
    expandMainCard();
    const device = selectedDeviceRef.current;
    if (device) {
      const coordinate = getDeviceCoordinate(device);
      if (coordinate) {
        lastCenteredKey.current = `${coordinate.latitude.toFixed(5)},${coordinate.longitude.toFixed(5)}`;
      }
      animateToDevice(device, MAIN_CARD_HEIGHT);
    }
  }, [expandMainCard, animateToDevice]);

  const toggleMainCardPeek = useCallback(() => {
    if (mainCardPeekedRef.current) expandAndFocusMainCard();
    else peekMainCard();
  }, [expandAndFocusMainCard, peekMainCard]);

  const closeMainCard = useCallback(() => {
    Animated.timing(mainCardAnim, {
      toValue: MAIN_CARD_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setMainCardVisible(false);
      setMainCardPeeked(false);
      setSelectedDeviceId(null);
      lastCenteredKey.current = '';
      const previousMode = quickSheetModeBeforeFocusRef.current;
      quickSheetModeBeforeFocusRef.current = null;
      if (previousMode && previousMode !== 'closed') {
        moveQuickSheetRef.current?.(previousMode);
      }
    });
  }, [mainCardAnim]);

  const mainCardPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gs) => {
          const base = mainCardPeekedRef.current ? MAIN_CARD_HEIGHT - MAIN_CARD_PEEK_HEIGHT : 0;
          const next = Math.max(0, Math.min(MAIN_CARD_HEIGHT - MAIN_CARD_PEEK_HEIGHT, base + gs.dy));
          mainCardAnim.setValue(next);
        },
        onPanResponderRelease: (_, gs) => {
          const isTap = Math.abs(gs.dy) < 8 && Math.abs(gs.dx) < 8 && Math.abs(gs.vy) < 0.2;
          if (isTap) {
            if (mainCardPeekedRef.current) expandAndFocusMainCard();
            else peekMainCard();
            return;
          }
          if (mainCardPeekedRef.current) {
            if (gs.dy < -60 || gs.vy < -0.6) {
              expandAndFocusMainCard();
            } else {
              peekMainCard();
            }
          } else {
            if (gs.dy > 80 || gs.vy > 0.7) {
              peekMainCard();
            } else {
              expandMainCard();
            }
          }
        },
      }),
    [mainCardAnim, expandMainCard, expandAndFocusMainCard, peekMainCard],
  );

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
    },
    [quickSheetHeight, quickSheetHeights],
  );
  moveQuickSheetRef.current = moveQuickSheet;

  const toggleQuickSheet = useCallback(() => {
    if (quickSheetMode === 'closed') { moveQuickSheet('peek'); return; }
    if (quickSheetMode === 'peek') { moveQuickSheet('expanded'); return; }
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
          if (gestureState.dy > 120 || gestureState.vy > 1.1) {
            moveQuickSheet('closed');
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

  const focusDevice = useCallback((device: TrackingDevice, openCard = false) => {
    const coordinate = getDeviceCoordinate(device);
    if (!coordinate) {
      toast.show({ message: 'Este dispositivo ainda não possui posição válida.', type: 'info' });
      return;
    }
    setSelectedDeviceId(device.dispositivoId);
    if (openCard) {
      // Guarda o modo do quick sheet antes de fechar para restaurar ao desfocar.
      // Só sobrescreve quando ainda não há foco ativo (evita perder o valor original
      // ao trocar de veículo enquanto o main card já está aberto).
      if (quickSheetModeBeforeFocusRef.current == null) {
        quickSheetModeBeforeFocusRef.current = quickSheetMode;
      }
      moveQuickSheet('closed');
      lastCenteredKey.current = `${coordinate.latitude.toFixed(5)},${coordinate.longitude.toFixed(5)}`;
      animateToDevice(device, MAIN_CARD_HEIGHT);
      openMainCard();
    } else {
      animateToDevice(device, 0);
    }
  }, [moveQuickSheet, animateToDevice, openMainCard, toast, quickSheetMode]);

  const fitAllDevices = useCallback((nextDevices: TrackingDevice[]) => {
    const coordinates = nextDevices
      .map(getDeviceCoordinate)
      .filter((c): c is LatLng => !!c);
    if (!coordinates.length) return;
    requestAnimationFrame(() => {
      if (coordinates.length === 1) {
        mapRef.current?.animateCamera({ center: coordinates[0], zoom: 15 }, { duration: 450 });
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
      if (status.bloqueado) { setDevices([]); return; }
      const snapshot = await getTrackingSnapshot();
      if (snapshot === 'blocked') {
        setAccessStatus({ bloqueado: true });
        setDevices([]);
        return;
      }
      setDevices(snapshot);
      fitAllDevices(snapshot);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : 'Não foi possível carregar o rastreamento.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [fitAllDevices, toast]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerButtons}>
          <IconButton icon="magnify" iconColor={colors.surface} size={22} onPress={() => setSearchSheetVisible(true)} />
          <IconButton icon="bell-outline" iconColor={colors.surface} size={22} onPress={() => setNotificationsSheetVisible(true)} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
        </View>
      ),
    });
  }, [navigation, unreadCount]);

  useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

  useEffect(() => {
    if (!showFences) { setGeofences([]); return; }
    getGeofences().then(setGeofences).catch(() => {});
  }, [showFences]);

  useEffect(() => {
    if (!showTracks) { setTracks([]); return; }
    const loadAllTracks = async () => {
      setIsLoadingTracks(true);
      try {
        const now = new Date();
        const from = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
        const to = now.toISOString();
        const trackPromises = locatedDevices.map(async (device) => {
          try {
            const data = await apiRequest<{ posicoes: { latitude: number; longitude: number }[] }>(
              `/cliente/rastreamento/dispositivos/${device.dispositivoId}/historico?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
            );
            const positions = data?.posicoes ?? [];
            if (positions.length < 2) return null;
            const coords = positions.filter(
              p => typeof p.latitude === 'number' && typeof p.longitude === 'number',
            );
            return coords.length >= 2 ? { deviceId: device.dispositivoId, coords } : null;
          } catch {
            return null;
          }
        });
        const results = await Promise.all(trackPromises);
        setTracks(results.filter((r): r is { deviceId: string; coords: { latitude: number; longitude: number }[] } => r !== null));
      } finally {
        setIsLoadingTracks(false);
      }
    };
    loadAllTracks();
  }, [showTracks, locatedDevices]);

  const handleGeofenceCreated = useCallback(() => {
    setShowFences(true);
    getGeofences().then(setGeofences).catch(() => {});
  }, []);

  const handleGeofencePress = useCallback(async (geofence: Geofence) => {
    const confirmed = await confirm.show({
      title: 'Remover Cerca',
      message: `Deseja remover a cerca "${geofence.name}"?`,
      confirmLabel: 'Remover',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteGeofence(geofence.id);
      setGeofences(current => current.filter(g => g.id !== geofence.id));
      toast.show({ message: 'Cerca removida!', type: 'success' });
    } catch {
      toast.show({ message: 'Não foi possível remover esta cerca.', type: 'error' });
    }
  }, [confirm, toast]);

  const handleWebSocketMessage = useCallback(
    (position: import('../tracking/trackingWebSocket').WsPosition, dispositivoId: string) => {
      setDevices((current) => updateDeviceFromMessage(current, dispositivoId, position));
    },
    [],
  );

  const handleWebSocketEvent = useCallback(() => {
    if (notificationsSheetVisible) return;
    setUnreadCount((current) => current + 1);
  }, [notificationsSheetVisible]);

  useTrackingWebSocket(devices, traccarDeviceIndex, handleWebSocketMessage, handleWebSocketEvent);

  const focusUserLocation = useCallback(async () => {
    try {
      setIsLocating(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        toast.show({ message: 'Permita acesso à localização para centralizar sua posição.', type: 'error' });
        return;
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateCamera(
        { center: { latitude: location.coords.latitude, longitude: location.coords.longitude }, zoom: 15 },
        { duration: 520 },
      );
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : 'Não foi possível obter sua localização.',
        type: 'error',
      });
    } finally {
      setIsLocating(false);
    }
  }, [toast]);

  const handleUploadPhoto = useCallback(async () => {
    if (!selectedDevice) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show({ message: 'Permita acesso às fotos para escolher a imagem do veículo.', type: 'error' });
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
      const response = await uploadVehiclePhoto(selectedDevice.dispositivoId, result.assets[0]);
      updateDevice(selectedDevice.dispositivoId, { imagemUrlCliente: response.imagemUrlCliente });
      toast.show({ message: 'Foto do veículo atualizada.', type: 'success' });
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : 'Erro ao enviar foto.', type: 'error' });
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
      toast.show({ message: 'Foto removida.', type: 'success' });
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : 'Erro ao remover foto.', type: 'error' });
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
        onRegionChangeComplete={handleRegionChangeComplete}
        onPress={handleMapPress}
      >
        {(() => {
          const renderDeviceMarker = (
            device: TrackingDevice,
            coord: LatLng,
            isSpiderMarker: boolean,
          ) => {
            const bitmapUri = getBitmap(device);
            return (
              <Marker
                key={`dev-${device.dispositivoId}${isSpiderMarker ? '-spider' : ''}`}
                coordinate={coord}
                image={bitmapUri ? { uri: bitmapUri } : undefined}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={!bitmapUri}
                zIndex={isSpiderMarker ? 1000 : 100}
                onPress={() => {
                  if (isSpiderMarker) closeSpiderFromMarker();
                  focusDevice(device, true);
                }}
              >
                {!bitmapUri ? (
                  <View style={styles.markerContainer}>
                    <View style={styles.markerWrap}>
                      <VehicleIcon
                        categoria={device.categoria}
                        color={getMarkerColor(device)}
                        course={device.posicao?.curso}
                        size={58}
                      />
                    </View>
                    {showLabels ? (
                      <View style={styles.markerLabelWrap}>
                        <View style={styles.markerLabelPointer} />
                        <View style={styles.markerLabel}>
                          <Text style={styles.markerLabelText} numberOfLines={1}>
                            {device.placa ?? device.nome}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </Marker>
            );
          };

          if (mainCardVisible && selectedDevice) {
            const coord = getDeviceCoordinate(selectedDevice);
            return coord ? renderDeviceMarker(selectedDevice, coord, false) : null;
          }

          return clusterGroups.flatMap((group) => {
            const isCluster = group.devices.length > 1;
            const isSpider = isCluster && spiderClusterKey === group.key;

            if (isCluster && !isSpider) {
              return [
                <ClusterMarker
                  key={`cluster-${group.key}`}
                  lat={group.lat}
                  lng={group.lng}
                  count={group.devices.length}
                  bitmapUri={getClusterBitmap(group.devices.length)}
                  onPress={() => openSpider(group.key)}
                />,
              ];
            }

            if (isCluster && isSpider && spiderPositions) {
              return spiderPositions.map((sp) =>
                renderDeviceMarker(sp.device, { latitude: sp.latitude, longitude: sp.longitude }, true),
              );
            }

            const device = group.devices[0];
            const coord = getDeviceCoordinate(device);
            return coord ? [renderDeviceMarker(device, coord, false)] : [];
          });
        })()}

        {!mainCardVisible && spiderPositions
          ? spiderPositions.map((sp) => (
              <Polyline
                key={`spider-line-${sp.device.dispositivoId}`}
                coordinates={[
                  { latitude: sp.centerLat, longitude: sp.centerLng },
                  { latitude: sp.latitude, longitude: sp.longitude },
                ]}
                strokeColor="rgba(102,102,102,0.65)"
                strokeWidth={1.5}
                lineDashPattern={[4, 4]}
                zIndex={400}
              />
            ))
          : null}

        {showFences && geofences.map((geofence) => {
          const parsed = parseCircleArea(geofence.area);
          if (!parsed) return null;
          const center = { latitude: parsed.latitude, longitude: parsed.longitude };
          return (
            <Marker
              key={`fence-tap-${geofence.id}`}
              coordinate={center}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => handleGeofencePress(geofence)}
            >
              <View style={styles.geofenceTapTarget}>
                <Icon source="circle-outline" size={14} color="#2980b9" />
              </View>
            </Marker>
          );
        })}

        {showFences && geofences.map((geofence) => {
          const parsed = parseCircleArea(geofence.area);
          if (!parsed) return null;
          return (
            <Circle
              key={`fence-circle-${geofence.id}`}
              center={{ latitude: parsed.latitude, longitude: parsed.longitude }}
              radius={parsed.radius}
              strokeWidth={2}
              strokeColor="rgba(41,128,185,0.8)"
              fillColor="rgba(41,128,185,0.15)"
            />
          );
        })}

        {showTracks && tracks.map((track) => {
          if (!track.coords || track.coords.length < 2) return null;
          return (
            <Polyline
              key={track.deviceId}
              coordinates={track.coords}
              strokeWidth={3}
              strokeColor="rgba(41,128,185,0.7)"
            />
          );
        })}
      </MapView>

      <OffscreenCapturePool pending={pending} onReady={onReady} />
      <ClusterCapturePool pending={clusterPending} onReady={onClusterReady} />

      <View style={styles.mapControls}>
        <MapFloatingButton
          icon={isLocating ? 'crosshairs-question' : 'crosshairs-gps'}
          active={isLocating}
          onPress={focusUserLocation}
        />
        <MapFloatingButton
          icon={mapTypeIndex === 0 ? 'satellite-variant' : 'map'}
          active={mapTypeIndex > 0}
          onPress={() => setMapTypeIndex(prev => (prev === 0 ? 1 : 0))}
        />
        <View style={styles.layersBtnWrap}>
          <MapFloatingButton
            icon="layers-outline"
            active={layersDrawerVisible || showLabels || showFences || showTracks}
            onPress={() => setLayersDrawerVisible(v => !v)}
          />
          {layersDrawerVisible && (
            <View style={styles.layersDrawer}>
              <LayerOption
                icon="label-outline"
                label="Labels"
                active={showLabels}
                onPress={() => setShowLabels(v => !v)}
              />
              <LayerOption
                icon="circle-outline"
                label="Cercas"
                active={showFences}
                onPress={() => setShowFences(v => !v)}
              />
              <LayerOption
                icon="timeline-outline"
                label="Rastro"
                active={showTracks}
                onPress={() => setShowTracks(v => !v)}
              />
            </View>
          )}
        </View>
      </View>

      {isLoadingTracks && (
        <View style={styles.trackLoadingBadge}>
          <ActivityIndicator size="small" color={colors.primaryText} />
          <Text style={styles.trackLoadingText}>Carregando rota...</Text>
        </View>
      )}

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
            Existe pendência financeira com mais de 10 dias. Regularize os pagamentos para voltar a acompanhar os veículos.
          </Text>
          {typeof accessStatus.diasAtraso === 'number' ? (
            <Text style={styles.blockedMeta}>Dias em atraso: {accessStatus.diasAtraso}</Text>
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
        <Animated.View style={[styles.quickSheet, { height: quickSheetHeight }]}>
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

      {/* Main vehicle card — inline, does NOT use Modal so map stays interactive above it */}
      {selectedDevice && mainCardVisible && (
        <Animated.View
          style={[styles.mainCard, { transform: [{ translateY: mainCardAnim }] }]}
        >
          <View
            accessibilityRole="button"
            accessibilityLabel={mainCardPeeked ? 'Expandir detalhes do veículo' : 'Recolher detalhes do veículo'}
            style={styles.mainCardDragArea}
            {...mainCardPanResponder.panHandlers}
          >
            <View style={styles.mainCardHandle} />
          </View>
          <View style={styles.mainCardHeader}>
            <Pressable
              style={styles.mainCardTitleWrap}
              onPress={focusSelectedDevice}
              disabled={!mainCardPeeked}
            >
              <Text style={styles.mainCardTitle} numberOfLines={1}>
                {selectedDevice.nome}{selectedDevice.placa ? ` — ${selectedDevice.placa}` : ''}
              </Text>
            </Pressable>
            <IconButton icon="close" size={22} onPress={closeMainCard} />
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!mainCardPeeked}
          >
            <MainVehicleCard
              device={selectedDevice}
              onUploadPhoto={handleUploadPhoto}
              onRemovePhoto={handleRemovePhoto}
              isUploading={isPhotoUploading}
              onGeofenceCreated={handleGeofenceCreated}
              onGeofenceDeleted={() => {
                if (showFences) getGeofences().then(setGeofences).catch(() => {});
              }}
              onFocusDevice={() => animateToDevice(selectedDevice, MAIN_CARD_HEIGHT)}
              onVerMais={() => {
                if (selectedDevice) {
                  closeMainCard();
                  (navigation as any).navigate('Historico', {
                    dispositivoId: selectedDevice.dispositivoId,
                    nome: selectedDevice.nome,
                    placa: selectedDevice.placa ?? null,
                  });
                }
              }}
              onShowRoute={() => {
                setShowTracks(true);
                closeMainCard();
              }}
              onCompartilhar={() => {
                // Compartilhar is handled inside VehicleCards
              }}
            />
          </ScrollView>
        </Animated.View>
      )}

      <SearchBottomSheet
        visible={searchSheetVisible}
        devices={devices}
        onClose={() => setSearchSheetVisible(false)}
        onSelectDevice={(device) => {
          focusDevice(device, true);
          setSearchSheetVisible(false);
        }}
      />

      <NotificationsBottomSheet
        visible={notificationsSheetVisible}
        devices={devices.map((d): any => ({
          dispositivoId: d.dispositivoId,
          nome: d.nome,
          placa: d.placa,
          posicao: d.posicao,
        }))}
        onClose={() => setNotificationsSheetVisible(false)}
        onSelectEvent={(event) => {
          if (event.dispositivoId) {
            const device = devices.find((d) => d.dispositivoId === event.dispositivoId);
            if (device) focusDevice(device, true);
          }
          setNotificationsSheetVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerButtons: {
    flexDirection: 'row',
    marginRight: spacing.xs,
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
  layersBtnWrap: {
    position: 'relative',
  },
  layersDrawer: {
    position: 'absolute',
    right: 50,
    top: 0,
    flexDirection: 'row',
    backgroundColor: 'rgba(20,20,30,0.92)',
    borderRadius: 14,
    padding: 8,
    gap: 6,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  layerOption: {
    width: 62,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  layerOptionActive: {
    backgroundColor: colors.primary,
  },
  layerOptionText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  layerOptionTextActive: {
    color: colors.primaryText,
  },
  markerContainer: {
    width: 84,
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  markerWrap: {
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  markerLabel: {
    maxWidth: 96,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    elevation: 2,
  },
  markerLabelWrap: {
    marginTop: -6,
    alignItems: 'center',
  },
  markerLabelPointer: {
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
  markerLabelText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
  },
  geofenceTapTarget: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(41,128,185,0.6)',
    elevation: 2,
  },
  trackLoadingBadge: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 3,
  },
  trackLoadingText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
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
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.primaryText,
    fontSize: 10,
    fontWeight: '700',
  },
  // Inline main card (not a Modal)
  mainCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: MAIN_CARD_HEIGHT,
    borderTopLeftRadius: radius.bottomSheet,
    borderTopRightRadius: radius.bottomSheet,
    backgroundColor: colors.surface,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  mainCardDragArea: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainCardHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  mainCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.xl,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mainCardTitleWrap: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  mainCardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
});
