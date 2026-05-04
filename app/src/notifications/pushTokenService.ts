import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { environment } from '../config/environment';
import { apiRequest } from '../services/api/apiClient';
import { colors } from '../theme/colors';
import { pushTokenStorage } from './pushTokenStorage';

type RegisterTokenBody = {
  token: string;
  plataforma: string;
  deviceId: string;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function configureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Notificações AgilLock',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: colors.primary,
  });
}

export async function requestExpoPushToken() {
  await configureAndroidNotificationChannel();

  const currentPermissions = await Notifications.getPermissionsAsync();
  let finalStatus = currentPermissions.status;

  if (currentPermissions.status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  if (finalStatus !== 'granted') return null;
  if (!environment.easProjectId) return null;

  const tokenResponse = await Notifications.getExpoPushTokenAsync({
    projectId: environment.easProjectId,
  });
  const token = tokenResponse.data;
  await pushTokenStorage.setToken(token);
  return token;
}

export async function ensureExpoPushTokenRegistered() {
  let token = await pushTokenStorage.getToken();
  if (!token) token = await requestExpoPushToken();
  if (!token) return null;
  return registerStoredExpoPushToken();
}

export async function registerStoredExpoPushToken() {
  const token = await pushTokenStorage.getToken();
  if (!token) return null;

  const body: RegisterTokenBody = {
    token,
    plataforma: Platform.OS,
    deviceId: await pushTokenStorage.getDeviceId(),
  };

  return apiRequest('/cliente/notificacoes/app-tokens', {
    method: 'POST',
    body,
  });
}

export async function unregisterStoredExpoPushToken() {
  const token = await pushTokenStorage.getToken();
  const deviceId = await pushTokenStorage.getDeviceId();

  if (!token && !deviceId) return null;

  return apiRequest('/cliente/notificacoes/app-tokens', {
    method: 'DELETE',
    body: token ? { token } : { deviceId },
  });
}
