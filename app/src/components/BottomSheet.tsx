import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  Platform,
  StyleSheet,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { IconButton } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';

const DISMISS_DRAG_DISTANCE = 90;
const KEYBOARD_GAP = 8;
// Folga mínima entre o topo do bottom sheet e a status bar / notch, para
// que quando o teclado abre o sheet não suba até o topo da tela.
const SAFE_TOP_EXTRA = 16;

type Props = {
  visible: boolean;
  title?: string;
  titleMainVehicleCard?: string;
  subtitle?: string;
  children: ReactNode;
  heightPercent?: number;
  dimBackdrop?: boolean;
  closeOnBackdropPress?: boolean;
  statusBarOverlay?: boolean;
  onClose(): void;
};

export function BottomSheet({
  visible,
  title,
  titleMainVehicleCard,
  subtitle,
  children,
  heightPercent = 0.8,
  dimBackdrop = true,
  closeOnBackdropPress = true,
  statusBarOverlay = true,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const sheetHeight = Math.round(Dimensions.get('window').height * heightPercent);
  const translateY = useRef(new Animated.Value(sheetHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [mounted, setMounted] = useState(visible);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const animateClose = useCallback(
    (notify: boolean) => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: sheetHeight,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 170,
          useNativeDriver: true,
        }),
        Animated.timing(keyboardOffset, {
          toValue: 0,
          duration: 170,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setKeyboardHeight(0);
        setMounted(false);
        if (notify) onCloseRef.current();
      });
    },
    [backdropOpacity, keyboardOffset, sheetHeight, translateY],
  );

  const close = useCallback(() => {
    animateClose(true);
  }, [animateClose]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim normal no touch start (preserva drag-to-dismiss desde o início
        // do toque), mas SEM capturar de filhos/irmãos — assim toques no X e
        // outros botões adjacentes não são roubados pelo PanResponder.
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          gestureState.dy > 6 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onMoveShouldSetPanResponderCapture: (_event, gestureState) =>
          gestureState.dy > 6 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gestureState) => {
          translateY.setValue(Math.max(gestureState.dy, 0));
        },
        onPanResponderRelease: (_event, gestureState) => {
          if (gestureState.dy > DISMISS_DRAG_DISTANCE || gestureState.vy > 0.85) {
            close();
            return;
          }

          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
            tension: 90,
          }).start();
        },
      }),
    [close, translateY],
  );

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.setValue(sheetHeight);
      backdropOpacity.setValue(0);

      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
            tension: 90,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: 180,
            useNativeDriver: true,
          }),
        ]).start();
      });
      return;
    }

    if (mounted) animateClose(false);
  }, [animateClose, backdropOpacity, mounted, sheetHeight, translateY, visible]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      const nextHeight = Math.max(event.endCoordinates.height - KEYBOARD_GAP, 0);
      setKeyboardHeight(nextHeight);
      Animated.timing(keyboardOffset, {
        toValue: -nextHeight,
        duration: event.duration || 220,
        useNativeDriver: true,
      }).start();
    });

    const hideSub = Keyboard.addListener(hideEvent, (event) => {
      setKeyboardHeight(0);
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: event.duration || 180,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOffset]);

  // Limita a altura para que, com o teclado aberto e a translação aplicada,
  // o topo do sheet fique abaixo da área segura (status bar / notch) ao invés
  // de subir até o topo da tela.
  const safeTopOffset = (insets.top || 0) + SAFE_TOP_EXTRA;
  const visibleSheetHeight = Math.max(
    Math.min(sheetHeight, Dimensions.get('window').height - keyboardHeight - safeTopOffset),
    260,
  );

  return (
    <Modal
      animationType="none"
      transparent
      visible={mounted}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <StatusBar
        translucent
        backgroundColor={statusBarOverlay ? 'rgba(23, 32, 42, 0.38)' : 'transparent'}
        barStyle={statusBarOverlay ? 'light-content' : 'dark-content'}
      />
      <View style={styles.backdrop}>
        {dimBackdrop ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.backdropTint, { opacity: backdropOpacity }]}
          />
        ) : null}
        {closeOnBackdropPress ? (
          <Pressable style={styles.backdropPressable} onPress={close} />
        ) : null}
        <Animated.View
          style={[
            styles.sheet,
            {
              height: visibleSheetHeight,
              transform: [{ translateY }, { translateY: keyboardOffset }],
            },
          ]}
        >
          <View style={styles.dragArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <View style={styles.headerDragZone} {...panResponder.panHandlers}>
              {title ? (
                <Text style={styles.title}>{title}</Text>
              ) : (
                <Text style={styles.titleMainVehicleCard}>{titleMainVehicleCard}</Text>
              )}
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <IconButton icon="close" size={22} onPress={close} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  backdropTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 32, 42, 0.38)',
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: radius.bottomSheet,
    borderTopRightRadius: radius.bottomSheet,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  dragArea: {
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerDragZone: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingLeft: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
  },
  titleMainVehicleCard: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginLeft: -10,
  },
  subtitle: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
});
