import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '@/src/ui/text';
import { colors, radii, spacing } from '@/src/theme/tokens';
import { useResponsive } from '@/src/hooks/use-responsive';

/**
 * Bottom sheet on phones, centred panel on larger screens — the same content
 * laid out for the shape of the device rather than stretched to fill it.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  maxHeightRatio = 0.86,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  maxHeightRatio?: number;
}) {
  const insets = useSafeAreaInsets();
  const { isTabletUp, height } = useResponsive();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isTabletUp ? 'fade' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          styles.container,
          isTabletUp ? styles.centered : styles.bottom,
          { maxHeight: height * maxHeightRatio },
        ]}
      >
        <View style={[styles.panel, isTabletUp && styles.panelCentered]}>
          {!isTabletUp && <View style={styles.grabber} />}
          {(title || subtitle) && (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                {title && <Txt variant="title3">{title}</Txt>}
                {subtitle && (
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {subtitle}
                  </Txt>
                )}
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function SheetAction({
  icon,
  label,
  detail,
  onPress,
  tone = 'default',
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail?: string;
  onPress: () => void;
  tone?: 'default' | 'accent' | 'danger';
  disabled?: boolean;
}) {
  const color = tone === 'danger' ? colors.danger : tone === 'accent' ? colors.accent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={19} color={color} />
      <View style={{ flex: 1 }}>
        <Txt variant="body" style={{ color }}>
          {label}
        </Txt>
        {detail && (
          <Txt variant="caption" tone="muted">
            {detail}
          </Txt>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  container: { position: 'absolute', left: 0, right: 0 },
  bottom: { bottom: 0 },
  centered: { top: '12%', alignItems: 'center' },
  panel: {
    backgroundColor: colors.backgroundElevated,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  panelCentered: {
    width: 460,
    maxWidth: '92%',
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.xl,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cardHigh,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: 14,
  },
});
