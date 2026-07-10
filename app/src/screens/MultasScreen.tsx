import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';
import * as FileSystem from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import * as Sharing from 'expo-sharing';

import { apiRequest } from '../services/api/apiClient';
import { environment } from '../config/environment';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import { useAuth } from '../auth/AuthProvider';

type Multa = {
  ait: string;
  motivo: string;
  dataInfracao: string | null;
  dataVencimento: string | null;
  valor: number;
  valorAPagar: number;
};
type Pix = { emv: string; qrCodeBase64: string | null } | null;
type Veiculo = {
  dispositivoId: string;
  placa: string;
  apelido: string | null;
  qtdMultas: number;
  valorTotal: number;
  possuiDebitoIpva: boolean;
  licenciamentoPendente: boolean;
  ultimaConsultaStatus: string | null;
  multas: Multa[];
  pix: Pix;
  boletoUrl: string | null;
};
type MultasResp = { habilitado: boolean; atualizadoEm: string | null; veiculos: Veiculo[] };
type PagamentoResp = { pagamento: { emv: string; qrCodeBase64: string | null } | null; boletoUrl: string | null };

function fmtMoney(n: number) {
  return 'R$ ' + Number(n ?? 0).toFixed(2).replace('.', ',');
}

export function MultasScreen() {
  const toast = useToast();
  const { me, can } = useAuth();
  const podePagar = me?.tipo === 'responsavel' || can('multas.pagar');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const [selecionadas, setSelecionadas] = useState<Record<string, boolean>>({});
  const [gerando, setGerando] = useState(false);
  const [pagamento, setPagamento] = useState<PagamentoResp | null>(null);
  const [baixando, setBaixando] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiRequest<MultasResp>('/cliente/multas');
      const vs = d.veiculos ?? [];
      setVeiculos(vs);
      setAtualizadoEm(d.atualizadoEm ?? null);
      setSelId((prev) => prev ?? vs.find((v) => v.qtdMultas > 0)?.dispositivoId ?? vs[0]?.dispositivoId ?? null);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar multas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const veiculo = useMemo(() => veiculos.find((v) => v.dispositivoId === selId) ?? null, [veiculos, selId]);

  // Ao (re)carregar ou trocar de veículo: marca todas as multas e limpa o pagamento anterior.
  useEffect(() => {
    const v = veiculos.find((x) => x.dispositivoId === selId);
    if (!v) return;
    const s: Record<string, boolean> = {};
    v.multas.forEach((m) => {
      s[m.ait] = true;
    });
    setSelecionadas(s);
    setPagamento(null);
  }, [selId, veiculos]);

  const toggle = (ait: string) => setSelecionadas((prev) => ({ ...prev, [ait]: !prev[ait] }));

  const pagar = async (modo: 'sel' | 'todas') => {
    if (!veiculo) return;
    let aits: string[] = [];
    if (modo === 'sel') {
      aits = veiculo.multas.filter((m) => selecionadas[m.ait]).map((m) => m.ait);
      if (!aits.length) {
        toast.show({ message: 'Selecione ao menos uma multa.', type: 'info' });
        return;
      }
    }
    setGerando(true);
    setPagamento(null);
    try {
      const p = await apiRequest<PagamentoResp>(`/cliente/multas/${veiculo.dispositivoId}/pagamento`, {
        method: 'POST',
        body: JSON.stringify({ aits }),
      });
      setPagamento(p);
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Não foi possível gerar o pagamento.', type: 'error' });
    } finally {
      setGerando(false);
    }
  };

  const compartilharPix = async (emv: string) => {
    try {
      await Share.share({ message: emv });
    } catch {
      /* usuário cancelou */
    }
  };

  const baixarBoleto = async (boletoUrl: string) => {
    setBaixando(true);
    try {
      const base = environment.apiUrl.replace(/\/api\/?$/, '');
      const url = base + boletoUrl;
      const nome = `boleto_multa_${Date.now()}.pdf`;

      // Não usar FileSystem.downloadFileAsync: o OkHttp dele tem read timeout de 10s.
      const resposta = await expoFetch(url);
      if (!resposta.ok) {
        throw new Error(`Não foi possível baixar o boleto (erro ${resposta.status}).`);
      }
      const conteudo = await resposta.bytes();

      const destino = new FileSystem.File(FileSystem.Paths.cache, nome);
      if (destino.exists) destino.delete();
      destino.create();
      destino.write(conteudo);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(destino.uri, { mimeType: 'application/pdf', dialogTitle: 'Boleto da multa', UTI: 'com.adobe.pdf' });
      } else {
        toast.show({ message: 'Compartilhamento não disponível neste dispositivo.', type: 'info' });
      }
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Erro ao baixar o boleto.', type: 'error' });
    } finally {
      setBaixando(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (erro) {
    return (
      <View style={styles.center}>
        <Text style={styles.erro}>{erro}</Text>
      </View>
    );
  }

  const filtrados = busca
    ? veiculos.filter(
        (v) =>
          v.placa?.toLowerCase().includes(busca.toLowerCase()) ||
          (v.apelido ?? '').toLowerCase().includes(busca.toLowerCase()),
      )
    : veiculos;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.aviso}>
          <Text style={styles.avisoTxt}>
            As multas são consultadas diretamente no Detran. A atualização é automática 2× ao dia, às 10h e às 17h. O
            boleto/Pix é gerado com o valor atualizado no momento do pagamento.
          </Text>
          {atualizadoEm ? (
            <Text style={styles.avisoData}>Atualizado em {new Date(atualizadoEm).toLocaleString('pt-BR')}</Text>
          ) : null}
        </View>

        {veiculos.length === 0 ? (
          <Text style={styles.vazio}>Nenhum veículo disponível.</Text>
        ) : (
          <>
            {veiculos.length > 1 ? (
              <Pressable
                style={styles.seletor}
                onPress={() => {
                  setBusca('');
                  setSelectorOpen(true);
                }}
              >
                <Icon source="car" size={18} color={colors.textMuted} />
                <Text style={styles.seletorTxt} numberOfLines={1}>
                  {veiculo ? veiculo.placa + (veiculo.apelido ? ' · ' + veiculo.apelido : '') : 'Selecionar veículo'}
                </Text>
                {veiculo && veiculo.qtdMultas > 0 ? <Text style={styles.indMulta}>● {veiculo.qtdMultas}</Text> : null}
                <Icon source="chevron-down" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null}

            {veiculo ? (
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.placa}>{veiculo.placa}</Text>
                  {veiculo.apelido ? <Text style={styles.apelido}>{veiculo.apelido}</Text> : null}
                  <View style={styles.headResumo}>
                    {veiculo.qtdMultas > 0 ? (
                      <Text style={styles.resumoMulta}>
                        {veiculo.qtdMultas} multa{veiculo.qtdMultas > 1 ? 's' : ''} · {fmtMoney(veiculo.valorTotal)}
                      </Text>
                    ) : (
                      <Text style={styles.resumoOk}>Sem multas</Text>
                    )}
                  </View>
                </View>

                {(veiculo.possuiDebitoIpva || veiculo.licenciamentoPendente) ? (
                  <View style={styles.badgesRow}>
                    {veiculo.possuiDebitoIpva ? <Text style={styles.badgeErr}>Débito IPVA</Text> : null}
                    {veiculo.licenciamentoPendente ? <Text style={styles.badgeErr}>Licenciamento pendente</Text> : null}
                  </View>
                ) : null}

                {veiculo.multas.length === 0 ? (
                  <Text style={styles.semMulta}>Nenhuma multa encontrada.</Text>
                ) : (
                  <>
                    {veiculo.multas.map((m) => {
                      const sel = !!selecionadas[m.ait];
                      return (
                        <Pressable key={m.ait} style={styles.multaRow} onPress={() => toggle(m.ait)}>
                          <Icon
                            source={sel ? 'checkbox-marked' : 'checkbox-blank-outline'}
                            size={22}
                            color={sel ? colors.primary : colors.textMuted}
                          />
                          <View style={styles.multaInfo}>
                            <Text style={styles.multaAit}>{m.ait}</Text>
                            <Text style={styles.multaMotivo} numberOfLines={2}>
                              {m.motivo}
                            </Text>
                            <Text style={styles.multaDatas}>
                              Infração {m.dataInfracao ?? '—'} · Vence {m.dataVencimento ?? '—'}
                            </Text>
                          </View>
                          <View style={styles.multaValores}>
                            {m.valor !== m.valorAPagar ? <Text style={styles.valorDe}>{fmtMoney(m.valor)}</Text> : null}
                            <Text style={styles.valorPagar}>{fmtMoney(m.valorAPagar)}</Text>
                          </View>
                        </Pressable>
                      );
                    })}

                    {podePagar ? (
                      <View style={styles.acoes}>
                        <Pressable style={[styles.btn, styles.btnPri]} disabled={gerando} onPress={() => pagar('sel')}>
                          {gerando ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text style={styles.btnPriTxt}>Pagar selecionadas</Text>
                          )}
                        </Pressable>
                        <Pressable style={[styles.btn, styles.btnSec]} disabled={gerando} onPress={() => pagar('todas')}>
                          <Text style={styles.btnSecTxt}>Pagar todas</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {pagamento && pagamento.pagamento ? (
                      <View style={styles.pixBox}>
                        {pagamento.pagamento.qrCodeBase64 ? (
                          <Image
                            source={{ uri: 'data:image/png;base64,' + pagamento.pagamento.qrCodeBase64 }}
                            style={styles.qr}
                          />
                        ) : null}
                        <Text style={styles.pixLabel}>Pague com Pix</Text>
                        <Text style={styles.pixEmv} selectable>
                          {pagamento.pagamento.emv}
                        </Text>
                        <View style={styles.pixAcoes}>
                          <Pressable
                            style={[styles.btn, styles.btnSec, styles.btnSmall]}
                            onPress={() => compartilharPix(pagamento.pagamento!.emv)}
                          >
                            <Icon source="content-copy" size={15} color={colors.text} />
                            <Text style={styles.btnSecTxt}> Compartilhar código Pix</Text>
                          </Pressable>
                          {pagamento.boletoUrl ? (
                            <Pressable
                              style={[styles.btn, styles.btnPri, styles.btnSmall]}
                              disabled={baixando}
                              onPress={() => baixarBoleto(pagamento.boletoUrl!)}
                            >
                              {baixando ? (
                                <ActivityIndicator color="#fff" size="small" />
                              ) : (
                                <>
                                  <Icon source="file-pdf-box" size={15} color="#fff" />
                                  <Text style={styles.btnPriTxt}> Baixar boleto (PDF)</Text>
                                </>
                              )}
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Seletor de veículo (2+ veículos) */}
      <Modal visible={selectorOpen} transparent animationType="fade" onRequestClose={() => setSelectorOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setSelectorOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Escolha o veículo</Text>
            <TextInput
              style={styles.buscaInput}
              placeholder="Buscar por placa…"
              placeholderTextColor={colors.textMuted}
              value={busca}
              onChangeText={setBusca}
              autoCorrect={false}
              autoCapitalize="characters"
            />
            <ScrollView style={styles.optList} keyboardShouldPersistTaps="handled">
              {filtrados.map((v) => (
                <Pressable
                  key={v.dispositivoId}
                  style={styles.opt}
                  onPress={() => {
                    setSelId(v.dispositivoId);
                    setSelectorOpen(false);
                  }}
                >
                  <Text style={styles.optPlaca}>{v.placa}</Text>
                  <Text style={styles.optApelido} numberOfLines={1}>
                    {v.apelido ?? ''}
                  </Text>
                  {v.qtdMultas > 0 ? (
                    <Text style={styles.indMulta}>● {v.qtdMultas}</Text>
                  ) : (
                    <Icon source="check" size={16} color={colors.success} />
                  )}
                </Pressable>
              ))}
              {filtrados.length === 0 ? <Text style={styles.vazio}>Nenhum veículo encontrado.</Text> : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  erro: { color: colors.danger, textAlign: 'center', padding: spacing.lg },
  vazio: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg },

  aviso: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  avisoTxt: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  avisoData: { color: colors.textSubtle, fontSize: 11, marginTop: 6 },

  seletor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.md,
  },
  seletorTxt: { flex: 1, color: colors.text, fontWeight: '600' },
  indMulta: { color: colors.danger, fontWeight: '700', fontSize: 13 },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  placa: { fontWeight: '700', color: '#fff', backgroundColor: '#333', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, letterSpacing: 1 },
  apelido: { color: colors.textMuted, fontSize: 13 },
  headResumo: { marginLeft: 'auto' },
  resumoMulta: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  resumoOk: { color: colors.success, fontWeight: '700', fontSize: 13 },

  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  badgeErr: { fontSize: 11, fontWeight: '700', color: '#b71c1c', backgroundColor: '#fdecea', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },

  semMulta: { color: colors.success, paddingVertical: 8 },

  multaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  multaInfo: { flex: 1 },
  multaAit: { fontWeight: '700', color: colors.text },
  multaMotivo: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  multaDatas: { color: colors.textSubtle, fontSize: 11, marginTop: 2 },
  multaValores: { alignItems: 'flex-end' },
  valorDe: { color: colors.textSubtle, fontSize: 11, textDecorationLine: 'line-through' },
  valorPagar: { fontWeight: '700', color: colors.text },

  acoes: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10 },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 10 },
  btnPri: { backgroundColor: colors.primary },
  btnPriTxt: { color: '#fff', fontWeight: '700' },
  btnSec: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1 },
  btnSecTxt: { color: colors.text, fontWeight: '600' },

  pixBox: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, marginTop: 12 },
  qr: { width: 180, height: 180, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 6 },
  pixLabel: { fontWeight: '700', color: colors.text, marginTop: 10, marginBottom: 4 },
  pixEmv: { fontFamily: 'monospace', fontSize: 11, color: colors.textMuted, backgroundColor: colors.surface, borderRadius: 6, padding: 8 },
  pixAcoes: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, maxHeight: '80%' },
  modalTitle: { fontWeight: '700', color: colors.text, fontSize: 16, marginBottom: 10 },
  buscaInput: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, color: colors.text, marginBottom: 8 },
  optList: { maxHeight: 340 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  optPlaca: { fontWeight: '700', color: '#fff', backgroundColor: '#333', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, letterSpacing: 1 },
  optApelido: { flex: 1, color: colors.textMuted, fontSize: 13 },
});
