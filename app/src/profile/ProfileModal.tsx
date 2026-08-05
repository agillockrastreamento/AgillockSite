import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Avatar, Button, Icon } from 'react-native-paper';

import { BottomSheet } from '../components/BottomSheet';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import {
  alterarSenhaCliente,
  getClientePerfil,
  resolveUploadUrl,
  uploadClienteAvatar,
} from './profileService';
import type { ClientePerfil, ClientePerfilVeiculo } from './profileTypes';

/** Mesmo mínimo cobrado pelo backend e pelo portal web. */
const SENHA_MIN = 6;

type Props = {
  visible: boolean;
  initialProfile?: ClientePerfil | null;
  onClose(): void;
  onProfileUpdated?(profile: ClientePerfil): void;
};

function formatCpfCnpj(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');

  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  if (digits.length === 14) {
    return digits.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5',
    );
  }

  return value || '-';
}

function VeiculoList({
  title,
  veiculos,
}: {
  title: string;
  veiculos: ClientePerfilVeiculo[];
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {veiculos.length ? (
        veiculos.map((veiculo) => (
          <View key={veiculo.id} style={styles.vehicleRow}>
            <Text style={styles.vehicleName} numberOfLines={1}>
              {veiculo.nome}
            </Text>
            <Text style={styles.vehiclePlate} numberOfLines={1}>
              {veiculo.placa ?? 'Sem placa'}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.emptyText}>Nenhum veículo nesta lista.</Text>
      )}
    </View>
  );
}

function CampoSenha({
  rotulo,
  valor,
  onChange,
  autoFocus,
}: {
  rotulo: string;
  valor: string;
  onChange(v: string): void;
  autoFocus?: boolean;
}) {
  const [mostrar, setMostrar] = useState(false);

  return (
    <View style={styles.campo}>
      <Text style={styles.fieldLabel}>{rotulo}</Text>
      <View style={styles.passwordWrap}>
        <TextInput
          value={valor}
          onChangeText={onChange}
          style={[styles.input, styles.inputWithIcon]}
          secureTextEntry={!mostrar}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          placeholder="••••••"
          placeholderTextColor={colors.textMuted}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mostrar ou ocultar a senha"
          style={styles.eyeBtn}
          onPress={() => setMostrar((v) => !v)}
        >
          <Icon source={mostrar ? 'eye-off' : 'eye'} size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

export function ProfileModal({
  visible,
  initialProfile,
  onClose,
  onProfileUpdated,
}: Props) {
  const toast = useToast();
  const [profile, setProfile] = useState<ClientePerfil | null>(
    initialProfile ?? null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Alterar senha troca o conteúdo DESTE sheet em vez de abrir um segundo.
  // O BottomSheet é um Modal nativo e, no iOS, apresentar um modal sobre outro
  // (ou fechar um e abrir o próximo no mesmo tick) congela o sistema de modais.
  const [view, setView] = useState<'perfil' | 'senha'>('perfil');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [isSalvandoSenha, setIsSalvandoSenha] = useState(false);

  const limparSenha = useCallback(() => {
    setSenhaAtual('');
    setNovaSenha('');
    setConfirmacao('');
    setErroSenha(null);
    setIsSalvandoSenha(false);
  }, []);

  // Reabrir o perfil sempre começa na visão de dados, mesmo que o sheet tenha sido
  // fechado com o formulário de senha aberto.
  useEffect(() => {
    if (!visible) {
      setView('perfil');
      limparSenha();
    }
  }, [limparSenha, visible]);

  useEffect(() => {
    if (initialProfile) setProfile(initialProfile);
  }, [initialProfile]);

  useEffect(() => {
    let mounted = true;
    if (!visible) return undefined;

    if (initialProfile) {
      setProfile(initialProfile);
      return undefined;
    }

    setIsLoading(true);
    getClientePerfil()
      .then((data) => {
        if (!mounted) return;
        setProfile(data);
        onProfileUpdated?.(data);
      })
      .catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : 'Não foi possível carregar o perfil.';
        toast.show({ message, type: 'error' });
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [initialProfile, onProfileUpdated, toast, visible]);

  async function handlePickAvatar() {
    // O seletor de fotos do sistema (Android/iOS) não exige permissão de mídia.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.82,
    });

    if (result.canceled || !result.assets[0]) return;

    try {
      setIsUploading(true);
      const response = await uploadClienteAvatar(result.assets[0]);
      const nextProfile = profile
        ? { ...profile, avatarUrl: response.avatarUrl }
        : await getClientePerfil();
      setProfile(nextProfile);
      onProfileUpdated?.(nextProfile);
      toast.show({ message: 'Foto de perfil atualizada.', type: 'success' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro ao enviar avatar.';
      toast.show({ message, type: 'error' });
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSalvarSenha() {
    setErroSenha(null);

    if (!senhaAtual) {
      setErroSenha('Informe a senha atual.');
      return;
    }
    if (novaSenha.length < SENHA_MIN) {
      setErroSenha(`A nova senha deve ter pelo menos ${SENHA_MIN} caracteres.`);
      return;
    }
    if (novaSenha !== confirmacao) {
      setErroSenha('A confirmação não confere com a nova senha.');
      return;
    }
    if (novaSenha === senhaAtual) {
      setErroSenha('A nova senha deve ser diferente da atual.');
      return;
    }

    try {
      setIsSalvandoSenha(true);
      await alterarSenhaCliente(senhaAtual, novaSenha);
      limparSenha();
      setView('perfil');
      toast.show({ message: 'Senha alterada.', type: 'success' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível alterar a senha.';
      setErroSenha(message);
      setIsSalvandoSenha(false);
    }
  }

  const avatarUri = resolveUploadUrl(profile?.avatarUrl);

  if (view === 'senha') {
    return (
      <BottomSheet
        visible={visible}
        title="Alterar senha"
        heightPercent={0.7}
        onClose={onClose}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityRole="button"
            style={styles.voltarRow}
            onPress={() => {
              limparSenha();
              setView('perfil');
            }}
          >
            <Icon source="chevron-left" size={20} color={colors.primary} />
            <Text style={styles.voltarText}>Perfil</Text>
          </Pressable>

          <View style={styles.section}>
            <CampoSenha
              rotulo="Senha atual"
              valor={senhaAtual}
              onChange={setSenhaAtual}
              autoFocus
            />
            <CampoSenha rotulo="Nova senha" valor={novaSenha} onChange={setNovaSenha} />
            <CampoSenha
              rotulo="Confirmar nova senha"
              valor={confirmacao}
              onChange={setConfirmacao}
            />
            <Text style={styles.emptyText}>Mínimo de {SENHA_MIN} caracteres.</Text>
            {erroSenha ? <Text style={styles.erroText}>{erroSenha}</Text> : null}
          </View>

          <Button
            mode="contained"
            icon="key-variant"
            loading={isSalvandoSenha}
            disabled={isSalvandoSenha}
            onPress={handleSalvarSenha}
          >
            Salvar nova senha
          </Button>
        </ScrollView>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet visible={visible} title="Perfil" heightPercent={0.7} onClose={onClose}>
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityRole="button"
            style={styles.avatarButton}
            disabled={isUploading}
            onPress={handlePickAvatar}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Avatar.Text
                size={92}
                label={(profile?.nome ?? 'CL').slice(0, 2).toUpperCase()}
                color={colors.primaryText}
                style={styles.avatarFallback}
              />
            )}
            <View style={styles.cameraBadge}>
              <Avatar.Icon
                size={30}
                icon="camera"
                color={colors.primaryText}
                style={styles.cameraIcon}
              />
            </View>
          </Pressable>

          <Button
            mode="outlined"
            icon="camera"
            loading={isUploading}
            disabled={isUploading}
            onPress={handlePickAvatar}
          >
            Alterar foto
          </Button>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Dados</Text>
            <Text style={styles.fieldLabel}>Nome</Text>
            <Text style={styles.fieldValue}>{profile?.nome ?? '-'}</Text>
            <Text style={styles.fieldLabel}>Email</Text>
            <Text style={styles.fieldValue}>{profile?.email ?? '-'}</Text>
            <Text style={styles.fieldLabel}>Telefone</Text>
            <Text style={styles.fieldValue}>{profile?.telefone ?? '-'}</Text>
            <Text style={styles.fieldLabel}>CPF/CNPJ</Text>
            <Text style={styles.fieldValue}>
              {formatCpfCnpj(profile?.cpfCnpj)}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            style={styles.acaoRow}
            onPress={() => setView('senha')}
          >
            <Icon source="key-variant" size={18} color={colors.text} />
            <Text style={styles.acaoText}>Alterar senha</Text>
            <Icon source="chevron-right" size={20} color={colors.textMuted} />
          </Pressable>

          <VeiculoList
            title="Veículos sob responsabilidade"
            veiculos={profile?.veiculosFaturamento ?? []}
          />
          <VeiculoList
            title="Veículos vinculados"
            veiculos={profile?.veiculosVinculados ?? []}
          />
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: spacing.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  avatarButton: {
    alignSelf: 'center',
  },
  avatarImage: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.surfaceMuted,
  },
  avatarFallback: {
    backgroundColor: colors.primary,
  },
  cameraBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.primary,
  },
  cameraIcon: {
    backgroundColor: colors.primary,
  },
  section: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    marginBottom: spacing.xs,
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  fieldValue: {
    marginBottom: spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  vehicleName: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  vehiclePlate: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
  },

  // ── Alterar senha ──────────────────────────────────────────────────────────
  acaoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  acaoText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  voltarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  voltarText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  campo: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  inputWithIcon: {
    paddingRight: 44,
  },
  passwordWrap: {
    position: 'relative',
  },
  eyeBtn: {
    position: 'absolute',
    right: spacing.sm,
    top: 0,
    bottom: 0,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  erroText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});
