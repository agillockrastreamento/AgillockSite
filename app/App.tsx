import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplash } from './src/components/AnimatedSplash';
import { ConfirmDialogProvider } from './src/components/ConfirmDialogProvider';
import { AppNavigator } from './src/navigation/AppNavigator';
import { colors } from './src/theme/colors';
import { paperTheme } from './src/theme/paperTheme';
import { ToastProvider } from './src/toast/ToastProvider';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={paperTheme}>
          <ToastProvider>
            <ConfirmDialogProvider>
              <StatusBar style="dark" backgroundColor={colors.surface} />
              <AppNavigator />
              <AnimatedSplash />
            </ConfirmDialogProvider>
          </ToastProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
