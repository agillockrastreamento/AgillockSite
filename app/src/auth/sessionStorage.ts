import AsyncStorage from '@react-native-async-storage/async-storage';

import { tokenStorage } from '../storage/tokenStorage';
import type { ClienteUser } from './authTypes';

const USER_KEY = 'agillock_cliente_user';

export const sessionStorage = {
  async get() {
    const [token, rawUser] = await Promise.all([
      tokenStorage.get(),
      AsyncStorage.getItem(USER_KEY),
    ]);

    if (!token || !rawUser) return null;

    try {
      const user = JSON.parse(rawUser) as ClienteUser;
      if (user.role !== 'CLIENTE') return null;
      return { token, user };
    } catch {
      await this.clear();
      return null;
    }
  },
  async set(token: string, user: ClienteUser) {
    await Promise.all([
      tokenStorage.set(token),
      AsyncStorage.setItem(USER_KEY, JSON.stringify(user)),
    ]);
  },
  async clear() {
    await Promise.all([tokenStorage.clear(), AsyncStorage.removeItem(USER_KEY)]);
  },
};
