import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, Icon, Portal } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';

import { BottomSheet } from './BottomSheet';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import type { NotificationEvent } from '../notifications/notificationService';
import { markAllAsRead } from '../notifications/notificationService';

const EVENTO_TYPES = [
  { tipo: 'ignitionOn', label: 'Ignição Ligada', color: '#27ae60', icon: 'key' },
  { tipo: 'ignitionOff', label: 'Ignição Desligada', color: '#e67e22', icon: 'power-off' },
  { tipo: 'geofenceEnter', label: 'Entrada na Cerca', color: '#27ae60', icon: 'map-marker-check' },
  { tipo: 'geofenceExit', label: 'Saída da Cerca', color: '#e67e22', icon: 'map-marker-minus' },
  { tipo: 'overspeed', label: 'Excesso de Velocidade', color: '#e74c3c', icon: 'speedometer' },
  { tipo: 'alarm', label: 'Alarme', color: '#e74c3c', icon: 'bell-ring' },
  { tipo: 'powerCut', label: 'Alimentação Cortada', color: '#e74c3c', icon: 'car-battery' },
  { tipo: 'deviceLocked', label: 'Veículo Bloqueado', color: '#e74c3c', icon: 'lock' },
  { tipo: 'deviceUnlocked', label: 'Veículo Desbloqueado', color: '#27ae60', icon: 'lock-open' },
];

type PeriodFilter = 'hoje' | 'ontem' | '7dias' | 'custom';

type NotificationsBottomSheetProps = {
  visible: boolean;
  devices: { dispositivoId: string; nome: string; placa: string | null }[];
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

  const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);
  const [customDateFrom, setCustomDateFrom] = useState(new Date());
  const [customDateTo, setCustomDateTo] = useState(new Date());

  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

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
      // Marcar todas como lidas ao abrir
      markAllAsRead().catch(() => {});
    }
  }, [visible, loadEvents]);

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

  const filteredEvents = events.filter((e) => selectedTypes.has(e.tipo));

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

  const getDeviceName = (dispositivoId: string | null) => {
    if (!dispositivoId) return null;
    const device = devices.find((d) => d.dispositivoId === dispositivoId);
    return device?.nome ?? device?.placa ?? dispositivoId;
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

        <View style={styles.filters}>
          <Pressable
            style={styles.typePickerButton}
            onPress={() => setTypePickerVisible(true)}
          >
            <Text style={styles.typePickerLabel}>{typeFilterLabel}</Text>
            <Icon source="chevron-down" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

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
              const deviceName = getDeviceName(item.dispositivoId);
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
                        {item.latitude && item.longitude && (
                          <Text style={styles.expandedCoords}>
                            Lat: {item.latitude}, Lng: {item.longitude}
                          </Text>
                        )}
                        <Pressable
                          style={styles.viewOnMapBtn}
                          onPress={() => handleSelect(item)}
                        >
                          <Icon source="map-marker" size={14} color={colors.primary} />
                          <Text style={styles.viewOnMapText}>
                            Ver no mapa
                          </Text>
                        </Pressable>
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

        <Portal>
          <Modal
            visible={typePickerVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setTypePickerVisible(false)}
          >
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setTypePickerVisible(false)}
            >
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Filtrar por tipo</Text>
                <Pressable style={styles.applyBtn} onPress={applyTypeFilter}>
                  <Text style={styles.applyBtnText}>Aplicar</Text>
                </Pressable>
                <View style={styles.typeList}>
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
                </View>
              </View>
            </Pressable>
          </Modal>
        </Portal>
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
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