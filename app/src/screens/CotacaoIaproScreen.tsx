import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';

import { apiRequest } from '../services/api/apiClient';
import { useAuth } from '../auth/AuthProvider';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';

type VeiculoCliente = {
  dispositivoId: string;
  nome: string | null;
  placa: string;
  marca: string | null;
  modelo: string | null;
  cor: string | null;
  ano: string | null;
};

type CotacaoVeiculo = {
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  ano: number | null;
  cor: string;
  fipeValor: number | null;
  fipeFormatado: string | null;
  fipeMesReferencia: string | null;
};

type CotacaoResposta = {
  veiculo: CotacaoVeiculo;
  preco: { adesao: number; mensalidade: number; descontoPct: number } | null;
  whatsappComercial: string | null;
  sessionId: string | null;
};

type ConcluirWebResposta = {
  url: string;
  orquestrada: boolean;
  placaJaCadastrada?: boolean;
};

type FipeOpcao = { codigo: string; nome: string };
type Modo = 'meu' | 'outra' | 'zero';

const TIPOS: FipeOpcao[] = [
  { codigo: 'CARRO', nome: 'Carro' },
  { codigo: 'MOTO', nome: 'Moto' },
  { codigo: 'CAMINHAO', nome: 'Caminhão' },
];

const COBERTURAS: { icon: string; title: string; desc: string }[] = [
  { icon: 'shield-check', title: 'Roubo e Furto', desc: 'Cobertura em caso de roubo ou furto do seu veículo.' },
  { icon: 'car', title: 'Colisão e Acidentes', desc: 'Proteção contra colisão, capotagem e abalroamento.' },
  { icon: 'fire', title: 'Incêndio', desc: 'Cobertura para danos causados por incêndio.' },
  { icon: 'weather-pouring', title: 'Fenômenos da Natureza', desc: 'Enchentes, granizo, queda de árvores e outros.' },
  { icon: 'account-group', title: 'Danos a Terceiros', desc: 'Danos materiais e corporais a terceiros.' },
  { icon: 'truck', title: 'Guincho e Reboque', desc: 'Reboque do seu veículo sempre que precisar.' },
  { icon: 'headset', title: 'Assistência 24h', desc: 'Atendimento e assistência 24 horas, todos os dias.' },
  { icon: 'map-marker-radius', title: 'Rastreamento', desc: 'Rastreamento e bloqueio para mais segurança.' },
];

const DIFERENCIAIS: { icon: string; title: string; desc: string }[] = [
  { icon: 'check-decagram', title: 'Análise simplificada', desc: 'Adesão sem burocracia e com aprovação rápida.' },
  { icon: 'clock-outline', title: 'Atendimento 24 horas', desc: 'Equipe pronta para te ajudar a qualquer momento.' },
  { icon: 'wrench', title: 'Rede credenciada', desc: 'Oficinas e parceiros para o reparo do seu veículo.' },
  { icon: 'trophy', title: 'Associação sólida', desc: 'Transparência e confiança para proteger o que é seu.' },
];

const GARANTIAS: { icon: string; text: string }[] = [
  { icon: 'clock-outline', text: 'Cotação válida por 48 horas' },
  { icon: 'shield-check', text: 'Proteção completa para seu veículo' },
  { icon: 'check-circle', text: 'Sem carência para assistência 24h' },
];

function normalizaPlaca(p: string): string {
  return p.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function fmtBRL(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const fixed = Number(n).toFixed(2).replace('.', ',');
  return 'R$ ' + fixed.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Modal de seleção com busca (usado para os selects da FIPE)
function SelectModal({
  visible,
  title,
  options,
  loading,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: FipeOpcao[];
  loading: boolean;
  onSelect: (o: FipeOpcao) => void;
  onClose: () => void;
}) {
  const [busca, setBusca] = useState('');
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? options.filter((o) => o.nome.toLowerCase().includes(q)) : options;
  }, [busca, options]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon source="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <TextInput
            style={styles.modalSearch}
            value={busca}
            onChangeText={setBusca}
            placeholder="Buscar..."
            placeholderTextColor={colors.textSubtle}
            autoCorrect={false}
          />
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
          ) : (
            <FlatList
              data={filtradas}
              keyExtractor={(o) => o.codigo}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalOption}
                  onPress={() => {
                    setBusca('');
                    onSelect(item);
                  }}
                >
                  <Text style={styles.modalOptionText}>{item.nome}</Text>
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.modalEmpty}>Nenhuma opção.</Text>}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

