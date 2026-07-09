import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from 'react-native-paper';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';

type Props = {
  visible: boolean;
  deviceName: string;
  apelido?: string | null;
  saving?: boolean;
  onClose(): void;
  onConfirm(apelido: string): void;
};

export function ApelidoEditModal({ visible, deviceName, apelido, saving, onClose, onConfirm }: Props) {
  const [texto, setTexto] = useState('');

  useEffect(() => {
    if (visible) setTexto(apelido ?? '');
  }, [visible, apelido]);

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
            <Icon source="pencil" size={22} color={colors.primary} />
            <Text style={styles.title}>Identificação do veículo</Text>
          </View>
          <Text style={styles.subtitle}>{deviceName}</Text>

          <Text style={[styles.label, { marginTop: spacing.md }]}>Apelido</Text>
          <TextInput
            style={styles.input}
            value={texto}
            onChangeText={setTexto}
            maxLength={40}
            placeholder="Nome da pessoa"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            onSubmitEditing={() => onConfirm(texto)}
          />
          <Text style={styles.hint}>Deixe em branco para remover o apelido.</Text>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[styles.confirmBtn, saving && styles.confirmBtnDisabled]}
              onPress={() => onConfirm(texto)}
              disabled={saving}
            >
              <Icon source="content-save" size={14} color={colors.primaryText} />
              <Text style={styles.confirmText}>{saving ? 'Salvando...' : 'Salvar'}</Text>
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
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
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
  hint: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
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
