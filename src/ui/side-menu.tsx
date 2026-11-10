import { useEffect, useRef } from 'react';
import { Animated, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { checkForUpdate, installedVersion } from '@/src/core/updates';
import { chatSettings } from '@/src/social/chat';
import { useStore } from '@/src/hooks/use-store';
import { useToast } from '@/src/ui/toast';
import { ProfileAvatar } from '@/src/ui/profile-avatar';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/theme';

type Icon = keyof typeof Ionicons.glyphMap;

interface Item {
  label: string;
  icon: Icon;
  go: () => void;
}

/**
 * The menu on the right: every place in Pulse that is not on the bottom bar,
 * so a quiet Home never means something is out of reach.
 */
export function SideMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const chats = useStore(chatSettings);
  const panelWidth = Math.min(340, width * 0.84);
  const slide = useRef(new Animated.Value(panelWidth)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 0 : panelWidth,
      duration: 220,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [open, panelWidth, slide]);

  const to = (path: string) => () => {
    onClose();
    router.push(path as never);
  };

  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'You',
      items: [
        { label: 'Profile', icon: 'person-outline', go: to('/profile') },
        {
          label: 'Chats',
          icon: 'chatbubbles-outline',
          go: chats.enabled
            ? to('/chats')
            : () => {
                toast('Switch chats on first', 'success');
                to('/settings/privacy')();
              },
        },
        { label: 'Your stats', icon: 'stats-chart-outline', go: to('/stats') },
        { label: 'Notifications', icon: 'notifications-outline', go: to('/notifications') },
      ],
    },
    {
      title: 'Your music',
      items: [
        { label: 'Liked songs', icon: 'heart-outline', go: to('/collection/favorites') },
        { label: 'Downloads', icon: 'arrow-down-circle-outline', go: to('/downloads') },
        { label: 'Grooves', icon: 'albums-outline', go: to('/grooves') },
        { label: 'Playlists', icon: 'list-outline', go: to('/library') },
        { label: 'Add music', icon: 'add-circle-outline', go: to('/import') },
        { label: 'Songs to identify', icon: 'help-circle-outline', go: to('/identify') },
      ],
    },
    {
      title: 'Discover',
      items: [
        { label: 'Charts by country', icon: 'podium-outline', go: to('/charts') },
        { label: 'Indie · full songs', icon: 'musical-notes-outline', go: to('/indie') },
        { label: 'Pulse Radio', icon: 'radio-outline', go: to('/radio') },
        { label: 'Songs of the Week', icon: 'trophy-outline', go: to('/radio-vote') },
        { label: 'Events near you', icon: 'calendar-outline', go: to('/events') },
        { label: 'Music news', icon: 'newspaper-outline', go: to('/discover?tab=news') },
      ],
    },
    {
      title: 'Settings',
      items: [
        { label: 'Privacy and chats', icon: 'lock-closed-outline', go: to('/settings/privacy') },
        { label: 'Notification settings', icon: 'options-outline', go: to('/settings/notifications') },
        { label: 'Playback', icon: 'play-circle-outline', go: to('/settings/playback') },
        { label: 'Profile picture', icon: 'image-outline', go: to('/settings/picture') },
        ...(Platform.OS === 'android'
          ? [
              {
                label: `Check for updates · ${installedVersion()}`,
                icon: 'arrow-down-circle-outline' as Icon,
                go: () => {
                  void checkForUpdate().then((found) => {
                    if (found) void Linking.openURL(found.url);
                    else toast("You're on the newest version", 'success');
                  });
                },
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close the menu" style={[styles.backdrop, { backgroundColor: colors.scrim }]} onPress={onClose} />
      <Animated.View
        style={[
          styles.panel,
          {
            width: panelWidth,
            paddingTop: insets.top + spacing.lg,
            backgroundColor: colors.background,
            borderLeftColor: colors.border,
            transform: [{ translateX: slide }],
          },
        ]}
      >
        <View style={styles.head}>
          <ProfileAvatar size={40} />
          <Pressable accessibilityRole="button" accessibilityLabel="Close the menu" onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
          {groups.map((group) => (
            <View key={group.title} style={{ marginTop: spacing.lg }}>
              <Txt variant="micro" tone="muted" uppercase style={styles.groupTitle}>
                {group.title}
              </Txt>
              {group.items.map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  onPress={item.go}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.card }]}
                >
                  <Ionicons name={item.icon} size={21} color={colors.text} />
                  <Txt variant="bodyStrong" style={{ flex: 1 }}>
                    {item.label}
                  </Txt>
                  <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  panel: { position: 'absolute', top: 0, right: 0, bottom: 0, borderLeftWidth: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  groupTitle: { paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radii.sm,
  },
});
