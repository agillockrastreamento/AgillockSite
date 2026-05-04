import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';

type ToastType = 'info' | 'success' | 'error';

type ToastOptions = {
  message: string;
  type?: ToastType;
  durationMs?: number;
};

type ToastContextValue = {
  show(options: ToastOptions): void;
  hide(): void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const palette: Record<ToastType, { background: string; text: string }> = {
  info: { background: '#17202a', text: '#ffffff' },
  success: { background: colors.success, text: '#ffffff' },
  error: { background: colors.danger, text: '#ffffff' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.96,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => setToast(null));
  }, [opacity, scale]);

  const show = useCallback(
    (options: ToastOptions) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast(options);

      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 8,
          tension: 90,
          useNativeDriver: true,
        }),
      ]).start();

      timerRef.current = setTimeout(hide, options.durationMs ?? 2600);
    },
    [hide, opacity, scale],
  );

  const value = useMemo(() => ({ show, hide }), [show, hide]);
  const type = toast?.type ?? 'info';
  const color = palette[type];

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={styles.host}>
          <Animated.View
            style={[
              styles.toast,
              {
                backgroundColor: color.background,
                opacity,
                transform: [{ scale }],
              },
            ]}
          >
            <Text style={[styles.message, { color: color.text }]}>
              {toast.message}
            </Text>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast deve ser usado dentro de ToastProvider.');
  }
  return context;
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 900,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  toast: {
    maxWidth: 340,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 8,
  },
  message: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: 'center',
  },
});
