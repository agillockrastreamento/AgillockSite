import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Icon, IconButton } from 'react-native-paper';

import { BottomSheet } from '../components/BottomSheet';
import { useConfirmDialog } from '../components/ConfirmDialogProvider';
import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';

type Dispositivo = {
  id: string;
  nome: string;
  placa: string | null;
  podeGerenciarManutencao: boolean;
  manutencaoAtiva: boolean;
};

type Recorrencia = {
  id: string;
  titulo: string;
  descricao?: string | null;
  intervaloKm: number;
  kmBase: number;
  ativa: boolean;
  origem?: string | null;
};

type ManutencaoFoto = {
  nome: string;
  dataUrl: string;
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
  notas?: string | null;
  fotos?: ManutencaoFoto[];
  origem?: string | null;
};

type AddRegistroPayload = {
  titulo: string;
  tipo: string;
  descricao: string;
  kmRealizacao: string;
  custo: string;
  oficina: string;
  dataRealizacao: string;
  notas: string;
  fotos: ManutencaoFoto[];
};

type AddRecorrenciaPayload = {
  titulo: string;
  descricao: string;
  intervaloKm: string;
};

const TIPOS_MANUTENCAO = [
  { value: 'preventiva', label: 'Preventiva' },
  { value: 'corretiva', label: 'Corretiva' },
  { value: 'revisao', label: 'Revisão' },
  { value: 'personalizado', label: 'Personalizado' },
];

const EMPTY_FORM: AddRegistroPayload = {
  titulo: '',
  tipo: 'preventiva',
  descricao: '',
  kmRealizacao: '',
  custo: '',
  oficina: '',
  dataRealizacao: new Date().toISOString().slice(0, 10),
  notas: '',
  fotos: [],
};

const EMPTY_RECORRENCIA: AddRecorrenciaPayload = {
  titulo: '',
  descricao: '',
  intervaloKm: '',
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '--/--/----';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--/--/----';
  return date.toLocaleDateString('pt-BR');
}

