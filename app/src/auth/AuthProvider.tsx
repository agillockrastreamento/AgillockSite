import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { loginApp } from './authService';
import { sessionStorage } from './sessionStorage';
import type { AppUser, ClienteUser, LoginCredentials, TipoSessao } from './authTypes';
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
  user: AppUser | null;
  token: string | null;
  tipoSessao: TipoSessao | null;
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

function isClienteUser(user: AppUser): user is ClienteUser {
  return user.role === 'CLIENTE';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tipoSessao, setTipoSessao] = useState<TipoSessao | null>(null);
  const [me, setMe] = useState<MePermissoes | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    sessionStorage
      .get()
      .then(async (session) => {
        if (!mounted || !session) return;

        // Validação de sessão depende do tipo
        try {
          if (session.tipoSessao === 'cliente') {
            await apiRequest('/cliente/perfil');
          } else {
            // Para resgate/admin basta validar que o token ainda funciona
            await apiRequest('/auth/me');
          }
        } catch {
          await sessionStorage.clear();
          return;
        }

        setUser(session.user);
        setToken(session.token);
        setTipoSessao(session.tipoSessao);

        if (session.tipoSessao === 'cliente') {
          const fetched = await fetchMePermissoes();
          if (mounted) setMe(fetched);
        }
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
      setTipoSessao(null);
      setMe(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (credentials: LoginCredentials) => {
    const session = await loginApp(credentials);
    await sessionStorage.set(session.token, session.user, session.tipoSessao);

    // Para cliente, carregamos permissões antes de marcar autenticado
    // (senão o navigator monta sem permissões e crasha em initialRouteName).
    if (session.tipoSessao === 'cliente') {
      const fetched = await fetchMePermissoes();
      setMe(fetched);
    } else {
      setMe(null);
    }

    setUser(session.user);
    setToken(session.token);
    setTipoSessao(session.tipoSessao);

    if (session.tipoSessao === 'cliente') {
      await ensureExpoPushTokenRegistered();
    }
  }, []);

  const signOut = useCallback(async () => {
    if (tipoSessao === 'cliente') {
      await unregisterStoredExpoPushToken().catch(() => undefined);
    }
    await sessionStorage.clear();
    setUser(null);
    setToken(null);
    setTipoSessao(null);
    setMe(null);
  }, [tipoSessao]);

  const refreshPermissoes = useCallback(async () => {
    if (tipoSessao !== 'cliente') return;
    const fetched = await fetchMePermissoes();
    setMe(fetched);
  }, [tipoSessao]);

  const can = useCallback(
    (key: PermKey) => {
      // Não-cliente (resgate/admin) tem acesso por convenção de role; permissões
      // granulares não se aplicam.
      if (tipoSessao !== 'cliente') return true;

      const clienteUser = user && isClienteUser(user) ? user : null;
      // Responsável (sem cache ainda ou explicitamente) tem todas as permissões.
      if (!me) {
        return clienteUser?.tipo === 'responsavel' || !clienteUser?.tipo;
      }
      if (me.tipo === 'responsavel') return true;
      return pode(me.permissoes, key);
    },
    [me, user, tipoSessao],
  );

  const podeAcessarDispositivoCb = useCallback(
    (_dispositivoId: string) => {
      if (tipoSessao !== 'cliente') return true;
      if (!me) return true;
      if (me.dispositivoIdsPermitidos === null) return true;
      return me.dispositivoIdsPermitidos.includes(_dispositivoId);
    },
    [me, tipoSessao],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      tipoSessao,
      me,
      isLoading,
      isAuthenticated: !!token && !!user && !!tipoSessao,
      signIn,
      signOut,
      refreshPermissoes,
      can,
      podeAcessarDispositivo: podeAcessarDispositivoCb,
    }),
    [
      isLoading,
      signIn,
      signOut,
      token,
      user,
      tipoSessao,
      me,
      refreshPermissoes,
      can,
      podeAcessarDispositivoCb,
    ],
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
