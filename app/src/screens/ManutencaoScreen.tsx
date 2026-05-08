import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon, IconButton } from 'react-native-paper';

import { useConfirmDialog } from '../components/ConfirmDialogProvider';
import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';

type Dispositivo = {
  id: string;
  nome: string;
  placa: string | null;
};

type Recorrencia = {
  id: string;
  titulo: string;
  descricao?: string | null;
  intervaloKm: number;
  kmBase: number;
  ativa: boolean;
};

type Registro = {
  id: string;
  titulo: string;
  tipo: string | null;
  descricao: string | null;
  dataRealizacao: string;
  kmRealizacao: number | null;
  custo: number | null;
  oficina: string | null;
};

type AddRegistroPayload = {
  titulo: string;
  tipo: string;
  descricao: string;
  kmRealizacao: string;
  custo: string;
  oficina: string;
};

const TIPOS_MANUTENCAO = [
  'Troca de óleo',
  'Revisão geral',
  'Freios',
  'Pneus',
  'Filtros',
  'Correia dentada',
  'Suspensão',
  'Elétrica',
  'Outros',
];

const EMPTY_FORM: AddRegistroPayload = {
  titulo: '',
  tipo: 'Outros',
  descricao: '',
  kmRealizacao: '',
  custo: '',
  oficina: '',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtMoney(val: number | null) {
  if (val == null) return '—';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtKm(km: number | null) {
  if (km == null) return '—';
  return `${km.toLocaleString('pt-BR')} km`;
}

export function ManutencaoScreen() {
  const toast = useToast();
  const confirm = useConfirmDialog();
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([]);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'recorrencias' | 'registros'>('recorrencias');
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [form, setForm] = useState<AddRegistroPayload>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const loadDispositivos = useCallback(async () => {
    try {
      const snapshot = await apiRequest<{ dispositivos?: Dispositivo[] } | any>('/cliente/rastreamento/snapshot');
      const devs: Dispositivo[] = (snapshot?.dispositivos ?? snapshot ?? []).map((d: any) => ({
        id: d.dispositivoId ?? d.id,
        nome: d.nome,
        placa: d.placa ?? null,
      }));
      setDispositivos(devs);
      if (devs.length > 0 && !selectedId) setSelectedId(devs[0].id);
    } catch {
      toast.show({ message: 'Erro ao carregar dispositivos.', type: 'error' });
    }
  }, [selectedId, toast]);

  const loadData = useCallback(async (silent = false) => {
    if (!selectedId) return;
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const [rec, reg] = await Promise.all([
        apiRequest<Recorrencia[]>(`/cliente/manutencoes/recorrencias?dispositivoId=${selectedId}`).catch(() => []),
        apiRequest<Registro[]>(`/cliente/manutencoes/registros?dispositivoId=${selectedId}`).catch(() => []),
      ]);
      setRecorrencias((rec ?? []).filter(r => r.ativa !== false));
      setRegistros(reg ?? []);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadDispositivos();
  }, []);

  useEffect(() => {
    if (selectedId) loadData();
  }, [selectedId, loadData]);

  const markDone = async (r: Recorrencia) => {
    const confirmed = await confirm.show({
      title: 'Confirmar Manutenção',
      message: `Confirmar que "${r.titulo}" foi realizada?\n\nO contador será reiniciado a partir do odômetro atual.`,
      confirmLabel: 'Confirmar',
    });
    if (!confirmed) return;
    try {
      await apiRequest(`/cliente/manutencoes/recorrencias/${r.id}/feito`, { method: 'POST' });
      toast.show({ message: 'Manutenção confirmada!', type: 'success' });
      loadData(true);
    } catch {
      toast.show({ message: 'Erro ao confirmar manutenção.', type: 'error' });
    }
  };

  const deleteRegistro = async (id: string) => {
    const confirmed = await confirm.show({
      title: 'Excluir Registro',
      message: 'Deseja excluir este registro de manutenção?',
      confirmLabel: 'Excluir',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await apiRequest(`/cliente/manutencoes/registros/${id}`, { method: 'DELETE' });
      toast.show({ message: 'Registro excluído.', type: 'success' });
      setRegistros(prev => prev.filter(r => r.id !== id));
    } catch {
      toast.show({ message: 'Erro ao excluir registro.', type: 'error' });
    }
  };

  const saveRegistro = async () => {
    if (!form.titulo.trim()) {
      toast.show({ message: 'Informe o título da manutenção.', type: 'error' });
      return;
    }
    if (!selectedId) return;
    setIsSaving(true);
    try {
      await apiRequest('/cliente/manutencoes/registros', {
        method: 'POST',
        body: {
          dispositivoId: selectedId,
          titulo: form.titulo.trim(),
          tipo: form.tipo,
          descricao: form.descricao.trim() || null,
          kmRealizacao: form.kmRealizacao ? parseInt(form.kmRealizacao) : null,
          custo: form.custo ? parseFloat(form.custo.replace(',', '.')) : null,
          oficina: form.oficina.trim() || null,
          dataRealizacao: new Date().toISOString(),
        },
      });
      toast.show({ message: 'Registro adicionado!', type: 'success' });
      setAddModalVisible(false);
      setForm(EMPTY_FORM);
      setActiveTab('registros');
      loadData(true);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao salvar registro.',
        type: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedDevice = dispositivos.find(d => d.id === selectedId);

  return (
    <View style={styles.container}>
      {/* Device selector */}
      {dispositivos.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.deviceBar}
        >
          {dispositivos.map(d => (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              style={[styles.deviceChip, selectedId === d.id && styles.deviceChipActive]}
              onPress={() => setSelectedId(d.id)}
            >
              <Text style={[styles.deviceChipText, selectedId === d.id && styles.deviceChipTextActive]}>
                {d.placa ?? d.nome}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Tabs */}
      <View style={styles.tabs}>
        <Pressable
          accessibilityRole="button"
          style={[styles.tab, activeTab === 'recorrencias' && styles.tabActive]}
          onPress={() => setActiveTab('recorrencias')}
        >
          <Text style={[styles.tabText, activeTab === 'recorrencias' && styles.tabTextActive]}>
            Programadas
          </Text>
          {recorrencias.length > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{recorrencias.length}</Text>
            </View>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.tab, activeTab === 'registros' && styles.tabActive]}
          onPress={() => setActiveTab('registros')}
        >
          <Text style={[styles.tabText, activeTab === 'registros' && styles.tabTextActive]}>
            Histórico
          </Text>
          {registros.length > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{registros.length}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => loadData(true)} />}
        >
          {activeTab === 'recorrencias' && (
            recorrencias.length === 0 ? (
              <View style={styles.empty}>
                <Icon source="wrench-clock" size={40} color={colors.textMuted} />
                <Text style={styles.emptyText}>Nenhuma manutenção programada</Text>
                <Text style={styles.emptySubText}>
                  Configure manutenções recorrentes pelo portal web.
                </Text>
              </View>
            ) : (
              recorrencias.map(r => (
                <View key={r.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardIconWrap}>
                      <Icon source="wrench-clock" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle}>{r.titulo}</Text>
                      {r.descricao ? (
                        <Text style={styles.cardMeta}>{r.descricao}</Text>
                      ) : null}
                      <Text style={styles.cardMeta}>
                        A cada {r.intervaloKm.toLocaleString('pt-BR')} km
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      style={styles.doneBtn}
                      onPress={() => markDone(r)}
                    >
                      <Icon source="check-circle-outline" size={18} color={colors.success} />
                      <Text style={styles.doneBtnText}>Feito</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )
          )}

          {activeTab === 'registros' && (
            registros.length === 0 ? (
              <View style={styles.empty}>
                <Icon source="clipboard-list-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyText}>Nenhum registro encontrado</Text>
                <Text style={styles.emptySubText}>
                  Registre manutenções realizadas usando o botão abaixo.
                </Text>
              </View>
            ) : (
              registros.map(r => (
                <View key={r.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardIconWrap}>
                      <Icon source="clipboard-check" size={20} color="#8e44ad" />
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle}>{r.titulo}</Text>
                      <Text style={styles.cardMeta}>{fmtDate(r.dataRealizacao)}</Text>
                      {r.tipo ? <Text style={styles.cardTag}>{r.tipo}</Text> : null}
                      <View style={styles.cardStats}>
                        {r.kmRealizacao != null && (
                          <Text style={styles.cardStatText}>
                            <Text style={styles.cardStatLabel}>KM: </Text>
                            {fmtKm(r.kmRealizacao)}
                          </Text>
                        )}
                        {r.custo != null && (
                          <Text style={styles.cardStatText}>
                            <Text style={styles.cardStatLabel}>Custo: </Text>
                            {fmtMoney(r.custo)}
                          </Text>
                        )}
                        {r.oficina ? (
                          <Text style={styles.cardStatText}>
                            <Text style={styles.cardStatLabel}>Oficina: </Text>
                            {r.oficina}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <IconButton
                      icon="delete-outline"
                      size={18}
                      iconColor={colors.danger}
                      style={styles.deleteBtn}
                      onPress={() => deleteRegistro(r.id)}
                    />
                  </View>
                </View>
              ))
            )
          )}
        </ScrollView>
      )}

      {/* FAB */}
      <Pressable
        accessibilityRole="button"
        style={styles.fab}
        onPress={() => { setForm(EMPTY_FORM); setAddModalVisible(true); }}
      >
        <Icon source="plus" size={24} color={colors.primaryText} />
      </Pressable>

      {/* Add registro modal */}
      <Modal
        animationType="slide"
        transparent
        visible={addModalVisible}
        statusBarTranslucent
        onRequestClose={() => setAddModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Novo Registro de Manutenção</Text>
              <IconButton icon="close" size={22} onPress={() => setAddModalVisible(false)} />
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.formLabel}>Título *</Text>
              <TextInput
                style={styles.formInput}
                value={form.titulo}
                onChangeText={v => setForm(f => ({ ...f, titulo: v }))}
                placeholder="Ex: Troca de óleo"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.formLabel}>Tipo</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tiposScroll}>
                {TIPOS_MANUTENCAO.map(t => (
                  <Pressable
                    key={t}
                    style={[styles.tipoChip, form.tipo === t && styles.tipoChipActive]}
                    onPress={() => setForm(f => ({ ...f, tipo: t }))}
                  >
                    <Text style={[styles.tipoChipText, form.tipo === t && styles.tipoChipTextActive]}>{t}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={styles.formLabel}>KM na realização</Text>
              <TextInput
                style={styles.formInput}
                value={form.kmRealizacao}
                onChangeText={v => setForm(f => ({ ...f, kmRealizacao: v.replace(/\D/g, '') }))}
                placeholder="Ex: 45000"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
              />

              <Text style={styles.formLabel}>Custo (R$)</Text>
              <TextInput
                style={styles.formInput}
                value={form.custo}
                onChangeText={v => setForm(f => ({ ...f, custo: v }))}
                placeholder="Ex: 150,00"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />

              <Text style={styles.formLabel}>Oficina</Text>
              <TextInput
                style={styles.formInput}
                value={form.oficina}
                onChangeText={v => setForm(f => ({ ...f, oficina: v }))}
                placeholder="Nome da oficina"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.formLabel}>Observações</Text>
              <TextInput
                style={[styles.formInput, styles.formInputMulti]}
                value={form.descricao}
                onChangeText={v => setForm(f => ({ ...f, descricao: v }))}
                placeholder="Detalhes da manutenção..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
              />

              <Pressable
                style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
                onPress={saveRegistro}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={colors.primaryText} />
                ) : (
                  <Icon source="content-save" size={18} color={colors.primaryText} />
                )}
                <Text style={styles.saveBtnText}>Salvar Registro</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  deviceBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  deviceChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  deviceChipActive: {
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  deviceChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  deviceChipTextActive: {
    color: colors.primary,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.primary,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primaryText,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: 90,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl * 2,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  emptySubText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: spacing.xl,
  },
  card: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  cardMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  cardTag: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '700',
    color: '#8e44ad',
    backgroundColor: '#f3e5f5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  cardStats: {
    gap: 2,
    marginTop: 4,
  },
  cardStatText: {
    fontSize: 11,
    color: colors.text,
  },
  cardStatLabel: {
    fontWeight: '700',
    color: colors.textMuted,
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: '#f0faf4',
  },
  doneBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.success,
  },
  deleteBtn: {
    margin: 0,
    marginTop: -4,
    marginRight: -4,
  },
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23,32,42,0.4)',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.bottomSheet,
    borderTopRightRadius: radius.bottomSheet,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.xl,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  modalBody: {
    padding: spacing.xl,
    gap: 6,
    paddingBottom: spacing.xxl,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
    marginTop: spacing.sm,
  },
  formInput: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  formInputMulti: {
    height: 80,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  tiposScroll: {
    marginBottom: spacing.sm,
  },
  tipoChip: {
    marginRight: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  tipoChipActive: {
    borderColor: '#8e44ad',
    backgroundColor: '#f3e5f5',
  },
  tipoChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tipoChipTextActive: {
    color: '#8e44ad',
  },
  saveBtn: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.md,
    elevation: 2,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.primaryText,
  },
});
