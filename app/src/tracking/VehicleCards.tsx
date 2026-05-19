import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, Icon, IconButton } from 'react-native-paper';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

import { GeofenceCreateModal } from '../components/GeofenceCreateModal';
import { useConfirmDialog } from '../components/ConfirmDialogProvider';
import { useAuth } from '../auth/AuthProvider';
import { resolveUploadUrl } from '../profile/profileService';
import { apiRequest } from '../services/api/apiClient';
import { environment } from '../config/environment';
import {
  buildCircleArea,
  getDeviceGeofences,
  createGeofence,
  deleteGeofence,
  type DeviceGeofence,
} from './geofenceService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import type { TrackingDevice, TrackingPosition } from './trackingTypes';
import { VehicleIcon } from './VehicleIcon';

export function getStatusColor(status: string, position?: TrackingPosition | null) {
  const isOnline = status === 'online';
  const isMoving = isOnline && position?.emMovimento;
  if (isMoving) return '#2980b9';
  if (isOnline) return '#27ae60';
  return '#fab32c';
}

export function getMarkerColor(device: TrackingDevice) {
  if (device.status !== 'online') return '#fab32c';
  if (!device.posicao) return '#fab32c';
  if (device.limiteVelocidade && (device.posicao.velocidade || 0) > device.limiteVelocidade) return '#e74c3c';
  if (device.posicao.emMovimento || device.posicao.ignicao === true) return '#2980b9';
  return '#27ae60';
}

export function getStatusText(status: string, position?: TrackingPosition | null) {
  const isOnline = status === 'online';
  const isMoving = isOnline && position?.emMovimento;
  if (isMoving) return 'Em movimento';
  if (isOnline) return 'Parado';
  return position ? 'Offline' : 'Sem posição';
}

export function formatSpeed(device: TrackingDevice) {
  const speed = device.posicao?.velocidade;
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return '0 km/h';
  return `${Math.round(speed)} km/h`;
}

export function formatLastUpdate(device: TrackingDevice) {
  const raw = device.posicao?.fixTime ?? device.lastUpdate;
  if (!raw) return 'Sem atualização';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Sem atualização';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTimeAgo(timestamp: string | number | null | undefined) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} d`;
}

function Speedometer({ speed, limit }: { speed: number; limit: number }) {
  const v = speed || 0;
  const lim = Math.max(limit || 120, 120);
  const f = Math.min(v / lim, 1);
  const ang = Math.PI * (1 - f);
  const ex = (40 + 30 * Math.cos(ang)).toFixed(1);
  const ey = (45 - 30 * Math.sin(ang)).toFixed(1);
  const cor = limit && v > limit ? '#e74c3c' : v > 80 ? '#f39c12' : '#27ae60';
  const tr = '#e9ecef';
  const arc = f > 0.01 ? (
    <Path
      d={`M 10 45 A 30 30 0 ${f > 0.5 ? 1 : 0} 1 ${ex} ${ey}`}
      fill="none"
      stroke={cor}
      strokeWidth="7"
      strokeLinecap="round"
    />
  ) : null;

  return (
    <View style={styles.speedometerWrap}>
      <Svg width="90" height="54" viewBox="0 0 90 54">
        <Path d="M 10 45 A 30 30 0 0 1 70 45" fill="none" stroke={tr} strokeWidth="7" strokeLinecap="round" />
        {arc}
        <SvgText x="40" y="40" textAnchor="middle" fontSize="17" fontWeight="700" fill="#333">{Math.round(v)}</SvgText>
        <SvgText x="40" y="50" textAnchor="middle" fontSize="9" fill="#555">km/h</SvgText>
      </Svg>
    </View>
  );
}

function VehiclePhoto({ device, size = 62 }: { device: TrackingDevice; size?: number }) {
  const imageUrl = resolveUploadUrl(device.imagemUrlCliente);
  return (
    <View style={[styles.photoBox, { width: size, height: size }]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.photo} />
      ) : (
        <VehicleIcon categoria={device.categoria} color={getMarkerColor(device)} course={device.posicao?.curso} size={size - 6} />
      )}
      <View style={styles.cameraBadge}>
        <Icon source="camera" size={13} color={colors.primaryText} />
      </View>
    </View>
  );
}

