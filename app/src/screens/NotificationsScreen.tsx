import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Card,
  Icon,
  Text,
  TextInput,
} from 'react-native-paper';
import { Pressable, ScrollView, StyleSheet, View, KeyboardAvoidingView } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { getTrackingSnapshot } from '../tracking/trackingService';
import type { TrackingDevice } from '../tracking/trackingTypes';
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferencesResponse,
  type SaveNotificationPreferencesPayload,
} from '../notifications/notificationService';
import { colors } from '../theme/colors';
import { spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import { BottomSheet } from '../components/BottomSheet';

const TIPOS_NOTIF = [
  { id: 'ignitionOn', label: 'Ignição Ligada', icon: 'power-plug' },
  { id: 'ignitionOff', label: 'Ignição Desligada', icon: 'power-plug-off' },
  { id: 'geofenceEnter', label: 'Entrada na Cerca', icon: 'map-marker-radius' },
  { id: 'geofenceExit', label: 'Saída da Cerca', icon: 'map-marker-remove' },
  { id: 'overspeed', label: 'Excesso de Velocidade', icon: 'speedometer' },
  { id: 'powerCut', label: 'Alimentação Cortada', icon: 'flash' },
  { id: 'alarm', label: 'Alarme', icon: 'bell-ring' },
  { id: 'deviceLocked', label: 'Veículo Bloqueado', icon: 'lock' },
  { id: 'deviceUnlocked', label: 'Veículo Desbloqueado', icon: 'lock-open' },
  { id: 'kmExcedida', label: 'Km Excedida (Período)', icon: 'chart-line-variant' },
  { id: 'kmReduzida', label: 'Km Reduzida (Período)', icon: 'chart-line-variant' },
  { id: 'trocaOleo', label: 'Troca de Óleo', icon: 'oil' },
  { id: 'manutencao', label: 'Manutenções (Recorrências)', icon: 'wrench' },
  { id: 'recorrenciaData', label: 'Recorrência por Data', icon: 'calendar-check' },
];

const CANAIS = [
  { id: 'web', label: 'Web', icon: 'monitor' },
  { id: 'app', label: 'App', icon: 'cellphone' },
  { id: 'email', label: 'E-mail', icon: 'email' },
];

export function NotificationsScreen() {
  const { user } = useAuth();
  const toast = useToast();

  // Vehicles
  const [veiculos, setVeiculos] = useState<TrackingDevice[]>([]);
  const [loadingVeiculos, setLoadingVeiculos] = useState(true);
  const [dispositivoIdAtivo, setDispositivoIdAtivo] = useState<string>('');
  const [selectedVehicleName, setSelectedVehicleName] = useState('');
  const [vehicleSelectorVisible, setVehicleSelectorVisible] = useState(false);
  const [vehiclePlateSearch, setVehiclePlateSearch] = useState('');

  // Preferences
  const [preferencias, setPreferencias] = useState<NotificationPreferencesResponse | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Local form state
  const [formPrefs, setFormPrefs] = useState<{ [key: string]: { web: boolean; app: boolean; email: boolean } }>({});
  const [overspeedLimit, setOverspeedLimit] = useState(100);
  const [kmMaximo, setKmMaximo] = useState('');
  const [diaMes, setDiaMes] = useState('');
  const [kmMinimo, setKmMinimo] = useState('');
  const [diaSemana, setDiaSemana] = useState(1);
  const [dayPickerVisible, setDayPickerVisible] = useState(false);

  const diasSemana = [
    { label: 'Domingo', value: 0 },
    { label: 'Segunda', value: 1 },
    { label: 'Terça', value: 2 },
    { label: 'Quarta', value: 3 },
    { label: 'Quinta', value: 4 },
    { label: 'Sexta', value: 5 },
    { label: 'Sábado', value: 6 },
  ];

  const normalizePlateSearch = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const filteredVeiculos = useMemo(() => {
    const filtro = normalizePlateSearch(vehiclePlateSearch);
    if (!filtro) return veiculos;
    return veiculos.filter(v => normalizePlateSearch(v.placa || '').includes(filtro));
  }, [veiculos, vehiclePlateSearch]);

  const loadVeiculos = useCallback(async () => {
    try {
      setLoadingVeiculos(true);
      const data = await getTrackingSnapshot();
      if (Array.isArray(data)) {
        setVeiculos(data);
      } else {
        setVeiculos([]);
      }
    } catch {
      toast.show({ message: 'Erro ao carregar veículos.', type: 'error' });
      setVeiculos([]);
    } finally {
      setLoadingVeiculos(false);
    }
  }, [toast]);

  const loadPreferencias = useCallback(async (dispositivoId: string) => {
    try {
      setLoadingPrefs(true);
      const prefsData = await getNotificationPreferences(dispositivoId);

      // Initialize formPrefs with all non-hidden types set to false, then merge with loaded prefs
      const defaultPrefs = TIPOS_NOTIF.reduce((acc, t) => {
        acc[t.id] = { web: false, app: false, email: false };
        return acc;
      }, {} as { [key: string]: { web: boolean; app: boolean; email: boolean } });

      const mergedPrefs = { ...defaultPrefs, ...(prefsData.preferencias || {}) };
      setFormPrefs(mergedPrefs);
      setPreferencias(prefsData);
      setOverspeedLimit(prefsData.overspeedLimit || 100);
      setKmMaximo(prefsData.kmExcedida?.kmMaximo30Dias?.toString() || '');
      setDiaMes(prefsData.kmExcedida?.diaRenovacaoMes?.toString() || '');
      setKmMinimo(prefsData.kmReduzida?.kmMinimo7Dias?.toString() || '');
      setDiaSemana(prefsData.kmReduzida?.diaSemanaRenovacao ?? 1);
    } catch {
      toast.show({ message: 'Erro ao carregar preferências.', type: 'error' });
    } finally {
      setLoadingPrefs(false);
    }
  }, [toast]);

  useEffect(() => {
    loadVeiculos();
  }, [loadVeiculos]);

  useEffect(() => {
    if (dispositivoIdAtivo) {
      loadPreferencias(dispositivoIdAtivo);
    } else {
      setPreferencias(null);
    }
  }, [dispositivoIdAtivo, loadPreferencias]);

  const toggleChannel = (tipoId: string, canalId: 'web' | 'app' | 'email') => {
    setFormPrefs(prev => ({
      ...prev,
      [tipoId]: {
        ...prev[tipoId],
        [canalId]: !prev[tipoId]?.[canalId],
      },
    }));
  };

  const salvarConfiguracoes = async () => {
    if (!dispositivoIdAtivo) return;

    try {
      setSavingPrefs(true);

      // Build preferencias object including all types
      const prefsToSave = TIPOS_NOTIF.reduce((acc, t) => {
        acc[t.id] = formPrefs[t.id] || { web: false, app: false, email: false };
        return acc;
      }, {} as any);

      const payload: SaveNotificationPreferencesPayload = {
        dispositivoId: dispositivoIdAtivo,
        preferencias: prefsToSave,
        overspeedLimit,
        kmExcedida: {
          kmMaximo30Dias: kmMaximo ? parseInt(kmMaximo) : null,
          diaRenovacaoMes: diaMes ? parseInt(diaMes) : null,
        },
        kmReduzida: {
          kmMinimo7Dias: kmMinimo ? parseInt(kmMinimo) : null,
          diaSemanaRenovacao: diaSemana,
        },
        kmTrocaOleo: null, // hidden on web, kept for compatibility
      };
      await saveNotificationPreferences(payload);
      toast.show({ message: 'Configurações salvas!', type: 'success' });
    } catch {
      toast.show({ message: 'Erro ao salvar configurações.', type: 'error' });
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleVehicleSelect = (v: TrackingDevice) => {
    setDispositivoIdAtivo(v.dispositivoId);
    setSelectedVehicleName(`${v.nome}${v.placa ? ` (${v.placa})` : ''}`);
    setVehiclePlateSearch('');
    setVehicleSelectorVisible(false);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Vehicle Selector */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Veículo</Text>
          {loadingVeiculos ? (
            <ActivityIndicator />
          ) : (
            <>
              <Pressable
                style={styles.vehicleSelector}
                onPress={() => setVehicleSelectorVisible(true)}
              >
                <Text style={styles.vehicleSelectorText}>
                  {selectedVehicleName || 'Selecione um veículo...'}
                </Text>
                <Icon source="chevron-down" size={20} color={colors.textMuted} />
              </Pressable>

              <BottomSheet
                visible={vehicleSelectorVisible}
                heightPercent={0.5}
                onClose={() => setVehicleSelectorVisible(false)}
                title="Selecionar Veículo"
              >
                <TextInput
                  mode="outlined"
                  value={vehiclePlateSearch}
                  onChangeText={setVehiclePlateSearch}
                  placeholder="Buscar por placa"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  left={<TextInput.Icon icon="magnify" />}
                  right={vehiclePlateSearch ? <TextInput.Icon icon="close" onPress={() => setVehiclePlateSearch('')} /> : undefined}
                  style={styles.vehicleSearchInput}
                  dense
                />
                <ScrollView style={styles.vehicleList}>
                  {filteredVeiculos.map(v => (
                    <Pressable
                      key={v.dispositivoId}
                      style={styles.vehicleItem}
                      onPress={() => handleVehicleSelect(v)}
                    >
                      <Text style={styles.vehicleItemText}>
                        {v.nome} {v.placa ? `(${v.placa})` : ''}
                      </Text>
                    </Pressable>
                  ))}
                  {!filteredVeiculos.length && (
                    <Text style={styles.vehicleEmptyText}>Nenhum veículo encontrado para esta placa.</Text>
                  )}
                </ScrollView>
              </BottomSheet>
            </>
          )}
        </View>

        {/* Preferences Section */}
        {dispositivoIdAtivo && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Preferências de Notificação</Text>
            {loadingPrefs ? (
              <ActivityIndicator />
            ) : (
              <>
                <View style={styles.channelLegend}>
                  {CANAIS.map(c => (
                    <View key={c.id} style={styles.legendItem}>
                      <Icon source={c.icon} size={14} color={colors.textMuted} />
                      <Text style={styles.legendText}>{c.label}</Text>
                    </View>
                  ))}
                </View>

                {TIPOS_NOTIF.map(tipo => (
                  <Card key={tipo.id} style={styles.prefCard} mode="outlined">
                    <Card.Content style={styles.prefCardContent}>
                      <View style={styles.prefHeader}>
                        <Icon source={tipo.icon} size={18} color={colors.primary} />
                        <Text style={styles.prefLabel}>{tipo.label}</Text>
                      </View>
                      <View style={styles.channelButtons}>
                        {CANAIS.map(canal => {
                          const ativo = formPrefs[tipo.id]?.[canal.id as 'web' | 'app' | 'email'] || false;
                          return (
                            <Pressable
                              key={canal.id}
                              style={[
                                styles.channelBtn,
                                ativo && styles.channelBtnActive,
                              ]}
                              onPress={() => toggleChannel(tipo.id, canal.id as 'web' | 'app' | 'email')}
                            >
                              <Icon source={canal.icon} size={16} color={ativo ? '#fff' : colors.textMuted} />
                              <Text style={[styles.channelBtnText, ativo && styles.channelBtnTextActive]}>
                                {canal.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </Card.Content>
                  </Card>
                ))}

                {/* Speed Limit */}
                <Card style={styles.configCard} mode="outlined">
                  <Card.Content style={styles.configCardContent}>
                    <Text style={styles.configTitle}>Limite de Velocidade para Alerta</Text>
                    <Text style={styles.configHelp}>
                      Este limite é exclusivo para suas notificações e não altera o cadastro do veículo.
                    </Text>
                    <View style={styles.speedInputWrap}>
                      <TextInput
                        mode="outlined"
                        value={overspeedLimit.toString()}
                        onChangeText={(v) => setOverspeedLimit(parseInt(v) || 0)}
                        keyboardType="numeric"
                        style={styles.speedInput}
                        dense
                      />
                      <Text style={styles.speedUnit}>km/h</Text>
                    </View>
                  </Card.Content>
                </Card>

                {/* Km Period Config */}
                <Card style={styles.configCard} mode="outlined">
                  <Card.Content style={styles.configCardContent}>
                    <Text style={styles.configTitle}>Alerta de Quilometragem por Período</Text>

                    <View style={styles.kmSubSection}>
                      <Text style={styles.kmSubTitle}>Quilometragem Excedida (mensal)</Text>
                      <Text style={styles.configHelp}>Notifica quando o veículo ultrapassar o km máximo no período mensal.</Text>
                      <View style={styles.kmInputs}>
                        <View style={styles.kmInputGroup}>
                          <Text style={styles.kmLabel}>Km máximo em 30 dias</Text>
                          <TextInput
                            mode="outlined"
                            value={kmMaximo}
                            onChangeText={setKmMaximo}
                            keyboardType="numeric"
                            style={styles.kmInput}
                            dense
                          />
                        </View>
                        <View style={styles.kmInputGroup}>
                          <Text style={styles.kmLabel}>Dia do mês que renova</Text>
                          <TextInput
                            mode="outlined"
                            value={diaMes}
                            onChangeText={setDiaMes}
                            keyboardType="numeric"
                            style={styles.kmInput}
                            dense
                          />
                        </View>
                      </View>
                    </View>

                    <View style={styles.kmSubSection}>
                      <Text style={styles.kmSubTitle}>Quilometragem Reduzida (semanal)</Text>
                      <Text style={styles.configHelp}>Notifica ao fim da semana se o veículo não atingir o km mínimo.</Text>
                      <View style={styles.kmInputs}>
                        <View style={styles.kmInputGroup}>
                          <Text style={styles.kmLabel}>Km mínimo em 7 dias</Text>
                          <TextInput
                            mode="outlined"
                            value={kmMinimo}
                            onChangeText={setKmMinimo}
                            keyboardType="numeric"
                            style={styles.kmInput}
                            dense
                          />
                        </View>
                        <View style={styles.kmInputGroup}>
                          <Text style={styles.kmLabel}>Dia que renova</Text>
                          <Pressable
                            style={styles.vehicleSelector}
                            onPress={() => setDayPickerVisible(true)}
                          >
                            <Text style={styles.vehicleSelectorText}>
                              {diasSemana.find(d => d.value === diaSemana)?.label || 'Selecione...'}
                            </Text>
                            <Icon source="chevron-down" size={20} color={colors.textMuted} />
                          </Pressable>
                          <BottomSheet
                            visible={dayPickerVisible}
                            heightPercent={0.5}
                            onClose={() => setDayPickerVisible(false)}
                            title="Dia da semana que renova o alerta"
                          >
                            <ScrollView style={styles.vehicleList}>
                              {diasSemana.map(d => (
                                <Pressable
                                  key={d.value}
                                  style={styles.vehicleItem}
                                  onPress={() => {
                                    setDiaSemana(d.value);
                                    setDayPickerVisible(false);
                                  }}
                                >
                                  <Text style={styles.vehicleItemText}>{d.label}</Text>
                                </Pressable>
                              ))}
                            </ScrollView>
                          </BottomSheet>
                        </View>
                      </View>
                    </View>
                  </Card.Content>
                </Card>

                <Button
                  mode="contained"
                  onPress={salvarConfiguracoes}
                  loading={savingPrefs}
                  style={styles.btnSave}
                  icon="content-save"
                >
                  Salvar Configurações
                </Button>
              </>
            )}
          </View>
        )}

        {/* Empty state when no vehicle selected */}
        {!dispositivoIdAtivo && !loadingVeiculos && (
          <View style={styles.emptyState}>
            <Icon source="bell-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Nenhum veículo selecionado</Text>
            <Text style={styles.emptyText}>Selecione um veículo acima para configurar as notificações.</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
  },
  vehicleSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  vehicleSelectorText: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  vehicleList: {
    maxHeight: 300,
  },
  vehicleSearchInput: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  vehicleEmptyText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  vehicleItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  vehicleItemText: {
    fontSize: 14,
    color: colors.text,
  },
  channelLegend: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  prefCard: {
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  prefCardContent: {
    paddingVertical: spacing.sm,
  },
  prefHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  prefLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  channelButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  channelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  channelBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  channelBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 2,
  },
  channelBtnTextActive: {
    color: '#fff',
  },
  configCard: {
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  configCardContent: {
    paddingVertical: spacing.md,
  },
  configTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  configHelp: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  speedInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 240,
  },
  speedInput: {
    flex: 1,
    height: 40,
    backgroundColor: colors.surface,
  },
  speedUnit: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  kmSubSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  kmSubTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  kmInputs: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  kmInputGroup: {
    flex: 1,
    minWidth: 140,
  },
  kmLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colors.textMuted,
    marginBottom: 4,
  },
  kmInput: {
    height: 40,
    backgroundColor: colors.surface,
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  picker: {
    height: 48,
    color: colors.text,
  },
  btnSave: {
    marginTop: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
    maxWidth: 280,
  },
});
