import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Card,
  Icon,
  Text,
  TextInput,
} from 'react-native-paper';
import { Pressable, ScrollView, StyleSheet, View, KeyboardAvoidingView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthProvider';
import { getTrackingSnapshot } from '../tracking/trackingService';
import type { TrackingDevice } from '../tracking/trackingTypes';
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferencesResponse,
  type PeriodoKm,
  type SaveNotificationPreferencesPayload,
} from '../notifications/notificationService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import { BottomSheet } from '../components/BottomSheet';
import { SearchBottomSheet } from '../components/SearchBottomSheet';

const TIPOS_NOTIF = [
  { id: 'ignitionOn', label: 'Ignição Ligada', icon: 'power-plug' },
  { id: 'ignitionOff', label: 'Ignição Desligada', icon: 'power-plug-off' },
  { id: 'geofenceEnter', label: 'Entrada na Zona de Segurança', icon: 'map-marker-radius' },
  { id: 'geofenceExit', label: 'Saída da Zona de Segurança', icon: 'map-marker-remove' },
  { id: 'overspeed', label: 'Excesso de Velocidade', icon: 'speedometer' },
  { id: 'powerCut', label: 'Alimentação Cortada', icon: 'flash' },
  { id: 'alarm', label: 'Alarme', icon: 'bell-ring' },
  { id: 'deviceLocked', label: 'Veículo Bloqueado', icon: 'lock' },
  { id: 'deviceUnlocked', label: 'Veículo Desbloqueado', icon: 'lock-open' },
  { id: 'veiculoMovimento', label: 'Veículo em Movimento', icon: 'navigation-variant' },
  { id: 'motorOcioso', label: 'Motor Ocioso (5min+)', icon: 'timer-sand' },
  { id: 'semAtualizacao', label: 'Veículo sem Atualização', icon: 'wifi-off' },
  { id: 'kmExcedida', label: 'Km Excedida (Período)', icon: 'chart-line-variant' },
  { id: 'kmReduzida', label: 'Km Reduzida (Período)', icon: 'chart-line-variant' },
  // Um interruptor para todos os avisos de multa/licenciamento.
  { id: 'multa', label: 'Multas', icon: 'gavel' },
  { id: 'trocaOleo', label: 'Troca de Óleo', icon: 'oil' },
  { id: 'manutencao', label: 'Manutenções (Recorrências)', icon: 'wrench' },
  { id: 'recorrenciaData', label: 'Recorrência por Data', icon: 'calendar-check' },
];

