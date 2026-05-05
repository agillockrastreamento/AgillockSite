import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';

import { useAuth } from '../auth/AuthProvider';

type NavRef = { navigate(screen: string, params?: object): void } | null;

type Props = {
  navigation: NavRef;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function NotificationHandlers({ navigation }: Props) {
  const responseListenerRef = useRef<Notifications.Subscription | null>(null);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        if (!isAuthenticated || !navigation) return;

        const notification = response.notification.request.content;
        const data = notification.data as Record<string, unknown> | undefined;
        const dispositivoId = data?.dispositivoId as string | undefined;
        const tipo = data?.tipo as string | undefined;

        // Device event notification
        if (dispositivoId) {
          navigation.navigate('Map', { dispositivoId, highlight: true });
          return;
        }

        // Financial notifications → Payments
        const financialTypes = ['pagamentoRecebido', 'boletoVencendoHoje', 'boletoAtrasado'];
        if (tipo && (tipo.includes('boleto') || tipo.includes('pagamento') || financialTypes.includes(tipo))) {
          navigation.navigate('Payments');
          return;
        }

        // Maintenance notifications → Notifications screen
        if (tipo && tipo.includes('manutencao')) {
          navigation.navigate('Notifications');
          return;
        }

        // Default → Map
        navigation.navigate('Map');
      }
    );

    return () => {
      responseListenerRef.current?.remove();
    };
  }, [navigation, isAuthenticated]);

  return null;
}

export async function configureAndroidChannel() {
  const { AndroidImportance } = await import('expo-notifications');
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Notificações AgilLock',
    importance: AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    enableLights: true,
  });
}