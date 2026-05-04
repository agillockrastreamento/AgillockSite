import Constants from 'expo-constants';

type ExpoExtra = {
  apiUrl?: string;
  wsUrl?: string;
  environment?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;

export const environment = {
  apiUrl:
    process.env.EXPO_PUBLIC_API_URL ??
    extra.apiUrl ??
    'https://api.agillock.com.br/api',
  wsUrl:
    process.env.EXPO_PUBLIC_WS_URL ??
    extra.wsUrl ??
    'wss://api.agillock.com.br/ws/rastreamento',
  name: process.env.EXPO_PUBLIC_APP_ENV ?? extra.environment ?? 'production',
};
