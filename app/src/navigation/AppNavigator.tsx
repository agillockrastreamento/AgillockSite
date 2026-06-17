import { NavigationContainer, DefaultTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import {
  DrawerContentScrollView,
  DrawerItemList,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, Avatar, Icon } from 'react-native-paper';

import { useAuth } from '../auth/AuthProvider';
import { ProfileModal } from '../profile/ProfileModal';
import { getClientePerfil, resolveUploadUrl } from '../profile/profileService';
import type { ClientePerfil } from '../profile/profileTypes';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ManutencaoScreen } from '../screens/ManutencaoScreen';
import { CotacaoIaproScreen } from '../screens/CotacaoIaproScreen';
import { MapScreen } from '../screens/MapScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { PagamentosScreen } from '../screens/PagamentosScreen';
import { ReportScreen } from '../screens/ReportScreen';
import { HistoricoScreen } from '../screens/HistoricoScreen';
import { SessionLoadingScreen } from '../screens/SessionLoadingScreen';
import { UsuariosScreen } from '../screens/UsuariosScreen';
import { UsuarioFormScreen } from '../screens/UsuarioFormScreen';
import { NotificationBootstrap } from '../notifications/NotificationBootstrap';
import { NotificationHandlers } from '../notifications/NotificationHandlers';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import { RescueStack } from './RescueStack';
import { AdminPareadorStack } from './AdminPareadorStack';
import type { ClienteDrawerParamList, RootStackParamList } from './routes';
import type { ClienteUser } from '../auth/authTypes';

const drawerLogo = require('../../assets/agillock_new_symbol.png');

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<ClienteDrawerParamList>();

const routeIcons: Record<keyof ClienteDrawerParamList, string> = {
  Mapa: 'map-marker-radius-outline',
  Relatorio: 'file-chart-outline',
  Notificacoes: 'bell-outline',
  Manutencao: 'wrench-outline',
  CotacaoIapro: 'shield-car',
  Pagamentos: 'credit-card-outline',
  Usuarios: 'account-group-outline',
};

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    border: colors.border,
    card: colors.surface,
    primary: colors.primary,
    text: colors.text,
  },
};

