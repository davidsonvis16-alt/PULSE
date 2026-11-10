import { useEffect, useRef } from 'react';
import { Animated, Platform, View } from 'react-native';

/**
 * Three lines that turn into an ✕: the top and bottom lines swing in and
 * cross, the middle one fades, and the reverse when it closes.
 */
export function MenuIcon({ open, color, size = 24 }: { open: boolean; color: string; size?: number }) {
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: 240,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [open, turn]);

  const gap = size * 0.3;
  const line = { position: 'absolute' as const, left: 0, width: size, height: 2.5, borderRadius: 2, backgroundColor: color };
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }}>
      <Animated.View
        style={[
          line,
          {
            top: size / 2 - 1.25,
            transform: [
              { translateY: turn.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }) },
              { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[line, { top: size / 2 - 1.25, opacity: turn.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' }) }]}
      />
      <Animated.View
        style={[
          line,
          {
            top: size / 2 - 1.25,
            transform: [
              { translateY: turn.interpolate({ inputRange: [0, 1], outputRange: [gap, 0] }) },
              { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-45deg'] }) },
            ],
          },
        ]}
      />
    </View>
  );
}
