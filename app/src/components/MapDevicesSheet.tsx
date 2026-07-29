import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  type ListRenderItemInfo,
  Platform,
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
import { cursoDoCard, getMarkerColor } from '../tracking/VehicleCards';
import { VehicleIcon } from '../tracking/VehicleIcon';
import type { TrackingDevice } from '../tracking/trackingTypes';

type Props = {
  visible: boolean;
  /** Todos os veículos do mapa ativo — a lista aqui nunca é cortada. */
  devices: TrackingDevice[];
  /** Seleção salva; `null` significa "automático" (os primeiros do limite). */
  selectedIds: string[] | null;
  limite: number;
  onClose(): void;
  onApply(ids: string[]): void;
};

// Altura fixa da linha — a lista é virtualizada e precisa de altura previsível.
const ROW_HEIGHT = 64;

function DeviceRowBase({
  device,
  checked,
  bloqueado,
  onToggle,
}: {
  device: TrackingDevice;
  checked: boolean;
  bloqueado: boolean;
  onToggle(dispositivoId: string): void;
}) {
  const cor = getMarkerColor(device);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: bloqueado }}
      style={[styles.row, checked && styles.rowChecked, bloqueado && styles.rowDisabled]}
      onPress={() => onToggle(device.dispositivoId)}
    >
      <View style={[styles.rowIcon, { backgroundColor: cor + '20' }]}>
        <VehicleIcon
          categoria={device.categoria}
          color={cor}
          course={cursoDoCard(device)}
          size={34}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {device.nome}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {device.placa ?? 'Sem placa'}
          {device.apelidoCliente ? ` · ${device.apelidoCliente}` : ''}
        </Text>
      </View>
      <Icon
        source={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={24}
        color={checked ? colors.accent : bloqueado ? colors.textSubtle : colors.textMuted}
      />
    </Pressable>
  );
}

// Só redesenha quando muda algo que a linha mostra.
const DeviceRow = memo(
  DeviceRowBase,
  (a, b) =>
    a.checked === b.checked &&
    a.bloqueado === b.bloqueado &&
    a.device.dispositivoId === b.device.dispositivoId &&
    a.device.nome === b.device.nome &&
    a.device.placa === b.device.placa &&
    a.device.apelidoCliente === b.device.apelidoCliente &&
    a.device.categoria === b.device.categoria &&
    getMarkerColor(a.device) === getMarkerColor(b.device) &&
    cursoDoCard(a.device) === cursoDoCard(b.device),
);

