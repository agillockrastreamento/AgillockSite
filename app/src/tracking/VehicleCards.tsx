import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';

import { resolveUploadUrl } from '../profile/profileService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import type { TrackingDevice } from './trackingTypes';
import { VehicleIcon } from './VehicleIcon';

export function getStatusColor(status: string) {
  if (status === 'online') return colors.success;
  if (status === 'offline') return colors.danger;
  return colors.textMuted;
}

export function formatSpeed(device: TrackingDevice) {
  const speed = device.posicao?.velocidade;
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return 'n/a';
  return `${Math.round(speed)} km/h`;
}

export function formatLastUpdate(device: TrackingDevice) {
  const raw = device.posicao?.fixTime ?? device.lastUpdate;
  if (!raw) return 'Sem atualização';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Sem atualização';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function VehiclePhoto({
  device,
  size = 62,
}: {
  device: TrackingDevice;
  size?: number;
}) {
  const imageUrl = resolveUploadUrl(device.imagemUrlCliente);

  return (
    <View style={[styles.photoBox, { width: size, height: size }]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.photo} />
      ) : (
        <VehicleIcon
          categoria={device.categoria}
          color={device.cor}
          course={device.posicao?.curso}
          size={size - 6}
        />
      )}
      <View style={styles.cameraBadge}>
        <Icon source="camera" size={13} color={colors.primaryText} />
      </View>
    </View>
  );
}

export function QuickVehicleCard({
  device,
  selected,
  onPress,
}: {
  device: TrackingDevice;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.quickCard, selected && styles.quickCardSelected]}
      onPress={onPress}
    >
      <VehiclePhoto device={device} size={44} />
      <View style={styles.quickBody}>
        <Text style={styles.quickName} numberOfLines={1}>
          {device.nome}
        </Text>
        <Text style={styles.quickMeta} numberOfLines={1}>
          {device.placa ?? 'Sem placa'} · {formatSpeed(device)}
        </Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: getStatusColor(device.status) },
            ]}
          />
          <Text style={styles.statusText} numberOfLines={1}>
            {device.status}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function MainVehicleCard({
  device,
  onUploadPhoto,
  onRemovePhoto,
  isUploading,
}: {
  device: TrackingDevice;
  onUploadPhoto(): void;
  onRemovePhoto(): void;
  isUploading?: boolean;
}) {
  const ignition = device.posicao?.ignicao ?? device.posicao?.ignition;
  const moving = device.posicao?.emMovimento;

  return (
    <View style={styles.mainCard}>
      <View style={styles.mainTop}>
        <Pressable
          accessibilityRole="button"
          style={styles.mainPhotoButton}
          disabled={isUploading}
          onPress={onUploadPhoto}
        >
          <VehiclePhoto device={device} size={86} />
        </Pressable>
        <View style={styles.mainInfo}>
          <Text style={styles.mainTitle} numberOfLines={1}>
            {device.nome}
          </Text>
          <Text style={styles.mainPlate} numberOfLines={1}>
            {device.placa ?? 'Sem placa'} · {device.status}
          </Text>
          <Text style={styles.mainSub} numberOfLines={1}>
            {device.marca ?? 'Marca não informada'} {device.modeloVeiculo ?? ''}
          </Text>
        </View>
      </View>

      <View style={styles.metricsGrid}>
        <Metric label="Velocidade" value={formatSpeed(device)} />
        <Metric label="Ignição" value={ignition ? 'Ligada' : 'Desligada'} />
        <Metric label="Movimento" value={moving ? 'Em movimento' : 'Parado'} />
        <Metric label="Atualização" value={formatLastUpdate(device)} />
      </View>

      <View style={styles.addressBox}>
        <Icon source="map-marker-outline" size={18} color={colors.textMuted} />
        <Text style={styles.addressText} numberOfLines={2}>
          {device.posicao?.endereco ?? 'Endereço ainda não disponível.'}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          style={styles.primaryAction}
          disabled={isUploading}
          onPress={onUploadPhoto}
        >
          <Icon source="camera" size={18} color={colors.primaryText} />
          <Text style={styles.primaryActionText}>
            {isUploading ? 'Enviando...' : 'Alterar foto'}
          </Text>
        </Pressable>
        {device.imagemUrlCliente ? (
          <Pressable
            accessibilityRole="button"
            style={styles.secondaryAction}
            disabled={isUploading}
            onPress={onRemovePhoto}
          >
            <Icon source="delete-outline" size={18} color={colors.danger} />
            <Text style={styles.secondaryActionText}>Remover</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photoBox: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  photo: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
  },
  cameraBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.primary,
  },
  quickCard: {
    width: '48%',
    minHeight: 108,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  quickBody: {
    flex: 1,
    minWidth: 0,
  },
  quickName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  quickMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  mainCard: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  mainTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  mainPhotoButton: {
    borderRadius: radius.md,
  },
  mainInfo: {
    flex: 1,
    minWidth: 0,
  },
  mainTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
  },
  mainPlate: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  mainSub: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 13,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metric: {
    width: '48%',
    minHeight: 62,
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metricValue: {
    marginTop: spacing.xs,
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  addressBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  addressText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryAction: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryActionText: {
    color: colors.primaryText,
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryAction: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#fff1ef',
  },
  secondaryActionText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '900',
  },
});