function fmtMoney(val: number | null) {
  if (val == null) return '—';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtKm(km: number | null) {
  if (km == null) return '—';
  return `${km.toLocaleString('pt-BR')} km`;
}

function tipoLabel(tipo: string | null | undefined) {
  return TIPOS_MANUTENCAO.find(t => t.value === tipo)?.label ?? tipo ?? 'Preventiva';
}

function parseDateInput(value: string) {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
  const [editingRegistroId, setEditingRegistroId] = useState<string | null>(null);
  const [expandedRegistros, setExpandedRegistros] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [addRecModalVisible, setAddRecModalVisible] = useState(false);
  const [formRec, setFormRec] = useState<AddRecorrenciaPayload>(EMPTY_RECORRENCIA);
  const [editingRecorrenciaId, setEditingRecorrenciaId] = useState<string | null>(null);
  const [isSavingRec, setIsSavingRec] = useState(false);

  const loadDispositivos = useCallback(async () => {
    try {
      const data = await apiRequest<any[]>('/cliente/rastreamento/posicoes');
      const devs: Dispositivo[] = (data ?? []).map((d: any) => ({
        id: d.dispositivoId ?? d.id,
        nome: d.nome,
        placa: d.placa ?? null,
        podeGerenciarManutencao: d.podeGerenciarManutencao ?? false,
        manutencaoAtiva: d.manutencaoAtiva !== false,
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

  // Quando manutenção está desativada, força aba de histórico
  useEffect(() => {
    const dev = dispositivos.find(d => d.id === selectedId);
    if (dev && !dev.manutencaoAtiva) setActiveTab('registros');
  }, [selectedId, dispositivos]);

  const resetRegistroForm = () => {
    setEditingRegistroId(null);
    setForm({ ...EMPTY_FORM, dataRealizacao: todayInput(), fotos: [] });
  };

  const resetRecorrenciaForm = () => {
    setEditingRecorrenciaId(null);
    setFormRec(EMPTY_RECORRENCIA);
  };

  const pickFotos = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show({ message: 'Permita acesso às fotos para anexar imagens.', type: 'error' });
      return;
    }
    const remaining = 5 - form.fotos.length;
    if (remaining <= 0) {
      toast.show({ message: 'Máximo de 5 fotos por registro.', type: 'error' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.65,
      base64: true,
    });
    if (result.canceled) return;
    const fotos = result.assets
      .filter(asset => asset.base64)
      .slice(0, remaining)
      .map((asset, index) => ({
        nome: asset.fileName ?? `foto-${Date.now()}-${index}.jpg`,
        dataUrl: `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`,
      }));
    setForm(prev => ({ ...prev, fotos: [...prev.fotos, ...fotos] }));
  };

  const removeFoto = (index: number) => {
    setForm(prev => ({ ...prev, fotos: prev.fotos.filter((_, i) => i !== index) }));
  };

  const editRegistro = (r: Registro) => {
    setEditingRegistroId(r.id);
    setForm({
      titulo: r.titulo,
      tipo: r.tipo || 'preventiva',
      descricao: r.descricao || '',
      kmRealizacao: r.kmRealizacao != null ? String(Math.round(r.kmRealizacao)) : '',
      custo: r.custo != null ? String(r.custo).replace('.', ',') : '',
      oficina: r.oficina || '',
      dataRealizacao: r.dataRealizacao ? new Date(r.dataRealizacao).toISOString().slice(0, 10) : todayInput(),
      notas: r.notas || '',
      fotos: Array.isArray(r.fotos) ? r.fotos : [],
    });
    setAddModalVisible(true);
  };

  const editRecorrencia = (r: Recorrencia) => {
    setEditingRecorrenciaId(r.id);
    setFormRec({
      titulo: r.titulo,
      descricao: r.descricao || '',
      intervaloKm: String(r.intervaloKm),
    });
    setAddRecModalVisible(true);
  };

  const markDone = async (r: Recorrencia) => {
    const confirmed = await confirm.show({
      title: 'Confirmar Manutenção',
      message: `Confirmar que "${r.titulo}" foi realizada?\n\nO contador será reiniciado a partir do odômetro atual.`,
      confirmLabel: 'Confirmar',
    });
    if (!confirmed) return;
    try {
      await apiRequest(`/cliente/manutencoes/recorrencias/${r.id}/feito`, { method: 'POST', body: {} });
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

  const deleteRecorrencia = async (id: string) => {
    const confirmed = await confirm.show({
      title: 'Excluir Programada',
      message: 'Deseja excluir esta manutenção programada?',
      confirmLabel: 'Excluir',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await apiRequest(`/cliente/manutencoes/recorrencias/${id}`, { method: 'DELETE' });
      toast.show({ message: 'Manutenção programada excluída.', type: 'success' });
      setRecorrencias(prev => prev.filter(r => r.id !== id));
    } catch {
      toast.show({ message: 'Erro ao excluir manutenção programada.', type: 'error' });
    }
  };

  const saveRegistro = async () => {
    if (!form.titulo.trim()) {
      toast.show({ message: 'Informe o título da manutenção.', type: 'error' });
      return;
    }
    const dataRealizacao = parseDateInput(form.dataRealizacao);
    if (!dataRealizacao) {
      toast.show({ message: 'Informe a data no formato AAAA-MM-DD.', type: 'error' });
      return;
    }
    if (!selectedId) return;
    setIsSaving(true);
    try {
      await apiRequest(editingRegistroId ? `/cliente/manutencoes/registros/${editingRegistroId}` : '/cliente/manutencoes/registros', {
        method: editingRegistroId ? 'PUT' : 'POST',
        body: {
          ...(editingRegistroId ? {} : { dispositivoId: selectedId }),
          titulo: form.titulo.trim(),
          tipo: form.tipo,
          descricao: form.descricao.trim() || null,
          kmRealizacao: form.kmRealizacao ? parseInt(form.kmRealizacao) : null,
          custo: form.custo ? parseFloat(form.custo.replace(',', '.')) : null,
          oficina: form.oficina.trim() || null,
          dataRealizacao,
          notas: form.notas.trim() || null,
          fotos: form.fotos,
        },
      });
      toast.show({ message: editingRegistroId ? 'Registro atualizado!' : 'Registro adicionado!', type: 'success' });
      setAddModalVisible(false);
      resetRegistroForm();
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

  const saveRecorrencia = async () => {
    if (!formRec.titulo.trim()) {
      toast.show({ message: 'Informe o título da manutenção programada.', type: 'error' });
      return;
    }
    const intervaloKmNum = parseInt(formRec.intervaloKm);
    if (!formRec.intervaloKm || isNaN(intervaloKmNum) || intervaloKmNum <= 0) {
      toast.show({ message: 'Informe um intervalo de KM válido.', type: 'error' });
      return;
    }
    if (!selectedId) return;
    setIsSavingRec(true);
    try {
      await apiRequest(editingRecorrenciaId ? `/cliente/manutencoes/recorrencias/${editingRecorrenciaId}` : '/cliente/manutencoes/recorrencias', {
        method: editingRecorrenciaId ? 'PUT' : 'POST',
        body: {
          ...(editingRecorrenciaId ? {} : { dispositivoId: selectedId }),
          titulo: formRec.titulo.trim(),
          descricao: formRec.descricao.trim() || null,
          intervaloKm: intervaloKmNum,
        },
      });
      toast.show({ message: editingRecorrenciaId ? 'Manutenção programada atualizada!' : 'Manutenção programada criada!', type: 'success' });
      setAddRecModalVisible(false);
      resetRecorrenciaForm();
      setActiveTab('recorrencias');
      loadData(true);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao criar manutenção programada.',
        type: 'error',
      });
    } finally {
      setIsSavingRec(false);
    }
  };

  const selectedDevice = dispositivos.find(d => d.id === selectedId);

  return (
    <View style={styles.container}>
      {/* Device selector */}
      {dispositivos.length > 1 && (
        <ScrollView
          horizontal
          style={styles.deviceBarScroll}
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

      {selectedDevice && !selectedDevice.manutencaoAtiva ? (
        <View style={styles.manutencaoBanner}>
          <Icon source="alert-outline" size={18} color="#856404" />
          <Text style={styles.manutencaoBannerText}>
            Manutenções desativadas para este dispositivo.
          </Text>
        </View>
      ) : (
        <>
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
        </>
      )}

      {(!selectedDevice || selectedDevice.manutencaoAtiva) && (
        isLoading ? (
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
                  {!selectedDevice?.manutencaoAtiva
                    ? 'Manutenções desativadas para este dispositivo.'
                    : selectedDevice?.podeGerenciarManutencao
                    ? 'Toque + para programar uma manutenção recorrente.'
                    : 'Apenas o responsável pelo faturamento pode configurar manutenções.'}
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
                    {selectedDevice?.podeGerenciarManutencao && selectedDevice?.manutencaoAtiva && (
                      <View style={styles.cardActions}>
                        {r.origem !== 'ADMIN' ? (
                          <>
                            <Pressable
                              accessibilityRole="button"
                              style={styles.doneBtn}
                              onPress={() => editRecorrencia(r)}
                            >
                              <Icon source="pencil" size={17} color="#2980b9" />
                              <Text style={[styles.doneBtnText, { color: '#2980b9' }]}>Editar</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              style={styles.doneBtn}
                              onPress={() => deleteRecorrencia(r.id)}
                            >
                              <Icon source="delete-outline" size={17} color={colors.danger} />
                              <Text style={[styles.doneBtnText, { color: colors.danger }]}>Excluir</Text>
                            </Pressable>
                          </>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          style={styles.doneBtn}
                          onPress={() => markDone(r)}
                        >
                          <Icon source="check-circle-outline" size={18} color={colors.success} />
                          <Text style={styles.doneBtnText}>Feito</Text>
                        </Pressable>
                      </View>
                    )}
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
              registros.map(r => {
                const fotos = Array.isArray(r.fotos) ? r.fotos : [];
                const hasExtra = Boolean(r.notas || fotos.length);
                const expanded = expandedRegistros[r.id];
                return (
                  <View key={r.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardIconWrap}>
                        <Icon source="clipboard-check" size={20} color="#8e44ad" />
                      </View>
                      <View style={styles.cardBody}>
                        <View style={styles.titleRow}>
                          <Text style={styles.cardTitle}>{r.titulo}</Text>
                          {r.tipo ? <Text style={styles.cardTag}>{tipoLabel(r.tipo)}</Text> : null}
                        </View>
                        <Text style={styles.cardMeta}>{fmtDate(r.dataRealizacao)}</Text>
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
                      <View style={styles.cardActions}>
                        {selectedDevice?.podeGerenciarManutencao && selectedDevice?.manutencaoAtiva && r.origem !== 'ADMIN' ? (
                          <>
                            <IconButton
                              icon="pencil"
                              size={18}
                              iconColor="#2980b9"
                              style={styles.deleteBtn}
                              onPress={() => editRegistro(r)}
                            />
                            <IconButton
                              icon="delete-outline"
                              size={18}
                              iconColor={colors.danger}
                              style={styles.deleteBtn}
                              onPress={() => deleteRegistro(r.id)}
                            />
                          </>
                        ) : null}
                        {hasExtra ? (
                          <IconButton
                            icon={expanded ? 'chevron-up' : 'chevron-down'}
                            size={20}
                            iconColor={colors.textMuted}
                            style={styles.deleteBtn}
                            onPress={() => setExpandedRegistros(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                          />
                        ) : null}
                      </View>
                    </View>
                    {hasExtra && expanded ? (
                      <View style={styles.extraBox}>
                        {r.notas ? <Text style={styles.notesText}>{r.notas}</Text> : null}
                        {fotos.length ? (
                          <View style={styles.photoGrid}>
                            {fotos.map((foto, index) => (
                              <Image key={`${foto.nome}-${index}`} source={{ uri: foto.dataUrl }} style={styles.photoThumb} />
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )
          )}
        </ScrollView>
      ))}

      {/* FAB — only show if user can manage this device and maintenance is enabled */}
      {selectedDevice?.podeGerenciarManutencao && selectedDevice?.manutencaoAtiva && (
        <Pressable
          accessibilityRole="button"
          style={styles.fab}
          onPress={() => {
            if (activeTab === 'recorrencias') {
              resetRecorrenciaForm();
              setAddRecModalVisible(true);
            } else {
              resetRegistroForm();
              setAddModalVisible(true);
            }
          }}
        >
          <Icon source="plus" size={24} color={colors.primaryText} />
        </Pressable>
      )}

      {/* Add recorrência — Bottom Sheet */}
      <BottomSheet
        visible={addRecModalVisible}
        onClose={() => {
          setAddRecModalVisible(false);
          resetRecorrenciaForm();
        }}
        title={editingRecorrenciaId ? 'Editar Manutenção Programada' : 'Nova Manutenção Programada'}
        heightPercent={0.72}
      >
        <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.formLabel}>Título *</Text>
          <TextInput
            style={styles.formInput}
            value={formRec.titulo}
            onChangeText={v => setFormRec(f => ({ ...f, titulo: v }))}
            placeholder="Ex: Troca de óleo"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.formLabel}>Intervalo (km) *</Text>
          <TextInput
            style={styles.formInput}
            value={formRec.intervaloKm}
            onChangeText={v => setFormRec(f => ({ ...f, intervaloKm: v.replace(/\D/g, '') }))}
            placeholder="Ex: 10000"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
          />

          <Text style={styles.formLabel}>Observações</Text>
          <TextInput
            style={[styles.formInput, styles.formInputMulti]}
            value={formRec.descricao}
            onChangeText={v => setFormRec(f => ({ ...f, descricao: v }))}
            placeholder="Detalhes da manutenção programada..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
          />

          <Pressable
            style={[styles.saveBtn, isSavingRec && styles.saveBtnDisabled]}
            onPress={saveRecorrencia}
            disabled={isSavingRec}
          >
            {isSavingRec ? (
              <ActivityIndicator size="small" color={colors.primaryText} />
            ) : (
              <Icon source="content-save" size={18} color={colors.primaryText} />
            )}
            <Text style={styles.saveBtnText}>{editingRecorrenciaId ? 'Atualizar' : 'Salvar'}</Text>
          </Pressable>
        </ScrollView>
      </BottomSheet>

      {/* Add registro — Bottom Sheet */}
      <BottomSheet
        visible={addModalVisible}
        onClose={() => {
          setAddModalVisible(false);
          resetRegistroForm();
        }}
        title={editingRegistroId ? 'Editar Registro de Manutenção' : 'Novo Registro de Manutenção'}
        heightPercent={0.88}
      >
        <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
                key={t.value}
                style={[styles.tipoChip, form.tipo === t.value && styles.tipoChipActive]}
                onPress={() => setForm(f => ({ ...f, tipo: t.value }))}
              >
                <Text style={[styles.tipoChipText, form.tipo === t.value && styles.tipoChipTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.formLabel}>Data da realização</Text>
          <TextInput
            style={styles.formInput}
            value={form.dataRealizacao}
            onChangeText={v => setForm(f => ({ ...f, dataRealizacao: v }))}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={colors.textMuted}
          />

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

          <Text style={styles.formLabel}>Notas</Text>
          <TextInput
            style={[styles.formInput, styles.formInputMulti]}
            value={form.notas}
            onChangeText={v => setForm(f => ({ ...f, notas: v }))}
            placeholder="Notas internas, peças, garantias..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
          />

          <View style={styles.photosHeader}>
            <Text style={styles.formLabel}>Fotos</Text>
            <Pressable style={styles.addPhotoBtn} onPress={pickFotos}>
              <Icon source="image-plus" size={16} color={colors.primaryText} />
              <Text style={styles.addPhotoText}>Adicionar</Text>
            </Pressable>
          </View>
          {form.fotos.length ? (
            <View style={styles.photoGrid}>
              {form.fotos.map((foto, index) => (
                <View key={`${foto.nome}-${index}`} style={styles.photoPreviewItem}>
                  <Image source={{ uri: foto.dataUrl }} style={styles.photoThumb} />
                  <Pressable style={styles.removePhotoBtn} onPress={() => removeFoto(index)}>
                    <Icon source="close" size={13} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

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
            <Text style={styles.saveBtnText}>{editingRegistroId ? 'Atualizar Registro' : 'Salvar Registro'}</Text>
          </Pressable>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  deviceBarScroll: {
    flexGrow: 0,
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
  manutencaoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: '#fff3cd',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#ffc107',
  },
  manutencaoBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#856404',
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
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
    width: '100%'
  },
  doneBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.success,
  },
  cardActions: {
    alignItems: 'flex-end',
    gap: 4,
  },
  iconActionBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  deleteBtn: {
    margin: 0,
    marginTop: -4,
    marginRight: -4,
  },
  extraBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  notesText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  photoPreviewItem: {
    position: 'relative',
  },
  removePhotoBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: colors.danger,
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
  photosHeader: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  addPhotoText: {
    color: colors.primaryText,
    fontSize: 12,
    fontWeight: '800',
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
