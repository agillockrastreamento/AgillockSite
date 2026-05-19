import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../auth/AuthProvider';
import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import type { AdminPareadorParamList } from '../navigation/routes';

type DispositivoPareamento = {
  id: string;
  nome: string;
  placa: string | null;
  identificador: string;
  marca: string | null;
  modeloVeiculo: string | null;
  enderecoMac: string | null;
  tags: Array<{
    id: string;
    apelido: string | null;
    mac: string | null;
    nomeBleAdvertised: string | null;
  }>;
};

type Navigation = NativeStackNavigationProp<AdminPareadorParamList, 'Pareador'>;

export function PareadorScreen() {
  const navigation = useNavigation<Navigation>();
  const { user, signOut } = useAuth();
  const toast = useToast();

  const [dispositivos, setDispositivos] = useState<DispositivoPareamento[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busca, setBusca] = useState('');

  const load = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const data = await apiRequest<DispositivoPareamento[]>('/app/admin/dispositivos-pareamento');
      setDispositivos(data);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Falha ao carregar dispositivos.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return dispositivos;
    return dispositivos.filter((d) =>
      (d.nome + ' ' + (d.placa ?? '') + ' ' + d.identificador).toLowerCase().includes(q),
    );
  }, [dispositivos, busca]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Pareador de Tags</Text>
          <Text style={styles.headerSub}>
            {user?.nome ? `${user.nome} · ` : ''}{dispositivos.length} dispositivo{dispositivos.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            await signOut();
            toast.show({ message: 'Sessão encerrada.', type: 'info' });
          }}
          style={styles.logoutBtn}
        >
          <Icon source="logout" size={18} color={colors.danger} />
        </Pressable>
      </View>

      <View style={styles.searchBox}>
        <Icon source="magnify" size={18} color={colors.textMuted} />
        <TextInput
          placeholder="Buscar por placa, nome ou identificador…"
          placeholderTextColor={colors.textMuted}
          value={busca}
          onChangeText={setBusca}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtrados}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Icon source="car-off" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>
                {busca ? 'Nenhum dispositivo encontrado.' : 'Nenhum dispositivo ativo cadastrado.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              style={styles.card}
              onPress={() =>
                navigation.navigate('PareadorTag', {
                  dispositivoId: item.id,
                  nome: item.nome,
                })
              }
            >
              <View style={styles.cardLeft}>
                <View style={[
                  styles.iconCircle,
                  item.tags.length > 0 && { backgroundColor: '#dcf3e7' },
                ]}>
                  <Icon
                    source={item.tags.length > 0 ? 'bluetooth-connect' : 'bluetooth-off'}
                    size={20}
                    color={item.tags.length > 0 ? colors.success : colors.textMuted}
                  />
                </View>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.nome}
                </Text>
                <Text style={styles.cardSub} numberOfLines={1}>
                  {item.placa ? `${item.placa} · ` : ''}{item.identificador}
                  {item.marca || item.modeloVeiculo ? ` · ${item.marca ?? ''} ${item.modeloVeiculo ?? ''}`.trim() : ''}
                </Text>
                {item.enderecoMac ? (
                  <Text style={styles.cardMac}>MAC: {item.enderecoMac}</Text>
                ) : null}
              </View>
              <View style={styles.cardRight}>
                <View style={styles.tagsBadge}>
                  <Text style={styles.tagsBadgeText}>{item.tags.length}</Text>
                </View>
                <Icon source="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  headerSub: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  logoutBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 20, backgroundColor: '#fff1ef',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 8,
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: 8 },
  emptyBox: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.xl, gap: spacing.sm,
  },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 1,
    marginBottom: 8,
  },
  cardLeft: {},
  iconCircle: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 20, backgroundColor: colors.surfaceMuted,
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  cardSub: { color: colors.textMuted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  cardMac: { color: colors.primary, fontSize: 10, fontWeight: '700', marginTop: 2 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagsBadge: {
    minWidth: 22, height: 22,
    paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 11, backgroundColor: colors.primary,
  },
  tagsBadgeText: { color: colors.primaryText, fontSize: 11, fontWeight: '900' },
});
