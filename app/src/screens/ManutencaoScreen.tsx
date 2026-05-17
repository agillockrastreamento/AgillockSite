import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
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
  dispositivo?: { odometroSistemaMetros?: number | null } | null;
};

type RecorrenciaData = {
  id: string;
  titulo: string;
  descricao?: string | null;
  tipoRecorrencia: string;
  dataReferencia: string;
  intervaloDias?: number | null;
  diasSemana?: number[] | null;
  diaDoMes?: number | null;
  mesDoAno?: number | null;
  ciclosCompletos: number;
  ativa: boolean;
  origem?: string | null;
  canalNotificacao?: string | null;
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
  historicoBase: 'data' | 'km' | 'ambos';
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

type AddRecorrenciaDataPayload = {
  titulo: string;
  descricao: string;
  tipoRecorrencia: string;
  dataReferencia: string;
  intervaloDias: string;
  diasSemana: number[];
  diaDoMes: string;
  mesDoAno: string;
};

const TIPOS_MANUTENCAO = [
  { value: 'preventiva', label: 'Preventiva' },
  { value: 'corretiva', label: 'Corretiva' },
  { value: 'revisao', label: 'Revisão' },
  { value: 'personalizado', label: 'Personalizado' },
];

const BASES_HISTORICO = [
  { value: 'data' as const, label: 'Por data' },
  { value: 'km' as const, label: 'Por KM' },
  { value: 'ambos' as const, label: 'Data + KM' },
];

const TIPOS_REC_DATA = [
  { value: 'AVULSA', label: 'Avulsa' },
  { value: 'INTERVALO', label: 'Intervalo' },
  { value: 'SEMANAL', label: 'Semanal' },
  { value: 'MENSAL', label: 'Mensal' },
  { value: 'ANUAL', label: 'Anual' },
];

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const EMPTY_FORM: AddRegistroPayload = {
  titulo: '',
  tipo: 'preventiva',
  historicoBase: 'data',
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

const EMPTY_REC_DATA: AddRecorrenciaDataPayload = {
  titulo: '',
  descricao: '',
  tipoRecorrencia: 'AVULSA',
  dataReferencia: new Date().toISOString().slice(0, 10),
  intervaloDias: '',
  diasSemana: [],
  diaDoMes: '',
  mesDoAno: '',
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '--/--/----';
  const datePart = String(iso).slice(0, 10);
  const date = new Date(datePart + 'T12:00:00');
  if (Number.isNaN(date.getTime())) return '--/--/----';
  return date.toLocaleDateString('pt-BR');
}

function diffDias(dataStr: string): number {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const datePart = String(dataStr).slice(0, 10);
  const data = new Date(datePart + 'T12:00:00'); data.setHours(0, 0, 0, 0);
  return Math.ceil((data.getTime() - hoje.getTime()) / 86400000);
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
  if (tipo === 'recorrencia') return 'Recorrência KM';
  if (tipo === 'recorrenciaData') return 'Recorrência Data';
  return TIPOS_MANUTENCAO.find(t => t.value === tipo)?.label ?? tipo ?? 'Preventiva';
}

function tipoRegistroNormalizado(registro: Registro) {
  const tipo = registro.tipo || 'preventiva';
  const texto = `${registro.titulo || ''} ${registro.descricao || ''}`.toLowerCase();
  if (tipo === 'recorrencia' && texto.includes('por data')) return 'recorrenciaData';
  return tipo;
}

function registroVisual(tipo: string) {
  switch (tipo) {
    case 'preventiva':
      return { icon: 'shield-check-outline', color: '#27ae60', bg: 'rgba(39,174,96,.1)' };
    case 'corretiva':
      return { icon: 'wrench-outline', color: '#e67e22', bg: 'rgba(230,126,34,.1)' };
    case 'revisao':
      return { icon: 'clipboard-search-outline', color: '#2980b9', bg: 'rgba(41,128,185,.1)' };
    case 'personalizado':
      return { icon: 'star-outline', color: '#8e44ad', bg: 'rgba(142,68,173,.1)' };
    case 'recorrencia':
      return { icon: 'speedometer', color: '#b47d00', bg: 'rgba(250,179,44,.14)' };
    case 'recorrenciaData':
      return { icon: 'calendar-check-outline', color: '#8e44ad', bg: 'rgba(142,68,173,.1)' };
    default:
      return { icon: 'clipboard-check-outline', color: colors.primary, bg: 'rgba(31,111,159,.1)' };
  }
}

function parseDateInput(value: string) {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function descRecData(r: RecorrenciaData): string {
  switch (r.tipoRecorrencia) {
    case 'AVULSA': return 'Data única';
    case 'INTERVALO': return `A cada ${r.intervaloDias ?? '?'} dias`;
    case 'SEMANAL': return `Semanal: ${(r.diasSemana ?? []).map(d => DIAS_SEMANA[d]).join(', ')}`;
    case 'MENSAL': return `Todo dia ${r.diaDoMes} do mês`;
    case 'ANUAL': {
      const mesIdx = (r.mesDoAno ?? 1) - 1;
      return `Todo ${r.diaDoMes}/${MESES_ABREV[mesIdx] ?? r.mesDoAno}`;
    }
    default: return '';
  }
}

export function ManutencaoScreen() {
  const toast = useToast();
  const confirm = useConfirmDialog();
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([]);
  const [recorrenciasData, setRecorrenciasData] = useState<RecorrenciaData[]>([]);
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
  const [chooserVisible, setChooserVisible] = useState(false);
  const [addRecDataModalVisible, setAddRecDataModalVisible] = useState(false);
  const [formRecData, setFormRecData] = useState<AddRecorrenciaDataPayload>(EMPTY_REC_DATA);
  const [editingRecDataId, setEditingRecDataId] = useState<string | null>(null);
  const [isSavingRecData, setIsSavingRecData] = useState(false);
  const [showDatePickerRef, setShowDatePickerRef] = useState(false);
  const [showDatePickerRegistro, setShowDatePickerRegistro] = useState(false);

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
      const [rec, reg, recData] = await Promise.all([
        apiRequest<Recorrencia[]>(`/cliente/manutencoes/recorrencias?dispositivoId=${selectedId}`).catch(() => []),
        apiRequest<Registro[]>(`/cliente/manutencoes/registros?dispositivoId=${selectedId}`).catch(() => []),
        apiRequest<RecorrenciaData[]>(`/cliente/manutencoes/recorrencias-data?dispositivoId=${selectedId}`).catch(() => []),
      ]);
      setRecorrencias((rec ?? []).filter(r => r.ativa !== false));
      setRegistros(reg ?? []);
      setRecorrenciasData((recData ?? []).filter(r => r.ativa !== false));
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

  const resetRecDataForm = () => {
    setEditingRecDataId(null);
    setFormRecData({ ...EMPTY_REC_DATA, dataReferencia: todayInput() });
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
      historicoBase: r.kmRealizacao != null ? 'ambos' : 'data',
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

  const editRecorrenciaData = (r: RecorrenciaData) => {
    setEditingRecDataId(r.id);
    setFormRecData({
      titulo: r.titulo,
      descricao: r.descricao || '',
      tipoRecorrencia: r.tipoRecorrencia || 'AVULSA',
      dataReferencia: r.dataReferencia ? new Date(r.dataReferencia).toISOString().slice(0, 10) : todayInput(),
      intervaloDias: r.intervaloDias != null ? String(r.intervaloDias) : '',
      diasSemana: Array.isArray(r.diasSemana) ? r.diasSemana : [],
      diaDoMes: r.diaDoMes != null ? String(r.diaDoMes) : '',
      mesDoAno: r.mesDoAno != null ? String(r.mesDoAno) : '',
    });
    setAddRecDataModalVisible(true);
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

  const markDoneData = async (r: RecorrenciaData) => {
    const confirmed = await confirm.show({
      title: 'Confirmar Manutenção',
      message: `Confirmar que "${r.titulo}" foi realizada?${r.tipoRecorrencia !== 'AVULSA' ? '\n\nA próxima data será calculada automaticamente.' : '\n\nEsta ocorrência avulsa será encerrada.'}`,
      confirmLabel: 'Confirmar',
    });
    if (!confirmed) return;
    try {
      const result = await apiRequest<{ proximaData?: string }>(`/cliente/manutencoes/recorrencias-data/${r.id}/feito`, { method: 'POST', body: {} });
      const msg = result?.proximaData
        ? `Confirmado! Próxima ocorrência: ${fmtDate(result.proximaData)}.`
        : 'Manutenção confirmada!';
      toast.show({ message: msg, type: 'success' });
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

  const deleteRecorrenciaData = async (id: string) => {
    const confirmed = await confirm.show({
      title: 'Cancelar Recorrência',
      message: 'Deseja cancelar esta recorrência por data? Os alertas serão interrompidos.',
      confirmLabel: 'Cancelar',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await apiRequest(`/cliente/manutencoes/recorrencias-data/${id}`, { method: 'DELETE' });
      toast.show({ message: 'Recorrência por data removida.', type: 'success' });
      setRecorrenciasData(prev => prev.filter(r => r.id !== id));
    } catch {
      toast.show({ message: 'Erro ao remover recorrência por data.', type: 'error' });
    }
  };

  const saveRegistro = async () => {
    if (!form.titulo.trim()) {
      toast.show({ message: 'Informe o título da manutenção.', type: 'error' });
      return;
    }
    const dataRealizacao = parseDateInput(form.dataRealizacao);
    if (!dataRealizacao) {
      toast.show({ message: 'Informe a data da realização.', type: 'error' });
      return;
    }
    const exigeKm = form.historicoBase === 'km' || form.historicoBase === 'ambos';
    const kmRealizacao = form.kmRealizacao ? parseInt(form.kmRealizacao) : null;
    if (exigeKm && (!kmRealizacao || kmRealizacao <= 0)) {
      toast.show({ message: 'Informe o KM da realização.', type: 'error' });
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
          kmRealizacao: form.historicoBase === 'data' ? null : kmRealizacao,
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

  const saveRecorrenciaData = async () => {
    if (!formRecData.titulo.trim()) {
      toast.show({ message: 'Informe o título.', type: 'error' });
      return;
    }
    if (formRecData.tipoRecorrencia === 'INTERVALO') {
      const n = parseInt(formRecData.intervaloDias);
      if (!formRecData.intervaloDias || isNaN(n) || n < 1) {
        toast.show({ message: 'Informe um intervalo de dias válido.', type: 'error' });
        return;
      }
    }
    if (formRecData.tipoRecorrencia === 'SEMANAL' && formRecData.diasSemana.length === 0) {
      toast.show({ message: 'Selecione ao menos um dia da semana.', type: 'error' });
      return;
    }
    if (formRecData.tipoRecorrencia === 'MENSAL' || formRecData.tipoRecorrencia === 'ANUAL') {
      const dia = parseInt(formRecData.diaDoMes);
      if (!formRecData.diaDoMes || isNaN(dia) || dia < 1 || dia > 31) {
        toast.show({ message: 'Informe um dia do mês válido (1-31).', type: 'error' });
        return;
      }
    }
    if (formRecData.tipoRecorrencia === 'ANUAL') {
      const mes = parseInt(formRecData.mesDoAno);
      if (!formRecData.mesDoAno || isNaN(mes) || mes < 1 || mes > 12) {
        toast.show({ message: 'Informe um mês válido (1-12).', type: 'error' });
        return;
      }
    }

    let dataRef: string | null;
    if (formRecData.tipoRecorrencia === 'MENSAL') {
      const dia = parseInt(formRecData.diaDoMes);
      const hoje = new Date();
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
      if (d <= hoje) d.setMonth(d.getMonth() + 1);
      dataRef = d.toISOString().slice(0, 10);
    } else if (formRecData.tipoRecorrencia === 'ANUAL') {
      const dia = parseInt(formRecData.diaDoMes);
      const mes = parseInt(formRecData.mesDoAno);
      const hoje = new Date();
      const passado = hoje.getMonth() + 1 > mes || (hoje.getMonth() + 1 === mes && hoje.getDate() >= dia);
      const ano = passado ? hoje.getFullYear() + 1 : hoje.getFullYear();
      dataRef = new Date(ano, mes - 1, dia).toISOString().slice(0, 10);
    } else {
      dataRef = parseDateInput(formRecData.dataReferencia);
      if (!dataRef) {
        toast.show({ message: 'Informe a data no formato AAAA-MM-DD.', type: 'error' });
        return;
      }
    }

    if (!selectedId) return;
    setIsSavingRecData(true);
    try {
      await apiRequest(
        editingRecDataId
          ? `/cliente/manutencoes/recorrencias-data/${editingRecDataId}`
          : '/cliente/manutencoes/recorrencias-data',
        {
          method: editingRecDataId ? 'PUT' : 'POST',
          body: {
            ...(editingRecDataId ? {} : { dispositivoId: selectedId }),
            titulo: formRecData.titulo.trim(),
            descricao: formRecData.descricao.trim() || null,
            tipoRecorrencia: formRecData.tipoRecorrencia,
            dataReferencia: dataRef,
            intervaloDias: formRecData.tipoRecorrencia === 'INTERVALO' ? parseInt(formRecData.intervaloDias) : null,
            diasSemana: formRecData.tipoRecorrencia === 'SEMANAL' ? formRecData.diasSemana : null,
            diaDoMes: ['MENSAL', 'ANUAL'].includes(formRecData.tipoRecorrencia) ? parseInt(formRecData.diaDoMes) : null,
            mesDoAno: formRecData.tipoRecorrencia === 'ANUAL' ? parseInt(formRecData.mesDoAno) : null,
          },
        }
      );
      toast.show({
        message: editingRecDataId ? 'Recorrência por data atualizada!' : 'Recorrência por data criada!',
        type: 'success',
      });
      setAddRecDataModalVisible(false);
      resetRecDataForm();
      setActiveTab('recorrencias');
      loadData(true);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao salvar recorrência por data.',
        type: 'error',
      });
    } finally {
      setIsSavingRecData(false);
    }
  };

  const selectedDevice = dispositivos.find(d => d.id === selectedId);
  const totalProgramadas = recorrencias.length + recorrenciasData.length;

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
            Manutenções desativadas para este dispositivo. Você não poderá registrar manutenções ou configurar recorrências.
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
              {totalProgramadas > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{totalProgramadas}</Text>
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
            totalProgramadas === 0 ? (
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
              <>
                {recorrencias.map(r => {
                  const kmAtual = (r.dispositivo?.odometroSistemaMetros ?? 0) / 1000;
                  const kmPercorrido = kmAtual - r.kmBase;
                  const kmRestante = r.intervaloKm - kmPercorrido;
                  const pct = Math.min(100, Math.max(0, (kmPercorrido / r.intervaloKm) * 100));
                  const kmPercorridoLabel = Math.max(0, Math.round(kmPercorrido)).toLocaleString('pt-BR');
                  const kmTotalLabel = r.intervaloKm.toLocaleString('pt-BR');
                  let stColor: string, stBg: string, stLabel: string;
                  if (kmRestante > 50) {
                    stColor = colors.success; stBg = 'rgba(39,174,96,.1)'; stLabel = 'Em dia';
                  } else if (kmRestante > 25) {
                    stColor = '#e67e22'; stBg = 'rgba(230,126,34,.1)'; stLabel = `Atenção — ${Math.round(kmRestante).toLocaleString('pt-BR')} km restantes`;
                  } else if (kmRestante > 0) {
                    stColor = colors.danger; stBg = 'rgba(231,76,60,.1)'; stLabel = `Urgente — ${Math.round(kmRestante).toLocaleString('pt-BR')} km restantes`;
                  } else {
                    stColor = colors.danger; stBg = 'rgba(231,76,60,.1)'; stLabel = `Vencido — ${Math.round(Math.abs(kmRestante)).toLocaleString('pt-BR')} km além`;
                  }
                  return (
                  <View key={r.id} style={[styles.card, { borderLeftWidth: 2, borderLeftColor: stColor }]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.cardIconWrap, { backgroundColor: 'rgba(250,179,44,.12)' }]}>
                        <Icon source="wrench-clock" size={20} color={colors.primary} />
                      </View>
                      <View style={styles.cardBody}>
                        <View style={styles.titleRow}>
                          <Text style={styles.cardTitle}>{r.titulo}</Text>
                          <Text style={styles.cardTagKm}>Por KM</Text>
                        </View>
                        {r.descricao ? (
                          <Text style={styles.cardMeta}>{r.descricao}</Text>
                        ) : null}
                        <Text style={styles.cardMeta}>
                          A cada {r.intervaloKm.toLocaleString('pt-BR')} km
                        </Text>
                        <View style={styles.progressWrap}>
                          <View style={styles.progressBg}>
                            <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: stColor }]} />
                          </View>
                          <View style={styles.progressInfo}>
                            <Text style={styles.progressInfoText}>{kmPercorridoLabel} km percorridos</Text>
                            <Text style={styles.progressInfoText}>{kmTotalLabel} km total</Text>
                          </View>
                        </View>
                        <View style={[styles.recStatusBadge, { backgroundColor: stBg }]}>
                          <Text style={[styles.recStatusText, { color: stColor }]}>{stLabel}</Text>
                        </View>
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
                  );
                })}

                {recorrenciasData.map(r => {
                  const dias = diffDias(r.dataReferencia);
                  let dtColor: string, dtBg: string, dtLabel: string;
                  if (dias > 4) {
                    dtColor = colors.success; dtBg = 'rgba(39,174,96,.1)'; dtLabel = `Em dia — ${dias} dias`;
                  } else if (dias > 0) {
                    dtColor = '#e67e22'; dtBg = 'rgba(230,126,34,.1)'; dtLabel = `Atenção — ${dias} dia${dias > 1 ? 's' : ''}`;
                  } else if (dias === 0) {
                    dtColor = '#8e44ad'; dtBg = 'rgba(142,68,173,.1)'; dtLabel = 'Hoje!';
                  } else {
                    dtColor = colors.danger; dtBg = 'rgba(231,76,60,.1)'; dtLabel = `Atrasada — ${Math.abs(dias)} dia${Math.abs(dias) > 1 ? 's' : ''}`;
                  }
                  return (
                  <View key={r.id} style={[styles.card, { borderLeftWidth: 2, borderLeftColor: dtColor }]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.cardIconWrap, { backgroundColor: 'rgba(31,111,159,.1)' }]}>
                        <Icon source="calendar-clock" size={20} color="#1f6f9f" />
                      </View>
                      <View style={styles.cardBody}>
                        <View style={styles.titleRow}>
                          <Text style={styles.cardTitle}>{r.titulo}</Text>
                          <Text style={styles.cardTagData}>Por Data</Text>
                        </View>
                        {r.descricao ? (
                          <Text style={styles.cardMeta}>{r.descricao}</Text>
                        ) : null}
                        <Text style={styles.cardMeta}>{descRecData(r)}</Text>
                        <Text style={styles.cardMeta}>
                          Próxima: <Text style={{ fontWeight: '700', color: dtColor }}>{fmtDate(r.dataReferencia)}</Text>
                        </Text>
                        <View style={[styles.recStatusBadge, { backgroundColor: dtBg }]}>
                          <Text style={[styles.recStatusText, { color: dtColor }]}>{dtLabel}</Text>
                        </View>
                      </View>
                      {selectedDevice?.podeGerenciarManutencao && selectedDevice?.manutencaoAtiva && (
                        <View style={styles.cardActions}>
                          {r.origem !== 'ADMIN' ? (
                            <>
                              <Pressable
                                accessibilityRole="button"
                                style={styles.doneBtn}
                                onPress={() => editRecorrenciaData(r)}
                              >
                                <Icon source="pencil" size={17} color="#2980b9" />
                                <Text style={[styles.doneBtnText, { color: '#2980b9' }]}>Editar</Text>
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                style={styles.doneBtn}
                                onPress={() => deleteRecorrenciaData(r.id)}
                              >
                                <Icon source="delete-outline" size={17} color={colors.danger} />
                                <Text style={[styles.doneBtnText, { color: colors.danger }]}>Excluir</Text>
                              </Pressable>
                            </>
                          ) : null}
                          <Pressable
                            accessibilityRole="button"
                            style={styles.doneBtn}
                            onPress={() => markDoneData(r)}
                          >
                            <Icon source="check-circle-outline" size={18} color={colors.success} />
                            <Text style={styles.doneBtnText}>Feito</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  </View>
                  );
                })}
              </>
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
                const tipoNormalizado = tipoRegistroNormalizado(r);
                const visual = registroVisual(tipoNormalizado);
                const isAdmin = r.origem === 'ADMIN';
                return (
                  <View key={r.id} style={[styles.card, { borderLeftWidth: 2, borderLeftColor: visual.color }]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.cardIconWrap, { backgroundColor: visual.bg }]}>
                        <Icon source={visual.icon} size={20} color={visual.color} />
                      </View>
                      <View style={styles.cardBody}>
                        <View style={styles.titleRow}>
                          <Text style={styles.cardTitle}>{r.titulo}</Text>
                          <Text style={[styles.cardTag, { color: visual.color, backgroundColor: visual.bg }]}>
                            {tipoLabel(tipoNormalizado)}
                          </Text>
                          {isAdmin ? (
                            <Text style={styles.adminTag}>Admin</Text>
                          ) : null}
                        </View>
                        {r.descricao ? (
                          <Text style={styles.historyDescription} numberOfLines={2}>{r.descricao}</Text>
                        ) : null}
                        <View style={styles.historyMetaGrid}>
                          <View style={styles.historyMetaPill}>
                            <Icon source="calendar-month-outline" size={13} color={colors.textMuted} />
                            <Text style={styles.historyMetaText}>{fmtDate(r.dataRealizacao)}</Text>
                          </View>
                          {r.kmRealizacao != null && (
                            <View style={styles.historyMetaPill}>
                              <Icon source="road-variant" size={13} color={colors.textMuted} />
                              <Text style={styles.historyMetaText}>{fmtKm(r.kmRealizacao)}</Text>
                            </View>
                          )}
                          {r.custo != null && (
                            <View style={styles.historyMetaPill}>
                              <Icon source="cash" size={13} color={colors.textMuted} />
                              <Text style={styles.historyMetaText}>{fmtMoney(r.custo)}</Text>
                            </View>
                          )}
                          {r.oficina ? (
                            <View style={styles.historyMetaPill}>
                              <Icon source="store-outline" size={13} color={colors.textMuted} />
                              <Text style={styles.historyMetaText}>{r.oficina}</Text>
                            </View>
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

      {/* FAB */}
      {selectedDevice?.podeGerenciarManutencao && selectedDevice?.manutencaoAtiva && (
        <Pressable
          accessibilityRole="button"
          style={styles.fab}
          onPress={() => {
            if (activeTab === 'recorrencias') {
              setChooserVisible(true);
            } else {
              resetRegistroForm();
              setAddModalVisible(true);
            }
          }}
        >
          <Icon source="plus" size={24} color={colors.primaryText} />
        </Pressable>
      )}

      {/* Chooser — tipo de recorrência */}
      <BottomSheet
        visible={chooserVisible}
        onClose={() => setChooserVisible(false)}
        title="Tipo de Manutenção Programada"
        heightPercent={0.38}
      >
        <View style={styles.chooserBody}>
          <Pressable
            accessibilityRole="button"
            style={styles.chooserOption}
            onPress={() => {
              setChooserVisible(false);
              resetRecorrenciaForm();
              setAddRecModalVisible(true);
            }}
          >
            <View style={[styles.chooserIconWrap, { backgroundColor: '#fff7e3' }]}>
              <Icon source="counter" size={26} color={colors.primary} />
            </View>
            <View style={styles.chooserOptionBody}>
              <Text style={styles.chooserOptionTitle}>Por KM</Text>
              <Text style={styles.chooserOptionSub}>A cada X quilômetros rodados</Text>
            </View>
            <Icon source="chevron-right" size={20} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={styles.chooserOption}
            onPress={() => {
              setChooserVisible(false);
              resetRecDataForm();
              setAddRecDataModalVisible(true);
            }}
          >
            <View style={[styles.chooserIconWrap, { backgroundColor: '#e8f4fd' }]}>
              <Icon source="calendar-clock" size={26} color="#1f6f9f" />
            </View>
            <View style={styles.chooserOptionBody}>
              <Text style={styles.chooserOptionTitle}>Por Data</Text>
              <Text style={styles.chooserOptionSub}>Avulsa, semanal, mensal, anual...</Text>
            </View>
            <Icon source="chevron-right" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      </BottomSheet>

      {/* Add recorrência por KM — Bottom Sheet */}
      <BottomSheet
        visible={addRecModalVisible}
        onClose={() => {
          setAddRecModalVisible(false);
          resetRecorrenciaForm();
        }}
        title={editingRecorrenciaId ? 'Editar Manutenção Programada' : 'Nova Manutenção por KM'}
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

      {/* Add recorrência por Data — Bottom Sheet */}
      <BottomSheet
        visible={addRecDataModalVisible}
        onClose={() => {
          setAddRecDataModalVisible(false);
          resetRecDataForm();
        }}
        title={editingRecDataId ? 'Editar Recorrência por Data' : 'Nova Recorrência por Data'}
        heightPercent={0.88}
      >
        <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={styles.formLabel}>Título *</Text>
          <TextInput
            style={styles.formInput}
            value={formRecData.titulo}
            onChangeText={v => setFormRecData(f => ({ ...f, titulo: v }))}
            placeholder="Ex: Revisão anual"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.formLabel}>Tipo de Recorrência *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tiposScroll}>
            {TIPOS_REC_DATA.map(t => (
              <Pressable
                key={t.value}
                style={[styles.tipoChip, formRecData.tipoRecorrencia === t.value && styles.tipoChipDataActive]}
                onPress={() => setFormRecData(f => ({ ...f, tipoRecorrencia: t.value }))}
              >
                <Text style={[styles.tipoChipText, formRecData.tipoRecorrencia === t.value && styles.tipoChipDataTextActive]}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.infoBox}>
            <Icon source="information-outline" size={16} color="#8e44ad" />
            <Text style={styles.infoBoxText}>
              {formRecData.tipoRecorrencia === 'AVULSA' && 'Ocorre uma única vez na data escolhida.'}
              {formRecData.tipoRecorrencia === 'INTERVALO' && 'Repete a cada X dias após a conclusão. Ex: a cada 30 dias.'}
              {formRecData.tipoRecorrencia === 'SEMANAL' && 'Repete toda semana nos dias marcados.'}
              {formRecData.tipoRecorrencia === 'MENSAL' && 'Repete todo mês no dia informado. Ex: todo dia 15.'}
              {formRecData.tipoRecorrencia === 'ANUAL' && 'Repete todo ano na data informada. Ex: 05 de Janeiro.'}
            </Text>
          </View>

          {['AVULSA', 'INTERVALO', 'SEMANAL'].includes(formRecData.tipoRecorrencia) && (
            <>
              <Text style={styles.formLabel}>
                {formRecData.tipoRecorrencia === 'AVULSA'
                  ? 'Data da ocorrência *'
                  : formRecData.tipoRecorrencia === 'INTERVALO'
                  ? 'Primeira ocorrência *'
                  : 'Próxima ocorrência *'}
              </Text>
              <Pressable
                style={[styles.formInput, { justifyContent: 'center' }]}
                onPress={() => setShowDatePickerRef(true)}
              >
                <Text style={{ color: formRecData.dataReferencia ? colors.text : colors.textMuted }}>
                  {formRecData.dataReferencia
                    ? new Date(formRecData.dataReferencia + 'T12:00:00').toLocaleDateString('pt-BR')
                    : 'Selecionar data'}
                </Text>
              </Pressable>
              {showDatePickerRef && (
                <DateTimePicker
                  value={formRecData.dataReferencia ? new Date(formRecData.dataReferencia + 'T12:00:00') : new Date()}
                  mode="date"
                  display="default"
                  onChange={(_event: any, selectedDate?: Date) => {
                    setShowDatePickerRef(false);
                    if (selectedDate) {
                      setFormRecData(f => ({ ...f, dataReferencia: selectedDate.toISOString().slice(0, 10) }));
                    }
                  }}
                  minimumDate={new Date()}
                  locale="pt-BR"
                />
              )}
            </>
          )}

          {formRecData.tipoRecorrencia === 'INTERVALO' && (
            <>
              <Text style={styles.formLabel}>A cada quantos dias? *</Text>
              <TextInput
                style={styles.formInput}
                value={formRecData.intervaloDias}
                onChangeText={v => setFormRecData(f => ({ ...f, intervaloDias: v.replace(/\D/g, '') }))}
                placeholder="Ex: 30"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
              />
            </>
          )}

          {formRecData.tipoRecorrencia === 'SEMANAL' && (
            <>
              <Text style={styles.formLabel}>Dias da semana *</Text>
              <View style={styles.diasSemanaGrid}>
                {DIAS_SEMANA.map((dia, idx) => (
                  <Pressable
                    key={idx}
                    accessibilityRole="checkbox"
                    style={[styles.diaChip, formRecData.diasSemana.includes(idx) && styles.diaChipActive]}
                    onPress={() =>
                      setFormRecData(f => ({
                        ...f,
                        diasSemana: f.diasSemana.includes(idx)
                          ? f.diasSemana.filter(d => d !== idx)
                          : [...f.diasSemana, idx],
                      }))
                    }
                  >
                    <Text style={[styles.diaChipText, formRecData.diasSemana.includes(idx) && styles.diaChipTextActive]}>
                      {dia}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {(formRecData.tipoRecorrencia === 'MENSAL' || formRecData.tipoRecorrencia === 'ANUAL') && (
            <>
              <Text style={styles.formLabel}>Dia do mês (1-31) *</Text>
              <TextInput
                style={styles.formInput}
                value={formRecData.diaDoMes}
                onChangeText={v => setFormRecData(f => ({ ...f, diaDoMes: v.replace(/\D/g, '') }))}
                placeholder="Ex: 15"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
              />
            </>
          )}

          {formRecData.tipoRecorrencia === 'ANUAL' && (
            <>
              <Text style={styles.formLabel}>Mês *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tiposScroll}>
                {MESES_ABREV.map((mes, idx) => {
                  const num = idx + 1;
                  const ativo = formRecData.mesDoAno === String(num);
                  return (
                    <Pressable
                      key={idx}
                      style={[styles.tipoChip, ativo && styles.tipoChipDataActive]}
                      onPress={() => setFormRecData(f => ({ ...f, mesDoAno: String(num) }))}
                    >
                      <Text style={[styles.tipoChipText, ativo && styles.tipoChipDataTextActive]}>{mes}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          <Text style={styles.formLabel}>Observações</Text>
          <TextInput
            style={[styles.formInput, styles.formInputMulti]}
            value={formRecData.descricao}
            onChangeText={v => setFormRecData(f => ({ ...f, descricao: v }))}
            placeholder="Detalhes da manutenção..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
          />

          <Pressable
            style={[styles.saveBtn, isSavingRecData && styles.saveBtnDisabled]}
            onPress={saveRecorrenciaData}
            disabled={isSavingRecData}
          >
            {isSavingRecData ? (
              <ActivityIndicator size="small" color={colors.primaryText} />
            ) : (
              <Icon source="content-save" size={18} color={colors.primaryText} />
            )}
            <Text style={styles.saveBtnText}>{editingRecDataId ? 'Atualizar' : 'Salvar'}</Text>
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

          <Text style={styles.formLabel}>Base do histórico</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tiposScroll}>
            {BASES_HISTORICO.map(t => (
              <Pressable
                key={t.value}
                style={[styles.tipoChip, form.historicoBase === t.value && styles.tipoChipActive]}
                onPress={() => setForm(f => ({
                  ...f,
                  historicoBase: t.value,
                  kmRealizacao: t.value === 'data' ? '' : f.kmRealizacao,
                }))}
              >
                <Text style={[styles.tipoChipText, form.historicoBase === t.value && styles.tipoChipTextActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.formLabel}>Data da realização</Text>
          <Pressable
            style={[styles.formInput, { justifyContent: 'center' }]}
            onPress={() => setShowDatePickerRegistro(true)}
          >
            <Text style={{ color: form.dataRealizacao ? colors.text : colors.textMuted }}>
              {form.dataRealizacao
                ? new Date(form.dataRealizacao + 'T12:00:00').toLocaleDateString('pt-BR')
                : 'Selecionar data'}
            </Text>
          </Pressable>
          {showDatePickerRegistro && (
            <DateTimePicker
              value={form.dataRealizacao ? new Date(form.dataRealizacao + 'T12:00:00') : new Date()}
              mode="date"
              display="default"
              onChange={(_event: any, selectedDate?: Date) => {
                setShowDatePickerRegistro(false);
                if (selectedDate) {
                  setForm(f => ({ ...f, dataRealizacao: selectedDate.toISOString().slice(0, 10) }));
                }
              }}
              maximumDate={new Date()}
              locale="pt-BR"
            />
          )}

          {form.historicoBase !== 'data' && (
            <>
              <Text style={styles.formLabel}>KM na realização *</Text>
              <TextInput
                style={styles.formInput}
                value={form.kmRealizacao}
                onChangeText={v => setForm(f => ({ ...f, kmRealizacao: v.replace(/\D/g, '') }))}
                placeholder="Ex: 45000"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
              />
            </>
          )}

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
  adminTag: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '700',
    color: '#1f6f9f',
    backgroundColor: 'rgba(31,111,159,.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  historyDescription: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 17,
    marginTop: 2,
  },
  historyMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  historyMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  historyMetaText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  cardTagKm: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '700',
    color: '#b47d00',
    backgroundColor: '#fff7e3',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  cardTagData: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '700',
    color: '#1f6f9f',
    backgroundColor: '#e8f4fd',
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
  progressWrap: {
    gap: 4,
    marginTop: 6,
  },
  progressBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  progressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  progressInfoText: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
  },
  recStatusBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  recStatusText: {
    fontSize: 11,
    fontWeight: '700',
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
    width: '100%',
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
  chooserBody: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  chooserOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chooserIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chooserOptionBody: {
    flex: 1,
  },
  chooserOptionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  chooserOptionSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
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
  tipoChipDataActive: {
    borderColor: '#1f6f9f',
    backgroundColor: '#e8f4fd',
  },
  tipoChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tipoChipTextActive: {
    color: '#8e44ad',
  },
  tipoChipDataTextActive: {
    color: '#1f6f9f',
  },
  diasSemanaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  diaChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    minWidth: 44,
    alignItems: 'center',
  },
  diaChipActive: {
    borderColor: '#1f6f9f',
    backgroundColor: '#e8f4fd',
  },
  diaChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  diaChipTextActive: {
    color: '#1f6f9f',
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
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(142,68,173,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(142,68,173,0.2)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  infoBoxText: {
    flex: 1,
    fontSize: 12,
    color: '#8e44ad',
    lineHeight: 17,
  },
});
