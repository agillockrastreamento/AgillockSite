import AsyncStorage from '@react-native-async-storage/async-storage';

import { tokenStorage } from '../storage/tokenStorage';
import type { AppUser, StoredSession, TipoSessao } from './authTypes';

const USER_KEY = 'agillock_cliente_user';
const TIPO_SESSAO_KEY = 'agillock_tipo_sessao';

export const sessionStorage = {
  async get(): Promise<StoredSession | null> {
    const [token, rawUser, rawTipo] = await Promise.all([
      tokenStorage.get(),
      AsyncStorage.getItem(USER_KEY),
      AsyncStorage.getItem(TIPO_SESSAO_KEY),
    ]);

    if (!token || !rawUser) return null;

    try {
      const user = JSON.parse(rawUser) as AppUser;
      // Compat: sessões antigas (antes do tipoSessao) vinham apenas de CLIENTE.
      const tipoSessao = (rawTipo as TipoSessao | null) ?? 'cliente';
      return { token, user, tipoSessao };
    } catch {
      await this.clear();
      return null;
    }
  },
  async set(token: string, user: AppUser, tipoSessao: TipoSessao) {
    await Promise.all([
      tokenStorage.set(token),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(user)),
      AsyncStorage.setItem(TIPO_SESSAO_KEY, tipoSessao),
    ]);
  },
  async clear() {
    await Promise.all([
      tokenStorage.clear(),
      AsyncStorage.removeItem(USER_KEY),
      AsyncStorage.removeItem(TIPO_SESSAO_KEY),
    ]);
  },
};
