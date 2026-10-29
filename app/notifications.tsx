import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { formatRelativeTime } from '@/src/core/format';
import {
  clearNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationType,
  type PulseNotification,
} from '@/src/db/repos/notifications';
import { checkForNewReleases } from '@/src/discovery/releases';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { IconButton } from '@/src/ui/buttons';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

const ICONS: Record<NotificationType, keyof typeof Ionicons.glyphMap> = {
  new_release: 'sparkles-outline',
  event: 'ticket-outline',
  event_reminder: 'alarm-outline',
  friend_activity: 'people-outline',
  recommendation: 'compass-outline',
  playlist: 'albums-outline',
  download: 'arrow-down-circle-outline',
  award: 'trophy-outline',
  news: 'newspaper-outline',
};

/** The notification centre: new releases, events, friends, recommendations. */
export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const toast = useToast();

  const state = useAsync(async () => {
    // Opening this screen is a good moment to look for releases we owe them.
    await checkForNewReleases().catch(() => []);
    return listNotifications(80);
  }, []);

  const notifications = state.data ?? [];
  const unread = notifications.filter((n) => !n.readAt).length;

  const open = async (notification: PulseNotification) => {
    await markNotificationRead(notification.id);
    state.reload();
    if (!notification.entityId || !notification.entityType) return;
    const id = encodeURIComponent(notification.entityId);
    switch (notification.entityType) {
      case 'album':
        router.push(`/album/${id}`);
        break;
      case 'track':
        router.push(`/track/${id}`);
        break;
      case 'artist':
        router.push(`/artist/${id}`);
        break;
      case 'playlist':
        router.push(`/playlist/${notification.entityId}`);
        break;
      case 'event':
        router.push('/events');
        break;
      case 'award':
        // Ids carry what the alert was about after the edition: "edition|won|artist".
        router.push(`/awards/${encodeURIComponent(notification.entityId.split('|')[0])}`);
        break;
      case 'article':
        void WebBrowser.openBrowserAsync(notification.entityId);
        break;
      default:
        break;
    }
  };

  return (
    <Screen>
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
        right={
          <View style={{ flexDirection: 'row' }}>
            <IconButton
              name="options-outline"
              label="Notification settings"
              onPress={() => router.push('/settings/notifications')}
            />
            {notifications.length > 0 && (
              <IconButton
                name="checkmark-done-outline"
                label="Mark all as read"
                onPress={async () => {
                  await markAllNotificationsRead();
                  state.reload();
                }}
              />
            )}
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        {state.loading && !state.data ? (
          <SkeletonRows count={6} />
        ) : state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="Nothing to tell you yet"
            message="Follow an artist and Pulse will let you know the moment they release something."
            actionLabel="Find artists"
            onAction={() => router.push('/discover')}
          />
        ) : (
          <>
            {notifications.map((notification) => (
              <Pressable
                key={notification.id}
                accessibilityRole="button"
                accessibilityLabel={notification.title}
                onPress={() => open(notification)}
                style={({ pressed }) => [
                  styles.row,
                  !notification.readAt && styles.unread,
                  pressed && { opacity: 0.75 },
                ]}
              >
                {notification.imageUrl ? (
                  <Artwork uri={notification.imageUrl} size={44} radius={radii.sm} />
                ) : (
                  <View style={styles.icon}>
                    <Ionicons
                      name={ICONS[notification.type] ?? 'notifications-outline'}
                      size={18}
                      color={colors.accentInk}
                    />
                  </View>
                )}
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {notification.title}
                  </Txt>
                  {notification.body ? (
                    <Txt variant="caption" tone="secondary" numberOfLines={2}>
                      {notification.body}
                    </Txt>
                  ) : null}
                  <Txt variant="caption" tone="faint">
                    {formatRelativeTime(notification.createdAt)}
                  </Txt>
                </View>
                {!notification.readAt && <View style={styles.dot} />}
              </Pressable>
            ))}

            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                await clearNotifications();
                toast('Notifications cleared');
                state.reload();
              }}
              style={{ paddingVertical: spacing.xl }}
            >
              <Txt variant="callout" tone="muted" align="center">
                Clear all notifications
              </Txt>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      marginBottom: 2,
    },
    unread: { backgroundColor: colors.card },
    icon: {
      width: 44,
      height: 44,
      borderRadius: radii.sm,
      backgroundColor: colors.cardHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  });
