import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Avatar, Button, IconButton } from 'react-native-paper';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import {
  getClientePerfil,
  resolveUploadUrl,
  uploadClienteAvatar,
} from './profileService';
import type { ClientePerfil, ClientePerfilVeiculo } from './profileTypes';

type Props = {
  visible: boolean;
  onClose(): void;
  onProfileUpdated?(profile: ClientePerfil): void;
};

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

export function ProfileModal({ visible, onClose, onProfileUpdated }: Props) {
  const toast = useToast();
  const [profile, setProfile] = useState<ClientePerfil | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!visible) return undefined;

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
  }, [onProfileUpdated, toast, visible]);

  async function handlePickAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.show({
        message: 'Permita acesso às fotos para escolher o avatar.',
        type: 'error',
      });
      return;
    }

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

  const avatarUri = resolveUploadUrl(profile?.avatarUrl);

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Perfil</Text>
            <IconButton icon="close" size={22} onPress={onClose} />
          </View>

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
                  <IconButton
                    icon="camera"
                    size={18}
                    iconColor={colors.primaryText}
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
                <Text style={styles.fieldValue}>{profile?.cpfCnpj ?? '-'}</Text>
              </View>

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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(23, 32, 42, 0.38)',
  },
  sheet: {
    width: '100%',
    maxWidth: 430,
    maxHeight: '88%',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },
  loading: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: spacing.lg,
    padding: spacing.xl,
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
    width: 30,
    height: 30,
    margin: 0,
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
});
