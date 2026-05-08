import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';

import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';

type Boleto = {
  id: string;
  status: 'PENDENTE' | 'PAGO' | 'ATRASADO' | 'CANCELADO' | 'REEMBOLSADO';
  valor: number;
  dataVencimento: string;
  dataPagamento?: string | null;
  descricao?: string | null;
  placas?: string[];
  dispositivos?: string[];
};

type StatusFilter = 'TODOS' | 'PENDENTE' | 'ATRASADO' | 'PAGO' | 'CANCELADO';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'TODOS', label: 'Todos' },
  { key: 'PENDENTE', label: 'Pendente' },
  { key: 'ATRASADO', label: 'Atrasado' },
  { key: 'PAGO', label: 'Pago' },
  { key: 'CANCELADO', label: 'Cancelado' },
];

const STATUS_COLORS: Record<string, string> = {
  PENDENTE: '#e67e22',
  ATRASADO: '#e74c3c',
  PAGO: '#27ae60',
  CANCELADO: '#95a5a6',
  REEMBOLSADO: '#8e44ad',
};

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: 'Pendente',
  ATRASADO: 'Atrasado',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
  REEMBOLSADO: 'Reembolsado',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtMoney(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function isOverdue(venc: string) {
  return new Date(venc) < new Date();
}

export function PagamentosScreen() {
  const toast = useToast();
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('TODOS');

  const loadBoletos = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const data = await apiRequest<Boleto[]>('/cliente/boletos');
      setBoletos(data ?? []);
    } catch {
      toast.show({ message: 'Erro ao carregar pagamentos.', type: 'error' });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadBoletos();
  }, [loadBoletos]);

  const filtered = activeStatus === 'TODOS'
    ? boletos
    : boletos.filter(b => b.status === activeStatus);

  const totais = {
    pendente: boletos.filter(b => b.status === 'PENDENTE').reduce((s, b) => s + b.valor, 0),
    atrasado: boletos.filter(b => b.status === 'ATRASADO').reduce((s, b) => s + b.valor, 0),
    pago: boletos.filter(b => b.status === 'PAGO').reduce((s, b) => s + b.valor, 0),
  };
  const contagens = {
    pendente: boletos.filter(b => b.status === 'PENDENTE').length,
    atrasado: boletos.filter(b => b.status === 'ATRASADO').length,
    pago: boletos.filter(b => b.status === 'PAGO').length,
  };

  return (
    <View style={styles.container}>
      {/* Summary cards */}
      <View style={styles.summaryRow}>
        <SummaryCard
          label="Pendente"
          valor={totais.pendente}
          count={contagens.pendente}
          color="#e67e22"
          icon="clock-outline"
        />
        <SummaryCard
          label="Atrasado"
          valor={totais.atrasado}
          count={contagens.atrasado}
          color="#e74c3c"
          icon="alert-circle-outline"
        />
        <SummaryCard
          label="Pago"
          valor={totais.pago}
          count={contagens.pago}
          color="#27ae60"
          icon="check-circle-outline"
        />
      </View>

      {/* Status filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
      >
        {STATUS_TABS.map(tab => {
          const count = tab.key === 'TODOS'
            ? boletos.length
            : boletos.filter(b => b.status === tab.key).length;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              style={[styles.statusTab, activeStatus === tab.key && styles.statusTabActive]}
              onPress={() => setActiveStatus(tab.key)}
            >
              <Text style={[styles.statusTabText, activeStatus === tab.key && styles.statusTabTextActive]}>
                {tab.label}
              </Text>
              {count > 0 && (
                <View style={[styles.countBadge, activeStatus === tab.key && styles.countBadgeActive]}>
                  <Text style={[styles.countBadgeText, activeStatus === tab.key && styles.countBadgeTextActive]}>
                    {count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => loadBoletos(true)} />}
        >
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Icon source="receipt-text-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyText}>Nenhum boleto encontrado</Text>
              {activeStatus !== 'TODOS' && (
                <Text style={styles.emptySubText}>
                  Não há boletos com status "{STATUS_LABELS[activeStatus] ?? activeStatus}".
                </Text>
              )}
            </View>
          ) : (
            filtered.map(boleto => <BoletoCard key={boleto.id} boleto={boleto} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

function SummaryCard({
  label,
  valor,
  count,
  color,
  icon,
}: {
  label: string;
  valor: number;
  count: number;
  color: string;
  icon: string;
}) {
  return (
    <View style={[styles.summaryCard, { borderTopColor: color }]}>
      <View style={styles.summaryCardHeader}>
        <Icon source={icon} size={16} color={color} />
        <Text style={[styles.summaryCardLabel, { color }]}>{label}</Text>
      </View>
      <Text style={styles.summaryCardValue}>{fmtMoney(valor)}</Text>
      <Text style={styles.summaryCardCount}>{count} {count === 1 ? 'boleto' : 'boletos'}</Text>
    </View>
  );
}

function BoletoCard({ boleto }: { boleto: Boleto }) {
  const statusColor = STATUS_COLORS[boleto.status] ?? '#95a5a6';
  const statusLabel = STATUS_LABELS[boleto.status] ?? boleto.status;
  const overdue = boleto.status === 'PENDENTE' && isOverdue(boleto.dataVencimento);
  const displayColor = overdue ? '#e74c3c' : statusColor;

  const tags = [
    ...(boleto.placas ?? []),
    ...(boleto.dispositivos ?? []),
  ];

  return (
    <View style={[styles.boletoCard, { borderLeftColor: displayColor }]}>
      <View style={styles.boletoRow}>
        <View style={styles.boletoLeft}>
          <Text style={styles.boletoValor}>{fmtMoney(boleto.valor)}</Text>
          <Text style={styles.boletoVenc}>
            Venc.: {fmtDate(boleto.dataVencimento)}
            {overdue ? ' (vencido)' : ''}
          </Text>
          {boleto.descricao ? (
            <Text style={styles.boletoDesc} numberOfLines={1}>{boleto.descricao}</Text>
          ) : null}
          {tags.length > 0 && (
            <View style={styles.tagsRow}>
              {tags.map((t, i) => (
                <View key={i} style={styles.plateTag}>
                  <Text style={styles.plateTagText}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${displayColor}22` }]}>
          <Text style={[styles.statusBadgeText, { color: displayColor }]}>{statusLabel}</Text>
        </View>
      </View>
      {boleto.dataPagamento && (
        <Text style={styles.paidDate}>
          Pago em {fmtDate(boleto.dataPagamento)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radius.md,
    borderTopWidth: 4,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  summaryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  summaryCardLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  summaryCardValue: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.text,
  },
  summaryCardCount: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  statusTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statusTabActive: {
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  statusTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  statusTabTextActive: {
    color: colors.primary,
  },
  countBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
  },
  countBadgeActive: {
    backgroundColor: colors.primary,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textMuted,
  },
  countBadgeTextActive: {
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
    paddingBottom: spacing.xxl,
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
  },
  boletoCard: {
    borderRadius: radius.md,
    borderLeftWidth: 4,
    backgroundColor: colors.surface,
    padding: spacing.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  boletoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  boletoLeft: {
    flex: 1,
    gap: 3,
  },
  boletoValor: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
  },
  boletoVenc: {
    fontSize: 12,
    color: colors.textMuted,
  },
  boletoDesc: {
    fontSize: 12,
    color: colors.text,
    fontStyle: 'italic',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  plateTag: {
    backgroundColor: '#333',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  plateTagText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  paidDate: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: colors.success,
    fontWeight: '700',
  },
});
