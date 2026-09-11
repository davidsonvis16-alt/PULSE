import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { colors, radii, spacing } from '@/src/theme/tokens';

/**
 * Loading, empty and error. Every data-driven screen in Pulse uses these three,
 * so the user never sits in front of a blank rectangle wondering what happened.
 */

export function Skeleton({
  width,
  height,
  radius = radii.sm,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 780, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 780, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.skeleton,
          opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
        },
        style,
      ]}
    />
  );
}

export function SkeletonRows({ count = 6, height = 56 }: { count?: number; height?: number }) {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.row}>
          <Skeleton width={height - 8} height={height - 8} radius={radii.sm} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="70%" height={13} />
            <Skeleton width="45%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function SkeletonShelf({ cardWidth = 156, count = 4 }: { cardWidth?: number; count?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={{ gap: 10 }}>
          <Skeleton width={cardWidth} height={cardWidth} radius={radii.md} />
          <Skeleton width={cardWidth * 0.8} height={12} />
          <Skeleton width={cardWidth * 0.55} height={10} />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  icon = 'musical-notes-outline',
  title,
  message,
  actionLabel,
  onAction,
  compact,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.state, compact && { paddingVertical: spacing.xl }]}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={26} color={colors.textMuted} />
      </View>
      <Txt variant="title3" align="center">
        {title}
      </Txt>
      {message && (
        <Txt variant="body" tone="muted" align="center" style={{ maxWidth: 320 }}>
          {message}
        </Txt>
      )}
      {actionLabel && onAction && (
        <Button label={actionLabel} onPress={onAction} size="sm" style={{ marginTop: spacing.sm }} />
      )}
    </View>
  );
}

export function ErrorState({
  error,
  onRetry,
  compact,
}: {
  error: Error | string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const message = typeof error === 'string' ? error : error.message;
  const offline = /network|timed out|failed to fetch/i.test(message);
  return (
    <View style={[styles.state, compact && { paddingVertical: spacing.xl }]}>
      <View style={[styles.stateIcon, { backgroundColor: 'rgba(255,107,107,0.12)' }]}>
        <Ionicons
          name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
          size={26}
          color={colors.danger}
        />
      </View>
      <Txt variant="title3" align="center">
        {offline ? "Can't reach the music service" : 'Something went wrong'}
      </Txt>
      <Txt variant="body" tone="muted" align="center" style={{ maxWidth: 320 }}>
        {offline
          ? 'Check your connection. Anything you have downloaded still plays offline.'
          : message}
      </Txt>
      {onRetry && (
        <Button
          label="Try again"
          icon="refresh"
          onPress={onRetry}
          size="sm"
          variant="secondary"
          style={{ marginTop: spacing.sm }}
        />
      )}
    </View>
  );
}

export function ProgressBar({
  progress,
  height = 4,
  color = colors.accent,
  track = colors.cardHigh,
  style,
}: {
  progress: number;
  height?: number;
  color?: string;
  track?: string;
  style?: ViewStyle;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
      style={[{ height, backgroundColor: track, borderRadius: height / 2, overflow: 'hidden' }, style]}
    >
      <View style={{ width: `${clamped * 100}%`, height, backgroundColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  state: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xl,
  },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cardRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
