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
  const { isAuthenticated, tipoSessao } = useAuth();
  const toast = useToast();

  // Push tokens são registrados no endpoint /api/cliente/notificacoes/app-tokens
  // que só aceita JWT de CLIENTE. Para RESGATE/ADMIN não há registro de push.
  const isCliente = isAuthenticated && tipoSessao === 'cliente';

  useEffect(() => {
    if (!enabled || requestedRef.current) return;

    requestedRef.current = true;
    requestExpoPushToken()
      .then((token) => {
        if (!token) return;
        if (isCliente) return ensureExpoPushTokenRegistered();
        console.log(token);
      })
      .catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : 'Não foi possível habilitar notificações.';
        toast.show({ message, type: 'error' });
      });
  }, [enabled, isCliente, toast]);

  useEffect(() => {
    if (!enabled || !isCliente) return;
    ensureExpoPushTokenRegistered().catch(() => undefined);
  }, [enabled, isCliente]);

  return null;
}
