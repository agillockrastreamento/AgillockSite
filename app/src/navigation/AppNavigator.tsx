import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import {
  DrawerContentScrollView,
  DrawerItem,
  DrawerItemList,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar, IconButton } from 'react-native-paper';

import { useAuth } from '../auth/AuthProvider';
import { ProfileModal } from '../profile/ProfileModal';
import { resolveUploadUrl } from '../profile/profileService';
import type { ClientePerfil } from '../profile/profileTypes';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { SessionLoadingScreen } from '../screens/SessionLoadingScreen';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import type { ClienteDrawerParamList, RootStackParamList } from './routes';

const drawerLogo = require('../../assets/agillock_new_symbol.png');

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<ClienteDrawerParamList>();

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
  const avatarUri = resolveUploadUrl(profile?.avatarUrl);

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawer}>
      <View style={styles.drawerHeader}>
        <Image source={drawerLogo} style={styles.drawerLogo} resizeMode="contain" />
      </View>

      <DrawerItemList {...props} />

      <View style={styles.profileArea}>
        <Pressable
          accessibilityRole="button"
          style={styles.profileButton}
          onPress={() => setIsProfileVisible(true)}
        >
          {avatarUri ? (
            <Avatar.Image size={58} source={{ uri: avatarUri }} />
          ) : (
            <Avatar.Text
              size={58}
              label={(user?.nome ?? 'CL').slice(0, 2).toUpperCase()}
              color={colors.primaryText}
              style={styles.profileAvatar}
            />
          )}
          <Text style={styles.drawerName} numberOfLines={1}>
            {profile?.nome ?? user?.nome ?? 'Cliente'}
          </Text>
          <Text style={styles.drawerEmail} numberOfLines={1}>
            {profile?.email ?? user?.email}
          </Text>
        </Pressable>

        <DrawerItem
          label="Sair"
          onPress={async () => {
            await signOut();
            toast.show({ message: 'Sessão encerrada.', type: 'info' });
          }}
          labelStyle={styles.logoutLabel}
        />
      </View>

      <ProfileModal
        visible={isProfileVisible}
        onClose={() => setIsProfileVisible(false)}
        onProfileUpdated={setProfile}
      />
    </DrawerContentScrollView>
  );
}

function HeaderActions({ routeName }: { routeName: keyof ClienteDrawerParamList }) {
  const toast = useToast();
  const pending = useCallback(
    (feature: string) => {
      toast.show({
        message: `${feature} será implementado nas próximas fases.`,
        type: 'info',
      });
    },
    [toast],
  );

  if (routeName === 'Mapa') {
    return (
      <View style={styles.headerActions}>
        <IconButton
          icon="magnify"
          size={22}
          accessibilityLabel="Pesquisar dispositivo"
          onPress={() => pending('Pesquisa do mapa')}
        />
        <IconButton
          icon="bell-outline"
          size={22}
          accessibilityLabel="Notificações do mapa"
          onPress={() => pending('Notificações do mapa')}
        />
      </View>
    );
  }

  if (routeName === 'Relatorio') {
    return (
      <View style={styles.headerActions}>
        <IconButton
          icon="export-variant"
          size={22}
          accessibilityLabel="Exportar relatório"
          onPress={() => pending('Exportação de relatório')}
        />
      </View>
    );
  }

  return <View style={styles.headerActions} />;
}

function ClienteDrawer() {
  return (
    <Drawer.Navigator
      initialRouteName="Mapa"
      drawerContent={(props) => <ClienteDrawerContent {...props} />}
      screenOptions={({ route }) => ({
        headerTitleAlign: 'center',
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        headerLeftContainerStyle: styles.headerSide,
        headerRightContainerStyle: styles.headerSide,
        headerRight: () => (
          <HeaderActions routeName={route.name as keyof ClienteDrawerParamList} />
        ),
        drawerActiveTintColor: colors.primaryText,
        drawerActiveBackgroundColor: colors.primary,
        drawerInactiveTintColor: colors.text,
        drawerLabelStyle: styles.drawerLabel,
      })}
    >
      <Drawer.Screen name="Mapa">
        {() => <PlaceholderScreen title="Mapa" />}
      </Drawer.Screen>
      <Drawer.Screen name="Relatorio" options={{ title: 'Relatório' }}>
        {() => <PlaceholderScreen title="Relatório" />}
      </Drawer.Screen>
      <Drawer.Screen name="Notificacoes" options={{ title: 'Notificações' }}>
        {() => <PlaceholderScreen title="Notificações" />}
      </Drawer.Screen>
      <Drawer.Screen name="Geocercas">
        {() => <PlaceholderScreen title="Geocercas" />}
      </Drawer.Screen>
      <Drawer.Screen name="Pagamentos">
        {() => <PlaceholderScreen title="Pagamentos" />}
      </Drawer.Screen>
    </Drawer.Navigator>
  );
}

export function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <SessionLoadingScreen />;

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Cliente" component={ClienteDrawer} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  drawer: {
    flexGrow: 1,
  },
  drawerHeader: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  drawerLogo: {
    width: 64,
    height: 64,
  },
  drawerLabel: {
    fontWeight: '700',
  },
  profileArea: {
    marginTop: 'auto',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  profileButton: {
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  profileAvatar: {
    backgroundColor: colors.primary,
  },
  drawerName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  drawerEmail: {
    color: colors.textMuted,
    fontSize: 12,
  },
  logoutLabel: {
    color: colors.danger,
    fontWeight: '700',
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
});
