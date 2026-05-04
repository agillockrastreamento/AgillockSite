import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import {
  DrawerContentScrollView,
  DrawerItem,
  DrawerItemList,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { SessionLoadingScreen } from '../screens/SessionLoadingScreen';
import { colors } from '../theme/colors';
import { spacing } from '../theme/layout';
import { useToast } from '../toast/ToastProvider';
import type {
  ClienteDrawerParamList,
  RootStackParamList,
} from './routes';

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

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawer}>
      <View style={styles.drawerHeader}>
        <Image source={drawerLogo} style={styles.drawerLogo} resizeMode="contain" />
        <Text style={styles.drawerName} numberOfLines={1}>
          {user?.nome ?? 'Cliente'}
        </Text>
        <Text style={styles.drawerEmail} numberOfLines={1}>
          {user?.email}
        </Text>
      </View>
      <DrawerItemList {...props} />
      <View style={styles.drawerFooter}>
        <DrawerItem
          label="Sair"
          onPress={async () => {
            await signOut();
            toast.show({ message: 'Sessão encerrada.', type: 'info' });
          }}
          labelStyle={styles.logoutLabel}
        />
      </View>
    </DrawerContentScrollView>
  );
}

function ClienteDrawer() {
  return (
    <Drawer.Navigator
      initialRouteName="Mapa"
      drawerContent={(props) => <ClienteDrawerContent {...props} />}
      screenOptions={{
        headerTitleAlign: 'center',
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.surface },
        drawerActiveTintColor: colors.primaryText,
        drawerActiveBackgroundColor: colors.primary,
        drawerInactiveTintColor: colors.text,
      }}
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
    paddingBottom: spacing.lg,
  },
  drawerLogo: {
    width: 64,
    height: 64,
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
  drawerFooter: {
    marginTop: 'auto',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  logoutLabel: {
    color: colors.danger,
    fontWeight: '700',
  },
});
