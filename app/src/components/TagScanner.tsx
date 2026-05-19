import { StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';

export type RescueVehicleTag = {
  id: string;
  apelido?: string | null;
  mac?: string | null;
  nomeBleAdvertised?: string | null;
  manufacturerCompanyId?: number | null;
  manufacturerDataHex?: string | null;
  serviceUuids?: unknown;
  txPowerCalibrado?: number | null;
  iosPeripheralUuidCache?: unknown;
};

export type RescueVehicle = {
  id: string;
  nome: string;
  placa?: string | null;
  tag?: RescueVehicleTag | null;
};

type TagScannerProps = {
  /** Veículo alvo selecionado (com a tag associada). Pode ser null se nenhum estiver selecionado. */
  veiculoAlvo: RescueVehicle | null;
};

/**
 * Placeholder do scanner BLE — implementação completa na Fase 5.
 * Por enquanto, apenas mostra qual veículo/tag está sendo "procurada"
 * e um aviso de que o scanner ainda não está ativo.
 */
export function TagScanner({ veiculoAlvo }: TagScannerProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon source="bluetooth-audio" size={24} color={colors.primary} />
        <Text style={styles.headerTitle}>Buscador de Tag</Text>
      </View>

      {veiculoAlvo ? (
        <View style={styles.alvoBox}>
          <Text style={styles.alvoLabel}>Veículo alvo</Text>
          <Text style={styles.alvoNome} numberOfLines={1}>
            {veiculoAlvo.nome}
            {veiculoAlvo.placa ? ` — ${veiculoAlvo.placa}` : ''}
          </Text>
          {veiculoAlvo.tag ? (
            <View style={styles.tagRow}>
              <Icon source="tag" size={14} color={colors.textMuted} />
              <Text style={styles.tagText} numberOfLines={1}>
                Tag: {veiculoAlvo.tag.apelido ?? veiculoAlvo.tag.nomeBleAdvertised ?? veiculoAlvo.tag.mac ?? '—'}
              </Text>
            </View>
          ) : (
            <View style={styles.tagRow}>
              <Icon source="alert-circle-outline" size={14} color="#e67e22" />
              <Text style={[styles.tagText, { color: '#e67e22' }]}>
                Este veículo não tem tag cadastrada.
              </Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.placeholderBox}>
          <Icon source="cursor-default-click-outline" size={32} color={colors.textMuted} />
          <Text style={styles.placeholderText}>
            Selecione um veículo no mapa para começar a busca.
          </Text>
        </View>
      )}

      <View style={styles.warningBox}>
        <Icon source="information-outline" size={18} color={colors.textMuted} />
        <Text style={styles.warningText}>
          Scanner Bluetooth em construção (Fase 5).{'\n'}
          Funcionalidade completa: distância em tempo real, indicador quente/frio
          e preferência por MAC/fingerprint da tag.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  alvoBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 1,
    marginBottom: spacing.md,
  },
  alvoLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  alvoNome: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  tagText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  placeholderBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    marginTop: 'auto',
  },
  warningText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
});
