import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TextInput } from 'react-native-paper';

import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../services/api/apiClient';
import { AppTextInput } from '../components/AppTextInput';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';

const logo = require('../../assets/logo_agillock_white_new.png');

export function LoginScreen() {
  const { signIn } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  // Novos estados para controlar o erro de cada input
  const [emailError, setEmailError] = useState('');
  const [senhaError, setSenhaError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    const normalizedEmail = email.trim().toLowerCase();

    // Limpamos os erros antigos antes da validação
    setEmailError('');
    setSenhaError('');

    let hasError = false;

    // Validações individuais
    if (!normalizedEmail) {
      setEmailError('Informe um email válido.');
      hasError = true;
    }
    
    if (!senha) {
      setSenhaError('A senha é obrigatória.');
      hasError = true;
    }

    if (hasError) {
      return; 
    }

    try {
      setIsSubmitting(true);
      await signIn({ email: normalizedEmail, senha });
    } catch (error) {
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : 'Não foi possível entrar. Tente novamente.';
      toast.show({ message, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboard}
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.panel}>
          <View style={styles.logoArea}>
            <Image source={logo} style={styles.logo} resizeMode="contain" />
          </View>
          <View style={styles.formArea}>
            <AppTextInput
              label="Email"
              value={email}
              errorMessage={emailError} // <-- Passando o erro
              onChangeText={(text) => {
                setEmail(text);
                if (emailError) setEmailError(''); // Limpa o erro ao digitar
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              returnKeyType="next"
              editable={!isSubmitting}
              left={<TextInput.Icon icon="email-outline" color="#999" />}
            />
            <AppTextInput
              label="Senha"
              value={senha}
              errorMessage={senhaError} // <-- Passando o erro
              onChangeText={(text) => {
                setSenha(text);
                if (senhaError) setSenhaError(''); // Limpa o erro ao digitar
              }}
              secureTextEntry={!showPassword}
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
              editable={!isSubmitting}
              left={<TextInput.Icon icon="lock-outline" color="#999" />}
              right={
                <TextInput.Icon
                  icon={showPassword ? 'eye-off' : 'eye'}
                  onPress={() => setShowPassword((current) => !current)}
                  forceTextInputFocus={false}
                />
              }
            />
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              style={[styles.button, isSubmitting && styles.buttonDisabled]}
              onPress={handleSubmit}
            >
              <Text style={styles.buttonText}>
                {isSubmitting ? 'Entrando...' : 'Entrar'}
              </Text>
            </Pressable>
            <Text style={styles.copyright}>
              © 2026 AgilLock — Gestão de Rastreamento
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    flex: 1,
    backgroundColor: colors.loginBackgroundStart,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.loginBackgroundStart,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: colors.surface,
    elevation: 1,
    overflow: 'hidden',
  },
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 132,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.loginLogoBackground,
  },
  formArea: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  logo: {
    alignSelf: 'center',
    width: 230,
    height: 82,
  },
  title: {
    color: colors.text,
    fontSize: 24,
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
  buttonDisabled: {
    opacity: 0.68,
  },
  copyright: {
    color: colors.textSubtle,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
