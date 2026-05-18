import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { loginCliente } from './authService';
import { sessionStorage } from './sessionStorage';
import type { ClienteUser, LoginCredentials } from './authTypes';
import { apiRequest, setUnauthorizedHandler } from '../services/api/apiClient';
import {
  ensureExpoPushTokenRegistered,
  unregisterStoredExpoPushToken,
} from '../notifications/pushTokenService';
import {
  type MePermissoes,
  type PermKey,
  pode,
} from './permissoes';

type AuthState = {
  user: ClienteUser | null;
  token: string | null;
  me: MePermissoes | null;
  isLoading: boolean;
  isAuthenticated: boolean;
};

type AuthContextValue = AuthState & {
  signIn(credentials: LoginCredentials): Promise<void>;
  signOut(): Promise<void>;
  refreshPermissoes(): Promise<void>;
  can(key: PermKey): boolean;
  podeAcessarDispositivo(dispositivoId: string): boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMePermissoes(): Promise<MePermissoes | null> {
  try {
    return await apiRequest<MePermissoes>('/cliente/me/permissoes');
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ClienteUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MePermissoes | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    sessionStorage
      .get()
      .then(async (session) => {
        if (!mounted || !session) return;
        try {
          await apiRequest('/cliente/perfil');
        } catch {
          await sessionStorage.clear();
          return;
        }
        setUser(session.user);
        setToken(session.token);
        const fetched = await fetchMePermissoes();
        if (mounted) setMe(fetched);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      await sessionStorage.clear();
      setUser(null);
      setToken(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (credentials: LoginCredentials) => {
    const session = await loginCliente(credentials);
    await sessionStorage.set(session.token, session.user);
    setUser(session.user);
    setToken(session.token);
    const fetched = await fetchMePermissoes();
    setMe(fetched);
    await ensureExpoPushTokenRegistered();
  }, []);

  const signOut = useCallback(async () => {
    await unregisterStoredExpoPushToken().catch(() => undefined);
    await sessionStorage.clear();
    setUser(null);
    setToken(null);
    setMe(null);
  }, []);

  const refreshPermissoes = useCallback(async () => {
    const fetched = await fetchMePermissoes();
    setMe(fetched);
  }, []);

  const can = useCallback(
    (key: PermKey) => {
      // Responsável (sem cache ainda ou explicitamente) tem todas as permissões.
      if (!me) {
        return user?.tipo === 'responsavel' || !user?.tipo;
      }
      if (me.tipo === 'responsavel') return true;
      return pode(me.permissoes, key);
    },
    [me, user],
  );

  const podeAcessarDispositivoCb = useCallback(
    (dispositivoId: string) => {
      if (!me) return true;
      if (me.dispositivoIdsPermitidos === null) return true;
      return me.dispositivoIdsPermitidos.includes(dispositivoId);
    },
    [me],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      me,
      isLoading,
      isAuthenticated: !!token && !!user,
      signIn,
      signOut,
      refreshPermissoes,
      can,
      podeAcessarDispositivo: podeAcessarDispositivoCb,
    }),
    [isLoading, signIn, signOut, token, user, me, refreshPermissoes, can, podeAcessarDispositivoCb],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  }
  return context;
}
