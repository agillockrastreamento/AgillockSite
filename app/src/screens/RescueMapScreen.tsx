import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import { TagScanner, type RescueVehicle } from '../components/TagScanner';
import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import {
  getMarkerColor,
  MainVehicleCard,
} from '../tracking/VehicleCards';
import { VehicleIcon } from '../tracking/VehicleIcon';
import type { TrackingDevice } from '../tracking/trackingTypes';

const DEFAULT_REGION = {
  latitude: -14.235,
  longitude: -51.9253,
  latitudeDelta: 24,
  longitudeDelta: 24,
};

const MAP_TYPES: MapType[] = ['standard', 'satellite', 'hybrid'];
const SCREEN_HEIGHT = Dimensions.get('window').height;
const MAIN_CARD_PEEK_HEIGHT = 76;

type SplitMode = 'normal' | 'mapMax' | 'scannerMax';

// Endpoint /api/app/resgate/dispositivos retorna campos do Dispositivo + tag.
// Adaptamos para um TrackingDevice mínimo (faltando alguns campos não relevantes).
type RescueDeviceRaw = {
  id: string;
  traccarId: number | null;
  nome: string;
  identificador: string;
  categoria: string | null;
  placa: string | null;
  marca: string | null;
  modeloVeiculo: string | null;
  cor: string | null;
  ano: string | null;
  enderecoMac: string | null;
  telemetriaUltimaLatitude: number | null;
  telemetriaUltimaLongitude: number | null;
  telemetriaUltimaPosicaoEm: string | null;
  telemetriaUltimaIgnicao: boolean | null;
  tag: {
    id: string;
    apelido: string | null;
    mac: string | null;
    nomeBleAdvertised: string | null;
    manufacturerCompanyId: number | null;
    manufacturerDataHex: string | null;
    serviceUuids: unknown;
    txPowerCalibrado: number | null;
    iosPeripheralUuidCache: unknown;
  } | null;
};

function toTrackingDevice(raw: RescueDeviceRaw): TrackingDevice {
  const hasPosition =
    typeof raw.telemetriaUltimaLatitude === 'number' &&
    typeof raw.telemetriaUltimaLongitude === 'number';
  return {
    dispositivoId: raw.id,
    nome: raw.nome,
    placa: raw.placa,
    categoria: raw.categoria,
    imagemUrlCliente: null,
    marca: raw.marca,
    modeloVeiculo: raw.modeloVeiculo,
    cor: raw.cor,
    limiteVelocidade: null,
    podeGerenciarManutencao: false,
    cliente: null,
    traccarId: raw.traccarId,
    status: hasPosition ? 'online' : 'offline',
    lastUpdate: raw.telemetriaUltimaPosicaoEm,
    posicao: hasPosition
      ? {
          latitude: raw.telemetriaUltimaLatitude,
          longitude: raw.telemetriaUltimaLongitude,
          ignicao: raw.telemetriaUltimaIgnicao,
          fixTime: raw.telemetriaUltimaPosicaoEm,
        }
      : null,
  };
}

