import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from 'react-native-paper';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';

const RADIUS_OPTIONS = [
  { label: '50 m', value: 50 },
  { label: '100 m', value: 100 },
  { label: '150 m', value: 150 },
  { label: '200 m', value: 200 },
  { label: '500 m', value: 500 },
  { label: '1 km', value: 1000 },
];

type Props = {
  visible: boolean;
  deviceName: string;
  onClose(): void;
  onConfirm(nome: string, raio: number): void;
};

export function GeofenceCreateModal({ visible, deviceName, onClose, onConfirm }: Props) {
  const [nome, setNome] = useState(`Cerca - ${deviceName}`);
  const [raio, setRaio] = useState(150);

  const handleConfirm = () => {
    const n = nome.trim();
    if (!n) return;
    onConfirm(n, raio);
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.dialog} onPress={() => {}}>
          <View style={styles.header}>
            <Icon source="circle-outline" size={22} color={colors.primary} />
            <Text style={styles.title}>Criar Cerca Virtual</Text>
          </View>

          <Text style={styles.label}>Nome da cerca</Text>
          <TextInput
            style={styles.input}
            value={nome}
            onChangeText={setNome}
            placeholder={`Cerca - ${deviceName}`}
            placeholderTextColor={colors.textMuted}
            maxLength={60}
            returnKeyType="done"
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>Raio</Text>
          <View style={styles.radiiGrid}>
            {RADIUS_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                accessibilityRole="button"
                style={[styles.raioBtn, raio === opt.value && styles.raioBtnActive]}
                onPress={() => setRaio(opt.value)}
              >
                <Text style={[styles.raioBtnText, raio === opt.value && styles.raioBtnTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              style={styles.cancelBtn}
              onPress={onClose}
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[styles.confirmBtn, !nome.trim() && styles.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={!nome.trim()}
            >
              <Icon source="circle-outline" size={14} color={colors.primaryText} />
              <Text style={styles.confirmText}>Criar Cerca</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: 'rgba(23,32,42,0.45)',
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  radiiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  raioBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  raioBtnActive: {
    borderColor: colors.primary,
    backgroundColor: '#fff7e3',
  },
  raioBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  raioBtnTextActive: {
    color: colors.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  confirmBtn: {
    flex: 1,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  confirmBtnDisabled: {
    opacity: 0.5,
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primaryText,
  },
});
