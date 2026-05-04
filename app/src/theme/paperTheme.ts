import {
  MD3LightTheme,
  configureFonts,
  type MD3Theme,
} from 'react-native-paper';

import { colors } from './colors';

export const paperTheme: MD3Theme = {
  ...MD3LightTheme,
  fonts: configureFonts({ config: MD3LightTheme.fonts }),
  roundness: 8,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    onPrimary: colors.primaryText,
    primaryContainer: '#ffe2a0',
    onPrimaryContainer: colors.primaryText,
    secondary: colors.accent,
    onSecondary: '#ffffff',
    background: colors.background,
    surface: colors.surface,
    surfaceVariant: colors.surfaceMuted,
    onSurface: colors.text,
    onSurfaceVariant: colors.textMuted,
    outline: colors.border,
    outlineVariant: colors.border,
    error: colors.danger,
    onError: '#ffffff',
  },
};
