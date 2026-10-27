import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';
import { useResponsive } from '@/src/hooks/use-responsive';
import { lastPointer } from '@/src/ui/pointer';

const MENU_WIDTH = 280;

/** True inside a popover menu, where actions are drawn tighter. */
const CompactContext = createContext(false);

/**
 * Bottom sheet on phones, centred panel on larger screens — the same content
 * laid out for the shape of the device rather than stretched to fill it.
 *
 * A `menu` (a list of actions, like a song's "…") is different on a computer:
 * it opens as a small popover where the pointer clicked, as menus do in every
 * desktop app, instead of a panel in the middle of the window.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  maxHeightRatio = 0.86,
  menu = false,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  maxHeightRatio?: number;
  menu?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { isTabletUp, width, height } = useResponsive();

  // Read once as the menu opens, so it stays where it appeared.
  const anchor = useMemo(() => (visible && menu && isTabletUp ? lastPointer() : null), [visible, menu, isTabletUp]);

  if (anchor) {
    const left = anchor.x + MENU_WIDTH + 12 > width ? Math.max(12, anchor.x - MENU_WIDTH) : anchor.x;
    const below = anchor.y < height / 2;
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.menuBackdrop} onPress={onClose} accessibilityLabel="Close menu" />
        <View
          accessibilityRole="menu"
          style={[
            styles.menu,
            { left, maxHeight: (below ? height - anchor.y : anchor.y) - 24 },
            below ? { top: anchor.y + 8 } : { bottom: height - anchor.y + 8 },
          ]}
        >
          {(title || subtitle) && (
            <View style={styles.menuHeader}>
              {title && (
                <Txt variant="callout" numberOfLines={1}>
                  {title}
                </Txt>
              )}
              {subtitle && (
                <Txt variant="caption" tone="muted" numberOfLines={1}>
                  {subtitle}
                </Txt>
              )}
            </View>
          )}
          <ScrollView showsVerticalScrollIndicator={false}>
            <CompactContext.Provider value>{children}</CompactContext.Provider>
          </ScrollView>
        </View>
      </Modal>
    );
  }

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const compact = useContext(CompactContext);
  const color = tone === 'danger' ? colors.danger : tone === 'accent' ? colors.accent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        compact ? styles.menuAction : styles.action,
        compact && hovered && { backgroundColor: colors.cardHigh },
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={compact ? 17 : 19} color={color} />
      <View style={{ flex: 1 }}>
        <Txt variant={compact ? 'callout' : 'body'} style={{ color }}>
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    menuHeader: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      marginBottom: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
    },
    menuBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.12)' },
    menu: {
      position: 'absolute',
      width: MENU_WIDTH,
      padding: 6,
      borderRadius: radii.md,
      backgroundColor: colors.cardRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 16 },
      elevation: 16,
    },
    menuAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      minHeight: 40,
      paddingVertical: 8,
      borderRadius: radii.xs,
    },
  });