const PERIODOS_KM: Array<{ label: string; value: PeriodoKm }> = [
  { label: 'Semanal', value: 'SEMANAL' },
  { label: 'Quinzenal', value: 'QUINZENAL' },
  { label: 'Mensal', value: 'MENSAL' },
  { label: 'Semestral', value: 'SEMESTRAL' },
  { label: 'Anual', value: 'ANUAL' },
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
  const [vehicleSelectorVisible, setVehicleSelectorVisible] = useState(false);

  // Preferences
  const [preferencias, setPreferencias] = useState<NotificationPreferencesResponse | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Local form state
  const [formPrefs, setFormPrefs] = useState<{ [key: string]: { web: boolean; app: boolean; email: boolean } }>({});
  const [overspeedLimit, setOverspeedLimit] = useState(100);
  const [semAtualizacaoHoras, setSemAtualizacaoHoras] = useState('3');
  const [kmMaximo, setKmMaximo] = useState('');
  const [diaMes, setDiaMes] = useState('');
  const [kmMinimo, setKmMinimo] = useState('');
  const [diaSemana, setDiaSemana] = useState(1);
  const [dayPickerVisible, setDayPickerVisible] = useState(false);
  // Periodicidade da contagem de km (antes era fixa: excedida mensal, reduzida semanal)
  const [periodoExcedida, setPeriodoExcedida] = useState<PeriodoKm>('MENSAL');
  const [periodoReduzida, setPeriodoReduzida] = useState<PeriodoKm>('SEMANAL');
  const [diaSemanaExcedida, setDiaSemanaExcedida] = useState(1);
  const [diaMesReduzida, setDiaMesReduzida] = useState('');
  const [periodoPickerVisivel, setPeriodoPickerVisivel] = useState<'excedida' | 'reduzida' | null>(null);
  const [dayPickerExcedidaVisible, setDayPickerExcedidaVisible] = useState(false);

  const diasSemana = [
    { label: 'Domingo', value: 0 },
    { label: 'Segunda', value: 1 },
    { label: 'Terça', value: 2 },
    { label: 'Quarta', value: 3 },
    { label: 'Quinta', value: 4 },
    { label: 'Sexta', value: 5 },
    { label: 'Sábado', value: 6 },
  ];

  const loadVeiculos = useCallback(async () => {
    try {
      setLoadingVeiculos(true);
      const data = await getTrackingSnapshot();
      const lista = Array.isArray(data) ? data : [];
      setVeiculos(lista);
      if (!dispositivoIdAtivo) {
        if (lista.length === 1) {
          setDispositivoIdAtivo(lista[0].dispositivoId);
        } else if (lista.length > 1) {
          setVehicleSelectorVisible(true);
        }
      }
    } catch {
      toast.show({ message: 'Erro ao carregar veículos.', type: 'error' });
      setVeiculos([]);
    } finally {
      setLoadingVeiculos(false);
    }
  }, [toast, dispositivoIdAtivo]);

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
      setSemAtualizacaoHoras((prefsData.semAtualizacaoHoras ?? 3).toString());
      setKmMaximo(prefsData.kmExcedida?.kmMaximo30Dias?.toString() || '');
      setDiaMes(prefsData.kmExcedida?.diaRenovacaoMes?.toString() || '');
      setKmMinimo(prefsData.kmReduzida?.kmMinimo7Dias?.toString() || '');
      setDiaSemana(prefsData.kmReduzida?.diaSemanaRenovacao ?? 1);
      setPeriodoExcedida(prefsData.kmExcedida?.periodo || 'MENSAL');
      setPeriodoReduzida(prefsData.kmReduzida?.periodo || 'SEMANAL');
      setDiaSemanaExcedida(prefsData.kmExcedida?.diaSemanaRenovacao ?? 1);
      setDiaMesReduzida(prefsData.kmReduzida?.diaRenovacaoMes?.toString() || '');
    } catch {
      toast.show({ message: 'Erro ao carregar preferências.', type: 'error' });
    } finally {
      setLoadingPrefs(false);
    }
  }, [toast]);

  // Ref para acessar loadVeiculos dentro do useFocusEffect sem disparar reexecução
  const loadVeiculosRef = useRef(loadVeiculos);
  loadVeiculosRef.current = loadVeiculos;

  // Ao focar a tela recarrega a lista (auto-seleciona se houver 1 veículo
  // ou abre o seletor para múltiplos). Ao sair, zera a seleção para que o
  // SearchBottomSheet reabra ao reentrar.
  useFocusEffect(
    useCallback(() => {
      loadVeiculosRef.current();
      return () => {
        setDispositivoIdAtivo('');
        setVehicleSelectorVisible(false);
      };
    }, []),
  );

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
        semAtualizacaoHoras: parseInt(semAtualizacaoHoras) || 3,
        kmExcedida: {
          kmMaximo30Dias: kmMaximo ? parseInt(kmMaximo) : null,
          diaRenovacaoMes: diaMes ? parseInt(diaMes) : null,
          diaSemanaRenovacao: diaSemanaExcedida,
          periodo: periodoExcedida,
        },
        kmReduzida: {
          kmMinimo7Dias: kmMinimo ? parseInt(kmMinimo) : null,
          diaSemanaRenovacao: diaSemana,
          diaRenovacaoMes: diaMesReduzida ? parseInt(diaMesReduzida) : null,
          periodo: periodoReduzida,
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

  const selectedDevice = veiculos.find(v => v.dispositivoId === dispositivoIdAtivo) || null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {/* Trocar de veículo — só aparece se houver mais de 1 e algum selecionado */}
      {veiculos.length > 1 && selectedDevice && (
        <Pressable
          accessibilityRole="button"
          style={styles.switchBar}
          onPress={() => setVehicleSelectorVisible(true)}
        >
          <View style={styles.switchBarInfo}>
            <Text style={styles.switchBarName} numberOfLines={1}>
              {selectedDevice.nome}
            </Text>
            {selectedDevice.placa ? (
              <Text style={styles.switchBarPlate} numberOfLines={1}>
                {selectedDevice.placa}
              </Text>
            ) : null}
          </View>
          <View style={styles.switchBarBtn}>
            <Icon source="swap-horizontal" size={18} color={colors.primary} />
            <Text style={styles.switchBarBtnText}>Trocar veículo</Text>
          </View>
        </Pressable>
      )}

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {loadingVeiculos && (
          <View style={styles.loading}>
            <ActivityIndicator />
          </View>
        )}

        {/* Sem veículos disponíveis */}
        {!loadingVeiculos && veiculos.length === 0 && (
          <View style={styles.emptyState}>
            <Icon source="bell-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Nenhum veículo disponível</Text>
            <Text style={styles.emptyText}>Não há veículos para configurar notificações.</Text>
          </View>
        )}

        {/* Empty state — múltiplos veículos e nenhum selecionado */}
        {!loadingVeiculos && veiculos.length > 1 && !selectedDevice && (
          <View style={styles.selectEmpty}>
            <Icon source="car-multiple" size={48} color={colors.textMuted} />
            <Text style={styles.selectEmptyTitle}>Selecione um veículo</Text>
            <Text style={styles.selectEmptySubtitle}>
              Escolha um veículo para configurar as notificações.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.selectEmptyBtn}
              onPress={() => setVehicleSelectorVisible(true)}
            >
              <Icon source="magnify" size={16} color={colors.primaryText} />
              <Text style={styles.selectEmptyBtnText}>Selecionar veículo</Text>
            </Pressable>
          </View>
        )}

        {/* Preferences Section */}
        {selectedDevice && (
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

                {/* Sem Atualização */}
                <Card style={styles.configCard} mode="outlined">
                  <Card.Content style={styles.configCardContent}>
                    <Text style={styles.configTitle}>Veículo sem Atualização</Text>
                    <Text style={styles.configHelp}>
                      Avisa quando o veículo ficar este tempo sem enviar atualização de posição. Defina a quantidade de horas.
                    </Text>
                    <View style={styles.speedInputWrap}>
                      <TextInput
                        mode="outlined"
                        value={semAtualizacaoHoras}
                        onChangeText={setSemAtualizacaoHoras}
                        keyboardType="numeric"
                        style={styles.speedInput}
                        dense
                      />
                      <Text style={styles.speedUnit}>horas</Text>
                    </View>
                  </Card.Content>
                </Card>

                {/* Km Period Config */}
                <Card style={styles.configCard} mode="outlined">
                  <Card.Content style={styles.configCardContent}>
                    <Text style={styles.configTitle}>Alerta de Quilometragem por Período</Text>

                    <View style={styles.kmSubSection}>
                      <Text style={styles.kmSubTitle}>Quilometragem Excedida</Text>
                      <Text style={styles.configHelp}>Notifica quando o veículo ultrapassar o km máximo dentro do período escolhido.</Text>
                      <View style={styles.kmInputs}>
                        <View style={styles.kmInputGroup}>
                          <Text style={styles.kmLabel}>Período</Text>
                          <Pressable
                            style={styles.vehicleSelector}
                            onPress={() => setPeriodoPickerVisivel('excedida')}
                          >
                            <Text style={styles.vehicleSelectorText}>
                              {PERIODOS_KM.find(p => p.value === periodoExcedida)?.label || 'Mensal'}
                            </Text>
                            <Icon source="chevron-down" size={20} color={colors.textMuted} />
                          </Pressable>
                        </View>
                        <View style={styles.kmInputGroup}>
                          <Text style={styles.kmLabel}>Km máximo no período</Text>
                          <TextInput
                            mode="outlined"
                            value={kmMaximo}
                            onChangeText={setKmMaximo}
                            keyboardType="numeric"
                            style={styles.kmInput}
                            dense
                          />
                        </View>
                        {/* A referência depende do período: dia da semana no semanal, dia do mês nos demais. */}
                        {periodoExcedida === 'SEMANAL' ? (
                          <View style={styles.kmInputGroup}>
                            <Text style={styles.kmLabel}>Dia que renova</Text>
                            <Pressable
                              style={styles.vehicleSelector}
                              onPress={() => setDayPickerExcedidaVisible(true)}
                            >
                              <Text style={styles.vehicleSelectorText}>
                                {diasSemana.find(d => d.value === diaSemanaExcedida)?.label || 'Selecione...'}
                              </Text>
                              <Icon source="chevron-down" size={20} color={colors.textMuted} />
                            </Pressable>
                          </View>
                        ) : (
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
                        )}
                      </View>
                    </View>

                    <View style={styles.kmSubSection}>
                      <Text style={styles.kmSubTitle}>Quilometragem Reduzida</Text>
                      <Text style={styles.configHelp}>Notifica ao fim de cada período se o veículo não atingir o km mínimo.</Text>
                      <View style={styles.kmInputs}>
                        <View style={styles.kmInputGroup}>
                          <Text style={styles.kmLabel}>Período</Text>
                          <Pressable
                            style={styles.vehicleSelector}
                            onPress={() => setPeriodoPickerVisivel('reduzida')}
                          >
                            <Text style={styles.vehicleSelectorText}>
                              {PERIODOS_KM.find(p => p.value === periodoReduzida)?.label || 'Semanal'}
                            </Text>
                            <Icon source="chevron-down" size={20} color={colors.textMuted} />
                          </Pressable>
                        </View>
                        <View style={styles.kmInputGroup}>
                          <Text style={styles.kmLabel}>Km mínimo no período</Text>
                          <TextInput
                            mode="outlined"
                            value={kmMinimo}
                            onChangeText={setKmMinimo}
                            keyboardType="numeric"
                            style={styles.kmInput}
                            dense
                          />
                        </View>
                        {periodoReduzida === 'SEMANAL' ? (
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
                          </View>
                        ) : (
                          <View style={styles.kmInputGroup}>
                            <Text style={styles.kmLabel}>Dia do mês que renova</Text>
                            <TextInput
                              mode="outlined"
                              value={diaMesReduzida}
                              onChangeText={setDiaMesReduzida}
                              keyboardType="numeric"
                              style={styles.kmInput}
                              dense
                            />
                          </View>
                        )}
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

      </ScrollView>

      {/* Seletores no nível da tela: dentro do card virariam modal sobre modal,
          que o iOS não abre. */}
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

      <BottomSheet
        visible={dayPickerExcedidaVisible}
        heightPercent={0.5}
        onClose={() => setDayPickerExcedidaVisible(false)}
        title="Dia da semana que renova o alerta"
      >
        <ScrollView style={styles.vehicleList}>
          {diasSemana.map(d => (
            <Pressable
              key={d.value}
              style={styles.vehicleItem}
              onPress={() => {
                setDiaSemanaExcedida(d.value);
                setDayPickerExcedidaVisible(false);
              }}
            >
              <Text style={styles.vehicleItemText}>{d.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={periodoPickerVisivel !== null}
        heightPercent={0.5}
        onClose={() => setPeriodoPickerVisivel(null)}
        title="Período de contagem"
      >
        <ScrollView style={styles.vehicleList}>
          {PERIODOS_KM.map(p => (
            <Pressable
              key={p.value}
              style={styles.vehicleItem}
              onPress={() => {
                if (periodoPickerVisivel === 'excedida') setPeriodoExcedida(p.value);
                else setPeriodoReduzida(p.value);
                setPeriodoPickerVisivel(null);
              }}
            >
              <Text style={styles.vehicleItemText}>{p.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>

      <SearchBottomSheet
        visible={vehicleSelectorVisible}
        devices={veiculos}
        title="Selecione o veículo"
        onClose={() => setVehicleSelectorVisible(false)}
        onSelectDevice={(device) => {
          setDispositivoIdAtivo(device.dispositivoId);
          setVehicleSelectorVisible(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
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
  switchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  switchBarInfo: {
    flex: 1,
    minWidth: 0,
  },
  switchBarName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  switchBarPlate: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  switchBarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  switchBarBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  selectEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  selectEmptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
    marginTop: spacing.xs,
  },
  selectEmptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  selectEmptyBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  selectEmptyBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primaryText,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
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
