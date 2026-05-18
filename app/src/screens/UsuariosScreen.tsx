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

import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import type { RootStackParamList } from '../navigation/routes';

type Usuario = {
  id: string;
  email: string;
  ativo: boolean;
  perfil: string | null;
  permissoes: Record<string, Record<string, boolean>>;
  dispositivoIds: string[];
  createdAt: string;
};

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function UsuariosScreen() {
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const carregar = useCallback(async (modo: 'inicial' | 'refresh' = 'inicial') => {
    if (modo === 'inicial') setLoading(true);
    if (modo === 'refresh') setRefreshing(true);
    try {
      const data = await apiRequest<Usuario[]>('/cliente/usuarios');
      setUsuarios(data);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao listar usuários.',
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

  function confirmarExcluir(u: Usuario) {
    Alert.alert(
      'Excluir usuário?',
      `O acesso de ${u.email} será removido. Esta ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiRequest(`/cliente/usuarios/${u.id}`, { method: 'DELETE' });
              toast.show({ message: 'Usuário excluído.', type: 'success' });
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

  async function alternarStatus(u: Usuario) {
    try {
      await apiRequest(`/cliente/usuarios/${u.id}/status`, { method: 'PATCH' });
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
        <Pressable
          accessibilityRole="button"
          style={styles.btnNovo}
          onPress={() => navigation.navigate('UsuarioForm')}
        >
          <Icon source="plus" size={18} color={colors.primaryText} />
          <Text style={styles.btnNovoLabel}>Novo Usuário</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => carregar('refresh')} />
        }
      >
        {usuarios.length === 0 ? (
          <View style={styles.empty}>
            <Icon source="account-group-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              Nenhum usuário cadastrado. Toque em "Novo Usuário" para liberar acesso a outras pessoas.
            </Text>
          </View>
        ) : (
          usuarios.map((u) => (
            <Pressable
              key={u.id}
              style={styles.card}
              onPress={() => navigation.navigate('UsuarioForm', { id: u.id })}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardEmail} numberOfLines={1}>
                  {u.email}
                </Text>
                <View style={[styles.badge, u.ativo ? styles.badgeAtivo : styles.badgeInativo]}>
                  <Text style={styles.badgeText}>{u.ativo ? 'ATIVO' : 'INATIVO'}</Text>
                </View>
              </View>
              <View style={styles.cardMeta}>
                {u.perfil ? (
                  <View style={styles.metaItem}>
                    <Icon source="tag-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.metaText}>{u.perfil}</Text>
                  </View>
                ) : null}
                <View style={styles.metaItem}>
                  <Icon source="car-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.metaText}>{u.dispositivoIds.length} veículo(s)</Text>
                </View>
              </View>
              <View style={styles.cardActions}>
                <Pressable
                  style={styles.actionBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    navigation.navigate('UsuarioForm', { id: u.id });
                  }}
                >
                  <Icon source="pencil" size={16} color={colors.primary} />
                  <Text style={styles.actionLabel}>Editar</Text>
                </Pressable>
                <Pressable
                  style={styles.actionBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    alternarStatus(u);
                  }}
                >
                  <Icon
                    source={u.ativo ? 'cancel' : 'check'}
                    size={16}
                    color={u.ativo ? '#e67e22' : '#27ae60'}
                  />
                  <Text style={styles.actionLabel}>{u.ativo ? 'Inativar' : 'Ativar'}</Text>
                </Pressable>
                <Pressable
                  style={styles.actionBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    confirmarExcluir(u);
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
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  btnNovo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  btnNovoLabel: {
    color: colors.primaryText,
    fontWeight: '800',
    fontSize: 13,
  },
  scroll: {
    padding: spacing.lg,
    paddingTop: 0,
    gap: spacing.md,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.md,
  },
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
  cardEmail: {
    flex: 1,
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeAtivo: { backgroundColor: '#27ae60' },
  badgeInativo: { backgroundColor: '#95a5a6' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  cardMeta: {
    flexDirection: 'row',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: colors.textMuted },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
});
