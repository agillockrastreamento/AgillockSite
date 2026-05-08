import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
  vencimento?: string;
  dataPagamento?: string | null;
  descricao?: string | null;
  linkBoleto?: string | null;
  numeroParcela?: number | null;
  placas?: string[];
  dispositivos?: string[];
  dispositivo?: { placa?: string | null; nome?: string | null } | null;
  placa?: { placa?: string | null } | null;
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

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '--/--/----';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--/--/----';
  return date.toLocaleDateString('pt-BR');
}

function fmtMoney(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getDueDate(boleto: Boleto) {
  return boleto.dataVencimento ?? boleto.vencimento;
}

function isOverdue(venc: string | null | undefined) {
  if (!venc) return false;
  const date = new Date(venc);
  return !Number.isNaN(date.getTime()) && date < new Date();
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
          count={contagens.pendente}
          color="#e67e22"
          icon="clock-outline"
        />
        <SummaryCard
          label="Atrasado"
          count={contagens.atrasado}
          color="#e74c3c"
          icon="alert-circle-outline"
        />
        <SummaryCard
          label="Pago"
          count={contagens.pago}
          color="#27ae60"
          icon="check-circle-outline"
        />
      </View>

      {/* Status filter tabs */}
      <ScrollView
        horizontal
        style={styles.tabsScroll}
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
  count,
  color,
  icon,
}: {
  label: string;
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
      <Text style={[styles.summaryCardValue, { color }]}>{count}</Text>
      <Text style={styles.summaryCardCount}>{count === 1 ? 'boleto' : 'boletos'}</Text>
    </View>
  );
}

function BoletoCard({ boleto }: { boleto: Boleto }) {
  const statusColor = STATUS_COLORS[boleto.status] ?? '#95a5a6';
  const statusLabel = STATUS_LABELS[boleto.status] ?? boleto.status;
  const dueDate = getDueDate(boleto);
  const overdue = boleto.status === 'PENDENTE' && isOverdue(dueDate);
  const displayColor = overdue ? '#e74c3c' : statusColor;

  const placaDisplay =
    (boleto.dispositivo?.placa || boleto.dispositivo?.nome) ??
    boleto.placa?.placa ??
    (boleto.placas?.[0] || boleto.dispositivos?.[0] || null);

  const extraTags = [
    ...(boleto.placas?.slice(1) ?? []),
    ...(boleto.dispositivos?.slice(1) ?? []),
  ];

  return (
    <View style={styles.boletoCard}>
      {/* Top row: placa badge + status badge */}
      <View style={styles.boletoTopRow}>
        <View style={styles.boletoTopLeft}>
          {placaDisplay ? (
            <View style={styles.placaBadge}>
              <Text style={styles.placaBadgeText}>{placaDisplay}</Text>
            </View>
          ) : null}
          <View style={[styles.statusBadge, { backgroundColor: displayColor }]}>
            <Text style={styles.statusBadgeText}>{overdue ? 'Atrasado' : statusLabel}</Text>
          </View>
        </View>
        <View style={styles.boletoRight}>
          <Text style={styles.boletoValor}>{fmtMoney(boleto.valor)}</Text>
        </View>
      </View>

      {/* Bottom row: venc info + PDF button */}
      <View style={styles.boletoBottomRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.boletoVenc}>
            Venc.: {fmtDate(dueDate)}
            {boleto.numeroParcela != null ? `  ·  Parc. ${boleto.numeroParcela}` : ''}
          </Text>
          {boleto.dataPagamento ? (
            <Text style={styles.paidDate}>Pago em {fmtDate(boleto.dataPagamento)}</Text>
          ) : null}
          {boleto.descricao ? (
            <Text style={styles.boletoDesc} numberOfLines={1}>{boleto.descricao}</Text>
          ) : null}
          {extraTags.length > 0 && (
            <View style={styles.tagsRow}>
              {extraTags.map((t, i) => (
                <View key={i} style={styles.plateTag}>
                  <Text style={styles.plateTagText}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={styles.pdfArea}>
          {boleto.linkBoleto ? (
            <Pressable
              style={styles.pdfBtn}
              onPress={() => Linking.openURL(boleto.linkBoleto!)}
            >
              <Icon source="file-pdf-box" size={14} color="#fff" />
              <Text style={styles.pdfBtnText}>2ª Via</Text>
            </Pressable>
          ) : (
            <Text style={styles.semLink}>Sem link</Text>
          )}
        </View>
      </View>
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
    fontSize: 22,
    fontWeight: '900',
    color: colors.text,
  },
  summaryCardCount: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  tabsScroll: {
    flexGrow: 0,
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
    backgroundColor: colors.surface,
    padding: spacing.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    gap: 8,
  },
  boletoTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  boletoTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    flexWrap: 'wrap',
  },
  boletoRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  placaBadge: {
    backgroundColor: '#333',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 3,
  },
  placaBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  boletoValor: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
  },
  boletoBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  boletoVenc: {
    fontSize: 11,
    color: colors.textMuted,
  },
  boletoDesc: {
    fontSize: 11,
    color: colors.text,
    fontStyle: 'italic',
    marginTop: 2,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  plateTag: {
    backgroundColor: '#555',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  plateTagText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  paidDate: {
    fontSize: 11,
    color: colors.success,
    fontWeight: '700',
    marginTop: 2,
  },
  pdfArea: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2980b9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  pdfBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  semLink: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
});