export function QuickVehicleCard({
  device,
  selected,
  onPress,
}: {
  device: TrackingDevice;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.quickCard, selected && styles.quickCardSelected]}
      onPress={onPress}
    >
      <VehiclePhoto device={device} size={60} />
      <View style={styles.quickBody}>
        <Text style={styles.quickName} numberOfLines={1}>{device.nome}</Text>
        <Text style={styles.quickMeta} numberOfLines={1}>{device.placa ?? 'Sem placa'}</Text>
        <Text style={styles.quickMeta} numberOfLines={1}>{formatSpeed(device)}</Text>
      </View>
    </Pressable>
  );
}

const _geocodeCache: Record<string, string> = {};

export function MainVehicleCard({
  device,
  onUploadPhoto,
  onRemovePhoto,
  isUploading,
  onGeofenceCreated,
  onGeofenceDeleted,
  onVerMais,
  onShowRoute,
  onCompartilhar,
  onFocusDevice,
  modoResgate,
}: {
  device: TrackingDevice;
  onUploadPhoto(): void;
  onRemovePhoto(): void;
  isUploading?: boolean;
  onGeofenceCreated?: () => void;
  onGeofenceDeleted?: () => void;
  onVerMais?: () => void;
  onShowRoute?: () => void;
  onCompartilhar?: () => void;
  onFocusDevice?: () => void;
  /** No modo resgate, esconde foto/upload, recorrências km/data, resumo do dia e botão "ver histórico". */
  modoResgate?: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirmDialog();
  const { can } = useAuth();
  const canBloquear = can('rastreamento.bloquear');
  const canDesbloquear = can('rastreamento.desbloquear');
  const canCriarCerca = can('rastreamento.criarCerca');
  const canUploadFoto = can('rastreamento.uploadFoto');
  const canMarcarManutFeita = can('rastreamento.marcarManutencaoRecorrenteFeita');
  const canMarcarRecDataFeita = can('rastreamento.marcarRecorrenciaDataFeita');
  const [summary, setSummary] = useState<{
    km: string;
    velMax: string;
    tempo: string;
    viagens: string;
  } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [recurrences, setRecurrences] = useState<any[]>(device._recorrencias || []);
  const [recorrenciasData, setRecorrenciasData] = useState<any[]>([]);
  const [deviceGeofences, setDeviceGeofences] = useState<DeviceGeofence[]>([]);
  const [isCreatingGeofence, setIsCreatingGeofence] = useState(false);
  const [isSendingCommand, setIsSendingCommand] = useState(false);
  const [geofenceModalVisible, setGeofenceModalVisible] = useState(false);

  const p = device.posicao;
  const statusColor = getStatusColor(device.status, p);
  const imageUrl = resolveUploadUrl(device.imagemUrlCliente);

  const fetchSummary = useCallback(async () => {
    try {
      const agora = new Date();
      const inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
      const fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59).toISOString();
      const trips = await apiRequest<any[]>(
        `/cliente/rastreamento/dispositivos/${device.dispositivoId}/viagens?from=${encodeURIComponent(inicio)}&to=${encodeURIComponent(fim)}`
      );
      const km = trips.reduce((s, v) => s + (v.distancia || 0), 0);
      const velMax = trips.reduce((m, v) => Math.max(m, v.velocidadeMaxima || 0), 0);
      const min = trips.reduce((s, v) => s + (v.duracao || 0), 0);
      const formatDur = (m: number) => {
        if (!m) return '—';
        const h = Math.floor(m / 60);
        const rem = m % 60;
        return h ? `${h}h ${rem}min` : `${rem}min`;
      };
      setSummary({
        km: km ? `${km.toFixed(1)} km` : '—',
        velMax: velMax ? `${velMax} km/h` : '—',
        tempo: min ? formatDur(min) : '—',
        viagens: String(trips.length || 0),
      });
    } catch {
      setSummary({ km: '—', velMax: '—', tempo: '—', viagens: '0' });
    }
  }, [device.dispositivoId]);

  const fetchRecurrences = useCallback(async () => {
    try {
      const data = await apiRequest<any[]>(`/cliente/manutencoes/recorrencias?dispositivoId=${device.dispositivoId}`);
      if (data) setRecurrences(data.filter(r => r.ativa !== false));
    } catch {}
  }, [device.dispositivoId]);

  const fetchRecorrenciasData = useCallback(async () => {
    try {
      const data = await apiRequest<any[]>(`/cliente/manutencoes/recorrencias-data?dispositivoId=${device.dispositivoId}`);
      if (data) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        setRecorrenciasData(
          data.filter(r => {
            const dp = String(r.dataReferencia).slice(0, 10).split('-');
            const dataRec = new Date(Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]));
            return r.ativa !== false && dataRec <= hoje;
          })
        );
      }
    } catch {}
  }, [device.dispositivoId]);

  const loadGeofences = useCallback(async () => {
    // Sub-usuário sem permissão de cercas não deve nem chamar a API (evita 403).
    if (!can('rastreamento.verCerca') && !can('rastreamento.criarCerca')) {
      setDeviceGeofences([]);
      return;
    }
    const geofences = await getDeviceGeofences(device.dispositivoId);
    setDeviceGeofences(geofences);
  }, [device.dispositivoId, can]);

  useEffect(() => {
    // Endpoints /cliente/* exigem JWT de cliente — não chamar no modo resgate
    // (resgate usa JWT de role RESGATE) para evitar 401 que desautentica a sessão.
    if (modoResgate) return;
    fetchSummary();
    fetchRecurrences();
    fetchRecorrenciasData();
  }, [modoResgate, fetchSummary, fetchRecurrences, fetchRecorrenciasData]);

  useEffect(() => {
    if (modoResgate) return;
    if (!device.dispositivoId) return;
    loadGeofences();
  }, [modoResgate, device.dispositivoId, loadGeofences]);

  useEffect(() => {
    if (p?.endereco) {
      setAddress(p.endereco);
      return;
    }
    if (p?.latitude && p?.longitude) {
      const cacheKey = `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
      if (_geocodeCache[cacheKey] !== undefined) {
        setAddress(_geocodeCache[cacheKey] || `(${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)})`);
        return;
      }
      // Endpoint depende do tipo de sessão: cliente usa /cliente/*, resgate usa /app/resgate/*
      const geocodeUrl = modoResgate
        ? `/app/resgate/geocode/reverse?lat=${encodeURIComponent(p.latitude as number)}&lon=${encodeURIComponent(p.longitude as number)}`
        : `/cliente/rastreamento/geocode/reverse?lat=${encodeURIComponent(p.latitude as number)}&lon=${encodeURIComponent(p.longitude as number)}`;
      const geocode = async () => {
        setIsGeocoding(true);
        try {
          const result = await apiRequest<{ endereco?: string }>(geocodeUrl);
          const end = result?.endereco || '';
          _geocodeCache[cacheKey] = end;
          setAddress(end || `(${p.latitude!.toFixed(5)}, ${p.longitude!.toFixed(5)})`);
        } catch {
          setAddress(`(${p.latitude!.toFixed(5)}, ${p.longitude!.toFixed(5)})`);
        } finally {
          setIsGeocoding(false);
        }
      };
      geocode();
    } else {
      setAddress(null);
    }
  }, [modoResgate, p?.latitude, p?.longitude, p?.endereco]);

  const openInMaps = () => {
    if (!p?.latitude || !p?.longitude) return;
    const query = address && !address.startsWith('(') ? address : `${p.latitude},${p.longitude}`;
    Linking.openURL(`https://www.google.com/maps?q=${encodeURIComponent(query)}`);
  };

  const openInStreetView = () => {
    if (!p?.latitude || !p?.longitude) return;
    Linking.openURL(`https://www.google.com/maps?q=&layer=c&cbll=${p.latitude},${p.longitude}`);
  };

  const sendCommand = async (tipo: 'engineStop' | 'engineResume') => {
    const isStop = tipo === 'engineStop';
    const confirmed = await confirm.show({
      title: isStop ? 'Bloquear veículo' : 'Desbloquear veículo',
      message: isStop
        ? `Deseja bloquear o motor de "${device.nome}"? O veículo perderá tração assim que parar.`
        : `Deseja desbloquear o motor de "${device.nome}"?`,
      confirmLabel: isStop ? 'Bloquear' : 'Desbloquear',
      destructive: isStop,
    });
    if (!confirmed) return;
    setIsSendingCommand(true);
    try {
      const cmdUrl = modoResgate
        ? `/app/resgate/dispositivos/${device.dispositivoId}/comandos`
        : `/cliente/dispositivos/${device.dispositivoId}/comandos`;
      await apiRequest(cmdUrl, {
        method: 'POST',
        body: { tipo, atributos: {} },
      });
      toast.show({
        message: isStop ? 'Comando de bloqueio enviado!' : 'Comando de desbloqueio enviado!',
        type: 'success',
      });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : `Erro ao ${isStop ? 'bloquear' : 'desbloquear'}.`,
        type: 'error',
      });
    } finally {
      setIsSendingCommand(false);
    }
  };

  const compartilhar = async () => {
    try {
      const data = await apiRequest<{ token: string }>('/compartilhamento/gerar', {
        method: 'POST',
        body: { dispositivoId: device.dispositivoId },
      });
      const url = `${environment.publicSiteUrl.replace(/\/$/, '')}/rastreamento-publico.html?token=${encodeURIComponent(data.token)}`;
      await Share.share({
        message: `Acompanhe ${device.nome}${device.placa ? ` (${device.placa})` : ''}: ${url}`,
        title: `Acompanhamento - ${device.nome}`,
      });
    } catch (err: any) {
      if (err?.code !== 'ERR_SHARING_CANCELLED') {
        toast.show({ message: err instanceof Error ? err.message : 'Não foi possível compartilhar.', type: 'error' });
      }
    }
  };

  const handleCercaPress = async () => {
    if (deviceGeofences.length > 0) {
      const confirmed = await confirm.show({
        title: 'Remover Cerca',
        message: `Deseja remover a(s) cerca(s) associada(s) a ${device.nome}?`,
        confirmLabel: 'Remover',
        destructive: true,
      });
      if (!confirmed) return;
      setIsCreatingGeofence(true);
      try {
        await Promise.all(deviceGeofences.map(g => deleteGeofence(g.id)));
        setDeviceGeofences([]);
        onGeofenceDeleted?.();
        toast.show({ message: 'Cerca(s) removida(s)!', type: 'success' });
      } catch {
        toast.show({ message: 'Erro ao remover cerca.', type: 'error' });
      } finally {
        setIsCreatingGeofence(false);
      }
    } else {
      if (!p?.latitude || !p?.longitude) {
        toast.show({ message: 'Veículo sem posição válida.', type: 'error' });
        return;
      }
      setGeofenceModalVisible(true);
    }
  };

  const handleGeofenceConfirm = async (nome: string, raio: number) => {
    setGeofenceModalVisible(false);
    if (!p?.latitude || !p?.longitude) return;
    setIsCreatingGeofence(true);
    try {
      const area = buildCircleArea(p.latitude, p.longitude, raio);
      await createGeofence({ nome, area, dispositivoId: device.dispositivoId });
      await loadGeofences();
      toast.show({ message: `Cerca de ${raio >= 1000 ? `${raio / 1000} km` : `${raio} m`} criada!`, type: 'success' });
      onGeofenceCreated?.();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao criar cerca.',
        type: 'error',
      });
    } finally {
      setIsCreatingGeofence(false);
    }
  };

  const markMaintenanceDone = async (id: string, title: string) => {
    const confirmed = await confirm.show({
      title: 'Confirmar Manutenção',
      message: `Confirmar que a manutenção "${title}" foi realizada?\n\nO contador será reiniciado a partir do odômetro atual.`,
      confirmLabel: 'Confirmar',
    });
    if (confirmed) {
      try {
        await apiRequest(`/cliente/manutencoes/recorrencias/${id}/feito`, { method: 'POST', body: {} });
        toast.show({ message: 'Manutenção confirmada!', type: 'success' });
        fetchRecurrences();
      } catch {
        toast.show({ message: 'Erro ao confirmar manutenção.', type: 'error' });
      }
    }
  };

  const markDateRecurrenceDone = async (id: string, title: string) => {
    const confirmed = await confirm.show({
      title: 'Confirmar Recorrência Por Data',
      message: `Confirmar que a recorrência por data "${title}" foi realizada?`,
      confirmLabel: 'Confirmar',
    });
    if (confirmed) {
      try {
        await apiRequest(`/cliente/manutencoes/recorrencias-data/${id}/feito`, { method: 'POST', body: {} });
        setRecorrenciasData(prev => prev.filter(r => r.id !== id));
        toast.show({ message: 'Confirmado!', type: 'success' });
        fetchRecorrenciasData();
      } catch {
        toast.show({ message: 'Erro ao confirmar.', type: 'error' });
      }
    }
  };

  const maintenanceAlerts = recurrences.filter(r => {
    const odometroM = r.dispositivo?.odometroSistemaMetros ?? p?.odometro ?? null;
    if (odometroM == null) return false;
    const kmPercorrido = (odometroM / 1000) - r.kmBase;
    const kmRestante = r.intervaloKm - kmPercorrido;
    return kmRestante <= 1000;
  });

  return (
    <View style={styles.mainContainer}>
      <GeofenceCreateModal
        visible={geofenceModalVisible}
        deviceName={device.nome}
        onClose={() => setGeofenceModalVisible(false)}
        onConfirm={handleGeofenceConfirm}
      />

      {!modoResgate ? (
        <View style={styles.mainCoverWrap}>
          <Pressable onPress={onFocusDevice} style={StyleSheet.absoluteFill}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.mainCoverImage} />
            ) : (
              <View style={styles.mainCoverFallback}>
                <VehicleIcon categoria={device.categoria} color={getMarkerColor(device)} course={0} size={96} />
              </View>
            )}
          </Pressable>
          {canUploadFoto ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Alterar foto do veículo"
              onPress={onUploadPhoto}
              disabled={isUploading}
              hitSlop={8}
              style={styles.coverCameraBadge}
            >
              <Icon source="camera" size={16} color={colors.primaryText} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.mainBody}>
        <Text style={styles.sectionTitle}>Informações do Dispositivo</Text>

        <View style={styles.infoAndSpeedRow}>
          <View style={styles.statusInfoColumn}>
            {p?.ignicao !== null && (
              <View style={styles.statusItem}>
                <Icon source="key-variant" size={14} color={p?.ignicao ? colors.success : colors.textMuted} />
                <Text style={[styles.statusItemText, { color: p?.ignicao ? colors.success : colors.textMuted }]}>
                  Ignição: {p?.ignicao ? 'Ligada' : 'Desligada'}
                </Text>
              </View>
            )}
            {p?.bateria_nivel != null && (
              <View style={styles.statusItem}>
                <Icon source="battery" size={14} color={p.bateria_nivel >= 40 ? colors.success : p.bateria_nivel >= 20 ? '#f39c12' : colors.danger} />
                <Text style={styles.statusItemText}>Bateria: {p.bateria_nivel}%</Text>
              </View>
            )}
            {p?.tensao != null && (
              <View style={styles.statusItem}>
                <Icon source="lightning-bolt" size={14} color="#8e44ad" />
                <Text style={styles.statusItemText}>Tensão: {p.tensao.toFixed(1)} V</Text>
              </View>
            )}
            {p?.odometro != null && (
              <View style={styles.statusItem}>
                <Icon source="speedometer" size={14} color={colors.textMuted} />
                <Text style={styles.statusItemText}>
                  Odômetro: {Math.round(p.odometro / 1000).toLocaleString('pt-BR')} km
                </Text>
              </View>
            )}
            {p?.horas_motor != null && (
              <View style={styles.statusItem}>
                <Icon source="clock-outline" size={14} color={colors.textMuted} />
                <Text style={styles.statusItemText}>Motor: {p.horas_motor} h</Text>
              </View>
            )}
            {p?.bloqueado != null && (
              <View style={styles.statusItem}>
                <Icon source={p.bloqueado ? 'lock' : 'lock-open'} size={14} color={p.bloqueado ? colors.danger : colors.success} />
                <Text style={[styles.statusItemText, { color: p.bloqueado ? colors.danger : colors.success }]}>
                  {p.bloqueado ? 'Bloqueado' : 'Desbloqueado'}
                </Text>
              </View>
            )}
          </View>
          <Speedometer speed={p?.velocidade || 0} limit={device.limiteVelocidade || 110} />
        </View>

        {!modoResgate ? maintenanceAlerts.map(r => {
          const odometroM = r.dispositivo?.odometroSistemaMetros ?? p?.odometro ?? 0;
          const kmRestante = Math.round(r.intervaloKm - (odometroM / 1000 - r.kmBase));
          const pastDue = kmRestante < 0;
          return (
            <View key={r.id} style={styles.alertRow}>
              <View style={styles.alertTextWrap}>
                <Icon source="wrench" size={14} color={pastDue ? colors.danger : '#f39c12'} />
                <Text style={[styles.alertText, { color: pastDue ? colors.danger : '#f39c12' }]}>
                  {pastDue
                    ? `Ultrapassou ${Math.abs(kmRestante).toLocaleString('pt-BR')} km da ${r.titulo}`
                    : `Faltam ${kmRestante.toLocaleString('pt-BR')} km para ${r.titulo}`}
                </Text>
              </View>
              {device.podeGerenciarManutencao && canMarcarManutFeita ? (
                <Pressable style={styles.alertBtn} onPress={() => markMaintenanceDone(r.id, r.titulo)}>
                  <Icon source="check" size={12} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          );
        }) : null}

        {!modoResgate ? recorrenciasData.map(r => {
          const dp = String(r.dataReferencia).slice(0, 10).split('-');
          const data = new Date(Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]));
          const hoje = new Date();
          hoje.setHours(0, 0, 0, 0);
          const atrasada = data < hoje;
          const fmtData = `${dp[2]}/${dp[1]}/${dp[0]}`;
          return (
            <View key={r.id} style={styles.alertRow}>
              <View style={styles.alertTextWrap}>
                <Icon source="calendar-clock" size={14} color={atrasada ? colors.danger : '#8e44ad'} />
                <Text style={[styles.alertText, { color: atrasada ? colors.danger : '#8e44ad' }]}>
                  {atrasada
                    ? `Pendente: ${r.titulo} (${fmtData})`
                    : `Hoje: ${r.titulo}`}
                </Text>
              </View>
              {device.podeGerenciarManutencao && canMarcarRecDataFeita ? (
                <Pressable style={styles.alertBtn} onPress={() => markDateRecurrenceDone(r.id, r.titulo)}>
                  <Icon source="check" size={12} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          );
        }) : null}

        <View style={styles.updateSection}>
          <Text style={styles.updateTitle}>Última Atualização</Text>
          {p ? (
            <View style={styles.gpsTimeRow}>
              <Icon source="cellphone-wireless" size={14} color={colors.textMuted} />
              <Text style={styles.gpsTimeText}>Dispositivo: {formatLastUpdate(device)}</Text>
            </View>
          ) : (
            <View style={styles.warningRow}>
              <Icon source="alert" size={14} color="#e67e22" />
              <Text style={styles.warningText}>Sem posição</Text>
            </View>
          )}
        </View>

        {p ? (
          <View style={styles.addressSection}>
            <View style={styles.addressHeader}>
              <Text style={styles.sectionTitle}>Endereço</Text>
              <View style={styles.addressButtons}>
                <IconButton icon="map-marker" size={20} containerColor="#eef6fc" iconColor="#2980b9" style={styles.miniBtn} onPress={openInMaps} />
                <IconButton icon="google-street-view" size={20} containerColor="#eef6fc" iconColor="#2980b9" style={styles.miniBtn} onPress={openInStreetView} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
              <Icon source="map-marker" size={14} color={colors.textMuted} />
              <Text style={styles.addressText}>{address || (isGeocoding ? 'Buscando...' : '—')}</Text>
            </View>
          </View>
        ) : null}

        {canBloquear || canDesbloquear ? (
          <View style={styles.commandsGrid}>
            {canBloquear ? (
              <Pressable
                style={[styles.cmdBtn, styles.cmdBtnDanger, isSendingCommand && styles.cmdBtnDisabled]}
                onPress={() => sendCommand('engineStop')}
                disabled={isSendingCommand}
              >
                {isSendingCommand ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon source="lock" size={14} color="#fff" />
                )}
                <Text style={styles.cmdBtnText}>Bloquear</Text>
              </Pressable>
            ) : null}
            {canDesbloquear ? (
              <Pressable
                style={[styles.cmdBtn, styles.cmdBtnSuccess, isSendingCommand && styles.cmdBtnDisabled]}
                onPress={() => sendCommand('engineResume')}
                disabled={isSendingCommand}
              >
                {isSendingCommand ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon source="lock-open" size={14} color="#fff" />
                )}
                <Text style={styles.cmdBtnText}>Desbloquear</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!modoResgate ? (
        <View style={styles.actionsSection}>
          <Text style={styles.actionsTitle}>AÇÕES</Text>
          <View style={styles.actionsGrid}>
            <Pressable style={styles.actionBtn} onPress={onShowRoute}>
              <View style={styles.actionIconWrap}>
                <Icon source="road-variant" size={18} color="#555" />
              </View>
              <Text style={styles.actionText}>Rota</Text>
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={compartilhar}>
              <View style={styles.actionIconWrap}>
                <Icon source="share-variant" size={18} color="#555" />
              </View>
              <Text style={styles.actionText}>Compartilhar</Text>
            </Pressable>
            {canCriarCerca ? (
              <Pressable
                style={styles.actionBtn}
                onPress={handleCercaPress}
              >
                <View style={[
                  styles.actionIconWrap,
                  deviceGeofences.length > 0 && styles.actionIconWrapCercaAtiva,
                ]}>
                  <Icon
                    source={deviceGeofences.length > 0 ? 'circle-slice-8' : 'circle-outline'}
                    size={18}
                    color={deviceGeofences.length > 0 ? '#fff' : '#555'}
                  />
                  {isCreatingGeofence && (
                    <View style={styles.actionLoading}>
                      <ActivityIndicator size="small" color="#f39c12" />
                    </View>
                  )}
                </View>
                <Text style={[styles.actionText, deviceGeofences.length > 0 && styles.actionTextCercaAtiva]}>
                  {deviceGeofences.length > 0 ? 'Cerca Ativa' : 'Cerca'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        ) : null}

        {!modoResgate ? (
          <View style={styles.summarySection}>
            <Text style={styles.summaryTitle}>RESUMO DE HOJE</Text>
            {!summary ? (
              <Text style={styles.loadingSummary}>Carregando...</Text>
            ) : (
              <View style={styles.summaryGrid}>
                <SummaryItem label="Distância" value={summary.km} />
                <SummaryItem label="Vel. Máxima" value={summary.velMax} />
                <SummaryItem label="Em Movimento" value={summary.tempo} />
                <SummaryItem label="Viagens" value={summary.viagens} />
              </View>
            )}
            <Pressable style={styles.verMaisBtn} onPress={onVerMais}>
              <Icon source="history" size={14} color="#fff" />
              <Text style={styles.verMaisText}>Ver Histórico</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photoBox: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
  },
  cameraBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.primary,
  },
  quickCard: {
    width: '48%',
    minHeight: 108,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  quickBody: {
    flex: 1,
    minWidth: 0,
  },
  quickName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  quickMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  mainContainer: {
    flex: 1,
  },
  mainCoverWrap: {
    position: 'relative',
    width: '100%',
    height: 140,
    backgroundColor: colors.surfaceMuted,
  },
  mainCoverFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainCoverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  coverCameraBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.primary,
  },
  mainBody: {
    padding: spacing.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#141414',
    marginBottom: spacing.sm,
  },
  infoAndSpeedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  statusInfoColumn: {
    flex: 1,
    gap: 4,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusItemText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  speedometerWrap: {
    marginTop: -4,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  alertTextWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  alertText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  alertBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  updateSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.1)',
  },
  updateTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.textMuted,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  gpsTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  gpsTimeText: {
    fontSize: 10,
    color: colors.textMuted,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  warningText: {
    fontSize: 10,
    color: '#e67e22',
  },
  addressSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.1)',
  },
  addressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  addressButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  miniBtn: {
    margin: 0,
    width: 32,
    height: 32,
  },
  addressText: {
    fontSize: 11,
    color: colors.text,
    lineHeight: 16,
    flex: 1,
  },
  commandsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.1)',
  },
  cmdBtn: {
    flex: 1,
    height: spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: spacing.sm,
    elevation: 2,
  },
  cmdBtnDanger: {
    backgroundColor: '#d9534f',
  },
  cmdBtnSuccess: {
    backgroundColor: '#5cb85c',
  },
  cmdBtnDisabled: {
    opacity: 0.6,
  },
  cmdBtnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  actionsSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.1)',
  },
  actionsTitle: {
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
    color: colors.text,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  actionsGrid: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 14,
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 4,
    minWidth: 48,
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  actionIconWrapCercaAtiva: {
    backgroundColor: '#f39c12',
    borderColor: '#e67e22',
  },
  actionText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#555',
  },
  actionTextCercaAtiva: {
    color: '#f39c12',
    fontWeight: '800',
  },
  actionLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 20,
  },
  summarySection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.1)',
  },
  summaryTitle: {
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
    color: colors.text,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  loadingSummary: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 6,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  summaryItem: {
    width: '48%',
    backgroundColor: '#f7f7f7',
    borderRadius: 6,
    padding: 8,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2980b9',
  },
  summaryLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  verMaisBtn: {
    marginTop: spacing.md,
    height: spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#f0ad4e',
    borderRadius: spacing.sm,
    elevation: 2,
    marginBottom: spacing.xl,
  },
  verMaisText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
