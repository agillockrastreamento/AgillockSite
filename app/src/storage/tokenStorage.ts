import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'agillock_cliente_token';

export const tokenStorage = {
  get() {
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  set(token: string) {
    return SecureStore.setItemAsync(TOKEN_KEY, token);
  },
  clear() {
    return SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};