export function MapDevicesSheet({
  visible,
  devices,
  selectedIds,
  limite,
  onClose,
  onApply,
}: Props) {
  const [selecao, setSelecao] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  // O texto digitado atualiza o campo na hora; o filtro (que re-renderiza a
  // lista inteira) só roda depois da pausa.
  const [queryAplicada, setQueryAplicada] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQueryAplicada(query), 140);
    return () => clearTimeout(timer);
  }, [query]);

  // Abrir sempre parte do que está no mapa hoje: a seleção salva ou, quando
  // ainda não há uma, os primeiros veículos (o mesmo corte automático da tela).
  useEffect(() => {
    if (!visible) return;
    const base = selectedIds ?? devices.slice(0, limite).map((d) => d.dispositivoId);
    setSelecao(new Set(base));
    setQuery('');
    setQueryAplicada('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const listaFiltrada = useMemo(() => {
    const q = queryAplicada.toLowerCase().trim();
    if (!q) return devices;
    return devices.filter(
      (d) =>
        d.nome.toLowerCase().includes(q) ||
        (d.placa?.toLowerCase().includes(q) ?? false) ||
        (d.apelidoCliente?.toLowerCase().includes(q) ?? false),
    );
  }, [devices, queryAplicada]);

  const cheio = selecao.size >= limite;

  // Identidade estável: evita invalidar o memo de todas as linhas a cada toque.
  const alternar = useCallback((dispositivoId: string) => {
    setSelecao((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(dispositivoId)) {
        proxima.delete(dispositivoId);
        return proxima;
      }
      // Teto rígido: acima disso o mapa trava (e no iOS chega a derrubar o app).
      if (proxima.size >= limite) return atual;
      proxima.add(dispositivoId);
      return proxima;
    });
  }, [limite]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TrackingDevice>) => {
      const marcado = selecao.has(item.dispositivoId);
      return (
        <DeviceRow
          device={item}
          checked={marcado}
          bloqueado={!marcado && cheio}
          onToggle={alternar}
        />
      );
    },
    [selecao, cheio, alternar],
  );

  const keyExtractor = useCallback((item: TrackingDevice) => item.dispositivoId, []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<TrackingDevice> | null | undefined, index: number) => ({
      length: ROW_HEIGHT + spacing.sm,
      offset: (ROW_HEIGHT + spacing.sm) * index,
      index,
    }),
    [],
  );

  const preencherAutomatico = useCallback(() => {
    setSelecao(new Set(devices.slice(0, limite).map((d) => d.dispositivoId)));
  }, [devices, limite]);

  const aplicar = useCallback(() => {
    // Preserva a ordem original da lista, não a ordem em que foi marcado.
    const ids = devices
      .map((d) => d.dispositivoId)
      .filter((id) => selecao.has(id))
      .slice(0, limite);
    onApply(ids);
    onClose();
  }, [devices, limite, onApply, onClose, selecao]);

  return (
    <BottomSheet
      visible={visible}
      title="Veículos no mapa"
      subtitle={`${selecao.size} de ${limite} selecionados · ${devices.length} disponíveis`}
      heightPercent={0.85}
      onClose={onClose}
    >
      <View style={styles.content}>
        <View style={styles.searchBox}>
          <Icon source="magnify" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nome, placa ou apelido..."
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

        <View style={styles.acoes}>
          <Pressable accessibilityRole="button" style={styles.acaoBtn} onPress={preencherAutomatico}>
            <Icon source="playlist-check" size={16} color={colors.accent} />
            <Text style={styles.acaoText}>Preencher os {limite} primeiros</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.acaoBtn}
            onPress={() => setSelecao(new Set())}
          >
            <Icon source="close-circle-outline" size={16} color={colors.danger} />
            <Text style={[styles.acaoText, styles.acaoTextDanger]}>Limpar</Text>
          </Pressable>
        </View>

        {cheio ? (
          <Text style={styles.avisoLimite}>
            Limite de {limite} atingido. Desmarque algum veículo para escolher outro.
          </Text>
        ) : null}

        <FlatList
          style={styles.lista}
          data={listaFiltrada}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          contentContainerStyle={styles.listaConteudo}
          ListEmptyComponent={
            <View style={styles.vazio}>
              <Icon source="car-off" size={40} color={colors.textMuted} />
              <Text style={styles.vazioText}>Nenhum veículo encontrado</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={60}
          windowSize={7}
          // Só no Android: no iOS essa otimização tem histórico de deixar
          // células em branco ao rolar rápido.
          removeClippedSubviews={Platform.OS === 'android'}
        />

        <View style={styles.rodape}>
          <Pressable
            accessibilityRole="button"
            style={[styles.aplicarBtn, selecao.size === 0 && styles.aplicarBtnDisabled]}
            disabled={selecao.size === 0}
            onPress={aplicar}
          >
            <Text style={styles.aplicarText}>
              Mostrar {selecao.size} no mapa
            </Text>
          </Pressable>
        </View>
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
    marginTop: spacing.sm,
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
  acoes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  acaoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  acaoText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
  },
  acaoTextDanger: {
    color: colors.danger,
  },
  avisoLimite: {
    marginBottom: spacing.xs,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  lista: {
    flex: 1,
  },
  listaConteudo: {
    paddingBottom: spacing.md,
  },
  row: {
    height: ROW_HEIGHT,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowChecked: {
    borderColor: colors.accent,
    backgroundColor: '#2980b90f',
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  rowMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  vazio: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  vazioText: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 14,
  },
  rodape: {
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  aplicarBtn: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  aplicarBtnDisabled: {
    opacity: 0.5,
  },
  aplicarText: {
    color: colors.primaryText,
    fontSize: 15,
    fontWeight: '900',
  },
});
