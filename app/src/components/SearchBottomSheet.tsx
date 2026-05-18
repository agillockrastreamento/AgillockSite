import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, IconButton } from 'react-native-paper';

import { BottomSheet } from './BottomSheet';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { getMarkerColor } from '../tracking/VehicleCards';
import { VehicleIcon } from '../tracking/VehicleIcon';
import { resolveUploadUrl } from '../profile/profileService';
import type { TrackingDevice } from '../tracking/trackingTypes';

type SearchBottomSheetProps = {
  visible: boolean;
  devices: TrackingDevice[];
  title?: string;
  searchPlaceholder?: string;
  onClose(): void;
  onSelectDevice(device: TrackingDevice): void;
};

function SearchCard({
  device,
  onPress,
}: {
  device: TrackingDevice;
  onPress(): void;
}) {
  const statusColor = getMarkerColor(device);
  const imageUrl = resolveUploadUrl(device.imagemUrlCliente);

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={[styles.cardPhoto, { backgroundColor: statusColor + '20' }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.photo} />
        ) : (
          <VehicleIcon
            categoria={device.categoria}
            color={statusColor}
            course={device.posicao?.curso}
            size={54}
          />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {device.nome}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {device.placa ?? 'Sem placa'}
        </Text>
      </View>
    </Pressable>
  );
}

export function SearchBottomSheet({
  visible,
  devices,
  title = 'Pesquisar veículo',
  searchPlaceholder = 'Buscar por nome ou placa...',
  onClose,
  onSelectDevice,
}: SearchBottomSheetProps) {
  const [query, setQuery] = useState('');

  const filteredDevices = useMemo(() => {
    if (!query.trim()) return devices;

    const q = query.toLowerCase().trim();
    return devices.filter(
      (d) =>
        d.nome.toLowerCase().includes(q) ||
        (d.placa?.toLowerCase().includes(q) ?? false),
    );
  }, [devices, query]);

  const handleSelect = useCallback(
    (device: TrackingDevice) => {
      onSelectDevice(device);
      onClose();
    },
    [onSelectDevice, onClose],
  );

  return (
    <BottomSheet
      visible={visible}
      title={title}
      heightPercent={0.7}
      onClose={onClose}
    >
      <View style={styles.content}>
        <View style={styles.searchBox}>
          <Icon source="magnify" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <IconButton
              icon="close-circle"
              size={18}
              iconColor={colors.textMuted}
              onPress={() => setQuery('')}
            />
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.grid}>
            {filteredDevices.map((device) => (
              <View key={device.dispositivoId} style={styles.gridItem}>
                <SearchCard
                  device={device}
                  onPress={() => handleSelect(device)}
                />
              </View>
            ))}
          </View>
          {filteredDevices.length === 0 && (
            <View style={styles.empty}>
              <Icon source="car-off" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>Nenhum veículo encontrado</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  searchInput: {
    flex: 1,
    height: 44,
    marginLeft: spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridItem: {
    width: '48%',
  },
  card: {
    width: '100%',
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
  cardPhoto: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  cardMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 14,
  },
});