function ClienteDrawerContent(props: DrawerContentComponentProps) {
  const { user, me, signOut } = useAuth();
  const clienteUser = user && user.role === 'CLIENTE' ? (user as ClienteUser) : null;
  const toast = useToast();
  const [isProfileVisible, setIsProfileVisible] = useState(false);
  const [profile, setProfile] = useState<ClientePerfil | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  // Sub-usuário (vinculado) não tem perfil próprio editável; apenas exibe nome.
  const isResponsavel = (me?.tipo ?? clienteUser?.tipo ?? 'responsavel') === 'responsavel';
  const avatarUri = resolveUploadUrl(profile?.avatarUrl);
  const logoUri = resolveUploadUrl(profile?.logoUrl);

  useEffect(() => {
    let mounted = true;

    if (!isResponsavel) {
      // Vinculado não chama /cliente/perfil (rota de responsável); evita 403 e loading inútil.
      setIsProfileLoading(false);
      return () => { mounted = false; };
    }

    setIsProfileLoading(true);
    getClientePerfil()
      .then((data) => {
        if (mounted) setProfile(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setIsProfileLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [isResponsavel]);

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawer}>
      <View style={styles.drawerHeader}>
        <View style={styles.brandRow}>
          <View style={styles.logoTile}>
            <Image source={drawerLogo} style={styles.drawerLogo} resizeMode="contain" />
          </View>
          <View style={styles.brandTextBlock}>
            <Text style={styles.brandTitle}>AgilLock</Text>
            <Text style={styles.brandSubtitle}>Gestão de Risco</Text>
          </View>
        </View>
      </View>

      <View style={styles.navArea}>
        <Text style={styles.navLabel}>Menu</Text>
        <DrawerItemList {...props} />
      </View>

      <View style={styles.logoSpacer} />
      {isResponsavel && logoUri ? (
        <View style={styles.logoContainer}>
          <Image source={{ uri: logoUri }} style={styles.logoImage} resizeMode="contain" />
        </View>
      ) : null}
      <View style={styles.logoSpacer} />

      <View style={styles.profileArea}>
        {isResponsavel ? (
          <Pressable
            accessibilityRole="button"
            style={styles.profileButton}
            onPress={() => setIsProfileVisible(true)}
          >
            <View style={styles.avatarWrap}>
              {isProfileLoading ? (
                <ActivityIndicator size="small" />
              ) : avatarUri ? (
                <Avatar.Image size={52} source={{ uri: avatarUri }} />
              ) : (
                <Avatar.Text
                  size={52}
                  label={(user?.nome ?? 'CL').slice(0, 2).toUpperCase()}
                  color={colors.primaryText}
                  style={styles.profileAvatar}
                />
              )}
            </View>
            <View style={styles.profileText}>
              <Text style={styles.drawerName} numberOfLines={1}>
                {profile?.nome ?? user?.nome ?? 'Cliente'}
              </Text>
              <Text style={styles.drawerEmail} numberOfLines={1}>
                {profile?.email ?? user?.email}
              </Text>
            </View>
            <Icon source="chevron-up" size={22} color={colors.textMuted} />
          </Pressable>
        ) : (
          // Vinculado: só exibe nome, sem botão de perfil/upload nem chevron
          <View style={styles.profileButtonVinculado}>
            <View style={styles.avatarWrap}>
              <Avatar.Text
                size={52}
                label={(user?.nome ?? 'US').slice(0, 2).toUpperCase()}
                color={colors.primaryText}
                style={styles.profileAvatar}
              />
            </View>
            <View style={styles.profileText}>
              <Text style={styles.drawerName} numberOfLines={1}>
                {user?.nome ?? 'Usuário'}
              </Text>
              <Text style={styles.drawerEmail} numberOfLines={1}>
                {user?.email}
              </Text>
            </View>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          style={styles.logoutButton}
          onPress={async () => {
            await signOut();
            toast.show({ message: 'Sessão encerrada.', type: 'info' });
          }}
        >
          <Icon source="logout" size={20} color={colors.danger} />
          <Text style={styles.logoutLabel}>Sair</Text>
        </Pressable>
      </View>

      <ProfileModal
        visible={isProfileVisible}
        initialProfile={profile}
        onClose={() => setIsProfileVisible(false)}
        onProfileUpdated={(nextProfile) => {
          setProfile(nextProfile);
          setIsProfileLoading(false);
        }}
      />
    </DrawerContentScrollView>
  );
}

function HeaderActions() {
  return <View style={styles.headerActions} />;
}

function ClienteDrawer() {
  const { user, me, can } = useAuth();
  const clienteUser = user && user.role === 'CLIENTE' ? (user as ClienteUser) : null;
  const [canAccessPayments, setCanAccessPayments] = useState(false);

  useEffect(() => {
    let mounted = true;
    getClientePerfil()
      .then((profile) => {
        if (mounted) setCanAccessPayments(profile.veiculosFaturamento.length > 0);
      })
      .catch(() => {
        if (mounted) setCanAccessPayments(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Tipo do login determina o que aparece no menu. Responsável vê tudo;
  // vinculado só vê telas com permissão 'ver'. Notificações/Pagamentos/Usuários só responsável.
  const tipo = me?.tipo ?? clienteUser?.tipo ?? 'responsavel';
  const responsavel = tipo === 'responsavel';
  const verMapa = responsavel || can('rastreamento.ver');
  const verRelatorio = responsavel || can('relatorio.ver');
  const verManutencao = responsavel || can('manutencao.ver');

  // initialRouteName precisa apontar para uma tela visível ao usuário,
  // senão o React Navigation crasha. Pega a primeira tela disponível.
  const initialRouteName: keyof ClienteDrawerParamList = verMapa
    ? 'Mapa'
    : verRelatorio
    ? 'Relatorio'
    : verManutencao
    ? 'Manutencao'
    : 'Mapa';

  return (
    <Drawer.Navigator
      initialRouteName={initialRouteName}
      drawerContent={(props) => <ClienteDrawerContent {...props} />}
      screenOptions={({ route }) => ({
        swipeEnabled: false,
        headerTitleAlign: 'center',
        headerTintColor: colors.surface,
        headerStyle: { backgroundColor: colors.loginBackgroundStart },
        headerShadowVisible: false,
        headerLeftContainerStyle: styles.headerSide,
        headerRightContainerStyle: styles.headerSide,
        headerRight: () => <HeaderActions />,
        drawerActiveTintColor: colors.primaryText,
        drawerActiveBackgroundColor: colors.primary,
        drawerInactiveTintColor: colors.text,
        drawerLabelStyle: styles.drawerLabel,
        drawerItemStyle: styles.drawerItem,
        drawerIcon: ({ color, size }) => (
          <Icon
            source={routeIcons[route.name as keyof ClienteDrawerParamList]}
            size={size}
            color={color}
          />
        ),
      })}
    >
      {verMapa ? (
        <Drawer.Screen name="Mapa" component={MapScreen} />
      ) : !verRelatorio && !verManutencao ? (
        // Sub-usuário sem nenhuma permissão de tela: monta um placeholder
        // sob o nome "Mapa" para satisfazer o initialRouteName e evitar crash.
        <Drawer.Screen
          name="Mapa"
          options={{ title: 'Acesso' }}
          children={() => <PlaceholderScreen title="Sem permissões atribuídas" />}
        />
      ) : null}
      {verRelatorio ? (
        <Drawer.Screen name="Relatorio" options={{ title: 'Relatório' }} component={ReportScreen} />
      ) : null}
      {responsavel ? (
        <Drawer.Screen name="Notificacoes" component={NotificationsScreen} options={{ title: 'Notificações' }} />
      ) : null}
      {verManutencao ? (
        <Drawer.Screen
          name="Manutencao"
          component={ManutencaoScreen}
          options={{ title: 'Manutenção' }}
        />
      ) : null}
      <Drawer.Screen
        name="CotacaoIapro"
        component={CotacaoIaproScreen}
        options={{ title: 'Cotação Proteção Veicular' }}
      />
      {responsavel && canAccessPayments ? (
        <Drawer.Screen
          name="Pagamentos"
          component={PagamentosScreen}
          options={{ title: 'Pagamentos' }}
        />
      ) : null}
      {responsavel ? (
        <Drawer.Screen name="Usuarios" component={UsuariosScreen} options={{ title: 'Usuários' }} />
      ) : null}
    </Drawer.Navigator>
  );
}

export function AppNavigator() {
  const { isAuthenticated, isLoading, tipoSessao } = useAuth();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    if (isAuthenticated && tipoSessao === 'cliente') {
      setNotificationsEnabled(true);
    }
  }, [isAuthenticated, tipoSessao]);

  if (isLoading) return <SessionLoadingScreen />;

  const renderRootScreen = () => {
    if (!isAuthenticated) {
      return <Stack.Screen name="Login" component={LoginScreen} />;
    }
    if (tipoSessao === 'resgate') {
      return <Stack.Screen name="Resgate" component={RescueStack} />;
    }
    if (tipoSessao === 'admin') {
      return <Stack.Screen name="AdminPareador" component={AdminPareadorStack} />;
    }
    return <Stack.Screen name="Cliente" component={ClienteDrawer} />;
  };

  return (
    <>
      <NotificationHandlers navigation={navigationRef} />
      <NavigationContainer ref={navigationRef} theme={navigationTheme}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {renderRootScreen()}
          <Stack.Screen
            name="Historico"
            component={HistoricoScreen}
            options={({ route }) => ({
              headerShown: true,
              headerTitle: `${route.params.nome}${route.params.placa ? ` — ${route.params.placa}` : ''}`,
              headerTitleAlign: 'center',
              headerStyle: { backgroundColor: colors.loginBackgroundStart },
              headerTintColor: colors.surface,
              headerShadowVisible: false,
            })}
          />
          <Stack.Screen
            name="UsuarioForm"
            component={UsuarioFormScreen}
            options={({ route }) => ({
              headerShown: true,
              headerTitle: route.params?.id ? 'Editar Usuário' : 'Novo Usuário',
              headerTitleAlign: 'center',
              headerStyle: { backgroundColor: colors.loginBackgroundStart },
              headerTintColor: colors.surface,
              headerShadowVisible: false,
            })}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

const styles = StyleSheet.create({
  drawer: {
    flexGrow: 1,
    backgroundColor: colors.surface,
  },
  drawerHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  brandRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.loginBackgroundStart,
  },
  logoTile: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  drawerLogo: {
    width: 32,
    height: 32,
  },
  brandTextBlock: {
    flex: 1,
  },
  brandTitle: {
    color: colors.surface,
    fontSize: 18,
    fontWeight: '900',
  },
  brandSubtitle: {
    marginTop: 2,
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 11,
    fontWeight: '700',
  },
  navArea: {
    paddingHorizontal: spacing.sm,
  },
  navLabel: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  drawerItem: {
    marginHorizontal: spacing.sm,
    marginVertical: 2,
    borderRadius: radius.md,
  },
  drawerLabel: {
    marginLeft: 0,
    fontSize: 14,
    fontWeight: '800',
  },
  logoSpacer: {
    flex: 1,
  },
  logoContainer: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  logoImage: {
    width: '100%',
    height: 100,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  profileArea: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  profileButton: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  profileButtonVinculado: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  avatarWrap: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatar: {
    backgroundColor: colors.primary,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  drawerName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  drawerEmail: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
  },
  logoutButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#fff1ef',
  },
  logoutLabel: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '900',
  },
  headerActions: {
    minWidth: 96,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingRight: spacing.xs,
  },
  headerSide: {
    width: 96,
  },
  headerBottom: {
    color: colors.colorHeader,
  },
});
