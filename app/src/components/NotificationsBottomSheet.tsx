import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, Icon } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';

import { BottomSheet } from './BottomSheet';
import { SearchBottomSheet } from './SearchBottomSheet';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import type { NotificationEvent } from '../notifications/notificationService';
import { markAllAsRead } from '../notifications/notificationService';
import type { TrackingDevice } from '../tracking/trackingTypes';

const EVENTO_TYPES = [
  { tipo: 'ignitionOn', label: 'Ignição Ligada', color: '#27ae60', icon: 'key' },
  { tipo: 'ignitionOff', label: 'Ignição Desligada', color: '#e67e22', icon: 'power-off' },
  { tipo: 'geofenceEnter', label: 'Entrada na Zona de Segurança', color: '#27ae60', icon: 'map-marker-check' },
  { tipo: 'geofenceExit', label: 'Saída da Zona de Segurança', color: '#e67e22', icon: 'map-marker-minus' },
  { tipo: 'overspeed', label: 'Excesso de Velocidade', color: '#e74c3c', icon: 'speedometer' },
  { tipo: 'powerCut', label: 'Alimentação Cortada', color: '#e74c3c', icon: 'car-battery' },
  { tipo: 'alarm', label: 'Alarme', color: '#e74c3c', icon: 'bell-ring' },
  { tipo: 'deviceLocked', label: 'Veículo Bloqueado', color: '#e74c3c', icon: 'lock' },
  { tipo: 'deviceUnlocked', label: 'Veículo Desbloqueado', color: '#27ae60', icon: 'lock-open' },
  { tipo: 'veiculoMovimento', label: 'Veículo em Movimento', color: '#27ae60', icon: 'navigation-variant' },
  { tipo: 'motorOcioso', label: 'Motor Ocioso', color: '#e67e22', icon: 'timer-sand' },
  { tipo: 'semAtualizacao', label: 'Veículo sem Atualização', color: '#e74c3c', icon: 'wifi-off' },
  { tipo: 'kmExcedida', label: 'Km Excedida', color: '#e74c3c', icon: 'speedometer' },
  { tipo: 'kmReduzida', label: 'Km Reduzida', color: '#e67e22', icon: 'speedometer' },
  { tipo: 'trocaOleo', label: 'Troca de Óleo', color: '#e74c3c', icon: 'oil' },
  { tipo: 'trocaOleoFeita', label: 'Troca de Óleo Realizada', color: '#27ae60', icon: 'oil' },
  { tipo: 'manutencaoAlerta', label: 'Alerta de Manutenção', color: '#e74c3c', icon: 'wrench' },
  { tipo: 'manutencaoAtrasada', label: 'Manutenção Atrasada', color: '#e74c3c', icon: 'wrench' },
  { tipo: 'manutencaoFeita', label: 'Manutenção Realizada', color: '#27ae60', icon: 'wrench' },
  { tipo: 'recorrenciaDataAlerta', label: 'Alerta de Recorrência por Data', color: '#8e44ad', icon: 'calendar-clock' },
  { tipo: 'recorrenciaDataNaoFeita', label: 'Recorrência por Data Atrasada', color: '#e74c3c', icon: 'calendar-remove' },
  { tipo: 'recorrenciaDataFeita', label: 'Recorrência por Data Realizada', color: '#27ae60', icon: 'calendar-check' },
  { tipo: 'boletoVencendoHoje', label: 'Boleto Vence Hoje', color: '#f1c40f', icon: 'cash-clock' },
  { tipo: 'boletoAtrasado', label: 'Boleto em Atraso', color: '#e74c3c', icon: 'cash-remove' },
  { tipo: 'pagamentoRecebido', label: 'Pagamento Recebido', color: '#27ae60', icon: 'cash-check' },
  { tipo: 'multaNova', label: 'Nova Multa', color: '#e74c3c', icon: 'gavel' },
  { tipo: 'multaVencimento7dias', label: 'Multa a Vencer (7 dias)', color: '#e67e22', icon: 'gavel' },
  { tipo: 'multaVencimentoHoje', label: 'Multa Vence Hoje', color: '#e74c3c', icon: 'gavel' },
];

type PeriodFilter = 'hoje' | 'ontem' | '7dias' | 'custom';

type NotificationsBottomSheetProps = {
  visible: boolean;
  devices: TrackingDevice[];
  onClose(): void;
  onSelectEvent(event: NotificationEvent): void;
};

const getTipoConfig = (tipo: string) => {
  const found = EVENTO_TYPES.find((t) => t.tipo === tipo);
  if (found) return found;
  return { tipo, label: tipo, color: '#2980b9', icon: 'bell' };
};

