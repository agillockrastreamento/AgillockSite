import { NavigationContainer, DefaultTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import {
  DrawerContentScrollView,
  DrawerItemList,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState, useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, Avatar, Icon, IconButton } from 'react-native-paper';

import { useAuth } from '../auth/AuthProvider';
import { ProfileModal } from '../profile/ProfileModal';
import { getClientePerfil, resolveUploadUrl } from '../profile/profileService';
import type { ClientePerfil } from '../profile/profileTypes';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ManutencaoScreen } from '../screens/ManutencaoScreen';
import { MapScreen } from '../screens/MapScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { PagamentosScreen } from '../screens/PagamentosScreen';
import { ReportScreen } from '../screens/ReportScreen';
import { SessionLoadingScreen } from '../screens/SessionLoadingScreen';
import { NotificationBootstrap } from '../notifications/NotificationBootstrap';
import { NotificationHandlers } from '../notifications/NotificationHandlers';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import type { ClienteDrawerParamList, RootStackParamList } from './routes';

const drawerLogo = require('../../assets/agillock_new_symbol.png');

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<ClienteDrawerParamList>();

const routeIcons: Record<keyof ClienteDrawerParamList, string> = {
  Mapa: 'map-marker-radius-outline',
  Relatorio: 'file-chart-outline',
  Notificacoes: 'bell-outline',
  Geocercas: 'vector-polygon',
  Manutencao: 'wrench-outline',
  Pagamentos: 'credit-card-outline',
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
  const { user, signOut } = useAuth();
  const toast = useToast();
  const [isProfileVisible, setIsProfileVisible] = useState(false);
  const [profile, setProfile] = useState<ClientePerfil | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const avatarUri = resolveUploadUrl(profile?.avatarUrl);

  useEffect(() => {
    let mounted = true;

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
  }, []);

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

      <View style={styles.profileArea}>
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
  return (
    <Drawer.Navigator
      initialRouteName="Mapa"
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
      <Drawer.Screen name="Mapa" component={MapScreen} />
      <Drawer.Screen name="Relatorio" options={{ title: 'Relatório' }} component={ReportScreen} />
      <Drawer.Screen name="Notificacoes" component={NotificationsScreen} options={{ title: 'Notificações' }} />
      <Drawer.Screen name="Geocercas" options={{ title: 'Geocercas' }}>
        {() => <PlaceholderScreen title="Geocercas" />}
      </Drawer.Screen>
      <Drawer.Screen
        name="Manutencao"
        component={ManutencaoScreen}
        options={{ title: 'Manutenção' }}
      />
      <Drawer.Screen
        name="Pagamentos"
        component={PagamentosScreen}
        options={{ title: 'Pagamentos' }}
      />
    </Drawer.Navigator>
  );
}

export function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    if (isAuthenticated) setNotificationsEnabled(true);
  }, [isAuthenticated]);

  if (isLoading) return <SessionLoadingScreen />;

  return (
    <>
      <NotificationHandlers navigation={navigationRef} />
      <NavigationContainer ref={navigationRef} theme={navigationTheme}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {isAuthenticated ? (
            <Stack.Screen name="Cliente" component={ClienteDrawer} />
          ) : (
            <Stack.Screen name="Login" component={LoginScreen} />
          )}
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
  profileArea: {
    marginTop: 'auto',
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
