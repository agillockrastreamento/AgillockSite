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
import {
  ensureExpoPushTokenRegistered,
  unregisterStoredExpoPushToken,
} from '../notifications/pushTokenService';

type AuthState = {
  user: ClienteUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
};

type AuthContextValue = AuthState & {
  signIn(credentials: LoginCredentials): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ClienteUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    sessionStorage
      .get()
      .then((session) => {
        if (!mounted || !session) return;
        setUser(session.user);
        setToken(session.token);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const signIn = useCallback(async (credentials: LoginCredentials) => {
    const session = await loginCliente(credentials);
    await sessionStorage.set(session.token, session.user);
    setUser(session.user);
    setToken(session.token);
    await ensureExpoPushTokenRegistered();
  }, []);

  const signOut = useCallback(async () => {
    await unregisterStoredExpoPushToken().catch(() => undefined);
    await sessionStorage.clear();
    setUser(null);
    setToken(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: !!token && !!user,
      signIn,
      signOut,
    }),
    [isLoading, signIn, signOut, token, user],
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
