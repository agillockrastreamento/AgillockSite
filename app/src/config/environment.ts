import Constants from 'expo-constants';

type ExpoExtra = {
  apiUrl?: string;
  wsUrl?: string;
  environment?: string;
  eas?: {
    projectId?: string;
  };
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;

function nonEmpty(value: string | undefined) {
  return value && value.trim().length > 0 ? value : undefined;
}

export const environment = {
  apiUrl:
    nonEmpty(process.env.EXPO_PUBLIC_API_URL) ??
    extra.apiUrl ??
    'https://api.agillock.com.br/api',
  wsUrl:
    nonEmpty(process.env.EXPO_PUBLIC_WS_URL) ??
    extra.wsUrl ??
    'wss://api.agillock.com.br/ws/rastreamento',
  name: nonEmpty(process.env.EXPO_PUBLIC_APP_ENV) ?? extra.environment ?? 'production',
  easProjectId:
    nonEmpty(process.env.EXPO_PUBLIC_EAS_PROJECT_ID) ??
    Constants.easConfig?.projectId ??
    extra.eas?.projectId ??
    undefined,
};
