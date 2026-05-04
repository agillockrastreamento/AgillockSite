import AsyncStorage from '@react-native-async-storage/async-storage';

const PUSH_TOKEN_KEY = 'agillock_expo_push_token';
const DEVICE_ID_KEY = 'agillock_device_installation_id';

function createInstallationId() {
  const random = Math.random().toString(36).slice(2, 12);
  return `app-${Date.now().toString(36)}-${random}`;
}

export const pushTokenStorage = {
  getToken() {
    return AsyncStorage.getItem(PUSH_TOKEN_KEY);
  },
  setToken(token: string) {
    return AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  },
  removeToken() {
    return AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  },
  async getDeviceId() {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const next = createInstallationId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  },
};
