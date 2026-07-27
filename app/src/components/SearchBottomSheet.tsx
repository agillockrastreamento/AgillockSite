import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  type ListRenderItemInfo,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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

// Altura fixa do card — a lista é virtualizada, então cada linha precisa de
// altura previsível para não "pular" ao rolar.
const CARD_HEIGHT = 108;

function SearchCardBase({
  device,
  onPress,
}: {
  device: TrackingDevice;
  onPress(device: TrackingDevice): void;
}) {
  const statusColor = getMarkerColor(device);
  const imageUrl = resolveUploadUrl(device.imagemUrlCliente);

  return (
    <Pressable style={styles.card} onPress={() => onPress(device)}>
      <View style={styles.cardPhotoCol}>
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
        {device.apelidoCliente ? (
          <Text style={styles.cardApelido} numberOfLines={1}>{device.apelidoCliente}</Text>
        ) : null}
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

const SearchCard = memo(SearchCardBase);

export function SearchBottomSheet({
  visible,
  devices,
  title = 'Pesquisar veículo',
  searchPlaceholder = 'Buscar por nome, placa ou apelido...',
  onClose,
  onSelectDevice,
}: SearchBottomSheetProps) {
  const [query, setQuery] = useState('');
  // O texto digitado atualiza o campo na hora; o filtro (que re-renderiza a
  // lista inteira) só roda depois da pausa — sem isso, cada tecla percorria e
  // remontava centenas de cards.
  const [queryAplicada, setQueryAplicada] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQueryAplicada(query), 140);
    return () => clearTimeout(timer);
  }, [query]);

  const filteredDevices = useMemo(() => {
    const q = queryAplicada.toLowerCase().trim();
    if (!q) return devices;

    return devices.filter(
      (d) =>
        d.nome.toLowerCase().includes(q) ||
        (d.placa?.toLowerCase().includes(q) ?? false) ||
        (d.apelidoCliente?.toLowerCase().includes(q) ?? false),
    );
  }, [devices, queryAplicada]);

  const onSelectRef = useRef(onSelectDevice);
  onSelectRef.current = onSelectDevice;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Identidade estável: evita invalidar o memo de todos os cards a cada render.
  const handleSelect = useCallback((device: TrackingDevice) => {
    onSelectRef.current(device);
    onCloseRef.current();
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TrackingDevice>) => (
      <View style={styles.gridItem}>
        <SearchCard device={item} onPress={handleSelect} />
      </View>
    ),
    [handleSelect],
  );

  const keyExtractor = useCallback((item: TrackingDevice) => item.dispositivoId, []);

  const header = (
    <View style={styles.searchBoxSticky}>
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
    </View>
  );

  return (
    <BottomSheet
      visible={visible}
      title={title}
      heightPercent={0.7}
      onClose={onClose}
    >
      <FlatList
        style={styles.content}
        data={filteredDevices}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        stickyHeaderIndices={[0]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon source="car-off" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>Nenhum veículo encontrado</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={60}
        windowSize={5}
        removeClippedSubviews
      />
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
    paddingBottom: spacing.lg,
  },
  searchBoxSticky: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  row: {
    gap: spacing.sm,
  },
  gridItem: {
    flex: 1,
    maxWidth: '50%',
    height: CARD_HEIGHT,
    marginBottom: spacing.sm,
  },
  card: {
    width: '100%',
    height: CARD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardPhotoCol: {
    width: 60,
    alignItems: 'center',
    gap: 3,
  },
  cardPhoto: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardApelido: {
    maxWidth: 64,
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
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