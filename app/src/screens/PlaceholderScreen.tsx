import { StyleSheet, Text, View } from 'react-native';

import { environment } from '../config/environment';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';

type Props = {
  title: string;
};

export function PlaceholderScreen({ title }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.text}>
          Tela reservada para as próximas fases do roadmap mobile.
        </Text>
        <Text style={styles.meta}>API: {environment.apiUrl}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  text: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
