import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

// Placeholder — implementação completa na Fase 5
export function PareadorTagScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Parear Tag</Text>
      <Text style={styles.subtitle}>Implementação completa em construção (Fase 5).</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  subtitle: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
});
