import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';

type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmDialogContextValue = {
  show(options: ConfirmDialogOptions): Promise<boolean>;
};

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(
  null,
);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const scale = useRef(new Animated.Value(0.96)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const close = useCallback(
    (confirmed: boolean) => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.96,
          duration: 140,
          useNativeDriver: true,
        }),
      ]).start(() => {
        resolverRef.current?.(confirmed);
        resolverRef.current = null;
        setOptions(null);
      });
    },
    [opacity, scale],
  );

  const show = useCallback(
    (nextOptions: ConfirmDialogOptions) => {
      setOptions(nextOptions);
      scale.setValue(0.96);
      opacity.setValue(0);

      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 8,
          tension: 90,
          useNativeDriver: true,
        }),
      ]).start();

      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [opacity, scale],
  );

  const value = useMemo(() => ({ show }), [show]);
  const confirmColor = options?.destructive ? colors.danger : colors.primary;
  const confirmTextColor = options?.destructive
    ? '#ffffff'
    : colors.primaryText;

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      <Modal
        animationType="none"
        transparent
        visible={!!options}
        onRequestClose={() => close(false)}
      >
        <View style={styles.backdrop}>
          <Animated.View
            style={[
              styles.dialog,
              {
                opacity,
                transform: [{ scale }],
              },
            ]}
          >
            <Text style={styles.title}>{options?.title}</Text>
            <Text style={styles.message}>{options?.message}</Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                style={[styles.button, styles.cancelButton]}
                onPress={() => close(false)}
              >
                <Text style={styles.cancelText}>
                  {options?.cancelLabel ?? 'Cancelar'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={[styles.button, { backgroundColor: confirmColor }]}
                onPress={() => close(true)}
              >
                <Text style={[styles.confirmText, { color: confirmTextColor }]}>
                  {options?.confirmLabel ?? 'Confirmar'}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const context = useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error(
      'useConfirmDialog deve ser usado dentro de ConfirmDialogProvider.',
    );
  }
  return context;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(23, 32, 42, 0.36)',
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 10,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  button: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  cancelButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '800',
  },
});
