import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Icon } from 'react-native-paper';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';

import {
  type BleDevice,
  ensureBlePermissions,
  startBleScan,
  waitForBleReady,
} from '../ble/bleManager';
import { rssiToDistance } from '../ble/distanceEstimator';
import { bufferBase64ToHex, getDeviceInstallId } from '../ble/tagMatcher';
import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import type { AdminPareadorParamList } from '../navigation/routes';

type ExistingTag = {
  id: string;
  apelido: string | null;
  mac: string | null;
  nomeBleAdvertised: string | null;
};

type ScanCandidate = {
  id: string;
  name: string;
  rssi: number;
  distance: number;
  rawDevice: BleDevice;
};

type RouteType = RouteProp<AdminPareadorParamList, 'PareadorTag'>;

export function PareadorTagScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteType>();
  const toast = useToast();
  const { dispositivoId, nome } = route.params;

  const [tags, setTags] = useState<ExistingTag[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(true);

  const [isScanning, setIsScanning] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, ScanCandidate>>({});
  const stopScanRef = useRef<(() => void) | null>(null);

  const [modalCandidate, setModalCandidate] = useState<ScanCandidate | null>(null);
  const [apelido, setApelido] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadTags = useCallback(async () => {
    setIsLoadingTags(true);
    try {
      const data = await apiRequest<ExistingTag[]>(`/dispositivos/${dispositivoId}/tags`);
      setTags(data);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Falha ao carregar tags.',
        type: 'error',
      });
    } finally {
      setIsLoadingTags(false);
    }
  }, [dispositivoId, toast]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  useEffect(() => {
    return () => {
      stopScanRef.current?.();
      stopScanRef.current = null;
    };
  }, []);

  const startScan = useCallback(async () => {
    setPermissionError(null);
    setCandidates({});
    const perm = await ensureBlePermissions();
    if (!perm.granted) {
      setPermissionError(perm.reason ?? 'Sem permissão para Bluetooth.');
      return;
    }
    const state = await waitForBleReady(4000);
    if (String(state) !== 'PoweredOn') {
      setPermissionError('Ative o Bluetooth do aparelho para escanear.');
      return;
    }

    const stop = startBleScan(
      (device: BleDevice) => {
        const id = device.id;
        const name = (device.localName ?? device.name ?? 'Tag sem nome').trim();
        const rssi = device.rssi ?? -100;
        setCandidates((current) => ({
          ...current,
          [id]: {
            id,
            name,
            rssi,
            distance: rssiToDistance(rssi, -59, 2.5),
            rawDevice: device,
          },
        }));
      },
      {
        onlyTags: true,
        onError: (msg) => {
          setPermissionError(msg);
          setIsScanning(false);
        },
      },
    );
    stopScanRef.current = stop;
    setIsScanning(true);
  }, []);

  const stopScan = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    setIsScanning(false);
  }, []);

  const openSaveModal = useCallback((candidate: ScanCandidate) => {
    stopScan();
    setApelido(candidate.name && candidate.name !== 'Tag sem nome' ? candidate.name : '');
    setModalCandidate(candidate);
  }, [stopScan]);

  const saveTag = useCallback(async () => {
    if (!modalCandidate) return;
    setIsSaving(true);
    try {
      const device = modalCandidate.rawDevice;
      const serviceUuids = (device.serviceUUIDs ?? []).map((u) => u.toLowerCase().replace(/-/g, '').slice(-4));
      const manufacturerDataHex = bufferBase64ToHex(device.manufacturerData);

      // No Android device.id é o MAC. No iOS, é um UUID estável por instalação.
      const isAndroid = Platform.OS === 'android';

      await apiRequest(`/dispositivos/${dispositivoId}/tags`, {
        method: 'POST',
        body: {
          apelido: apelido.trim() || null,
          mac: isAndroid ? device.id : null,
          nomeBleAdvertised: (device.localName ?? device.name ?? null),
          manufacturerCompanyId:
            manufacturerDataHex && manufacturerDataHex.length >= 4
              ? parseInt(manufacturerDataHex.slice(2, 4) + manufacturerDataHex.slice(0, 2), 16)
              : null,
          manufacturerDataHex: manufacturerDataHex || null,
          serviceUuids: serviceUuids.length ? serviceUuids : null,
          txPowerCalibrado: device.txPowerLevel ?? null,
          iosPeripheralUuid: !isAndroid ? device.id : null,
          iosDeviceId: !isAndroid ? getDeviceInstallId() : null,
        },
      });

      toast.show({ message: 'Tag pareada com sucesso!', type: 'success' });
      setModalCandidate(null);
      setApelido('');
      await loadTags();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao salvar tag.',
        type: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  }, [modalCandidate, apelido, dispositivoId, toast, loadTags]);

  const deleteTag = useCallback(async (tagId: string) => {
    try {
      await apiRequest(`/tags/${tagId}`, { method: 'DELETE' });
      toast.show({ message: 'Tag removida.', type: 'success' });
      loadTags();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Erro ao remover tag.',
        type: 'error',
      });
    }
  }, [toast, loadTags]);

  // Conjunto de IDs (MAC no Android / UUID no iOS) das tags já pareadas com este dispositivo.
  // Filtramos as candidatas para não exibir tags que já estão cadastradas — evita
  // clique acidental que dispararia erro 500 (unique constraint do MAC).
  const tagsCadastradasIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of tags) {
      if (t.mac) set.add(t.mac.toUpperCase().replace(/[^0-9A-F]/g, ''));
    }
    return set;
  }, [tags]);

  const candidatesOrdenados = useMemo(
    () => {
      const normalize = (s: string) => s.toUpperCase().replace(/[^0-9A-F]/g, '');
      return Object.values(candidates)
        .filter((c) => !tagsCadastradasIds.has(normalize(c.id)))
        .sort((a, b) => a.distance - b.distance);
    },
    [candidates, tagsCadastradasIds],
  );

  return (
    <View style={styles.container}>
      {/* Tags já cadastradas */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tags cadastradas</Text>
        {isLoadingTags ? (
          <ActivityIndicator color={colors.primary} />
        ) : tags.length === 0 ? (
          <Text style={styles.emptyText}>Nenhuma tag pareada ainda.</Text>
        ) : (
          tags.map((t) => (
            <View key={t.id} style={styles.tagCard}>
              <Icon source="tag" size={18} color={colors.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.tagName}>
                  {t.apelido ?? t.nomeBleAdvertised ?? 'Tag sem nome'}
                </Text>
                <Text style={styles.tagMac}>
                  {t.mac ? `MAC: ${t.mac}` : t.nomeBleAdvertised ? `Nome: ${t.nomeBleAdvertised}` : '—'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => deleteTag(t.id)}
                style={styles.deleteBtn}
              >
                <Icon source="delete-outline" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))
        )}
      </View>

      {/* Scan e candidatas */}
      <View style={[styles.section, { flex: 1 }]}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Parear novo dispositivo</Text>
          <Pressable
            accessibilityRole="button"
            onPress={isScanning ? stopScan : startScan}
            style={[styles.scanButton, isScanning && styles.scanButtonStop]}
          >
            {isScanning ? (
              <>
                <ActivityIndicator size={14} color="#fff" />
                <Text style={styles.scanButtonText}>Parar</Text>
              </>
            ) : (
              <>
                <Icon source="magnify" size={16} color="#fff" />
                <Text style={styles.scanButtonText}>Escanear</Text>
              </>
            )}
          </Pressable>
        </View>

        {permissionError ? (
          <View style={styles.errorBox}>
            <Icon source="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{permissionError}</Text>
          </View>
        ) : null}

        {isScanning && candidatesOrdenados.length === 0 ? (
          <View style={styles.searchingBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.searchingText}>Procurando dispositivos ao redor…</Text>
            <Text style={styles.searchingHint}>
              Aproxime o celular do dispositivo para captar o sinal.
            </Text>
          </View>
        ) : null}

        <FlatList
          data={candidatesOrdenados}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
          ListEmptyComponent={
            !isScanning ? (
              <View style={styles.idleBox}>
                <Icon source="bluetooth-settings" size={32} color={colors.textMuted} />
                <Text style={styles.idleText}>
                  Toque em "Escanear" para começar a procurar dispositivos próximos.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              style={styles.candidateCard}
              onPress={() => openSaveModal(item)}
            >
              <View style={styles.iconCircle}>
                <Icon source="bluetooth" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.candidateName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.candidateMeta}>
                  RSSI: {item.rssi} dBm · {item.distance < 1 ? `${Math.round(item.distance * 100)} cm` : `~${item.distance.toFixed(1)} m`}
                </Text>
                {Platform.OS === 'android' ? (
                  <Text style={styles.candidateId} numberOfLines={1}>{item.id}</Text>
                ) : null}
              </View>
              <Icon source="plus-circle" size={22} color={colors.primary} />
            </Pressable>
          )}
        />
      </View>

      {/* Modal salvar candidata */}
      <Modal
        visible={modalCandidate !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setModalCandidate(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => !isSaving && setModalCandidate(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Parear tag</Text>
            <Text style={styles.modalSub}>Veículo: {nome}</Text>

            {modalCandidate ? (
              <View style={styles.modalInfoBox}>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Nome BLE</Text>
                  <Text style={styles.modalInfoValue} numberOfLines={1}>
                    {modalCandidate.name}
                  </Text>
                </View>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>
                    {Platform.OS === 'android' ? 'MAC' : 'UUID iOS'}
                  </Text>
                  <Text style={styles.modalInfoValue} numberOfLines={1}>
                    {modalCandidate.id}
                  </Text>
                </View>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>RSSI</Text>
                  <Text style={styles.modalInfoValue}>{modalCandidate.rssi} dBm</Text>
                </View>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>Apelido (opcional)</Text>
            <TextInput
              value={apelido}
              onChangeText={setApelido}
              placeholder="Ex.: Tag debaixo do banco"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              editable={!isSaving}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => setModalCandidate(null)}
                disabled={isSaving}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, isSaving && { opacity: 0.6 }]}
                onPress={saveTag}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size={14} color="#fff" />
                ) : (
                  <Icon source="content-save" size={16} color="#fff" />
                )}
                <Text style={styles.saveBtnText}>Salvar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
  tagCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 1,
    marginBottom: 6,
  },
  tagName: { color: colors.text, fontSize: 13, fontWeight: '800' },
  tagMac: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  deleteBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 16, backgroundColor: '#fff1ef',
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginBottom: spacing.sm,
  },
  scanButtonStop: { backgroundColor: colors.danger },
  scanButtonText: {
    color: '#fff', fontSize: 11, fontWeight: '900', textTransform: 'uppercase',
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: spacing.sm, borderRadius: radius.md,
    backgroundColor: '#fff1ef', marginBottom: spacing.sm,
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 11, fontWeight: '700' },
  searchingBox: { alignItems: 'center', gap: 6, paddingVertical: spacing.lg },
  searchingText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  searchingHint: { color: colors.textMuted, fontSize: 11 },
  idleBox: { alignItems: 'center', gap: 8, paddingVertical: spacing.xl },
  idleText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.xl },
  candidateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    elevation: 1,
    marginBottom: 8,
  },
  iconCircle: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 18, backgroundColor: colors.surfaceMuted,
  },
  candidateName: { color: colors.text, fontSize: 13, fontWeight: '800' },
  candidateMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  candidateId: { color: colors.textSubtle, fontSize: 10, marginTop: 1 },
  modalOverlay: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalCard: {
    width: '100%', maxWidth: 420,
    padding: spacing.lg,
    borderRadius: radius.lg, backgroundColor: colors.surface,
    elevation: 8,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  modalSub: { color: colors.textMuted, fontSize: 12, marginTop: 4, marginBottom: spacing.md },
  modalInfoBox: {
    padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    gap: 6, marginBottom: spacing.md,
  },
  modalInfoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  modalInfoLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  modalInfoValue: { color: colors.text, fontSize: 12, fontWeight: '700', flex: 1, textAlign: 'right' },
  fieldLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginBottom: 4 },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  cancelBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: radius.md, backgroundColor: colors.surfaceMuted,
  },
  cancelBtnText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: radius.md, backgroundColor: colors.primary,
  },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '900' },
});
