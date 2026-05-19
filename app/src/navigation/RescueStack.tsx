import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { RescueMapScreen } from '../screens/RescueMapScreen';
import type { RescueStackParamList } from './routes';

const Stack = createNativeStackNavigator<RescueStackParamList>();

export function RescueStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RescueMap" component={RescueMapScreen} />
    </Stack.Navigator>
  );
}
