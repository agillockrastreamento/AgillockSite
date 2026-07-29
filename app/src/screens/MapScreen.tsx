import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Image,
  type ListRenderItemInfo,
  PanResponder,
  Platform,
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
  Polygon,
  Polyline,
  PROVIDER_GOOGLE,
  type LatLng,
  type MapType,
} from 'react-native-maps';
import { Icon, IconButton } from 'react-native-paper';

import { useAuth } from '../auth/AuthProvider';
import { SearchBottomSheet } from '../components/SearchBottomSheet';
import { MapDevicesSheet } from '../components/MapDevicesSheet';
import { NotificationsBottomSheet } from '../components/NotificationsBottomSheet';
import { useConfirmDialog } from '../components/ConfirmDialogProvider';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import { useTrackingWebSocket, aplicarPosicoesEmLote } from '../tracking/useTrackingWebSocket';
import {
  buildTraccarDeviceIndex,
  getTrackingAccessStatus,
  getTrackingSnapshot,
} from '../tracking/trackingService';
import { apiRequest } from '../services/api/apiClient';
import {
  getGeofences,
  parseCircleArea,
  parsePolygonArea,
  type Geofence,
} from '../tracking/geofenceService';
import type { TrackingAccessStatus, TrackingDevice } from '../tracking/trackingTypes';
import { VehicleIcon } from '../tracking/VehicleIcon';
import { IconMarker } from '../tracking/IconMarker';
import { RoutePolyline } from '../tracking/RoutePolyline';
import { useMarkerBitmaps, OffscreenCapturePool } from '../tracking/useMarkerBitmaps';
import { useClusterBitmaps, ClusterCapturePool, ClusterIcon } from '../tracking/useClusterBitmaps';
import {
  cursoDoCard,
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
import { useValorEspacado } from '../utils/useValorEspacado';
import type { ClienteDrawerParamList, RootStackParamList } from '../navigation/routes';

const DEFAULT_REGION = {
  latitude: -14.235,
  longitude: -51.9253,
  latitudeDelta: 24,
  longitudeDelta: 24,
};

const isIOS = Platform.OS === 'ios';

const MAP_TYPES: MapType[] = ['standard', 'satellite', 'terrain', 'hybrid'];
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;
const MAIN_CARD_HEIGHT = Math.round(SCREEN_HEIGHT * 0.60);
const MAIN_CARD_PEEK_HEIGHT = 76; // mostra apenas alça + header (nome/placa + X)
const MAP_PREFERENCES_KEY = 'agillock_map_preferences_v1';
const MAP_SELECAO_KEY = 'agillock_map_selecao_v1';
// Teto de veículos desenhados no mapa. Acima disso o mapa engasga no Android e
// chega a derrubar o app no iOS ao aproximar o zoom (cada marcador é uma view
// nativa que o mapa refotografa). Quem tem mais que isso escolhe quais quer ver
// pelo botão do topo; a busca continua enxergando a frota inteira.
const LIMITE_MAPA = 40;
const CLUSTER_PX = 40;
const SPIDER_RADIUS_PX = 55;
// Posições do WebSocket são acumuladas e aplicadas de uma vez. Com centenas de
// veículos chegavam dezenas de mensagens por segundo, cada uma re-renderizando
// a tela inteira (marcadores + lista + clusters).
const WS_FLUSH_MS = 700;
// Acima disto o marcador não renderiza o ícone como filho enquanto o bitmap não
// fica pronto: `tracksViewChanges` obriga o mapa a re-fotografar cada view a
// cada frame — com centenas de marcadores isso trava e derruba o app.
const MARKER_CHILDREN_LIMIT = 60;
// Altura fixa dos cards da lista de veículos (2 por linha).
const QUICK_CARD_HEIGHT = 108;
const QUICK_ROW_HEIGHT = QUICK_CARD_HEIGHT + spacing.sm;
// A gaveta de veículos e o modal de busca mostram nome, placa, velocidade e
// ícone — nada que precise acompanhar o mapa em tempo real. Espaçar as
// atualizações libera a thread de JS justamente enquanto o usuário rola.
const LISTA_INTERVALO_MS = 3000;
// Rastro ("Rastro" na gaveta de camadas): acima deste número de veículos só o
// focado ganha rota, e as requisições saem em blocos.
const TRACKS_LIMITE = 40;
const TRACKS_CONCORRENCIA = 6;

function getMapaDoDevice(d: TrackingDevice): 1 | 2 {
  const m = Number(d.mapa);
  return m === 2 ? 2 : 1;
}

// Cerca segue o(s) dispositivo(s) vinculado(s): aparece só no mapa ativo correspondente.
// Cerca sem dispositivo vinculado (sem mapa) aparece em qualquer mapa.
function cercaNoMapaAtivo(g: Geofence, mapaAtivo: 1 | 2): boolean {
  if (!Array.isArray(g.mapas) || g.mapas.length === 0) return true;
  return g.mapas.includes(mapaAtivo);
}

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

type SelecaoPorMapa = { 1: string[] | null; 2: string[] | null };

const SELECAO_VAZIA: SelecaoPorMapa = { 1: null, 2: null };

/**
 * Corta a lista do mapa no teto de `LIMITE_MAPA`.
 *
 * - Até o limite, nada muda: aparecem todos.
 * - Acima dele vale a escolha do usuário (`selecao`); sem escolha, os primeiros
 *   da lista, para o mapa nunca abrir vazio.
 * - O veículo focado entra sempre, mesmo fora da escolha: é o que permite achar
 *   pela busca alguém que não está entre os selecionados e vê-lo no mapa.
 */
function aplicarLimiteMapa(
  devices: TrackingDevice[],
  selecao: string[] | null,
  focadoId: string | null,
): TrackingDevice[] {
  let base: TrackingDevice[];
  if (devices.length <= LIMITE_MAPA) {
    base = devices;
  } else if (selecao && selecao.length) {
    const ids = new Set(selecao);
    const escolhidos = devices.filter((d) => ids.has(d.dispositivoId)).slice(0, LIMITE_MAPA);
    // Escolha antiga apontando só para veículos que sumiram: volta ao automático.
    base = escolhidos.length ? escolhidos : devices.slice(0, LIMITE_MAPA);
  } else {
    base = devices.slice(0, LIMITE_MAPA);
  }

  if (focadoId && !base.some((d) => d.dispositivoId === focadoId)) {
    const focado = devices.find((d) => d.dispositivoId === focadoId);
    if (focado) return [...base, focado];
  }
  return base;
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
  // iOS: ícone como filho + re-snapshot via tracksViewChanges (sem bitmap/key).
  if (isIOS) {
    return (
      <IconMarker
        signature={`cluster-${count}`}
        coordinate={{ latitude: lat, longitude: lng }}
        anchor={{ x: 0.5, y: 0.5 }}
        zIndex={500}
        onPress={onPress}
      >
        <ClusterIcon count={count} />
      </IconMarker>
    );
  }
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
  const { can: canPerm } = useAuth();
  const canVerCerca = canPerm('rastreamento.verCerca') || canPerm('rastreamento.criarCerca');
  const canVerEventos = canPerm('rastreamento.verEventos');
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
  const [devicesSheetVisible, setDevicesSheetVisible] = useState(false);
  // Quais veículos o usuário escolheu ver no mapa, por mapa (1 e 2).
  // `null` = automático (os primeiros do limite).
  const [selecaoMapa, setSelecaoMapa] = useState<SelecaoPorMapa>(SELECAO_VAZIA);
  const selecaoMapaRef = useRef(selecaoMapa);
  selecaoMapaRef.current = selecaoMapa;
  const [selecaoMapaCarregada, setSelecaoMapaCarregada] = useState(false);
  const avisoLimiteMostradoRef = useRef(false);
  const [notificationsSheetVisible, setNotificationsSheetVisible] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // Eventos recebidos aguardando o próximo lote do WebSocket (ver flushWsBuffer).
  const eventosPendentesRef = useRef(0);
  const [layersDrawerVisible, setLayersDrawerVisible] = useState(false);
  const [currentRegion, setCurrentRegion] = useState<{
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  }>(DEFAULT_REGION);
  const [spiderClusterKey, setSpiderClusterKey] = useState<string | null>(null);
  const [mapaAtivo, setMapaAtivo] = useState<1 | 2>(1);
  const mapaAtivoHydrated = useRef(false);
  const lastSpiderInteractionRef = useRef(0);
  const quickSheetModeBeforeFocusRef = useRef<QuickSheetMode | null>(null);
  const moveQuickSheetRef = useRef<((mode: QuickSheetMode) => void) | null>(null);
  const mapPreferencesHydrated = useRef(false);

  // Main card animation
  const mainCardAnim = useRef(new Animated.Value(MAIN_CARD_HEIGHT)).current;
  // Track last centered position to avoid redundant map moves
  const lastCenteredKey = useRef('');

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

  // A escolha de quais veículos ficam no mapa é trabalhosa de refazer — sobrevive
  // ao fechamento do app.
  useEffect(() => {
    let cancelled = false;
    const carregarSelecao = async () => {
      try {
        const raw = await AsyncStorage.getItem(MAP_SELECAO_KEY);
        if (!raw || cancelled) return;
        const salvo = JSON.parse(raw) as Partial<SelecaoPorMapa>;
        const normalizar = (v: unknown) =>
          Array.isArray(v) && v.every((id) => typeof id === 'string')
            ? (v as string[]).slice(0, LIMITE_MAPA)
            : null;
        setSelecaoMapa({ 1: normalizar(salvo?.[1]), 2: normalizar(salvo?.[2]) });
      } catch {
        await AsyncStorage.removeItem(MAP_SELECAO_KEY);
      } finally {
        if (!cancelled) setSelecaoMapaCarregada(true);
      }
    };
    carregarSelecao();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selecaoMapaCarregada) return;
    AsyncStorage.setItem(MAP_SELECAO_KEY, JSON.stringify(selecaoMapa)).catch(() => {});
  }, [selecaoMapa, selecaoMapaCarregada]);

  // O app sempre abre no Mapa 1 — não restauramos nem persistimos o último mapa
  // visto (decisão de produto). O flag apenas libera os efeitos que dependem de
  // troca de mapa pelo usuário; mantido assíncrono (microtask) para não disparar
  // no mount inicial.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) mapaAtivoHydrated.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  // Quando o mapa ativo muda, fecha o card se o veículo selecionado pertencer ao outro mapa
  // e reposiciona o zoom para os veículos do novo mapa.
  useEffect(() => {
    if (!mapaAtivoHydrated.current) return;
    if (selectedDeviceId) {
      const device = devices.find((d) => d.dispositivoId === selectedDeviceId);
      if (device && getMapaDoDevice(device) !== mapaAtivo) {
        setSelectedDeviceId(null);
        if (mainCardVisible) closeMainCard();
      }
    }
    // Enquadra só o que vai aparecer: com o teto ativo, incluir os cortados
    // daria um zoom bem mais aberto do que os veículos desenhados pedem.
    const doMapa = devices.filter((d) => getMapaDoDevice(d) === mapaAtivo);
    fitAllDevices(aplicarLimiteMapa(doMapa, selecaoMapaRef.current[mapaAtivo], null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapaAtivo]);

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
    if (!canVerEventos) return;
    const loadUnreadCount = async () => {
      const { getUnreadCount } = await import('../notifications/notificationService');
      const count = await getUnreadCount();
      setUnreadCount(count);
    };
    loadUnreadCount();
  }, [canVerEventos]);

  useEffect(() => {
    if (!notificationsSheetVisible) return;
    // Descarta também o que estava só acumulado à espera do próximo lote.
    eventosPendentesRef.current = 0;
    setUnreadCount(0);
  }, [notificationsSheetVisible]);

  const mapasUsados = useMemo(() => {
    const set = new Set<1 | 2>();
    devices.forEach((d) => set.add(getMapaDoDevice(d)));
    return set;
  }, [devices]);
  const seletorVisivel = mapasUsados.size > 1;

  // Quando há apenas um mapa em uso, sincroniza `mapaAtivo` com ele.
  useEffect(() => {
    if (mapasUsados.size === 1) {
      const unico = mapasUsados.values().next().value as 1 | 2;
      if (mapaAtivo !== unico) setMapaAtivo(unico);
    }
  }, [mapasUsados, mapaAtivo]);

  const filteredDevices = useMemo(
    () => devices.filter((device) => getMapaDoDevice(device) === mapaAtivo),
    [devices, mapaAtivo],
  );

  const selecaoAtual = selecaoMapa[mapaAtivo];
  const acimaDoLimite = filteredDevices.length > LIMITE_MAPA;

  // O que de fato é desenhado no mapa (marcadores, clusters) e listado na
  // gaveta. Tudo que vem depois daqui trabalha em cima desta lista.
  const devicesVisiveis = useMemo(
    () => aplicarLimiteMapa(filteredDevices, selecaoAtual, selectedDeviceId),
    [filteredDevices, selecaoAtual, selectedDeviceId],
  );

  // Versão da lista para os cards (gaveta). O mapa continua usando
  // `devicesVisiveis`, que acompanha cada posição recebida.
  // Trocar de mapa ou ganhar/perder um veículo aparece na hora; só as
  // atualizações de posição é que são espaçadas.
  const devicesParaLista = useValorEspacado(
    devicesVisiveis,
    LISTA_INTERVALO_MS,
    `${mapaAtivo}:${devicesVisiveis.length}:${selectedDeviceId ?? ''}`,
  );

  // Busca e notificações enxergam a frota inteira do mapa ativo: o teto existe
  // para o mapa não travar, não para esconder veículo do usuário. Escolher um
  // que está fora dos selecionados o traz para o mapa (ver `aplicarLimiteMapa`).
  const todosParaLista = useValorEspacado(
    filteredDevices,
    LISTA_INTERVALO_MS,
    `todos:${mapaAtivo}:${filteredDevices.length}`,
  );

  // Avisa uma vez por sessão que o mapa está cortando a frota — só para quem
  // ainda não escolheu seus veículos (quem já escolheu sabe do corte).
  useEffect(() => {
    if (!acimaDoLimite || !selecaoMapaCarregada || avisoLimiteMostradoRef.current) return;
    if (selecaoAtual && selecaoAtual.length) return;
    avisoLimiteMostradoRef.current = true;
    toast.show({
      message: `Mostrando ${LIMITE_MAPA} de ${filteredDevices.length} veículos. Toque no ícone de veículos no topo para escolher quais.`,
      type: 'info',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acimaDoLimite, selecaoMapaCarregada]);

  const filteredGeofences = useMemo(
    () => geofences.filter((g) => cercaNoMapaAtivo(g, mapaAtivo)),
    [geofences, mapaAtivo],
  );

  const quickSheetHeights = useMemo(() => getQuickSheetHeights(devicesVisiveis.length), [devicesVisiveis.length]);
  const quickSheetHeight = useRef(new Animated.Value(Math.round(SCREEN_HEIGHT * 0.3))).current;

  useEffect(() => {
    if (devicesVisiveis.length > 0) {
      Animated.spring(quickSheetHeight, {
        toValue: quickSheetHeights[quickSheetMode],
        useNativeDriver: false,
        friction: 8,
        tension: 82,
      }).start();
    }
  }, [devicesVisiveis.length, quickSheetHeights, quickSheetHeight, quickSheetMode]);

  const locatedDevices = useMemo(
    () => devicesVisiveis.filter((device) => !!getDeviceCoordinate(device)),
    [devicesVisiveis],
  );

  // Só vira marcador quem está na área visível (com folga de 75% para o ícone
  // não "pipocar" na borda durante o gesto, já que a região só é reportada ao
  // fim dele). Cada marcador é uma view nativa: criar centenas delas fora da
  // tela era desperdício puro — quem está longe volta a aparecer no zoom out,
  // agrupado em cluster.
  const devicesNaViewport = useMemo(() => {
    const { latitude, longitude, latitudeDelta, longitudeDelta } = currentRegion;
    if (!Number.isFinite(latitudeDelta) || !Number.isFinite(longitudeDelta)) {
      return locatedDevices;
    }
    const margemLat = latitudeDelta * 0.75;
    const margemLng = longitudeDelta * 0.75;
    const minLat = latitude - latitudeDelta / 2 - margemLat;
    const maxLat = latitude + latitudeDelta / 2 + margemLat;
    const minLng = longitude - longitudeDelta / 2 - margemLng;
    const maxLng = longitude + longitudeDelta / 2 + margemLng;

    return locatedDevices.filter((device) => {
      const lat = device.posicao?.latitude as number;
      const lng = device.posicao?.longitude as number;
      return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
    });
  }, [locatedDevices, currentRegion]);
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

  // Agrupamento por grade: cada veículo só é comparado com os das 9 células
  // vizinhas, em vez de com todos os outros. A versão anterior era O(n²) —
  // com 300 veículos eram ~45 mil comparações a cada posição recebida e a cada
  // movimento do mapa, o que segurava a thread de JS.
  const clusterGroups = useMemo(() => {
    type Grupo = { key: string; devices: TrackingDevice[]; lat: number; lng: number };
    if (!devicesNaViewport.length) return [] as Grupo[];

    const latPorPx = pxToLatDeg || 1;
    const lngPorPx = pxToLngDeg || 1;
    const celulaLat = latPorPx * CLUSTER_PX;
    const celulaLng = lngPorPx * CLUSTER_PX;

    type Entrada = { device: TrackingDevice; lat: number; lng: number; gx: number; gy: number };
    const entradas: Entrada[] = [];
    const celulas = new Map<string, Entrada[]>();

    for (const device of devicesNaViewport) {
      const coord = getDeviceCoordinate(device);
      if (!coord) continue;
      const gx = Math.floor(coord.longitude / celulaLng);
      const gy = Math.floor(coord.latitude / celulaLat);
      const entrada: Entrada = { device, lat: coord.latitude, lng: coord.longitude, gx, gy };
      entradas.push(entrada);
      const chave = `${gx}:${gy}`;
      const lista = celulas.get(chave);
      if (lista) lista.push(entrada);
      else celulas.set(chave, [entrada]);
    }

    const visited = new Set<string>();
    const groups: Grupo[] = [];

    for (const base of entradas) {
      if (visited.has(base.device.dispositivoId)) continue;
      visited.add(base.device.dispositivoId);
      const group: TrackingDevice[] = [base.device];
      let somaLat = base.lat;
      let somaLng = base.lng;
      let menorId = base.device.dispositivoId;

      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const vizinhos = celulas.get(`${base.gx + dx}:${base.gy + dy}`);
          if (!vizinhos) continue;
          for (const outro of vizinhos) {
            if (visited.has(outro.device.dispositivoId)) continue;
            const dxPx = (outro.lng - base.lng) / lngPorPx;
            const dyPx = (outro.lat - base.lat) / latPorPx;
            if (Math.hypot(dxPx, dyPx) > CLUSTER_PX) continue;
            visited.add(outro.device.dispositivoId);
            group.push(outro.device);
            somaLat += outro.lat;
            somaLng += outro.lng;
            if (outro.device.dispositivoId < menorId) menorId = outro.device.dispositivoId;
          }
        }
      }

      groups.push({
        // Chave estável para o conjunto (usada pelo spider) sem concatenar
        // centenas de ids a cada recálculo.
        key: `${menorId}|${group.length}`,
        devices: group,
        lat: somaLat / group.length,
        lng: somaLng / group.length,
      });
    }

    return groups;
  }, [devicesNaViewport, pxToLatDeg, pxToLngDeg]);

  const clusterCounts = useMemo(
    () => clusterGroups.filter((g) => g.devices.length > 1).map((g) => g.devices.length),
    [clusterGroups],
  );
  const {
    getClusterBitmap,
    pending: clusterPending,
    onReady: onClusterReady,
  } = useClusterBitmaps(clusterCounts, !isIOS);

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

  // Só os veículos que viram um marcador individual na tela. Antes o hook
  // recebia TODOS os dispositivos e capturava um bitmap para cada um, mesmo os
  // que estavam escondidos dentro de um cluster.
  const markerDevices = useMemo(() => {
    if (mainCardVisible && selectedDevice) return [selectedDevice];
    const lista: TrackingDevice[] = [];
    for (const group of clusterGroups) {
      if (group.devices.length === 1) lista.push(group.devices[0]);
      else if (spiderClusterKey === group.key) lista.push(...group.devices);
    }
    return lista;
  }, [clusterGroups, spiderClusterKey, mainCardVisible, selectedDevice]);

  // No iOS o ícone é renderizado como filho do Marker (sem bitmap) — desliga a
  // captura para não rodar captureRef em massa (custo/crash sob Fabric).
  const { getBitmap } = useMarkerBitmaps(markerDevices, showLabels, !isIOS);
  // Com muitos marcadores na tela, o fallback "ícone como filho" (que exige
  // tracksViewChanges) é caro demais — nesse caso esperamos o bitmap.
  const usarIconeComoFilho = markerDevices.length <= MARKER_CHILDREN_LIMIT;

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

  // Refs mantêm a identidade do renderItem estável — trocá-la faz a FlatList
  // re-renderizar todas as células visíveis.
  const focusDeviceRef = useRef(focusDevice);
  focusDeviceRef.current = focusDevice;
  const devicesRef = useRef(devices);
  devicesRef.current = devices;

  const aplicarSelecaoDoMapa = useCallback(
    (ids: string[]) => {
      // Sem nada marcado voltamos ao automático — o mapa nunca fica vazio.
      const proxima = ids.length ? ids.slice(0, LIMITE_MAPA) : null;
      setSelecaoMapa((atual) => ({ ...atual, [mapaAtivo]: proxima }));
      // Reenquadra no novo conjunto, exceto quando o usuário está acompanhando
      // um veículo (aí o mapa deve continuar nele).
      if (mainCardVisible) return;
      const doMapa = devicesRef.current.filter((d) => getMapaDoDevice(d) === mapaAtivo);
      fitAllDevices(aplicarLimiteMapa(doMapa, proxima, null));
    },
    [mapaAtivo, mainCardVisible, fitAllDevices],
  );

  // A célula pode não ter sido redesenhada desde a última posição recebida, e a
  // lista é atualizada de forma espaçada — por isso buscamos o dispositivo
  // atual pelo id em vez de usar o objeto capturado na closure.
  const focusDeviceById = useCallback((dispositivoId: string) => {
    const atual = devicesRef.current.find((d) => d.dispositivoId === dispositivoId);
    if (atual) focusDeviceRef.current(atual, true);
  }, []);

  const renderQuickCard = useCallback(
    ({ item }: ListRenderItemInfo<TrackingDevice>) => (
      <View style={styles.quickGridItem}>
        <QuickVehicleCard
          device={item}
          selected={selectedDeviceId === item.dispositivoId}
          onPress={() => focusDeviceById(item.dispositivoId)}
        />
      </View>
    ),
    [selectedDeviceId, focusDeviceById],
  );

  const quickKeyExtractor = useCallback((item: TrackingDevice) => item.dispositivoId, []);

  const quickGetItemLayout = useCallback(
    (_data: ArrayLike<TrackingDevice> | null | undefined, index: number) => ({
      length: QUICK_ROW_HEIGHT,
      offset: QUICK_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

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
      const doMapa = snapshot.filter((d) => getMapaDoDevice(d) === mapaAtivo);
      fitAllDevices(aplicarLimiteMapa(doMapa, selecaoMapaRef.current[mapaAtivo], null));
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : 'Não foi possível carregar o rastreamento.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [fitAllDevices, toast, mapaAtivo]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: seletorVisivel
        ? () => (
            <View style={styles.mapaSeletor}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: mapaAtivo === 1 }}
                style={[styles.mapaSeletorOpt, mapaAtivo === 1 && styles.mapaSeletorOptAtivo]}
                onPress={() => setMapaAtivo(1)}
              >
                <Text style={[styles.mapaSeletorText, mapaAtivo === 1 && styles.mapaSeletorTextAtivo]}>Mapa 1</Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: mapaAtivo === 2 }}
                style={[styles.mapaSeletorOpt, mapaAtivo === 2 && styles.mapaSeletorOptAtivo]}
                onPress={() => setMapaAtivo(2)}
              >
                <Text style={[styles.mapaSeletorText, mapaAtivo === 2 && styles.mapaSeletorTextAtivo]}>Mapa 2</Text>
              </Pressable>
            </View>
          )
        : 'Mapa',
      headerRight: () => (
        <View style={styles.headerButtons}>
          {/* Só aparece para quem tem mais veículos do que o mapa aguenta. */}
          {acimaDoLimite ? (
            <IconButton
              icon="car-multiple"
              iconColor={colors.surface}
              size={22}
              accessibilityLabel="Escolher veículos no mapa"
              onPress={() => setDevicesSheetVisible(true)}
            />
          ) : null}
          <IconButton icon="magnify" iconColor={colors.surface} size={22} onPress={() => setSearchSheetVisible(true)} />
          {canVerEventos ? (
            <>
              <IconButton icon="bell-outline" iconColor={colors.surface} size={22} onPress={() => setNotificationsSheetVisible(true)} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              )}
            </>
          ) : null}
        </View>
      ),
    });
  }, [navigation, unreadCount, canVerEventos, mapaAtivo, seletorVisivel, acimaDoLimite]);

  useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

  useEffect(() => {
    if (!showFences || !canVerCerca) { setGeofences([]); return; }
    getGeofences().then(setGeofences).catch(() => {});
  }, [showFences, canVerCerca]);

  // Identidade estável da lista de dispositivos localizados. `locatedDevices`
  // muda de referência a cada posição recebida; usá-lo como dependência fazia o
  // rastro recarregar o histórico de TODOS os veículos (uma requisição por
  // veículo) a cada atualização do WebSocket.
  const locatedDevicesKey = useMemo(
    () => locatedDevices.map((d) => d.dispositivoId).join(','),
    [locatedDevices],
  );
  const locatedDevicesRef = useRef(locatedDevices);
  locatedDevicesRef.current = locatedDevices;

  // Com muitos veículos o rastro segue a seleção, então o veículo focado entra
  // nas dependências. Com poucos, todos têm rota e trocar de foco não deve
  // recarregar nada.
  const muitosParaRastro = locatedDevices.length > TRACKS_LIMITE;
  const rastroSegueSelecao = muitosParaRastro ? selectedDeviceId ?? '' : '';
  const avisoRastroMostradoRef = useRef(false);
  useEffect(() => {
    if (!showTracks) avisoRastroMostradoRef.current = false;
  }, [showTracks]);

  useEffect(() => {
    if (!showTracks) { setTracks([]); return; }
    let cancelado = false;

    const loadAllTracks = async () => {
      setIsLoadingTracks(true);
      try {
        const now = new Date();
        const from = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
        const to = now.toISOString();

        // Acima do teto, o rastro sai só do veículo focado. Buscar o histórico
        // de centenas de veículos são centenas de requisições e centenas de
        // polylines no mapa — trava o app e castiga o servidor à toa.
        const todos = locatedDevicesRef.current;
        const focado = selectedDeviceRef.current;
        const alvos = todos.length > TRACKS_LIMITE
          ? (focado ? [focado] : [])
          : todos;

        if (todos.length > TRACKS_LIMITE && !avisoRastroMostradoRef.current) {
          avisoRastroMostradoRef.current = true;
          toast.show({
            message: focado
              ? 'Muitos veículos: mostrando o rastro apenas do veículo selecionado.'
              : 'Muitos veículos: selecione um veículo para ver o rastro dele.',
            type: 'info',
          });
        }

        const carregarUm = async (device: TrackingDevice) => {
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
        };

        // Em blocos, para não abrir dezenas de conexões de uma vez.
        const results: ({ deviceId: string; coords: { latitude: number; longitude: number }[] } | null)[] = [];
        for (let i = 0; i < alvos.length; i += TRACKS_CONCORRENCIA) {
          if (cancelado) return;
          const bloco = alvos.slice(i, i + TRACKS_CONCORRENCIA);
          results.push(...(await Promise.all(bloco.map(carregarUm))));
        }

        if (cancelado) return;
        setTracks(results.filter((r): r is { deviceId: string; coords: { latitude: number; longitude: number }[] } => r !== null));
      } finally {
        if (!cancelado) setIsLoadingTracks(false);
      }
    };

    loadAllTracks();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTracks, locatedDevicesKey, rastroSegueSelecao]);

  const handleGeofenceCreated = useCallback(() => {
    setShowFences(true);
    getGeofences().then(setGeofences).catch(() => {});
  }, []);

  // Acumula as posições recebidas e aplica todas de uma vez a cada WS_FLUSH_MS.
  // Antes cada posição disparava um setDevices próprio: com 300 veículos isso
  // recriava a lista inteira dezenas de vezes por segundo, e cada recriação
  // reprocessava clusters, marcadores e a lista da gaveta.
  const wsBufferRef = useRef(new Map<string, import('../tracking/trackingWebSocket').WsPosition>());
  const wsFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agendarFlushWs = useCallback((flush: () => void) => {
    if (wsFlushTimerRef.current) return;
    wsFlushTimerRef.current = setTimeout(flush, WS_FLUSH_MS);
  }, []);

  const flushWsBuffer = useCallback(() => {
    wsFlushTimerRef.current = null;

    const novosEventos = eventosPendentesRef.current;
    eventosPendentesRef.current = 0;
    if (novosEventos > 0) setUnreadCount((atual) => atual + novosEventos);

    const buffer = wsBufferRef.current;
    if (buffer.size === 0) return;
    wsBufferRef.current = new Map();
    setDevices((current) => aplicarPosicoesEmLote(current, buffer));
  }, []);

  const handleWebSocketMessage = useCallback(
    (position: import('../tracking/trackingWebSocket').WsPosition, dispositivoId: string) => {
      wsBufferRef.current.set(dispositivoId, position);
      agendarFlushWs(flushWsBuffer);
    },
    [agendarFlushWs, flushWsBuffer],
  );

  useEffect(() => () => {
    if (wsFlushTimerRef.current) clearTimeout(wsFlushTimerRef.current);
  }, []);

  const handleWebSocketEvent = useCallback(() => {
    if (notificationsSheetVisible) return;
    eventosPendentesRef.current += 1;
    agendarFlushWs(flushWsBuffer);
  }, [notificationsSheetVisible, agendarFlushWs, flushWsBuffer]);

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
    // O seletor de fotos do sistema (Android/iOS) não exige permissão de mídia.
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
            const color = getMarkerColor(device);
            // Arredondado em 15°, igual ao bitmap do Android e à assinatura do
            // iOS. Desenhar o ângulo cru aqui deixava o ícone fora de sincronia
            // com o que dispara o re-snapshot: no iOS o mapa só refotografa a
            // view quando a assinatura muda, então um ângulo intermediário
            // capturado no meio da janela aparecia como tremido.
            const curso = cursoDoCard(device);
            const label = device.placa ?? device.nome ?? '';
            // Construído sob demanda: no Android a maioria dos marcadores usa o
            // bitmap e não desenha filho nenhum — montar essa árvore para todos
            // gerava milhares de elementos descartados a cada atualização.
            const montarMarkerContent = () => (
              <View style={styles.markerContainer} collapsable={false}>
                <View style={styles.markerWrap}>
                  <VehicleIcon
                    categoria={device.categoria}
                    color={color}
                    course={curso}
                    size={58}
                  />
                </View>
                {showLabels ? (
                  <View style={styles.markerLabelWrap}>
                    <View style={styles.markerLabelPointer} />
                    <View style={styles.markerLabel}>
                      <Text style={styles.markerLabelText} numberOfLines={1}>
                        {label}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>
            );

            // iOS/Fabric: NUNCA remontar o Marker via key (derruba o app) nem
            // confiar no prop `image` (não reaplica). Renderiza o ícone como
            // filho e re-snapshota via tracksViewChanges quando o conteúdo muda
            // (cor/curso/label/etiqueta) — assim rotação, cor e etiqueta
            // atualizam na hora.
            if (isIOS) {
              return (
                <IconMarker
                  key={`dev-${device.dispositivoId}${isSpiderMarker ? '-spider' : ''}`}
                  // Cada mudança de assinatura liga `tracksViewChanges` por meio
                  // segundo, e no iOS isso é o principal custo do mapa — daí o
                  // curso entrar já arredondado em 15°.
                  signature={`${color}|${curso}|${label}|${showLabels ? 1 : 0}`}
                  coordinate={coord}
                  anchor={{ x: 0.5, y: 0.5 }}
                  zIndex={isSpiderMarker ? 1000 : 100}
                  onPress={() => {
                    if (isSpiderMarker) closeSpiderFromMarker();
                    focusDevice(device, true);
                  }}
                >
                  {montarMarkerContent()}
                </IconMarker>
              );
            }

            // Android: o `image` não reaplica em update — o bitmap entra na key
            // para remontar quando o ícone muda (remontar é seguro no Android).
            const bitmapUri = getBitmap(device);
            // Sem bitmap ainda: só desenhamos o ícone como filho (o que exige
            // tracksViewChanges) quando há poucos marcadores. Com muitos, o
            // marcador padrão aparece por um instante até o bitmap ficar pronto.
            const desenharFilho = !bitmapUri && usarIconeComoFilho;
            return (
              <Marker
                key={`dev-${device.dispositivoId}${isSpiderMarker ? '-spider' : ''}-${bitmapUri ?? 'pending'}`}
                coordinate={coord}
                image={bitmapUri ? { uri: bitmapUri } : undefined}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={desenharFilho}
                zIndex={isSpiderMarker ? 1000 : 100}
                onPress={() => {
                  if (isSpiderMarker) closeSpiderFromMarker();
                  focusDevice(device, true);
                }}
              >
                {desenharFilho ? montarMarkerContent() : null}
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
              const clusterUri = getClusterBitmap(group.devices.length);
              return [
                <ClusterMarker
                  // Vide nota acima: no iOS a remontagem do marcador derruba o
                  // app sob Fabric; o bitmap só entra na key no Android.
                  key={`cluster-${group.key}${Platform.OS === 'android' ? `-${clusterUri ?? 'pending'}` : ''}`}
                  lat={group.lat}
                  lng={group.lng}
                  count={group.devices.length}
                  bitmapUri={clusterUri}
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

        {showFences && filteredGeofences.map((geofence) => {
          const parsed = parseCircleArea(geofence.area);
          if (!parsed) return null;
          // Cor por origem: cerca individual do mapa (azul) x tela de Geocercas (verde).
          const stroke = geofence.criadaNoMapa ? 'rgba(41,128,185,0.8)' : 'rgba(39,174,96,0.8)';
          const fill = geofence.criadaNoMapa ? 'rgba(41,128,185,0.15)' : 'rgba(39,174,96,0.15)';
          return (
            <Circle
              key={`fence-circle-${geofence.id}`}
              center={{ latitude: parsed.latitude, longitude: parsed.longitude }}
              radius={parsed.radius}
              strokeWidth={2}
              strokeColor={stroke}
              fillColor={fill}
            />
          );
        })}

        {showFences && filteredGeofences.map((geofence) => {
          // Cercas em polígono (criadas no portal). O mobile só cria círculos,
          // mas precisa desenhar polígonos vindos do web/admin igual ao site.
          const pts = parsePolygonArea(geofence.area);
          if (!pts) return null;
          const stroke = geofence.criadaNoMapa ? 'rgba(41,128,185,0.8)' : 'rgba(39,174,96,0.8)';
          const fill = geofence.criadaNoMapa ? 'rgba(41,128,185,0.15)' : 'rgba(39,174,96,0.15)';
          return (
            <Polygon
              key={`fence-poly-${geofence.id}`}
              coordinates={pts}
              strokeWidth={2}
              strokeColor={stroke}
              fillColor={fill}
            />
          );
        })}

        {showTracks && tracks.map((track) => {
          if (!track.coords || track.coords.length < 2) return null;
          // Com um veículo focado, mostra o rastro apenas dele; sem foco, mostra de todos.
          if (mainCardVisible && selectedDevice && track.deviceId !== selectedDevice.dispositivoId) {
            return null;
          }
          return (
            <RoutePolyline
              key={track.deviceId}
              coordinates={track.coords}
              strokeWidth={3}
              strokeColor="rgba(41,128,185,0.7)"
            />
          );
        })}
      </MapView>

      <OffscreenCapturePool enabled={!isIOS} />
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
              {canVerCerca ? (
                <LayerOption
                  icon="circle-outline"
                  label="Cercas"
                  active={showFences}
                  onPress={() => setShowFences(v => !v)}
                />
              ) : null}
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

      {!isLoading && !accessStatus?.bloqueado && devices.length > 0 && !filteredDevices.length && seletorVisivel ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>Sem veículos no Mapa {mapaAtivo}</Text>
          <Text style={styles.emptyText}>
            Toque em Mapa {mapaAtivo === 1 ? 2 : 1} no topo para ver os outros veículos.
          </Text>
        </View>
      ) : null}

      {!accessStatus?.bloqueado && devicesVisiveis.length ? (
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
                  <Text style={styles.quickTitle}>{seletorVisivel ? `Veículos · Mapa ${mapaAtivo}` : 'Veículos'}</Text>
                  {/* Deixa explícito que o mapa não está mostrando a frota toda. */}
                  {acimaDoLimite ? (
                    <Pressable accessibilityRole="button" onPress={() => setDevicesSheetVisible(true)}>
                      <Text style={styles.quickSubtitle}>
                        {devicesVisiveis.length} de {filteredDevices.length} · toque para escolher
                      </Text>
                    </Pressable>
                  ) : null}
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
              <FlatList
                // A virtualização depende de conhecer a altura do viewport —
                // dentro da gaveta de altura animada, o flex garante isso.
                style={styles.quickListWrap}
                data={devicesParaLista}
                renderItem={renderQuickCard}
                keyExtractor={quickKeyExtractor}
                getItemLayout={quickGetItemLayout}
                extraData={selectedDeviceId}
                numColumns={2}
                columnWrapperStyle={[
                  styles.quickRow,
                  // Veículo único: centraliza a célula (que ocupa metade da
                  // largura) em vez de deixá-la encostada à esquerda.
                  devicesParaLista.length === 1 && styles.quickRowCenter,
                ]}
                showsVerticalScrollIndicator={quickSheetMode === 'expanded'}
                contentContainerStyle={styles.quickList}
                initialNumToRender={6}
                maxToRenderPerBatch={6}
                updateCellsBatchingPeriod={60}
                windowSize={5}
                // Só no Android: no iOS essa otimização tem histórico de deixar
                // células em branco ao rolar rápido.
                removeClippedSubviews={Platform.OS === 'android'}
              />
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
            {selectedDevice.apelidoCliente ? (
              <Text style={styles.mainCardApelido} numberOfLines={1}>
                {selectedDevice.apelidoCliente}
              </Text>
            ) : null}
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
              onApelidoChanged={(apelidoCliente) =>
                updateDevice(selectedDevice.dispositivoId, { apelidoCliente })
              }
              onGeofenceCreated={handleGeofenceCreated}
              onGeofenceDeleted={() => {
                if (showFences && canVerCerca) getGeofences().then(setGeofences).catch(() => {});
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

      {/* A busca lista a frota inteira do mapa ativo, inclusive quem ficou fora
          do teto: ao escolher um desses, ele entra no mapa focado. */}
      <SearchBottomSheet
        visible={searchSheetVisible}
        devices={todosParaLista}
        onClose={() => setSearchSheetVisible(false)}
        onSelectDevice={(device) => {
          focusDevice(device, true);
          setSearchSheetVisible(false);
        }}
      />

      {acimaDoLimite ? (
        <MapDevicesSheet
          visible={devicesSheetVisible}
          devices={todosParaLista}
          selectedIds={selecaoAtual}
          limite={LIMITE_MAPA}
          onClose={() => setDevicesSheetVisible(false)}
          onApply={aplicarSelecaoDoMapa}
        />
      ) : null}

      {canVerEventos ? (
        <NotificationsBottomSheet
          visible={notificationsSheetVisible}
          devices={todosParaLista}
          onClose={() => setNotificationsSheetVisible(false)}
          onSelectEvent={(event) => {
            if (event.dispositivoId) {
              const device = devices.find((d) => d.dispositivoId === event.dispositivoId);
              if (device) {
                if (getMapaDoDevice(device) !== mapaAtivo) setMapaAtivo(getMapaDoDevice(device));
                focusDevice(device, true);
              }
            }
            setNotificationsSheetVisible(false);
          }}
        />
      ) : null}
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
  mapaSeletor: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    padding: 3,
    alignSelf: 'center',
  },
  mapaSeletorOpt: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  mapaSeletorOptAtivo: {
    backgroundColor: colors.primary,
  },
  mapaSeletorText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '700',
  },
  mapaSeletorTextAtivo: {
    color: colors.primaryText,
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
  quickSubtitle: {
    marginTop: 1,
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
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
  quickListWrap: {
    flex: 1,
  },
  quickList: {
    paddingBottom: spacing.lg,
  },
  quickRow: {
    gap: spacing.sm,
  },
  quickRowCenter: {
    justifyContent: 'center',
  },
  quickGridItem: {
    flex: 1,
    maxWidth: '50%',
    height: QUICK_CARD_HEIGHT,
    marginBottom: spacing.sm,
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
  mainCardApelido: {
    maxWidth: 120,
    marginRight: spacing.xs,
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
});
