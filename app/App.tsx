import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplash } from './src/components/AnimatedSplash';
import { ConfirmDialogProvider } from './src/components/ConfirmDialogProvider';
import { AuthProvider } from './src/auth/AuthProvider';
import { AppNavigator } from './src/navigation/AppNavigator';
import { NotificationBootstrap } from './src/notifications/NotificationBootstrap';
import { configureAndroidChannel } from './src/notifications/NotificationHandlers';
import { colors } from './src/theme/colors';
import { paperTheme } from './src/theme/paperTheme';
import { ToastProvider } from './src/toast/ToastProvider';

export default function App() {
  const [splashFinished, setSplashFinished] = useState(false);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={paperTheme}>
          <ToastProvider>
            <ConfirmDialogProvider>
              <AuthProvider>
                <StatusBar style="dark" backgroundColor={colors.surface} />
                <AppNavigator />
                <NotificationBootstrap enabled={splashFinished} />
                <AnimatedSplash onFinish={() => { setSplashFinished(true); configureAndroidChannel(); }} />
              </AuthProvider>
            </ConfirmDialogProvider>
          </ToastProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
