import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppTextInput } from '../components/AppTextInput';
import { useConfirmDialog } from '../components/ConfirmDialogProvider';
import type { RootStackParamList } from '../navigation/routes';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const toast = useToast();
  const confirm = useConfirmDialog();

  return (
    <View style={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.brand}>AgilLock Cliente</Text>
        <Text style={styles.description}>
          Base inicial do app Expo. A tela de login real será implementada na
          Fase 1.
        </Text>
        <AppTextInput
          label="Email"
          value=""
          onChangeText={() => undefined}
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="username"
        />
        <AppTextInput
          label="Senha"
          value=""
          onChangeText={() => undefined}
          secureTextEntry
          textContentType="password"
        />
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => navigation.replace('Cliente')}
        >
          <Text style={styles.buttonText}>Entrar no protótipo</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() =>
            toast.show({
              message: 'Toast centralizado pronto para as próximas fases.',
              type: 'success',
            })
          }
        >
          <Text style={styles.secondaryButtonText}>Testar toast</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={async () => {
            const confirmed = await confirm.show({
              title: 'Confirmar ação',
              message:
                'Modal universal pronto para confirmações bloqueantes.',
              confirmLabel: 'Confirmar',
              cancelLabel: 'Cancelar',
            });
            if (confirmed) {
              toast.show({
                message: 'Confirmação recebida pelo modal universal.',
                type: 'info',
              });
            }
          }}
        >
          <Text style={styles.secondaryButtonText}>Testar modal</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  brand: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  buttonText: {
    color: colors.primaryText,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
});
