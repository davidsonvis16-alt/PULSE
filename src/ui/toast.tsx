import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '@/src/ui/text';
import { colors, layout, radii, spacing } from '@/src/theme/tokens';

type ToastTone = 'default' | 'success' | 'error';

interface ToastMessage {
  text: string;
  tone: ToastTone;
}

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** Short confirmations ("Added to your library", "Download started"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback(
    (text: string, tone: ToastTone = 'default') => {
      if (timer.current) clearTimeout(timer.current);
      setMessage({ text, tone });
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(
          ({ finished }) => finished && setMessage(null),
        );
      }, 2600);
    },
    [opacity],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {message && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            {
              opacity,
              bottom: layout.tabBarHeight + layout.miniPlayerHeight + insets.bottom * 0.5 + spacing.md,
              transform: [
                { translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.toast}>
            {message.tone !== 'default' && (
              <Ionicons
                name={message.tone === 'success' ? 'checkmark-circle' : 'alert-circle'}
                size={16}
                color={message.tone === 'success' ? colors.accent : colors.danger}
              />
            )}
            <Txt variant="callout" numberOfLines={2} style={{ flexShrink: 1 }}>
              {message.text}
            </Txt>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: spacing.xl },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.cardHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: 420,
  },
});