const getEventoIcon = (tipo: string) => {
  const config = getTipoConfig(tipo);
  return config.icon;
};

function fmtTempoDecorrido(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'há agora';
  if (diffMins < 60) return `há ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `há ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? 'há 1 dia' : `há ${diffDays} dias`;
}

const _geocodeCache: Record<string, string> = {};

async function geocodeAddress(lat: number, lng: number): Promise<string> {
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (_geocodeCache[cacheKey]) return _geocodeCache[cacheKey];
  try {
    const { apiRequest } = await import('../services/api/apiClient');
    const result = await apiRequest<{ endereco?: string }>(
      `/cliente/rastreamento/geocode/reverse?lat=${lat}&lon=${lng}`
    );
    const address = result?.endereco || '';
    _geocodeCache[cacheKey] = address;
    return address;
  } catch {
    _geocodeCache[cacheKey] = '';
    return '';
  }
}

export function NotificationsBottomSheet({
  visible,
  devices,
  onClose,
  onSelectEvent,
}: NotificationsBottomSheetProps) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    new Set(EVENTO_TYPES.map((t) => t.tipo)),
  );
  const [period, setPeriod] = useState<PeriodFilter>('hoje');
  const [typePickerVisible, setTypePickerVisible] = useState(false);
  const [typeFilterLabel, setTypeFilterLabel] = useState(`Todos (${EVENTO_TYPES.length})`);
  const [geocodedAddresses, setGeocodedAddresses] = useState<Record<string, string>>({});

  const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);
  const [customDateFrom, setCustomDateFrom] = useState(new Date());
  const [customDateTo, setCustomDateTo] = useState(new Date());

  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [searchSheetVisible, setSearchSheetVisible] = useState(false);

  // Reseta filtros quando o sheet fecha — ao reabrir volta para "Hoje" e sem
  // dispositivos selecionados.
  useEffect(() => {
    if (!visible) {
      setSelectedDeviceIds(new Set());
      setSearchSheetVisible(false);
      setPeriod('hoje');
    }
  }, [visible]);

  const selectedDevices = devices.filter((d) => selectedDeviceIds.has(d.dispositivoId));

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const formatDate = (d: Date) => d.toISOString().split('T')[0];
      let url = `/cliente/notificacoes/eventos?periodo=${period}`;
      if (period === 'custom') {
        url += `&de=${formatDate(customDateFrom)}&ate=${formatDate(customDateTo)}`;
      }
      const { apiRequest } = await import('../services/api/apiClient');
      const data = await apiRequest<NotificationEvent[]>(url);
      setEvents(Array.isArray(data) ? data : []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [period, customDateFrom, customDateTo]);

  useEffect(() => {
    if (visible) {
      loadEvents();
      markAllAsRead().catch(() => {});
    }
  }, [visible, loadEvents]);

  // Geocode addresses for events
  useEffect(() => {
    if (!events.length) return;
    
    const toGeocode: { event: NotificationEvent; lat: number; lng: number }[] = [];
    
    events.forEach((event) => {
      if (geocodedAddresses[event.id]) return; // Already geocoded
      
      const lat = event.lat ?? null;
      const lng = event.lng ?? null;
      
      if (lat != null && lng != null) {
        toGeocode.push({ event, lat, lng });
      }
    });
    
    if (toGeocode.length === 0) return;
    
    // Queue geocoding
    toGeocode.forEach(async ({ event, lat, lng }) => {
      const cachedKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
      let address = '';
      
      if (_geocodeCache[cachedKey]) {
        address = _geocodeCache[cachedKey];
      } else {
        const cachedKeyFull = `${lat},${lng}`;
        if (_geocodeCache[cachedKeyFull]) {
          address = _geocodeCache[cachedKeyFull];
        } else {
          address = await geocodeAddress(lat, lng);
        }
      }
      
      setGeocodedAddresses(prev => ({ ...prev, [event.id]: address }));
    });
  }, [events, devices, geocodedAddresses]);

  const handleTypeToggle = useCallback((tipo: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(tipo)) {
        next.delete(tipo);
      } else {
        next.add(tipo);
      }
      return next;
    });
  }, []);

  const applyTypeFilter = useCallback(() => {
    const count = selectedTypes.size;
    if (count === EVENTO_TYPES.length) {
      setTypeFilterLabel(`Todos (${count})`);
    } else if (count === 0) {
      setTypeFilterLabel('Nenhum');
    } else {
      setTypeFilterLabel(`${count} selecionado(s)`);
    }
    setTypePickerVisible(false);
  }, [selectedTypes.size]);

  const deviceIdsDoMapa = new Set(devices.map((d) => d.dispositivoId));

  const filteredEvents = events.filter((e) => {
    if (!selectedTypes.has(e.tipo)) return false;
    // Oculta eventos de dispositivos que pertencem a outro mapa.
    // Eventos sem dispositivoId (sistema/financeiro) continuam visíveis.
    if (e.dispositivoId && !deviceIdsDoMapa.has(e.dispositivoId)) return false;
    if (selectedDeviceIds.size > 0) {
      if (!e.dispositivoId || !selectedDeviceIds.has(e.dispositivoId)) return false;
    }
    return true;
  });

  const handleSelect = useCallback(
    (event: NotificationEvent) => {
      onSelectEvent(event);
      onClose();
    },
    [onSelectEvent, onClose],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedEvent((prev) => (prev === id ? null : id));
  }, []);

  const getDeviceName = (event: NotificationEvent) => {
    if (!event.dispositivoId) return null;
    const device = devices.find((d) => d.dispositivoId === event.dispositivoId);
    return device?.nome ?? device?.placa ?? event.dispositivoNome ?? event.dispositivoPlaca ?? null;
  };

  const formatFullDate = (dateStr: string | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleString('pt-BR');
  };

  const handleDateChange = useCallback(
    (event: any, selectedDate?: Date) => {
      setShowDatePicker(null);
      if (selectedDate) {
        if (showDatePicker === 'from') {
          setCustomDateFrom(selectedDate);
        } else {
          setCustomDateTo(selectedDate);
        }
      }
    },
    [showDatePicker],
  );

  const periodLabels: Record<PeriodFilter, string> = {
    hoje: 'Hoje',
    ontem: 'Ontem',
    '7dias': '7 dias',
    custom: 'Personalizado',
  };

  return (
    <BottomSheet
      visible={visible}
      title="Notificações"
      heightPercent={0.7}
      onClose={onClose}
    >
      <View style={styles.content}>
        <View style={styles.periodFilters}>
          {(['hoje', 'ontem', '7dias', 'custom'] as PeriodFilter[]).map((p) => (
            <Pressable
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              onPress={() => setPeriod(p)}
            >
              <Text
                style={[
                  styles.periodBtnText,
                  period === p && styles.periodBtnTextActive,
                ]}
              >
                {periodLabels[p]}
              </Text>
            </Pressable>
          ))}
        </View>

        {period === 'custom' && (
          <View style={styles.customDateRow}>
            <Pressable
              style={styles.dateButton}
              onPress={() => setShowDatePicker('from')}
            >
              <Text style={styles.dateButtonLabel}>De</Text>
              <Text style={styles.dateButtonValue}>
                {customDateFrom.toLocaleDateString('pt-BR')}
              </Text>
            </Pressable>
            <Pressable
              style={styles.dateButton}
              onPress={() => setShowDatePicker('to')}
            >
              <Text style={styles.dateButtonLabel}>Até</Text>
              <Text style={styles.dateButtonValue}>
                {customDateTo.toLocaleDateString('pt-BR')}
              </Text>
            </Pressable>
          </View>
        )}

        <View style={styles.filtersRow}>
          <Pressable
            style={[styles.typePickerButton, styles.flex1]}
            onPress={() => setTypePickerVisible(true)}
          >
            <Text style={styles.typePickerLabel}>{typeFilterLabel}</Text>
            <Icon source="chevron-down" size={20} color={colors.textMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filtrar por dispositivo"
            style={[
              styles.searchBtn,
              selectedDeviceIds.size > 0 && styles.searchBtnActive,
            ]}
            onPress={() => setSearchSheetVisible(true)}
          >
            <Icon
              source="magnify"
              size={20}
              color={selectedDeviceIds.size > 0 ? colors.primaryText : colors.text}
            />
          </Pressable>
        </View>

        {selectedDevices.length > 0 && (
          <View style={styles.deviceFiltersBar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.deviceChipsRow}
              keyboardShouldPersistTaps="handled"
            >
              {selectedDevices.map((d) => (
                <View key={d.dispositivoId} style={styles.deviceChip}>
                  <Text style={styles.deviceChipText} numberOfLines={1}>
                    {d.nome}
                    {d.placa ? ` — ${d.placa}` : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Limpar filtro de dispositivos"
              style={styles.clearDevicesBtn}
              onPress={() => setSelectedDeviceIds(new Set())}
            >
              <Icon source="close-circle" size={18} color={colors.danger} />
            </Pressable>
          </View>
        )}

{loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView 
            style={styles.list} 
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={true}
          >
            {filteredEvents.map((item) => {
              const config = getTipoConfig(item.tipo);
              const deviceName = getDeviceName(item);
              const isExpanded = expandedEvent === item.id;

              return (
                <Pressable
                  key={item.id}
                  style={[
                    styles.eventItem,
                    { borderLeftColor: config.color },
                    !item.lido && styles.eventItemUnread,
                  ]}
                  onPress={() => toggleExpand(item.id)}
                >
                  <View
                    style={[
                      styles.eventIcon,
                      { backgroundColor: config.color + '20' },
                    ]}
                  >
                    <Icon
                      source={config.icon}
                      size={16}
                      color={config.color}
                    />
                  </View>
                  <View style={styles.eventContent}>
                    <View style={styles.eventHeader}>
                      <Text
                        style={[styles.eventTitle, { color: config.color }]}
                        numberOfLines={1}
                      >
                        {deviceName ?? 'Sistema'}
                      </Text>
                      <View style={styles.eventRight}>
                        <Text style={styles.eventTime}>
                          {fmtTempoDecorrido(item.serverTime)}
                        </Text>
                        <Icon
                          source={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={colors.textMuted}
                        />
                      </View>
                    </View>
                    <Text
                      style={styles.eventMessage}
                      numberOfLines={isExpanded ? undefined : 1}
                    >
                      {item.mensagem}
                    </Text>
                    {isExpanded && (
                      <View style={styles.expandedContent}>
                        <Text style={styles.expandedDate}>
                          {formatFullDate(item.data)}
                        </Text>
                        {(() => {
                          const eventLat = item.lat ?? null;
                          const eventLng = item.lng ?? null;
                          
                          let address = '';
                          let deviceLatLng: { lat: number; lng: number } | null = null;
                          
                          // Try to get device current position for fallback
                          const device = devices.find(d => d.dispositivoId === item.dispositivoId);
                          const devicePos = device?.posicao;
                          const deviceLat = devicePos?.latitude ?? null;
                          const deviceLng = devicePos?.longitude ?? null;
                          const deviceAddress = devicePos?.endereco ?? null;
                          
                          if (item.endereco) {
                            address = item.endereco;
                          } else if (eventLat != null && eventLng != null) {
                            // Check if event coords match current position roughly
                            const mesmaPosicao = deviceLat != null && deviceLng != null
                              && Math.abs(eventLat - deviceLat) < 0.00001
                              && Math.abs(eventLng - deviceLng) < 0.00001;
                            
                            if (mesmaPosicao && deviceAddress) {
                              address = deviceAddress;
                            } else {
                              address = geocodedAddresses[item.id] || '';
                              if (!address) {
                                const cachedKey = `${eventLat.toFixed(3)},${eventLng.toFixed(3)}`;
                                address = _geocodeCache[cachedKey] || '';
                              }
                              if (!address) {
                                const fullKey = `${eventLat},${eventLng}`;
                                address = _geocodeCache[fullKey] || '';
                              }
                              if (!address && item.titulo) {
                                address = item.titulo;
                              }
                            }
                          } else if (deviceLat != null && deviceLng != null) {
                            // No event coords - use device current position
                            deviceLatLng = { lat: deviceLat, lng: deviceLng };
                            if (deviceAddress) {
                              address = deviceAddress;
                            }
                          }
                          
                          if (!address) {
                            return null;
                          }
                          
                          const finalLat = eventLat ?? deviceLatLng?.lat ?? null;
                          const finalLng = eventLng ?? deviceLatLng?.lng ?? null;
                          
                          return (
                            <>
                              <Text style={styles.expandedAddress} numberOfLines={2}>
                                {address}
                              </Text>
                              {finalLat != null && finalLng != null && (
                                <View style={styles.mapsButtonsRow}>
                                  <Pressable
                                    style={styles.mapsButton}
                                    onPress={() => {
                                      const url = address.startsWith('Lat:')
                                        ? `https://www.google.com/maps/dir/?api=1&destination=${finalLat},${finalLng}`
                                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
                                      Linking.openURL(url);
                                    }}
                                  >
                                    <Text style={styles.mapsButtonText}>Maps</Text>
                                  </Pressable>
                                  <Pressable
                                    style={styles.streetViewButton}
                                    onPress={() => {
                                      Linking.openURL(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${finalLat},${finalLng}`);
                                    }}
                                  >
                                    <Text style={styles.streetViewButtonText}>StreetView</Text>
                                  </Pressable>
                                </View>
                              )}
                            </>
                          );
                        })()}
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })}
            {filteredEvents.length === 0 && (
              <View style={styles.empty}>
                <Icon
                  source="bell-off-outline"
                  size={40}
                  color={colors.textMuted}
                />
                <Text style={styles.emptyText}>Nenhuma notificação</Text>
              </View>
            )}
          </ScrollView>
        )}

        {showDatePicker && (
          <DateTimePicker
            value={showDatePicker === 'from' ? customDateFrom : customDateTo}
            mode="date"
            display="default"
            onChange={handleDateChange}
          />
        )}

        {/* Overlay "Filtrar por tipo" — renderizado dentro do próprio BottomSheet
            (View absoluta), em vez de um Modal aninhado. Evita o cenário frágil de
            "modal sobre modal" no iOS, onde o segundo Modal pode não abrir. Os
            "checkboxes" são ícones do Material + Pressable (multiplataforma). */}
        {typePickerVisible ? (
          <View style={styles.typeOverlay}>
            <Pressable
              style={styles.typeOverlayBackdrop}
              onPress={() => setTypePickerVisible(false)}
            />
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Filtrar por tipo</Text>
              <Pressable style={styles.applyBtn} onPress={applyTypeFilter}>
                <Text style={styles.applyBtnText}>Aplicar</Text>
              </Pressable>
              <ScrollView style={styles.typeList} showsVerticalScrollIndicator={false}>
                {EVENTO_TYPES.map((t) => (
                  <Pressable
                    key={t.tipo}
                    style={styles.typeItem}
                    onPress={() => handleTypeToggle(t.tipo)}
                  >
                    <Icon
                      source={
                        selectedTypes.has(t.tipo)
                          ? 'checkbox-marked'
                          : 'checkbox-blank-outline'
                      }
                      size={20}
                      color={selectedTypes.has(t.tipo) ? t.color : colors.textMuted}
                    />
                    <View
                      style={[styles.typeColorDot, { backgroundColor: t.color }]}
                    />
                    <Icon source={t.icon} size={16} color={t.color} />
                    <Text style={[styles.typeItemText, { color: t.color }]}>
                      {t.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        ) : null}

        <SearchBottomSheet
          visible={searchSheetVisible}
          devices={devices}
          title="Selecione o dispositivo para filtrar as notificações por ele"
          onClose={() => setSearchSheetVisible(false)}
          onSelectDevice={(device) => {
            setSelectedDeviceIds((prev) => {
              const next = new Set(prev);
              next.add(device.dispositivoId);
              return next;
            });
            setSearchSheetVisible(false);
          }}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  periodFilters: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  periodBtnActive: {
    backgroundColor: colors.primary,
  },
  periodBtnText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  periodBtnTextActive: {
    color: colors.primaryText,
  },
  customDateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  dateButton: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  dateButtonLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  dateButtonValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  filters: {
    paddingBottom: spacing.sm,
  },
  filtersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  flex1: {
    flex: 1,
  },
  typePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  typePickerLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  searchBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  searchBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  deviceFiltersBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  deviceChipsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  deviceChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  deviceChipText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  clearDevicesBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  eventItem: {
    flexDirection: 'row',
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    backgroundColor: colors.background,
  },
  eventItemUnread: {
    backgroundColor: '#f5f5f5',
  },
  eventIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  eventContent: {
    flex: 1,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  eventRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  eventTime: {
    color: colors.textMuted,
    fontSize: 10,
  },
  eventMessage: {
    color: colors.text,
    fontSize: 12,
    marginTop: 4,
  },
  expandedContent: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  expandedDate: {
    color: colors.textMuted,
    fontSize: 11,
  },
  expandedCoords: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  expandedAddress: {
    color: colors.text,
    fontSize: 12,
    marginTop: spacing.xs,
    lineHeight: 16,
  },
  noCoords: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  mapsButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  mapsButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapsButtonText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  streetViewButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
  },
  streetViewButtonText: {
    color: colors.primaryText,
    fontSize: 11,
    fontWeight: '600',
  },
  viewOnMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.sm,
  },
  viewOnMapText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  unreadDot: {
    width: 8,
    height: 8,
    marginLeft: spacing.sm,
    marginTop: spacing.xs,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 14,
  },
  typeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  typeOverlayBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '80%',
    maxHeight: '70%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  applyBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    marginBottom: spacing.md,
  },
  applyBtnText: {
    color: colors.primaryText,
    fontSize: 12,
    fontWeight: '700',
  },
  typeList: {
    maxHeight: 300,
    marginBottom: spacing.xl,
  },
  typeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  typeColorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  typeItemText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
});