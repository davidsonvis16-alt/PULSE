import { Pressable, ScrollView, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listPlaylists } from '@/src/db/repos/playlists';
import { getStatsSummary } from '@/src/db/repos/history';
import { MOODS } from '@/src/core/moods';
import { moodMixId } from '@/src/discovery/mood-mix';
import { useAsync } from '@/src/hooks/use-async';
import { Artwork } from '@/src/ui/artwork';
import { PulseLogo } from '@/src/ui/logo';
import { Txt } from '@/src/ui/text';
import { layout, radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** react-native-web adds `hovered` to the pressable state. */
type PressState = PressableStateCallbackType & { hovered?: boolean };

export interface SidebarTab {
  name: string;
  href: string;
  title: string;
  icon: IconName;
  active: IconName;
}

/** The main destinations, shared with the phone's tab bar. */
export const TABS: SidebarTab[] = [
  { name: 'index', href: '/', title: 'Home', icon: 'home-outline', active: 'home' },
  { name: 'discover', href: '/discover', title: 'Discover', icon: 'search-outline', active: 'search' },
  { name: 'library', href: '/library', title: 'Library', icon: 'library-outline', active: 'library' },
  { name: 'events', href: '/events', title: 'Events', icon: 'calendar-outline', active: 'calendar' },
  { name: 'profile', href: '/profile', title: 'Profile', icon: 'person-outline', active: 'person' },
];

/**
 * Laptop and desktop navigation: the tabs down the left, and the listener's own
 * library under them, the way every desktop music app is arranged — so the
 * content gets the whole width instead of a phone column in the middle.
 *
 * It sits around the whole app rather than inside the tabs, so it stays put on
 * an album or artist page too.
 */
export function Sidebar({ tabs }: { tabs: SidebarTab[] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const pathname = usePathname();

  // Re-read on every move, which is when a new playlist could have appeared.
  const playlists = useAsync(() => listPlaylists(), [pathname]);
  const week = useAsync(() => getStatsSummary('week'), [pathname]);
  const minutes = Math.round((week.data?.totalMs ?? 0) / 60_000);
  // Mood mixes have their own list above; the playlists list is everything else.
  const moodMixes = new Set(MOODS.map((mood) => moodMixId(mood.id)));

  const shortcuts: { label: string; detail: string; icon: IconName; href: string }[] = [
    { label: 'Liked songs', detail: 'Everything you hearted', icon: 'heart', href: '/collection/favorites' },
    { label: 'Downloaded', detail: 'Plays with no connection', icon: 'arrow-down-circle', href: '/downloads' },
    { label: 'Pulse Radio', detail: 'Live freestyles', icon: 'radio', href: '/radio' },
    { label: 'Indie', detail: 'Full songs from independent artists', icon: 'musical-notes', href: '/indie' },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.panel}>
        <View style={styles.brand}>
          <PulseLogo size={30} />
          <Txt variant="title2">pulse</Txt>
        </View>
        {tabs.map((tab) => {
          const focused = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="link"
              accessibilityState={{ selected: focused }}
              onPress={() => router.navigate(tab.href as never)}
              style={(s: PressState) => [
                styles.navItem,
                focused && { backgroundColor: colors.cardRaised },
                !focused && s.hovered && { backgroundColor: colors.card },
              ]}
            >
              <Ionicons
                name={focused ? tab.active : tab.icon}
                size={21}
                color={focused ? colors.accentInk : colors.textMuted}
              />
              <Txt variant="callout" style={{ color: focused ? colors.text : colors.textMuted }}>
                {tab.title}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.panel, { flex: 1, paddingBottom: 0 }]}>
        <View style={styles.libraryHead}>
          <Ionicons name="library-outline" size={19} color={colors.textMuted} />
          <Txt variant="callout" tone="muted" style={{ flex: 1 }}>
            Your library
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open your library"
            hitSlop={8}
            onPress={() => router.navigate('/library')}
          >
            <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.lg }}>
          {shortcuts.map((item) => (
            <Pressable
              key={item.href}
              accessibilityRole="link"
              onPress={() => router.push(item.href as never)}
              style={(s: PressState) => [styles.libraryRow, s.hovered && { backgroundColor: colors.card }]}
            >
              <View style={[styles.shortcutArt, { backgroundColor: colors.accentGlow }]}>
                <Ionicons name={item.icon} size={20} color={colors.accentInk} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="callout" numberOfLines={1}>
                  {item.label}
                </Txt>
                <Txt variant="caption" tone="faint" numberOfLines={1}>
                  {item.detail}
                </Txt>
              </View>
            </Pressable>
          ))}
          <Txt variant="micro" tone="faint" uppercase style={styles.groupTitle}>
            How do you feel?
          </Txt>
          {MOODS.map((mood) => (
            <Pressable
              key={mood.id}
              accessibilityRole="link"
              onPress={() => router.push(`/mood/${mood.id}`)}
              style={(s: PressState) => [
                styles.moodRow,
                pathname === `/mood/${mood.id}` && { backgroundColor: colors.cardRaised },
                s.hovered && { backgroundColor: colors.card },
              ]}
            >
              <View style={[styles.moodDot, { backgroundColor: mood.accent }]} />
              <Txt variant="callout" tone="secondary" numberOfLines={1}>
                {mood.name}
              </Txt>
            </Pressable>
          ))}
          <Txt variant="micro" tone="faint" uppercase style={styles.groupTitle}>
            Playlists
          </Txt>
          {(playlists.data ?? []).filter((playlist) => !moodMixes.has(playlist.id)).map((playlist) => (
            <Pressable
              key={playlist.id}
              accessibilityRole="link"
              onPress={() => router.push(`/playlist/${encodeURIComponent(playlist.id)}`)}
              style={(s: PressState) => [styles.libraryRow, s.hovered && { backgroundColor: colors.card }]}
            >
              <Artwork uri={playlist.coverArtworkUrl} size={44} radius={radii.xs} />
              <View style={{ flex: 1 }}>
                <Txt variant="callout" numberOfLines={1}>
                  {playlist.name}
                </Txt>
                <Txt variant="caption" tone="faint" numberOfLines={1}>
                  Playlist · {playlist.trackCount} {playlist.trackCount === 1 ? 'song' : 'songs'}
                </Txt>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`You listened for ${minutes} minutes this week. Open your stats.`}
        onPress={() => router.push('/stats')}
        style={(s: PressState) => [styles.week, s.hovered && { opacity: 0.92 }]}
      >
        <Txt variant="caption" tone="onAccent">
          You listened this week
        </Txt>
        <Txt variant="title1" tone="onAccent">
          {minutes.toLocaleString()} <Txt variant="callout" tone="onAccent">min</Txt>
        </Txt>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      width: layout.sidebarWidth,
      gap: spacing.sm,
      padding: spacing.sm,
      paddingRight: 0,
      backgroundColor: colors.background,
    },
    panel: {
      backgroundColor: colors.backgroundElevated,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: 2,
    },
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.xs,
      paddingBottom: spacing.lg,
    },
    navItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      height: 44,
      borderRadius: radii.sm,
    },
    libraryHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.md,
    },
    libraryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: 6,
      borderRadius: radii.sm,
    },
    groupTitle: { paddingHorizontal: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.sm },
    moodRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      height: 36,
      borderRadius: radii.sm,
    },
    moodDot: { width: 9, height: 9, borderRadius: 5 },
    week: {
      backgroundColor: colors.accent,
      borderRadius: radii.md,
      padding: spacing.lg,
      marginBottom: spacing.xs,
    },
    shortcutArt: {
      width: 44,
      height: 44,
      borderRadius: radii.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
