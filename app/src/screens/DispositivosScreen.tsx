import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  alternarStatusDispositivo,
  excluirDispositivo,
  listarDispositivos,
  type DispositivoCliente,
} from '../services/api/dispositivosService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import type { RootStackParamList } from '../navigation/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function DispositivosScreen() {
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const [dispositivos, setDispositivos] = useState<DispositivoCliente[]>([]);
  const [limite, setLimite] = useState(0);
  const [total, setTotal] = useState(0);
  const [podeCriar, setPodeCriar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const carregar = useCallback(async (modo: 'inicial' | 'refresh' = 'inicial') => {
    if (modo === 'inicial') setLoading(true);
    if (modo === 'refresh') setRefreshing(true);
    try {
      const data = await listarDispositivos();
      setDispositivos(data.dispositivos);
      setLimite(data.limite);
      setTotal(data.total);
      setPodeCriar(data.podeCriar);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao listar dispositivos.',
        type: 'error',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => carregar('inicial'));
    return unsubscribe;
  }, [navigation, carregar]);

  // O botão continua visível quando a cota está cheia — só avisa em vez de navegar.
  function novoDispositivo() {
    if (!podeCriar) {
      toast.show({
        message: `Você atingiu o limite de ${limite} dispositivo(s) do seu plano. Entre em contato com a AgilLock para ampliá-lo.`,
        type: 'error',
      });
      return;
    }
    navigation.navigate('DispositivoForm');
  }

  function confirmarExcluir(d: DispositivoCliente) {
    Alert.alert(
      'Excluir dispositivo?',
      `O dispositivo ${d.nome} será removido permanentemente. Esta ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await excluirDispositivo(d.id);
              toast.show({ message: 'Dispositivo excluído.', type: 'success' });
              carregar('refresh');
            } catch (err) {
              toast.show({
                message: err instanceof Error ? err.message : 'Falha ao excluir.',
                type: 'error',
              });
            }
          },
        },
      ],
    );
  }

  async function alternarStatus(d: DispositivoCliente) {
    try {
      await alternarStatusDispositivo(d.id);
      toast.show({ message: 'Status atualizado.', type: 'success' });
      carregar('refresh');
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Falha ao atualizar status.',
        type: 'error',
      });
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.actionBar}>
        <View style={styles.cota}>
          <Icon source="chip" size={15} color={colors.textMuted} />
          <Text style={styles.cotaText}>
            <Text style={styles.cotaForte}>{total}</Text> de{' '}
            <Text style={styles.cotaForte}>{limite}</Text> dispositivos
          </Text>
        </View>
        <Pressable accessibilityRole="button" style={styles.btnNovo} onPress={novoDispositivo}>
          <Icon source="plus" size={18} color={colors.primaryText} />
          <Text style={styles.btnNovoLabel}>Novo Dispositivo</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => carregar('refresh')} />
        }
      >
        {dispositivos.length === 0 ? (
          <View style={styles.empty}>
            <Icon source="chip" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              Nenhum dispositivo cadastrado. Toque em "Novo Dispositivo" para cadastrar o seu rastreador.
            </Text>
          </View>
        ) : (
          dispositivos.map((d) => (
            <Pressable
              key={d.id}
              style={styles.card}
              onPress={() => navigation.navigate('DispositivoForm', { id: d.id })}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardNome} numberOfLines={1}>
                    {d.nome}
                  </Text>
                  <Text style={styles.cardSub} numberOfLines={1}>
                    {d.identificador}
                    {d.placa ? ` · ${d.placa}` : ''}
                  </Text>
                </View>
                <View style={[styles.badge, d.ativo ? styles.badgeAtivo : styles.badgeInativo]}>
                  <Text style={styles.badgeText}>{d.ativo ? 'ATIVO' : 'INATIVO'}</Text>
                </View>
              </View>

              <View style={styles.cardMeta}>
                {d.categoria ? (
                  <View style={styles.metaItem}>
                    <Icon source="tag-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.metaText}>{d.categoria}</Text>
                  </View>
                ) : null}
                {!d.podeGerenciar ? (
                  <View style={styles.metaItem}>
                    <Icon source="lock-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.metaText}>Cadastrado pela AgilLock</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.cardActions}>
                <Pressable
                  style={styles.actionBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    navigation.navigate('DispositivoForm', { id: d.id });
                  }}
                >
                  <Icon source="pencil" size={16} color={colors.primary} />
                  <Text style={styles.actionLabel}>Editar</Text>
                </Pressable>

                <Pressable
                  disabled={!d.podeGerenciar}
                  style={[styles.actionBtn, !d.podeGerenciar && styles.actionBtnDisabled]}
                  onPress={(e) => {
                    e.stopPropagation();
                    alternarStatus(d);
                  }}
                >
                  <Icon
                    source={d.ativo ? 'cancel' : 'check'}
                    size={16}
                    color={d.ativo ? '#e67e22' : '#27ae60'}
                  />
                  <Text style={styles.actionLabel}>{d.ativo ? 'Inativar' : 'Ativar'}</Text>
                </Pressable>

                <Pressable
                  disabled={!d.podeGerenciar}
                  style={[styles.actionBtn, !d.podeGerenciar && styles.actionBtnDisabled]}
                  onPress={(e) => {
                    e.stopPropagation();
                    confirmarExcluir(d);
                  }}
                >
                  <Icon source="trash-can-outline" size={16} color={colors.danger} />
                  <Text style={[styles.actionLabel, { color: colors.danger }]}>Excluir</Text>
                </Pressable>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  cota: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cotaText: { fontSize: 12, color: colors.textMuted },
  cotaForte: { color: colors.text, fontWeight: '900' },
  btnNovo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  btnNovoLabel: { color: colors.primaryText, fontWeight: '800', fontSize: 13 },
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  empty: { alignItems: 'center', paddingVertical: spacing.xl * 2, gap: spacing.md },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardNome: { fontSize: 15, fontWeight: '900', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 999 },
  badgeAtivo: { backgroundColor: '#27ae60' },
  badgeInativo: { backgroundColor: '#95a5a6' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  cardMeta: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBtnDisabled: { opacity: 0.35 },
  actionLabel: { fontSize: 12, fontWeight: '700', color: colors.text },
});
