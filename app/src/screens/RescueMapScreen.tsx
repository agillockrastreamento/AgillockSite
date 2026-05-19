import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Avatar } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
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
import { useMarkerBitmaps, OffscreenCapturePool } from '../tracking/useMarkerBitmaps';
import { useTrackingWebSocket, updateDeviceFromMessage } from '../tracking/useTrackingWebSocket';
import { buildTraccarDeviceIndex } from '../tracking/trackingService';
import type { TrackingDevice } from '../tracking/trackingTypes';

const DEFAULT_REGION = {
  latitude: -14.235,
  longitude: -51.9253,
  latitudeDelta: 24,
  longitudeDelta: 24,
};

const MAP_TYPES: MapType[] = ['standard', 'satellite', 'hybrid'];
// Usa `screen.height` (tela física inteira, incl. status bar) porque o mapa
// é edge-to-edge. `window.height` em Android translucent exclui a status bar
// e faria a divisória visualmente subir pro lado do mapa.
const SCREEN_HEIGHT = Dimensions.get('screen').height;
const MAIN_CARD_PEEK_HEIGHT = 52;
const DIVIDER_HEIGHT = 16;
const MIN_PANEL_FRACTION = 0.12;
const MAX_PANEL_FRACTION = 0.88;
// Posições de snap do split: scanner grande / igual / mapa grande
const SNAP_POSITIONS = [0.15, 0.5, 0.85];

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
  // Considera "online" só se a última telemetria foi há menos de 15 min,
  // caso contrário marca offline (cor laranja) mesmo tendo última posição.
  const lastFixMs = raw.telemetriaUltimaPosicaoEm
    ? Date.parse(raw.telemetriaUltimaPosicaoEm)
    : 0;
  const isRecent = lastFixMs > 0 && Date.now() - lastFixMs < 15 * 60 * 1000;
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
    status: hasPosition && isRecent ? 'online' : 'offline',
    lastUpdate: raw.telemetriaUltimaPosicaoEm,
    posicao: hasPosition
      ? {
          latitude: raw.telemetriaUltimaLatitude,
          longitude: raw.telemetriaUltimaLongitude,
          ignicao: raw.telemetriaUltimaIgnicao,
          // Se ignição está ligada e fix recente, consideramos em movimento
          emMovimento: !!(raw.telemetriaUltimaIgnicao && isRecent),
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
  const [drawerVisible, setDrawerVisible] = useState(false);

  // Card state
  const [mainCardVisible, setMainCardVisible] = useState(false);
  const [mainCardPeeked, setMainCardPeeked] = useState(false);
  const mainCardPeekedRef = useRef(false);
  mainCardPeekedRef.current = mainCardPeeked;

  // Split contínuo: fração da altura ocupada pelo mapa (0..1).
  // Snapa nas três posições padrão; o usuário pode arrastar livremente
  // pela divisória ou tocar nela pra ciclar entre as posições.
  const splitFraction = useRef(new Animated.Value(0.5)).current;
  const splitFractionRef = useRef(0.5);
  useEffect(() => {
    const id = splitFraction.addListener(({ value }) => {
      splitFractionRef.current = value;
    });
    return () => splitFraction.removeListener(id);
  }, [splitFraction]);

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

  // Altura total disponível para os dois painéis (mapa + scanner).
  // O mapa ocupa edge-to-edge (incluindo o espaço sob a status bar),
  // então só subtraímos o inset de baixo + divisória.
  const containerHeight = SCREEN_HEIGHT - insets.bottom - DIVIDER_HEIGHT;

  // Heights interpolados a partir da fração do split
  const mapPanelHeightAnim = splitFraction.interpolate({
    inputRange: [0, 1],
    outputRange: [0, containerHeight],
  });
  const scannerPanelHeightAnim = splitFraction.interpolate({
    inputRange: [0, 1],
    outputRange: [containerHeight, 0],
  });

  // Card menor para o resgate (deixa mais mapa visível).
  // Como o painel do mapa varia, usamos um valor fixo razoável.
  // Card compacto pra deixar mais mapa visível. Conteúdo do MainVehicleCard
  // em modoResgate é enxuto (status, endereço, bloquear/desbloquear), então
  // 240 acomoda sem cortar nada e pode ser arrastado pra peek a qualquer momento.
  const cardFullHeight = 220;

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

  // Updates em tempo real via WebSocket de rastreamento (mesmo do cliente)
  const traccarDeviceIndex = useMemo(
    () => buildTraccarDeviceIndex(devices),
    [devices],
  );
  const handleWsMessage = useCallback(
    (position: import('../tracking/trackingWebSocket').WsPosition, dispositivoId: string) => {
      setDevices((current) => updateDeviceFromMessage(current, dispositivoId, position));
    },
    [],
  );
  useTrackingWebSocket(devices, traccarDeviceIndex, handleWsMessage);

  // Bitmaps dos marcadores (renderizados offscreen e cacheados como PNG)
  const { getBitmap, pending, onReady } = useMarkerBitmaps(devices, false);

  // Snap o split para uma das três posições padrão
  const snapToPosition = useCallback((target: number) => {
    Animated.spring(splitFraction, {
      toValue: target,
      useNativeDriver: false,
      friction: 9,
      tension: 78,
    }).start();
  }, [splitFraction]);

  // Toque na divisória cicla pelas posições: meio → mapa grande → scanner grande → meio
  const cycleSplit = useCallback(() => {
    const v = splitFractionRef.current;
    let target: number;
    if (v >= 0.7) target = SNAP_POSITIONS[0];          // mapa grande → scanner grande
    else if (v <= 0.3) target = SNAP_POSITIONS[1];     // scanner grande → meio
    else target = SNAP_POSITIONS[2];                    // meio → mapa grande
    snapToPosition(target);
  }, [snapToPosition]);

  // PanResponder para arrastar a divisória verticalmente
  const dragBaseRef = useRef(0.5);
  const dividerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 3,
        onPanResponderGrant: () => {
          dragBaseRef.current = splitFractionRef.current;
        },
        onPanResponderMove: (_, gs) => {
          if (containerHeight <= 0) return;
          const delta = gs.dy / containerHeight;
          const next = Math.max(
            MIN_PANEL_FRACTION,
            Math.min(MAX_PANEL_FRACTION, dragBaseRef.current + delta),
          );
          splitFraction.setValue(next);
        },
        onPanResponderRelease: (_, gs) => {
          // Se foi um tap (sem movimento), cicla; senão snap para o mais próximo.
          const isTap = Math.abs(gs.dy) < 6 && Math.abs(gs.vy) < 0.2;
          if (isTap) {
            cycleSplit();
            return;
          }
          const v = splitFractionRef.current;
          // Considera velocidade pra deixar mais responsivo
          let target = SNAP_POSITIONS[1];
          if (gs.vy < -0.6) target = SNAP_POSITIONS[2];
          else if (gs.vy > 0.6) target = SNAP_POSITIONS[0];
          else {
            // Snap pro mais próximo
            target = SNAP_POSITIONS.reduce((best, p) =>
              Math.abs(p - v) < Math.abs(best - v) ? p : best,
            SNAP_POSITIONS[1]);
          }
          snapToPosition(target);
        },
      }),
    [containerHeight, splitFraction, snapToPosition, cycleSplit],
  );

  const animateToDevice = useCallback((device: TrackingDevice, cardOpen = false) => {
    const coord = getDeviceCoordinate(device);
    if (!coord) return;
    // Quando o card está aberto/abrindo, desloca o centro do mapa pra cima
    // de modo que o marcador fique visível acima da bandeja, não atrás.
    const latitudeOffset = cardOpen
      ? (cardFullHeight / SCREEN_HEIGHT) * 0.011
      : 0;
    mapRef.current?.animateCamera(
      {
        center: {
          latitude: coord.latitude - latitudeOffset,
          longitude: coord.longitude,
        },
        zoom: 16,
      },
      { duration: 420 },
    );
  }, [cardFullHeight]);

  const focusDevice = useCallback(
    (device: TrackingDevice) => {
      const coord = getDeviceCoordinate(device);
      if (!coord) {
        toast.show({ message: 'Este veículo ainda não tem posição.', type: 'info' });
        return;
      }
      setSelectedDeviceId(device.dispositivoId);
      // Anima com offset porque o card vai abrir e cobrir parte inferior do mapa
      animateToDevice(device, true);
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
      // NÃO zera selectedDeviceId — assim o scanner continua trabalhando no veículo.
      // Pra reabrir o card, toque novamente no marcador do mapa.
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

  const currentMapType = MAP_TYPES[mapTypeIndex];

  return (
    <View style={styles.root}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      {/* ── Metade superior: mapa + card flutuante ───────────── */}
      <Animated.View style={[styles.mapPanel, { height: mapPanelHeightAnim }]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          mapType={currentMapType}
          initialRegion={DEFAULT_REGION}
          showsUserLocation
          showsMyLocationButton={false}
          // Empurra a bússola/botões nativos pra baixo dos nossos controles flutuantes
          mapPadding={{ top: insets.top + 60, right: 0, bottom: 0, left: 0 }}
        >
          {devices.map((device) => {
            const coord = getDeviceCoordinate(device);
            if (!coord) return null;
            const bitmapUri = getBitmap(device);
            return (
              <Marker
                key={device.dispositivoId}
                coordinate={coord}
                image={bitmapUri ? { uri: bitmapUri } : undefined}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={!bitmapUri}
                onPress={() => focusDevice(device)}
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
                  </View>
                ) : null}
              </Marker>
            );
          })}
        </MapView>

        <OffscreenCapturePool pending={pending} onReady={onReady} />

        {/* Hamburger flutuante (sem header padrão) — abaixo da status bar */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir menu"
          onPress={() => setDrawerVisible(true)}
          style={[styles.hamburgerButton, { top: insets.top + 8 }]}
        >
          <Icon source="menu" size={22} color={colors.text} />
        </Pressable>

        {/* Controles do mapa: localização + tipo — alinhados ao hamburger */}
        <View style={[styles.mapControls, { top: insets.top + 8 }]}>
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
              <IconButton icon="close" size={18} style={{ margin: 0 }} onPress={closeMainCard} />
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

      {/* ── Divisor arrastável (tap cicla, drag ajusta) ────── */}
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Ajustar divisão entre mapa e scanner"
        style={styles.divider}
        {...dividerPanResponder.panHandlers}
      >
        <View style={styles.dividerLine} />
        <View style={styles.dividerToggle}>
          <Icon
            source="drag-horizontal-variant"
            size={14}
            color={colors.text}
          />
        </View>
      </View>

      {/* ── Metade inferior: scanner ─────────────────────────── */}
      <Animated.View style={[styles.scannerPanel, { height: scannerPanelHeightAnim }]}>
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
            {/* Brand header (mesmo estilo do drawer do cliente) */}
            <View style={styles.drawerBrandHeader}>
              <View style={styles.drawerBrandRow}>
                <View style={styles.drawerLogoTile}>
                  <Image
                    source={require('../../assets/agillock_new_symbol.png')}
                    style={styles.drawerLogo}
                    resizeMode="contain"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.drawerBrandTitle}>AgilLock</Text>
                  <Text style={styles.drawerBrandSubtitle}>Resgate</Text>
                </View>
              </View>
            </View>

            {/* Menu de ações */}
            <View style={styles.drawerNavArea}>
              <Text style={styles.drawerNavLabel}>Menu</Text>
              <Pressable
                style={styles.drawerNavItem}
                onPress={() => {
                  setDrawerVisible(false);
                  loadDevices();
                }}
              >
                <Icon source="refresh" size={22} color={colors.text} />
                <Text style={styles.drawerNavItemText}>Recarregar veículos</Text>
              </Pressable>
            </View>

            <View style={{ flex: 1 }} />

            {/* Perfil + sair */}
            <View style={styles.drawerProfileArea}>
              <View style={styles.drawerProfileCard}>
                <Avatar.Text
                  size={52}
                  label={(user?.nome ?? 'RG').slice(0, 2).toUpperCase()}
                  color={colors.primaryText}
                  style={{ backgroundColor: colors.primary }}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.drawerProfileName} numberOfLines={1}>
                    {user?.nome ?? 'Usuário'}
                  </Text>
                  <Text style={styles.drawerProfileEmail} numberOfLines={1}>
                    {user?.email}
                  </Text>
                </View>
              </View>

              <Pressable
                style={styles.drawerLogoutBtn}
                onPress={async () => {
                  setDrawerVisible(false);
                  await signOut();
                  toast.show({ message: 'Sessão encerrada.', type: 'info' });
                }}
              >
                <Icon source="logout" size={20} color={colors.danger} />
                <Text style={styles.drawerLogoutText}>Sair</Text>
              </Pressable>
            </View>
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
  mapControls: {
    position: 'absolute',
    right: 12,
    gap: 8,
  },
  mapButton: {
    margin: 0,
    elevation: 3,
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
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainCardHandle: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  mainCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.md,
    paddingRight: 2,
    minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mainCardTitleWrap: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  mainCardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  divider: {
    height: DIVIDER_HEIGHT,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  dividerLine: {
    position: 'absolute',
    top: DIVIDER_HEIGHT / 2 - 1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.border,
  },
  dividerToggle: {
    width: 44,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
  },
  scannerPanel: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawerPanel: {
    width: 296,
    height: '100%',
    backgroundColor: colors.surface,
    elevation: 10,
  },
  drawerBrandHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
    paddingBottom: spacing.lg,
  },
  drawerBrandRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.loginBackgroundStart,
  },
  drawerLogoTile: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  drawerLogo: {
    width: 32,
    height: 32,
  },
  drawerBrandTitle: {
    color: colors.surface,
    fontSize: 18,
    fontWeight: '900',
  },
  drawerBrandSubtitle: {
    marginTop: 2,
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 11,
    fontWeight: '700',
  },
  drawerNavArea: {
    paddingHorizontal: spacing.sm,
  },
  drawerNavLabel: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  drawerNavItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.sm,
    marginVertical: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  drawerNavItemText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  drawerProfileArea: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  drawerProfileCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  drawerProfileName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  drawerProfileEmail: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
  },
  drawerLogoutBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#fff1ef',
  },
  drawerLogoutText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '900',
  },
});
