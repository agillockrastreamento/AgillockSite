import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { colors } from '../theme/colors';
import type {
  ClienteDrawerParamList,
  RootStackParamList,
} from './routes';

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

function ClienteDrawer() {
  return (
    <Drawer.Navigator
      initialRouteName="Mapa"
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
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Cliente" component={ClienteDrawer} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
