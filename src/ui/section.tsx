import type { ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '@/src/ui/text';
import { colors, spacing } from '@/src/theme/tokens';

export function SectionHeader({
  title,
  subtitle,
  actionLabel = 'See all',
  onAction,
  style,
}: {
  title: string;
  subtitle?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.header, style]}>
      <View style={{ flex: 1 }}>
        <Txt variant="title3" numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {onAction && (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}: ${title}`}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
        >
          <Txt variant="callout" tone="secondary">
            {actionLabel}
          </Txt>
          <Ionicons name="chevron-forward" size={13} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

/** A horizontally scrolling rail of cards, virtualised for long shelves. */
export function Shelf<T>({
  data,
  renderItem,
  keyExtractor,
  gutter,
  gap = spacing.md,
}: {
  data: T[];
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;
  gutter: number;
  gap?: number;
}) {
  return (
    <FlatList
      horizontal
      data={data}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => <>{renderItem(item, index)}</>}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: gutter, gap }}
      initialNumToRender={5}
      windowSize={5}
      removeClippedSubviews
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
