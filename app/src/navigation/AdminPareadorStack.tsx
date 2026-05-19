import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { PareadorScreen } from '../screens/PareadorScreen';
import { PareadorTagScreen } from '../screens/PareadorTagScreen';
import { colors } from '../theme/colors';
import type { AdminPareadorParamList } from './routes';

const Stack = createNativeStackNavigator<AdminPareadorParamList>();

export function AdminPareadorStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.loginBackgroundStart },
        headerTintColor: colors.surface,
        headerTitleAlign: 'center',
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="Pareador"
        component={PareadorScreen}
        options={{ title: 'Parear Tags' }}
      />
      <Stack.Screen
        name="PareadorTag"
        component={PareadorTagScreen}
        options={({ route }) => ({
          title: route.params?.nome ?? 'Tag',
        })}
      />
    </Stack.Navigator>
  );
}