export function CotacaoIaproScreen() {
  const { user } = useAuth();
  const toast = useToast();

  const [veiculos, setVeiculos] = useState<VeiculoCliente[]>([]);
  const [isLoadingVeiculos, setIsLoadingVeiculos] = useState(true);
  const [modo, setModo] = useState<Modo>('meu');
  const [placaSelecionada, setPlacaSelecionada] = useState('');
  const [placaManual, setPlacaManual] = useState('');

  // FIPE (0 km)
  const [fipeTipo, setFipeTipo] = useState<FipeOpcao>(TIPOS[0]);
  const [fipeMarca, setFipeMarca] = useState<FipeOpcao | null>(null);
  const [fipeModelo, setFipeModelo] = useState<FipeOpcao | null>(null);
  const [fipeAno, setFipeAno] = useState<FipeOpcao | null>(null);
  const [marcas, setMarcas] = useState<FipeOpcao[]>([]);
  const [modelos, setModelos] = useState<FipeOpcao[]>([]);
  const [anos, setAnos] = useState<FipeOpcao[]>([]);
  const [carregandoFipe, setCarregandoFipe] = useState(false);
  const [pickerAberto, setPickerAberto] = useState<null | 'tipo' | 'marca' | 'modelo' | 'ano'>(null);

  const [isCotando, setIsCotando] = useState(false);
  const [isAbrindoWeb, setIsAbrindoWeb] = useState(false);
  const [cotacao, setCotacao] = useState<CotacaoResposta | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [zeroCotado, setZeroCotado] = useState(false);

  const carregarVeiculos = useCallback(async () => {
    setIsLoadingVeiculos(true);
    try {
      const lista = await apiRequest<VeiculoCliente[]>('/cliente/cotacao-iapro/veiculos');
      setVeiculos(lista ?? []);
      if (!lista || lista.length === 0) setModo('outra');
      else setPlacaSelecionada(lista[0].placa);
    } catch {
      toast.show({ message: 'Erro ao carregar seus veículos.', type: 'error' });
    } finally {
      setIsLoadingVeiculos(false);
    }
  }, [toast]);

  useEffect(() => {
    carregarVeiculos();
  }, [carregarVeiculos]);

  // ── FIPE: carregamentos em cascata ──
  const carregarMarcas = useCallback(async (tipo: string) => {
    setCarregandoFipe(true);
    try {
      const m = await apiRequest<FipeOpcao[]>(`/cliente/cotacao-iapro/fipe/marcas?tipo=${tipo}`);
      setMarcas(m ?? []);
    } catch {
      toast.show({ message: 'Erro ao carregar marcas.', type: 'error' });
    } finally {
      setCarregandoFipe(false);
    }
  }, [toast]);

  const carregarModelos = useCallback(async (tipo: string, marca: string) => {
    setCarregandoFipe(true);
    try {
      const m = await apiRequest<FipeOpcao[]>(`/cliente/cotacao-iapro/fipe/modelos?tipo=${tipo}&marca=${encodeURIComponent(marca)}`);
      setModelos(m ?? []);
    } catch {
      toast.show({ message: 'Erro ao carregar modelos.', type: 'error' });
    } finally {
      setCarregandoFipe(false);
    }
  }, [toast]);

  const carregarAnos = useCallback(async (tipo: string, marca: string, modelo: string) => {
    setCarregandoFipe(true);
    try {
      const a = await apiRequest<FipeOpcao[]>(`/cliente/cotacao-iapro/fipe/anos?tipo=${tipo}&marca=${encodeURIComponent(marca)}&modelo=${encodeURIComponent(modelo)}`);
      setAnos(a ?? []);
    } catch {
      toast.show({ message: 'Erro ao carregar anos.', type: 'error' });
    } finally {
      setCarregandoFipe(false);
    }
  }, [toast]);

  // Ao entrar no modo 0 km, carrega as marcas do tipo atual (se ainda não tiver).
  useEffect(() => {
    if (modo === 'zero' && marcas.length === 0) carregarMarcas(fipeTipo.codigo);
  }, [modo, marcas.length, fipeTipo.codigo, carregarMarcas]);

  function limparResultado() {
    setCotacao(null);
    // sessionId é mantido de propósito: reaproveita a mesma cotação no painel da IAPRO.
  }

  function escolherTipo(t: FipeOpcao) {
    setFipeTipo(t);
    setFipeMarca(null); setFipeModelo(null); setFipeAno(null);
    setModelos([]); setAnos([]);
    limparResultado();
    carregarMarcas(t.codigo);
  }
  function escolherMarca(m: FipeOpcao) {
    setFipeMarca(m); setFipeModelo(null); setFipeAno(null);
    setAnos([]);
    limparResultado();
    carregarModelos(fipeTipo.codigo, m.codigo);
  }
  function escolherModelo(m: FipeOpcao) {
    setFipeModelo(m); setFipeAno(null);
    limparResultado();
    carregarAnos(fipeTipo.codigo, fipeMarca!.codigo, m.codigo);
  }
  function escolherAno(a: FipeOpcao) {
    setFipeAno(a);
    limparResultado();
  }

  const placaAtual = useMemo(
    () => (modo === 'meu' ? normalizaPlaca(placaSelecionada) : normalizaPlaca(placaManual)),
    [modo, placaSelecionada, placaManual],
  );

  async function cotar() {
    setIsCotando(true);
    try {
      let resp: CotacaoResposta;
      if (modo === 'zero') {
        if (!fipeMarca || !fipeModelo || !fipeAno) {
          toast.show({ message: 'Selecione tipo, marca, modelo e ano.', type: 'error' });
          return;
        }
        const body = { tipo: fipeTipo.codigo, marca: fipeMarca.codigo, modelo: fipeModelo.codigo, ano: fipeAno.codigo, sessionId };
        resp = await apiRequest<CotacaoResposta>('/cliente/cotacao-iapro/cotar-zero', { method: 'POST', body });
        setZeroCotado(true);
      } else {
        const placa = placaAtual;
        if (placa.length < 7) {
          toast.show({ message: 'Informe uma placa válida (7 caracteres).', type: 'error' });
          return;
        }
        resp = await apiRequest<CotacaoResposta>('/cliente/cotacao-iapro/cotar', { method: 'POST', body: { placa, sessionId } });
        setZeroCotado(false);
      }
      setCotacao(resp);
      if (resp.sessionId) setSessionId(resp.sessionId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Não foi possível fazer a cotação.';
      toast.show({ message: msg, type: 'error' });
    } finally {
      setIsCotando(false);
    }
  }

  function montarMensagemWhatsapp(): string {
    if (!cotacao) return '';
    const v = cotacao.veiculo;
    const p = cotacao.preco;
    const linhas = [
      'Olá! Fiz uma cotação de proteção veicular IAPRO pelo app Ágil Lock e gostaria de mais informações.',
      '',
      'Veículo: ' + [v.marca, v.modelo, v.ano].filter(Boolean).join(' '),
      zeroCotado ? 'Condição: 0 km (sem placa)' : 'Placa: ' + v.placa,
    ];
    if (v.fipeFormatado) linhas.push('Valor FIPE: ' + v.fipeFormatado);
    if (p) {
      const desc = Number(p.descontoPct) || 0;
      const mensalFinal = desc > 0 ? p.mensalidade * (1 - desc / 100) : p.mensalidade;
      linhas.push('Adesão: ' + fmtBRL(p.adesao));
      linhas.push('Mensalidade: ' + fmtBRL(mensalFinal) + '/mês' + (desc > 0 ? ' (com desconto de pontualidade)' : ''));
    }
    linhas.push('');
    linhas.push('Cliente: ' + (user?.nome ?? '-'));
    return linhas.join('\n');
  }

  async function abrirUrl(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      toast.show({ message: 'Não foi possível abrir o link.', type: 'error' });
    }
  }

  async function concluirWhatsapp() {
    if (!cotacao?.whatsappComercial) return;
    const url = 'https://wa.me/' + cotacao.whatsappComercial + '?text=' + encodeURIComponent(montarMensagemWhatsapp());
    await abrirUrl(url);
  }

  async function concluirWeb() {
    if (!sessionId) {
      toast.show({ message: 'Não foi possível registrar a cotação. Verifique se seu cadastro tem e-mail e cote novamente.', type: 'error' });
      return;
    }
    setIsAbrindoWeb(true);
    try {
      const resp = await apiRequest<ConcluirWebResposta>('/cliente/cotacao-iapro/contratar', {
        method: 'POST',
        body: { sessionId },
      });
      if (resp.placaJaCadastrada) {
        toast.show({ message: 'Este veículo já possui cadastro na IAPRO. Fale com a administração.', type: 'info' });
      }
      if (resp.url) await abrirUrl(resp.url);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Não foi possível abrir a cotação na web.';
      toast.show({ message: msg, type: 'error' });
    } finally {
      setIsAbrindoWeb(false);
    }
  }

  const temVeiculos = veiculos.length > 0;
  const primeiroNome = (user?.nome ?? '').trim().split(/\s+/)[0] || '';

  function ModoBtn({ valor, icon, label }: { valor: Modo; icon: string; label: string }) {
    const ativo = modo === valor;
    return (
      <Pressable
        style={[styles.modeBtn, ativo && styles.modeBtnActive]}
        onPress={() => {
          setModo(valor);
          limparResultado();
        }}
      >
        <Icon source={icon} size={17} color={ativo ? '#b9791a' : colors.textMuted} />
        <Text style={[styles.modeBtnText, ativo && styles.modeBtnTextActive]}>{label}</Text>
      </Pressable>
    );
  }

  function PickerField({
    label,
    valor,
    placeholder,
    onPress,
    disabled,
  }: {
    label: string;
    valor?: string | null;
    placeholder: string;
    onPress: () => void;
    disabled?: boolean;
  }) {
    return (
      <View style={{ marginBottom: spacing.md }}>
        <Text style={styles.label}>{label}</Text>
        <Pressable style={[styles.picker, disabled && styles.pickerDisabled]} onPress={disabled ? undefined : onPress}>
          <Text style={[styles.pickerText, !valor && styles.pickerPlaceholder]} numberOfLines={1}>
            {valor || placeholder}
          </Text>
          <Icon source="chevron-down" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    );
  }

  function Acoes({ comHint }: { comHint?: boolean }) {
    if (!cotacao) return null;
    const temPreco = !!cotacao.preco;
    const temWa = !!cotacao.whatsappComercial;
    return (
      <View style={styles.acoesWrap}>
        <View style={styles.actionsRow}>
          {temPreco ? (
            <Pressable
              style={[styles.actionBtn, styles.actionWeb, isAbrindoWeb && styles.btnDisabled]}
              onPress={concluirWeb}
              disabled={isAbrindoWeb}
            >
              {isAbrindoWeb ? (
                <ActivityIndicator color={colors.primaryText} size="small" />
              ) : (
                <Icon source="shield-check" size={20} color={colors.primaryText} />
              )}
              <Text style={[styles.actionText, styles.actionTextWeb]}>Contratar proteção</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.actionBtn, styles.actionWa, !temWa && styles.btnDisabled]}
            onPress={concluirWhatsapp}
            disabled={!temWa}
          >
            <Icon source="whatsapp" size={20} color="#fff" />
            <Text style={styles.actionText}>Falar no WhatsApp</Text>
          </Pressable>
        </View>
        {temPreco && comHint ? <Text style={styles.ctaHint}>Sem burocracia • Ativação rápida</Text> : null}
      </View>
    );
  }

  const preco = cotacao?.preco ?? null;
  const desconto = preco ? Number(preco.descontoPct) || 0 : 0;
  const mensalFinal = preco ? (desconto > 0 ? preco.mensalidade * (1 - desconto / 100) : preco.mensalidade) : 0;

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {!cotacao ? (
          <>
            {/* Intro */}
            <View style={styles.card}>
              <View style={styles.introRow}>
                <View style={styles.introIcon}>
                  <Icon source="shield-car" size={26} color="#e0941a" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.introTitle}>Proteção veicular IAPRO</Text>
                  <Text style={styles.introText}>
                    Faça uma cotação da proteção: use um veículo cadastrado, informe outra placa ou um veículo 0 km.
                  </Text>
                </View>
              </View>
            </View>

            {/* Formulário */}
            <View style={styles.card}>
              <View style={styles.modeRow}>
                {temVeiculos ? <ModoBtn valor="meu" icon="car" label="Meu veículo" /> : null}
                <ModoBtn valor="outra" icon="keyboard-outline" label="Outra placa" />
                <ModoBtn valor="zero" icon="star-outline" label="0 km" />
              </View>

              {modo === 'meu' ? (
                <View>
                  <Text style={styles.label}>Selecione o veículo</Text>
                  {isLoadingVeiculos ? (
                    <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
                  ) : temVeiculos ? (
                    veiculos.map((v) => {
                      const sel = normalizaPlaca(placaSelecionada) === v.placa;
                      return (
                        <Pressable
                          key={v.dispositivoId}
                          style={[styles.vehicleRow, sel && styles.vehicleRowActive]}
                          onPress={() => setPlacaSelecionada(v.placa)}
                        >
                          <Icon source={sel ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={sel ? colors.primary : colors.textSubtle} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.vehicleName}>{v.nome || 'Veículo'}</Text>
                            <Text style={styles.vehiclePlate}>{v.placa}</Text>
                          </View>
                        </Pressable>
                      );
                    })
                  ) : (
                    <Text style={styles.emptyVehicles}>
                      Você não possui veículos com placa cadastrada. Use "Outra placa" ou "0 km".
                    </Text>
                  )}
                </View>
              ) : modo === 'outra' ? (
                <View>
                  <Text style={styles.label}>Placa do veículo</Text>
                  <TextInput
                    style={styles.input}
                    value={placaManual}
                    onChangeText={(t) => setPlacaManual(normalizaPlaca(t))}
                    placeholder="ABC1D23"
                    placeholderTextColor={colors.textSubtle}
                    autoCapitalize="characters"
                    maxLength={8}
                  />
                </View>
              ) : (
                <View>
                  <PickerField label="Tipo de veículo" valor={fipeTipo.nome} placeholder="Selecione" onPress={() => setPickerAberto('tipo')} />
                  <PickerField label="Marca" valor={fipeMarca?.nome} placeholder="Selecione..." onPress={() => setPickerAberto('marca')} />
                  <PickerField label="Modelo" valor={fipeModelo?.nome} placeholder="Selecione a marca..." onPress={() => setPickerAberto('modelo')} disabled={!fipeMarca} />
                  <PickerField label="Ano" valor={fipeAno?.nome} placeholder="Selecione o modelo..." onPress={() => setPickerAberto('ano')} disabled={!fipeModelo} />
                </View>
              )}

              <Pressable
                style={[styles.cotarBtn, isCotando && styles.btnDisabled]}
                onPress={cotar}
                disabled={isCotando}
              >
                {isCotando ? (
                  <ActivityIndicator color={colors.primaryText} size="small" />
                ) : (
                  <Icon source="magnify" size={20} color={colors.primaryText} />
                )}
                <Text style={styles.cotarBtnText}>{isCotando ? 'Cotando...' : 'Cotar'}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          /* ── Resultado (estilo etapa 3) ── */
          <View style={styles.card}>
            <View style={styles.hero}>
              <Icon source="check-circle" size={46} color={colors.success} />
              <Text style={styles.heroTitle}>
                Pronto{primeiroNome ? `, ${primeiroNome}` : ''}! Sua proteção está aqui.
              </Text>
              <Text style={styles.heroSub}>
                Confira a sua cotação e tudo o que você passa a ter ao proteger seu veículo com a IAPRO.
              </Text>
            </View>

            <View style={styles.infoGrid}>
              <View style={styles.infoBox}>
                <Text style={styles.infoLabel}>Solicitante</Text>
                <Text style={styles.infoStrong}>{user?.nome ?? 'Você'}</Text>
              </View>
              <View style={styles.infoBox}>
                <Text style={styles.infoLabel}>Veículo</Text>
                <Text style={styles.infoPlate}>{cotacao.veiculo.placa || '0 km'}</Text>
                <Text style={styles.infoSub}>
                  {[cotacao.veiculo.marca, cotacao.veiculo.modelo, cotacao.veiculo.ano].filter(Boolean).join(' ') || '—'}
                </Text>
              </View>
            </View>

            {preco ? (
              <View style={styles.valGrid}>
                <View style={[styles.valCard, styles.valMensal]}>
                  {desconto > 0 ? (
                    <View style={styles.discountBadge}>
                      <Text style={styles.discountBadgeText}>{Math.round(desconto)}% OFF</Text>
                    </View>
                  ) : null}
                  <Text style={styles.valLabel}>Mensalidade</Text>
                  {desconto > 0 ? <Text style={styles.valOld}>{fmtBRL(preco.mensalidade)}</Text> : null}
                  <Text style={styles.valNumMensal}>{fmtBRL(mensalFinal)}</Text>
                  <Text style={styles.valFoot}>por mês</Text>
                  {desconto > 0 ? (
                    <Text style={styles.valDesc}>com desconto de pagamento até 1 dia antes do vencimento</Text>
                  ) : null}
                </View>
                <View style={[styles.valCard, styles.valAdesao]}>
                  <Text style={styles.valLabel}>Adesão</Text>
                  <Text style={styles.valNumAdesao}>{fmtBRL(preco.adesao)}</Text>
                  <Text style={styles.valFoot}>pagamento único</Text>
                </View>
              </View>
            ) : (
              <View style={styles.noprice}>
                <Text style={styles.nopriceText}>
                  Para este veículo os valores são personalizados. Fale com a nossa equipe pelo WhatsApp para
                  preparar a sua proteção.
                </Text>
              </View>
            )}

            {cotacao.veiculo.fipeFormatado ? (
              <Text style={styles.fipeText}>
                <Icon source="tag-outline" size={13} color={colors.textMuted} /> Valor FIPE:{' '}
                <Text style={{ fontWeight: '700' }}>{cotacao.veiculo.fipeFormatado}</Text>
                {cotacao.veiculo.fipeMesReferencia ? ` (ref. ${cotacao.veiculo.fipeMesReferencia})` : ''}
              </Text>
            ) : null}

            <Acoes comHint />

            <Text style={styles.sectionTitle}>O que está incluso na sua proteção</Text>
            <Text style={styles.sectionSub}>Proteção completa para você dirigir tranquilo, todos os dias.</Text>
            <View style={styles.grid2}>
              {COBERTURAS.map((c) => (
                <View key={c.title} style={styles.covCard}>
                  <Icon source={c.icon} size={20} color={colors.primary} />
                  <Text style={styles.covTitle}>{c.title}</Text>
                  <Text style={styles.covDesc}>{c.desc}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Por que escolher a IAPRO?</Text>
            <View style={[styles.grid2, { marginTop: spacing.sm }]}>
              {DIFERENCIAIS.map((d) => (
                <View key={d.title} style={styles.difCard}>
                  <Icon source={d.icon} size={20} color={colors.primary} />
                  <Text style={styles.difTitle}>{d.title}</Text>
                  <Text style={styles.difDesc}>{d.desc}</Text>
                </View>
              ))}
            </View>

            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              {GARANTIAS.map((g) => (
                <View key={g.text} style={styles.guarantee}>
                  <Icon source={g.icon} size={16} color={colors.primary} />
                  <Text style={styles.guaranteeText}>{g.text}</Text>
                </View>
              ))}
            </View>

            <View style={styles.finalCard}>
              <Text style={styles.finalTitle}>Garanta sua proteção agora</Text>
              <Text style={styles.finalText}>
                {preco
                  ? 'Esta cotação é válida por 48 horas. Contrate em poucos passos, sem sair daqui.'
                  : 'Fale com a nossa equipe pelo WhatsApp para preparar a sua proteção.'}
              </Text>
              <Acoes />
            </View>

            <Pressable style={styles.novaCotacao} onPress={limparResultado}>
              <Icon source="refresh" size={18} color={colors.textMuted} />
              <Text style={styles.novaCotacaoText}>Fazer nova cotação</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Modais dos selects FIPE */}
      <SelectModal
        visible={pickerAberto === 'tipo'}
        title="Tipo de veículo"
        options={TIPOS}
        loading={false}
        onSelect={(o) => { setPickerAberto(null); escolherTipo(o); }}
        onClose={() => setPickerAberto(null)}
      />
      <SelectModal
        visible={pickerAberto === 'marca'}
        title="Marca"
        options={marcas}
        loading={carregandoFipe && marcas.length === 0}
        onSelect={(o) => { setPickerAberto(null); escolherMarca(o); }}
        onClose={() => setPickerAberto(null)}
      />
      <SelectModal
        visible={pickerAberto === 'modelo'}
        title="Modelo"
        options={modelos}
        loading={carregandoFipe && modelos.length === 0}
        onSelect={(o) => { setPickerAberto(null); escolherModelo(o); }}
        onClose={() => setPickerAberto(null)}
      />
      <SelectModal
        visible={pickerAberto === 'ano'}
        title="Ano"
        options={anos}
        loading={carregandoFipe && anos.length === 0}
        onSelect={(o) => { setPickerAberto(null); escolherAno(o); }}
        onClose={() => setPickerAberto(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  introRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  introIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(250,179,44,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 3 },
  introText: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  label: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  modeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.md,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  modeBtnActive: { borderColor: colors.primary, backgroundColor: 'rgba(250,179,44,0.12)' },
  // flexShrink: no iOS o Text não encolhe por padrão e vaza para fora do botão
  modeBtnText: { flexShrink: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.textMuted },
  modeBtnTextActive: { color: '#b9791a' },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  vehicleRowActive: { borderColor: colors.primary, backgroundColor: 'rgba(250,179,44,0.08)' },
  vehicleName: { fontSize: 14, fontWeight: '700', color: colors.text },
  vehiclePlate: { fontSize: 12, color: colors.textMuted, marginTop: 2, letterSpacing: 1 },
  emptyVehicles: { fontSize: 13, color: colors.textMuted, marginVertical: spacing.sm },
  input: {
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  picker: {
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
  },
  pickerDisabled: { opacity: 0.5, backgroundColor: colors.surfaceMuted },
  pickerText: { flex: 1, fontSize: 14, color: colors.text },
  pickerPlaceholder: { color: colors.textSubtle },
  cotarBtn: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  cotarBtnText: { fontSize: 15, fontWeight: '800', color: colors.primaryText },
  btnDisabled: { opacity: 0.55 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.bottomSheet,
    borderTopRightRadius: radius.bottomSheet,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  modalSearch: {
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  modalOption: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  modalOptionText: { fontSize: 15, color: colors.text },
  modalEmpty: { fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },

  // Resultado
  hero: { alignItems: 'center', marginBottom: spacing.md },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  heroSub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
  infoGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  infoBox: { flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md },
  infoLabel: { fontSize: 12, color: colors.textSubtle, marginBottom: 4 },
  infoStrong: { fontSize: 14, fontWeight: '700', color: colors.text },
  infoPlate: { fontSize: 14, fontWeight: '700', color: colors.text, letterSpacing: 2 },
  infoSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  valGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  valCard: { flex: 1, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', borderWidth: 2 },
  valMensal: { backgroundColor: 'rgba(250,179,44,0.10)', borderColor: colors.primary },
  valAdesao: { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
  valLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 6 },
  valOld: { fontSize: 13, color: colors.textSubtle, textDecorationLine: 'line-through', marginBottom: 2 },
  valNumMensal: { fontSize: 23, fontWeight: '800', color: '#d8920f' },
  valNumAdesao: { fontSize: 22, fontWeight: '800', color: colors.text },
  valFoot: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  valDesc: { fontSize: 10.5, color: colors.success, fontWeight: '600', textAlign: 'center', marginTop: 5, lineHeight: 14 },
  discountBadge: {
    position: 'absolute',
    top: -10,
    right: 8,
    backgroundColor: colors.success,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  discountBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  noprice: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  nopriceText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  fipeText: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  acoesWrap: { width: '100%' },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  actionBtn: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  actionWeb: { backgroundColor: colors.primary },
  actionWa: { backgroundColor: '#25d366' },
  actionText: { flexShrink: 1, textAlign: 'center', fontSize: 14, fontWeight: '800', color: '#fff' },
  actionTextWeb: { color: colors.primaryText },
  ctaHint: { textAlign: 'center', fontSize: 12, color: colors.textSubtle, marginTop: spacing.sm },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginBottom: 4,
  },
  sectionSub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.md },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.sm },
  covCard: { width: '48%', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md },
  covTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 6, marginBottom: 2 },
  covDesc: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  difCard: {
    width: '48%',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  difTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text, marginTop: 6, marginBottom: 3, textAlign: 'center' },
  difDesc: { fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 16 },
  guarantee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  guaranteeText: { flexShrink: 1, fontSize: 13, color: colors.text },
  finalCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  finalTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 4, textAlign: 'center' },
  finalText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.md, lineHeight: 19 },
  novaCotacao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  novaCotacaoText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
});