function getDeviceCoordinate(device: TrackingDevice): LatLng | null {
  const lat = device.posicao?.latitude;
  const lng = device.posicao?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
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

export function RescueMapScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const toast = useToast();
  const mapRef = useRef<MapView | null>(null);

  const [rawDevices, setRawDevices] = useState<RescueDeviceRaw[]>([]);
  const [devices, setDevices] = useState<TrackingDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocating, setIsLocating] = useState(false);
  const [mapTypeIndex, setMapTypeIndex] = useState(0);
  const [splitMode, setSplitMode] = useState<SplitMode>('normal');
  const [drawerVisible, setDrawerVisible] = useState(false);

  // Card state
  const [mainCardVisible, setMainCardVisible] = useState(false);
  const [mainCardPeeked, setMainCardPeeked] = useState(false);
  const mainCardPeekedRef = useRef(false);
  mainCardPeekedRef.current = mainCardPeeked;

  // Tamanho do card é dinâmico baseado no split
  const mapPanelFlex = useRef(new Animated.Value(1)).current;
  const scannerPanelFlex = useRef(new Animated.Value(1)).current;
  const mainCardAnim = useRef(new Animated.Value(0)).current;

  const selectedDevice = useMemo(
    () => devices.find((d) => d.dispositivoId === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  const selectedRaw = useMemo(
    () => rawDevices.find((r) => r.id === selectedDeviceId) ?? null,
    [rawDevices, selectedDeviceId],
  );

  const veiculoAlvo: RescueVehicle | null = selectedRaw
    ? {
        id: selectedRaw.id,
        nome: selectedRaw.nome,
        placa: selectedRaw.placa,
        tag: selectedRaw.tag,
      }
    : null;

  // Altura disponível pra metade superior (mapa+card) baseada no split
  const containerHeight = SCREEN_HEIGHT - insets.top - insets.bottom;
  const mapPanelHeight = useMemo(() => {
    switch (splitMode) {
      case 'mapMax':
        return containerHeight - 56; // só barra mínima do scanner embaixo
      case 'scannerMax':
        return 56; // só barra mínima do mapa em cima
      case 'normal':
      default:
        return Math.round(containerHeight * 0.5);
    }
  }, [splitMode, containerHeight]);

  const cardFullHeight = Math.max(0, Math.round(mapPanelHeight * 0.85));

  const loadDevices = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<RescueDeviceRaw[]>('/app/resgate/dispositivos');
      setRawDevices(data);
      const mapped = data.map(toTrackingDevice);
      setDevices(mapped);
      const withCoords = mapped.map(getDeviceCoordinate).filter((c): c is LatLng => !!c);
      if (withCoords.length === 1) {
        mapRef.current?.animateCamera({ center: withCoords[0], zoom: 14 }, { duration: 450 });
      } else if (withCoords.length > 1) {
        requestAnimationFrame(() => {
          mapRef.current?.fitToCoordinates(withCoords, {
            edgePadding: { top: 80, right: 60, bottom: 60, left: 60 },
            animated: true,
          });
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      // Log explícito pra ajudar a diagnosticar erros de autenticação/permissão
      console.error('[RescueMapScreen] Falha ao carregar veículos:', errorMsg, err);
      toast.show({
        message: `Erro ao carregar: ${errorMsg}`,
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Animação dos painéis em resposta ao splitMode
  useEffect(() => {
    const targets = {
      normal: { map: 1, scanner: 1 },
      mapMax: { map: 12, scanner: 1 },
      scannerMax: { map: 1, scanner: 12 },
    } as const;
    const t = targets[splitMode];
    Animated.parallel([
      Animated.spring(mapPanelFlex, {
        toValue: t.map,
        useNativeDriver: false,
        friction: 8,
        tension: 80,
      }),
      Animated.spring(scannerPanelFlex, {
        toValue: t.scanner,
        useNativeDriver: false,
        friction: 8,
        tension: 80,
      }),
    ]).start();
  }, [splitMode, mapPanelFlex, scannerPanelFlex]);

  const animateToDevice = useCallback((device: TrackingDevice) => {
    const coord = getDeviceCoordinate(device);
    if (!coord) return;
    mapRef.current?.animateCamera(
      { center: coord, zoom: 16 },
      { duration: 420 },
    );
  }, []);

  const focusDevice = useCallback(
    (device: TrackingDevice) => {
      const coord = getDeviceCoordinate(device);
      if (!coord) {
        toast.show({ message: 'Este veículo ainda não tem posição.', type: 'info' });
        return;
      }
      setSelectedDeviceId(device.dispositivoId);
      animateToDevice(device);
      // Abre o card expandido
      setMainCardVisible(true);
      setMainCardPeeked(false);
      Animated.spring(mainCardAnim, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 90,
      }).start();
    },
    [animateToDevice, mainCardAnim, toast],
  );

  // Seleciona automaticamente o primeiro veículo ao carregar (UX do user)
  useEffect(() => {
    if (devices.length > 0 && !selectedDeviceId) {
      const primeiro = devices.find((d) => getDeviceCoordinate(d)) ?? devices[0];
      if (primeiro) {
        setSelectedDeviceId(primeiro.dispositivoId);
        setMainCardVisible(true);
      }
    }
  }, [devices, selectedDeviceId]);

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
      toValue: cardFullHeight - MAIN_CARD_PEEK_HEIGHT,
      useNativeDriver: true,
      friction: 8,
      tension: 90,
    }).start();
  }, [mainCardAnim, cardFullHeight]);

  const focusSelectedFromTitle = useCallback(() => {
    if (selectedDevice) animateToDevice(selectedDevice);
  }, [selectedDevice, animateToDevice]);

  const closeMainCard = useCallback(() => {
    Animated.timing(mainCardAnim, {
      toValue: cardFullHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setMainCardVisible(false);
      setMainCardPeeked(false);
      setSelectedDeviceId(null);
    });
  }, [mainCardAnim, cardFullHeight]);

  const mainCardPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, gs) => {
          const base = mainCardPeekedRef.current ? cardFullHeight - MAIN_CARD_PEEK_HEIGHT : 0;
          const next = Math.max(0, Math.min(cardFullHeight - MAIN_CARD_PEEK_HEIGHT, base + gs.dy));
          mainCardAnim.setValue(next);
        },
        onPanResponderRelease: (_, gs) => {
          const isTap = Math.abs(gs.dy) < 8 && Math.abs(gs.vy) < 0.2;
          if (isTap) {
            if (mainCardPeekedRef.current) expandMainCard();
            else peekMainCard();
            return;
          }
          if (mainCardPeekedRef.current) {
            if (gs.dy < -60 || gs.vy < -0.6) expandMainCard();
            else peekMainCard();
          } else {
            if (gs.dy > 80 || gs.vy > 0.7) peekMainCard();
            else expandMainCard();
          }
        },
      }),
    [mainCardAnim, expandMainCard, peekMainCard, cardFullHeight],
  );

  const focusUserLocation = useCallback(async () => {
    try {
      setIsLocating(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        toast.show({ message: 'Permita acesso à localização.', type: 'error' });
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateCamera(
        { center: { latitude: loc.coords.latitude, longitude: loc.coords.longitude }, zoom: 15 },
        { duration: 500 },
      );
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao obter localização.',
        type: 'error',
      });
    } finally {
      setIsLocating(false);
    }
  }, [toast]);

  const toggleSplit = useCallback((target: SplitMode) => {
    setSplitMode((current) => (current === target ? 'normal' : target));
  }, []);

  const currentMapType = MAP_TYPES[mapTypeIndex];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── Metade superior: mapa + card flutuante ───────────── */}
      <Animated.View style={[styles.mapPanel, { flex: mapPanelFlex }]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          mapType={currentMapType}
          initialRegion={DEFAULT_REGION}
          showsUserLocation
          showsMyLocationButton={false}
        >
          {devices.map((device) => {
            const coord = getDeviceCoordinate(device);
            if (!coord) return null;
            return (
              <Marker
                key={device.dispositivoId}
                coordinate={coord}
                anchor={{ x: 0.5, y: 0.5 }}
                onPress={() => focusDevice(device)}
              >
                <View style={styles.markerWrap}>
                  <VehicleIcon
                    categoria={device.categoria}
                    color={getMarkerColor(device)}
                    course={device.posicao?.curso}
                    size={50}
                  />
                </View>
              </Marker>
            );
          })}
        </MapView>

        {/* Hamburger flutuante (sem header padrão) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir menu"
          onPress={() => setDrawerVisible(true)}
          style={[styles.hamburgerButton, { top: 12 }]}
        >
          <Icon source="menu" size={22} color={colors.text} />
        </Pressable>

        {/* Botão minimizar/maximizar do mapa (move para metade superior) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Maximizar mapa"
          onPress={() => toggleSplit('mapMax')}
          style={[styles.splitToggleTopRight, { top: 12 }]}
        >
          <Icon
            source={splitMode === 'mapMax' ? 'arrow-collapse' : 'arrow-expand'}
            size={18}
            color={colors.text}
          />
        </Pressable>

        {/* Controles do mapa: localização + tipo */}
        <View style={[styles.mapControls, { top: 64 }]}>
          <MapFloatingButton
            icon={isLocating ? 'crosshairs-question' : 'crosshairs-gps'}
            active={isLocating}
            onPress={focusUserLocation}
          />
          <MapFloatingButton
            icon={mapTypeIndex === 0 ? 'satellite-variant' : 'map'}
            active={mapTypeIndex > 0}
            onPress={() => setMapTypeIndex((p) => (p + 1) % MAP_TYPES.length)}
          />
        </View>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Carregando veículos...</Text>
          </View>
        ) : null}

        {!isLoading && devices.length === 0 ? (
          <View style={styles.emptyPanel}>
            <Icon source="car-off" size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Nenhum veículo atribuído</Text>
            <Text style={styles.emptyText}>
              Peça ao administrador para atribuir veículos a esta conta de resgate.
            </Text>
          </View>
        ) : null}

        {/* Card flutuante sobre o mapa */}
        {selectedDevice && mainCardVisible ? (
          <Animated.View
            style={[
              styles.mainCard,
              {
                height: cardFullHeight,
                transform: [{ translateY: mainCardAnim }],
              },
            ]}
          >
            <View
              accessibilityRole="button"
              style={styles.mainCardDragArea}
              {...mainCardPanResponder.panHandlers}
            >
              <View style={styles.mainCardHandle} />
            </View>
            <View style={styles.mainCardHeader}>
              <Pressable
                style={styles.mainCardTitleWrap}
                onPress={focusSelectedFromTitle}
              >
                <Text style={styles.mainCardTitle} numberOfLines={1}>
                  {selectedDevice.nome}
                  {selectedDevice.placa ? ` — ${selectedDevice.placa}` : ''}
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
                onUploadPhoto={() => {}}
                onRemovePhoto={() => {}}
                isUploading={false}
                onFocusDevice={() => animateToDevice(selectedDevice)}
                modoResgate
              />
            </ScrollView>
          </Animated.View>
        ) : null}
      </Animated.View>

      {/* ── Divisor com botão de split central ───────────────── */}
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resetar layout"
          onPress={() => toggleSplit('normal')}
          style={styles.dividerToggle}
        >
          <Icon
            source={
              splitMode === 'normal'
                ? 'unfold-more-horizontal'
                : 'unfold-less-horizontal'
            }
            size={18}
            color={colors.text}
          />
        </Pressable>
      </View>

      {/* ── Metade inferior: scanner ─────────────────────────── */}
      <Animated.View style={[styles.scannerPanel, { flex: scannerPanelFlex }]}>
        {/* Botão minimizar/maximizar do scanner */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Maximizar scanner"
          onPress={() => toggleSplit('scannerMax')}
          style={styles.splitToggleScanner}
        >
          <Icon
            source={splitMode === 'scannerMax' ? 'arrow-collapse' : 'arrow-expand'}
            size={18}
            color={colors.text}
          />
        </Pressable>
        <TagScanner veiculoAlvo={veiculoAlvo} />
      </Animated.View>

      {/* ── Drawer lateral mínimo (hamburger) ────────────────── */}
      <Modal
        visible={drawerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setDrawerVisible(false)}
      >
        <Pressable style={styles.drawerOverlay} onPress={() => setDrawerVisible(false)}>
          <Pressable style={styles.drawerPanel} onPress={(e) => e.stopPropagation()}>
            <View style={styles.drawerHeader}>
              <Icon source="account-circle" size={48} color={colors.primary} />
              <View style={styles.drawerUserInfo}>
                <Text style={styles.drawerUserName} numberOfLines={1}>
                  {user?.nome ?? 'Usuário'}
                </Text>
                <Text style={styles.drawerUserEmail} numberOfLines={1}>
                  {user?.email}
                </Text>
                <View style={styles.drawerBadge}>
                  <Icon source="life-buoy" size={11} color={colors.primaryText} />
                  <Text style={styles.drawerBadgeText}>Resgate</Text>
                </View>
              </View>
            </View>

            <Pressable
              style={styles.drawerAction}
              onPress={() => {
                setDrawerVisible(false);
                loadDevices();
              }}
            >
              <Icon source="refresh" size={20} color={colors.text} />
              <Text style={styles.drawerActionText}>Recarregar veículos</Text>
            </Pressable>

            <View style={{ flex: 1 }} />

            <Pressable
              style={[styles.drawerAction, styles.drawerLogout]}
              onPress={async () => {
                setDrawerVisible(false);
                await signOut();
                toast.show({ message: 'Sessão encerrada.', type: 'info' });
              }}
            >
              <Icon source="logout" size={20} color={colors.danger} />
              <Text style={[styles.drawerActionText, { color: colors.danger }]}>Sair</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mapPanel: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#dde2e7',
  },
  hamburgerButton: {
    position: 'absolute',
    left: 12,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: colors.surface,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  splitToggleTopRight: {
    position: 'absolute',
    right: 12,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: colors.surface,
    elevation: 3,
  },
  mapControls: {
    position: 'absolute',
    right: 12,
    gap: 8,
  },
  mapButton: {
    margin: 0,
    elevation: 3,
  },
  markerWrap: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    top: '40%',
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
    fontSize: 13,
    fontWeight: '700',
  },
  emptyPanel: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '30%',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    elevation: 4,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  mainCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
    paddingLeft: spacing.lg,
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
  divider: {
    height: 8,
    position: 'relative',
    backgroundColor: colors.background,
  },
  dividerLine: {
    position: 'absolute',
    top: 3,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.border,
  },
  dividerToggle: {
    position: 'absolute',
    alignSelf: 'center',
    top: -10,
    width: 42,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    elevation: 3,
  },
  scannerPanel: {
    position: 'relative',
    backgroundColor: colors.background,
  },
  splitToggleScanner: {
    position: 'absolute',
    right: 12,
    top: 12,
    zIndex: 5,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: colors.surface,
    elevation: 3,
  },
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawerPanel: {
    width: 280,
    height: '100%',
    paddingTop: 48,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    elevation: 10,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    marginBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  drawerUserInfo: {
    flex: 1,
    minWidth: 0,
  },
  drawerUserName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  drawerUserEmail: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  drawerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignSelf: 'flex-start',
  },
  drawerBadgeText: {
    color: colors.primaryText,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  drawerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  drawerActionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  drawerLogout: {
    backgroundColor: '#fff1ef',
  },
});
