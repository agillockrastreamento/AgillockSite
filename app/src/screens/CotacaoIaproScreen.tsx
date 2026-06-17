import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
  preco: { adesao: number; mensalidade: number } | null;
  whatsappComercial: string | null;
};

type ConcluirWebResposta = {
  url: string;
  orquestrada: boolean;
  placaJaCadastrada?: boolean;
};

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

export function CotacaoIaproScreen() {
  const { user } = useAuth();
  const toast = useToast();

  const [veiculos, setVeiculos] = useState<VeiculoCliente[]>([]);
  const [isLoadingVeiculos, setIsLoadingVeiculos] = useState(true);
  const [modo, setModo] = useState<'meu' | 'outra'>('meu');
  const [placaSelecionada, setPlacaSelecionada] = useState('');
  const [placaManual, setPlacaManual] = useState('');

  const [isCotando, setIsCotando] = useState(false);
  const [isAbrindoWeb, setIsAbrindoWeb] = useState(false);
  const [cotacao, setCotacao] = useState<CotacaoResposta | null>(null);
  const [placaCotada, setPlacaCotada] = useState('');

  const carregarVeiculos = useCallback(async () => {
    setIsLoadingVeiculos(true);
    try {
      const lista = await apiRequest<VeiculoCliente[]>('/cliente/cotacao-iapro/veiculos');
      setVeiculos(lista ?? []);
      if (!lista || lista.length === 0) {
        setModo('outra');
      } else {
        setPlacaSelecionada(lista[0].placa);
      }
    } catch {
      toast.show({ message: 'Erro ao carregar seus veículos.', type: 'error' });
    } finally {
      setIsLoadingVeiculos(false);
    }
  }, [toast]);

  useEffect(() => {
    carregarVeiculos();
  }, [carregarVeiculos]);

  const placaAtual = useMemo(
    () => (modo === 'meu' ? normalizaPlaca(placaSelecionada) : normalizaPlaca(placaManual)),
    [modo, placaSelecionada, placaManual],
  );

  function limparResultado() {
    setCotacao(null);
    setPlacaCotada('');
  }

  async function cotar() {
    const placa = placaAtual;
    if (placa.length < 7) {
      toast.show({ message: 'Informe uma placa válida (7 caracteres).', type: 'error' });
      return;
    }
    setIsCotando(true);
    try {
      const resp = await apiRequest<CotacaoResposta>('/cliente/cotacao-iapro/cotar', {
        method: 'POST',
        body: { placa },
      });
      setCotacao(resp);
      setPlacaCotada(placa);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Não foi possível cotar a placa.';
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
      'Placa: ' + v.placa,
    ];
    if (v.fipeFormatado) linhas.push('Valor FIPE: ' + v.fipeFormatado);
    // Só inclui valores quando há cotação fechada (preço dentro da faixa).
    if (p) {
      linhas.push('Adesão: ' + fmtBRL(p.adesao));
      linhas.push('Mensalidade: ' + fmtBRL(p.mensalidade) + '/mês');
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
    const url =
      'https://wa.me/' + cotacao.whatsappComercial + '?text=' + encodeURIComponent(montarMensagemWhatsapp());
    await abrirUrl(url);
  }

  async function concluirWeb() {
    if (!placaCotada) return;
    setIsAbrindoWeb(true);
    try {
      const resp = await apiRequest<ConcluirWebResposta>('/cliente/cotacao-iapro/concluir-web', {
        method: 'POST',
        body: { placa: placaCotada },
      });
      if (resp.placaJaCadastrada) {
        toast.show({
          message: 'Este veículo já possui cadastro na IAPRO. Fale com a administração.',
          type: 'info',
        });
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

  // ── Botões de ação (reutilizados no topo e no CTA final) ──
  function Acoes({ comHint }: { comHint?: boolean }) {
    if (!cotacao) return null;
    const temPreco = !!cotacao.preco;
    const temWa = !!cotacao.whatsappComercial;
    return (
      <View>
        <View style={styles.actionsRow}>
          {temPreco ? (
            <Pressable
              style={[styles.actionBtn, styles.actionWeb, isAbrindoWeb && styles.btnDisabled]}
              onPress={concluirWeb}
              disabled={isAbrindoWeb}
            >
              {isAbrindoWeb ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Icon source="shield-check" size={20} color="#fff" />
              )}
              <Text style={styles.actionText}>Contratar proteção</Text>
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

  return (
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
                  Faça uma cotação da proteção para o seu veículo. Selecione um veículo já cadastrado ou
                  informe outra placa.
                </Text>
              </View>
            </View>
          </View>

          {/* Formulário */}
          <View style={styles.card}>
            <View style={styles.modeRow}>
              {temVeiculos ? (
                <Pressable
                  style={[styles.modeBtn, modo === 'meu' && styles.modeBtnActive]}
                  onPress={() => {
                    setModo('meu');
                    limparResultado();
                  }}
                >
                  <Icon source="car" size={18} color={modo === 'meu' ? '#b9791a' : colors.textMuted} />
                  <Text style={[styles.modeBtnText, modo === 'meu' && styles.modeBtnTextActive]}>Meu veículo</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.modeBtn, modo === 'outra' && styles.modeBtnActive]}
                onPress={() => {
                  setModo('outra');
                  limparResultado();
                }}
              >
                <Icon source="keyboard-outline" size={18} color={modo === 'outra' ? '#b9791a' : colors.textMuted} />
                <Text style={[styles.modeBtnText, modo === 'outra' && styles.modeBtnTextActive]}>Outra placa</Text>
              </Pressable>
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
                        <Icon
                          source={sel ? 'radiobox-marked' : 'radiobox-blank'}
                          size={20}
                          color={sel ? colors.primary : colors.textSubtle}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.vehicleName}>{v.nome || 'Veículo'}</Text>
                          <Text style={styles.vehiclePlate}>{v.placa}</Text>
                        </View>
                      </Pressable>
                    );
                  })
                ) : (
                  <Text style={styles.emptyVehicles}>
                    Você não possui veículos com placa cadastrada. Use a opção "Outra placa".
                  </Text>
                )}
              </View>
            ) : (
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
          {/* Hero */}
          <View style={styles.hero}>
            <Icon source="check-circle" size={46} color={colors.success} />
            <Text style={styles.heroTitle}>
              Pronto{primeiroNome ? `, ${primeiroNome}` : ''}! Sua proteção está aqui.
            </Text>
            <Text style={styles.heroSub}>
              Confira a sua cotação e tudo o que você passa a ter ao proteger seu veículo com a IAPRO.
            </Text>
          </View>

          {/* Solicitante + Veículo */}
          <View style={styles.infoGrid}>
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>Solicitante</Text>
              <Text style={styles.infoStrong}>{user?.nome ?? 'Você'}</Text>
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>Veículo</Text>
              <Text style={styles.infoPlate}>{cotacao.veiculo.placa}</Text>
              <Text style={styles.infoSub}>
                {[cotacao.veiculo.marca, cotacao.veiculo.modelo, cotacao.veiculo.ano].filter(Boolean).join(' ') || '—'}
              </Text>
            </View>
          </View>

          {/* Valores ou sob consulta */}
          {cotacao.preco ? (
            <View style={styles.valGrid}>
              <View style={[styles.valCard, styles.valMensal]}>
                <Text style={styles.valLabel}>Mensalidade</Text>
                <Text style={styles.valNumMensal}>{fmtBRL(cotacao.preco.mensalidade)}</Text>
                <Text style={styles.valFoot}>por mês</Text>
              </View>
              <View style={[styles.valCard, styles.valAdesao]}>
                <Text style={styles.valLabel}>Adesão</Text>
                <Text style={styles.valNumAdesao}>{fmtBRL(cotacao.preco.adesao)}</Text>
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

          {/* Coberturas */}
          <Text style={styles.sectionTitle}>O que está incluso na sua proteção</Text>
          <Text style={styles.sectionSub}>Proteção completa para você dirigir tranquilo, todos os dias.</Text>
          <View style={styles.grid2}>
            {COBERTURAS.map((c) => (
              <View key={c.title} style={styles.covCard}>
                <Icon source={c.icon} size={20} color={colors.accent} />
                <Text style={styles.covTitle}>{c.title}</Text>
                <Text style={styles.covDesc}>{c.desc}</Text>
              </View>
            ))}
          </View>

          {/* Diferenciais */}
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

          {/* Garantias */}
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            {GARANTIAS.map((g) => (
              <View key={g.text} style={styles.guarantee}>
                <Icon source={g.icon} size={16} color={colors.primary} />
                <Text style={styles.guaranteeText}>{g.text}</Text>
              </View>
            ))}
          </View>

          {/* CTA final */}
          <View style={styles.finalCard}>
            <Text style={styles.finalTitle}>Garanta sua proteção agora</Text>
            <Text style={styles.finalText}>
              {cotacao.preco
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
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  modeBtnActive: { borderColor: colors.primary, backgroundColor: 'rgba(250,179,44,0.12)' },
  modeBtnText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
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
  valNumMensal: { fontSize: 24, fontWeight: '800', color: '#d8920f' },
  valNumAdesao: { fontSize: 22, fontWeight: '800', color: colors.text },
  valFoot: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  noprice: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  nopriceText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  fipeText: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  actionBtn: {
    flex: 1,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  actionWeb: { backgroundColor: colors.accent },
  actionWa: { backgroundColor: '#25d366' },
  actionText: { fontSize: 14, fontWeight: '800', color: '#fff' },
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
  guaranteeText: { fontSize: 13, color: colors.text },
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
