import { useEffect, useRef } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../toast/ToastProvider';
import {
  ensureExpoPushTokenRegistered,
  requestExpoPushToken,
} from './pushTokenService';

type Props = {
  enabled: boolean;
};

export function NotificationBootstrap({ enabled }: Props) {
  const requestedRef = useRef(false);
  const { isAuthenticated } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (!enabled || requestedRef.current) return;

    requestedRef.current = true;
    requestExpoPushToken()
      .then((token) => {
        if (!token) return;
        if (isAuthenticated) return ensureExpoPushTokenRegistered();
        console.log(token);
      })
      .catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : 'Não foi possível habilitar notificações.';
        toast.show({ message, type: 'error' });
      });
  }, [enabled, isAuthenticated, toast]);

  useEffect(() => {
    if (!enabled || !isAuthenticated) return;
    ensureExpoPushTokenRegistered().catch(() => undefined);
  }, [enabled, isAuthenticated]);

  return null;
}
