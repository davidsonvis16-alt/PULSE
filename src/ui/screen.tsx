import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '@/src/ui/text';
import { layout, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';
import { useResponsive } from '@/src/hooks/use-responsive';

/**
 * Page chrome. Centres content on wide screens instead of letting a phone
 * layout stretch across a monitor, and reserves room for the mini player.
 */
export function Screen({
  children,
  scroll = false,
  edges = ['top'],
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom')[];
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: edges.includes('top') ? insets.top : 0 },
        scroll && { flex: 1 },
      ]}
    >
      {children}
    </View>
  );
}

/** Wraps page content so it never runs wider than is comfortable to read. */
export function ContentWidth({ children }: { children: ReactNode }) {
  const { isLaptopUp, contentWidth } = useResponsive();
  if (!isLaptopUp) return <>{children}</>;
  return <View style={{ width: contentWidth, alignSelf: 'center' }}>{children}</View>;
}

export function PageHeader({
  title,
  subtitle,
  onBack,
  right,
  transparent,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  transparent?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { gutter } = useResponsive();
  return (
    <View
      style={[
        styles.header,
        { paddingHorizontal: gutter },
        !transparent && styles.headerSolid,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={10}
        onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
        style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        {title ? (
          <Txt variant="title3" numberOfLines={1}>
            {title}
          </Txt>
        ) : null}
        {subtitle ? (
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Bottom padding that clears the tab bar and the mini player. */
export function useBottomInset(extra = spacing.xl) {
  const insets = useSafeAreaInsets();
  return (
    layout.tabBarHeight +
    layout.miniPlayerHeight +
    (Platform.OS === 'ios' ? insets.bottom * 0.4 : 0) +
    extra
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    headerSolid: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
    },
    back: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
  });
