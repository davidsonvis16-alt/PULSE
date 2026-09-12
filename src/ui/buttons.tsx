import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const HEIGHT: Record<Size, number> = { sm: 34, md: 44, lg: 52 };
const PADDING: Record<Size, number> = { sm: 14, md: 20, lg: 26 };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  full,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isPrimary = variant === 'primary';
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: PADDING[size],
          opacity: inactive ? 0.5 : pressed ? 0.82 : 1,
        },
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        full && styles.full,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={isPrimary ? colors.onAccent : colors.text} />
      ) : (
        <>
          {icon && (
            <Ionicons
              name={icon}
              size={size === 'sm' ? 15 : 18}
              color={isPrimary ? colors.onAccent : variant === 'danger' ? colors.danger : colors.text}
            />
          )}
          <Txt
            variant={size === 'sm' ? 'callout' : 'bodyStrong'}
            tone={isPrimary ? 'onAccent' : variant === 'danger' ? 'danger' : 'default'}
          >
            {label}
          </Txt>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  name,
  onPress,
  size = 20,
  color,
  background = 'none',
  label,
  disabled,
  style,
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  size?: number;
  /** Defaults to the theme's text colour. */
  color?: string;
  background?: 'none' | 'surface' | 'accent';
  label: string;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const box = size + 20;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.iconBase,
        { width: box, height: box, borderRadius: box / 2 },
        background === 'surface' && { backgroundColor: colors.cardRaised },
        background === 'accent' && { backgroundColor: colors.accent },
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Ionicons
        name={name}
        size={size}
        color={background === 'accent' ? colors.onAccent : (color ?? colors.text)}
      />
    </Pressable>
  );
}

/** The big lime circle that starts playback. */
export function PlayButton({
  playing,
  onPress,
  size = 64,
  loading,
}: {
  playing: boolean;
  onPress: () => void;
  size?: number;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Pause' : 'Play'}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        styles.play,
        { width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.onAccent} />
      ) : (
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={size * 0.44}
          color={colors.onAccent}
          style={!playing && { marginLeft: size * 0.04 }}
        />
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && { opacity: 0.8 },
      ]}
    >
      {icon && (
        <Ionicons name={icon} size={13} color={active ? colors.onAccent : colors.textSecondary} />
      )}
      <Txt variant="callout" tone={active ? 'onAccent' : 'secondary'}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              onChange(option.value);
            }}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
          >
            <Txt variant="callout" tone={active ? 'onAccent' : 'secondary'}>
              {option.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    base: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      borderRadius: radii.pill,
    },
    primary: { backgroundColor: colors.accent },
    secondary: {
      backgroundColor: colors.cardHigh,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    ghost: { backgroundColor: 'transparent' },
    danger: {
      backgroundColor: 'transparent',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.danger,
    },
    full: { alignSelf: 'stretch' },
    iconBase: { alignItems: 'center', justifyContent: 'center' },
    play: {
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.accent,
      shadowOpacity: 0.3,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      height: 32,
      borderRadius: radii.pill,
      backgroundColor: colors.cardRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    segment: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: radii.pill,
      padding: 4,
      gap: 4,
    },
    segmentItem: {
      flex: 1,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.pill,
    },
    segmentItemActive: { backgroundColor: colors.accent },
  });
