import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { pluralize } from '@/src/core/format';
import { musicProvider } from '@/src/providers/music';
import { playerStore } from '@/src/audio/player';
import { buildBlend, cardColor, notesStore, tasteMatch } from '@/src/social/notes';
import { useStore } from '@/src/hooks/use-store';
import { useResponsive } from '@/src/hooks/use-responsive';
import { Screen, PageHeader, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { EmptyState } from '@/src/ui/states';
import { useToast } from '@/src/ui/toast';
import { FriendAvatar, NoteBubble, StoryViewer, noteCardShadow } from '@/src/ui/notes';
import { palette, radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * A friend's profile, laid out the way people know from Instagram: the picture
 * with its story ring and note on top, three numbers beside it, then what they
 * have on repeat.
 */
export function FriendScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { gutter, width } = useResponsive();
  const bottomInset = useBottomInset();
  const notes = useStore(notesStore);
  const [viewing, setViewing] = useState(false);
  const [blending, setBlending] = useState(false);

  useEffect(() => {
    void notesStore.load();
  }, []);

  const friend = notes.friends.find((entry) => entry.id === id);

  if (!friend) {
    return (
      <Screen>
        <PageHeader title="Profile" />
        {notes.ready && <EmptyState icon="person-outline" title="Not found" message="This friend is not on Pulse." />}
      </Screen>
    );
  }

  const match = tasteMatch(friend, notes.taste);
  const hours = Math.round(friend.minutesThisWeek / 6) / 10;
  const cardWidth = (Math.min(width, 900) - gutter * 2 - spacing.md) / 2;

  const blend = async () => {
    setBlending(true);
    try {
      const made = await buildBlend(friend);
      if (!made.tracks.length) return toast('Could not make a blend right now', 'error');
      void playerStore.playQueue(made.tracks, { context: 'recommendation', contextLabel: made.name });
      router.push(`/playlist/${encodeURIComponent(made.id)}`);
    } finally {
      setBlending(false);
    }
  };

  return (
    <Screen>
      <PageHeader title={friend.handle} subtitle="Demo profile" />
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }} showsVerticalScrollIndicator={false}>
        <View style={[styles.top, { paddingHorizontal: gutter }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={friend.note ? `Open ${friend.name}'s note` : friend.name}
            onPress={() => friend.note && setViewing(true)}
            style={{ alignItems: 'center' }}
          >
            <NoteBubble note={friend.note} maxWidth={120} placeholder="No note today" />
            <FriendAvatar friend={friend} size={92} />
          </Pressable>
          <View style={styles.stats}>
            <Stat value={`${hours}h`} label="this week" />
            <Stat value={notes.taste?.hasData ? `${match.percent}%` : '—'} label="match" accent />
            <Stat value={String(friend.repeats.reduce((sum, entry) => sum + entry.plays, 0))} label="repeats" />
          </View>
        </View>

        <View style={{ paddingHorizontal: gutter, marginTop: spacing.md, gap: 2 }}>
          <Txt variant="bodyStrong">{friend.name}</Txt>
          <Txt variant="caption" tone="muted">
            {friend.city} · {friend.topGenres[0]}
            {friend.autoPost ? ' · auto-posts' : ''}
          </Txt>
          <Txt variant="body" tone="secondary" style={{ marginTop: spacing.xs }}>
            {friend.bio}
          </Txt>
        </View>

        <View style={[styles.buttons, { paddingHorizontal: gutter }]}>
          <Pressable
            accessibilityRole="button"
            onPress={blend}
            disabled={blending}
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="git-merge-outline" size={16} color="#0A0B0A" />
            <Txt variant="callout" style={{ color: '#0A0B0A' }}>
              {blending ? 'Mixing…' : 'Mix our taste'}
            </Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!friend.repeats.length}
            onPress={() =>
              playerStore.playQueue(
                friend.repeats.map((entry) => entry.track),
                { context: 'recommendation', contextLabel: `${friend.name.split(' ')[0]} on repeat` },
              )
            }
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="play" size={15} color={colors.text} />
            <Txt variant="callout">Play their repeats</Txt>
          </Pressable>
        </View>

        {!!(match.sharedArtists.length || match.sharedGenres.length) && (
          <View style={[styles.shared, { marginHorizontal: gutter }]}>
            <Ionicons name="sparkles" size={16} color={colors.accent} />
            <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
              In common: {[...match.sharedArtists, ...match.sharedGenres].slice(0, 4).join(', ')}
            </Txt>
          </View>
        )}

        <Txt variant="title3" style={{ paddingHorizontal: gutter, marginTop: spacing.xxl, marginBottom: spacing.md }}>
          On repeat
        </Txt>
        <View style={[styles.grid, { paddingHorizontal: gutter }]}>
          {friend.repeats.map((entry, index) => {
            const color = cardColor(entry.track.id);
            return (
              <Pressable
                key={entry.track.id}
                accessibilityRole="button"
                accessibilityLabel={`${entry.track.title}, ${entry.plays} plays`}
                onPress={() =>
                  playerStore.playQueue(
                    friend.repeats.map((row) => row.track),
                    { startIndex: index, context: 'recommendation', contextLabel: `${friend.name.split(' ')[0]} on repeat` },
                  )
                }
                style={({ pressed }) => [
                  styles.repeatCard,
                  { width: cardWidth, backgroundColor: color, shadowColor: color },
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
              >
                <LinearGradient
                  colors={['rgba(255,255,255,0.12)', 'rgba(0,0,0,0.25)']}
                  style={[StyleSheet.absoluteFill, { borderRadius: radii.md }]}
                />
                <Txt variant="title2" style={{ color: '#fff' }}>
                  {entry.plays}×
                </Txt>
                <View style={{ maxWidth: cardWidth - 70 }}>
                  <Txt variant="callout" numberOfLines={2} style={{ color: '#fff' }}>
                    {entry.track.title}
                  </Txt>
                  <Txt variant="caption" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.8)' }}>
                    {entry.track.artistName}
                  </Txt>
                </View>
                <View style={styles.repeatArt}>
                  <Artwork uri={musicProvider().getArtwork(entry.track.artworkUrl, 200)} size={64} radius={radii.xs} />
                </View>
              </Pressable>
            );
          })}
        </View>

        <Txt variant="title3" style={{ paddingHorizontal: gutter, marginTop: spacing.xxl, marginBottom: spacing.md }}>
          Top artists
        </Txt>
        <View style={[styles.chips, { paddingHorizontal: gutter }]}>
          {friend.topArtists.map((artist) => {
            const shared = match.sharedArtists.includes(artist);
            return (
              <Pressable
                key={artist}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/discover', params: { q: artist } })}
                style={[styles.chip, shared && { borderColor: colors.accent, backgroundColor: colors.accentGlow }]}
              >
                <Txt variant="callout">{artist}</Txt>
                {shared && <Ionicons name="checkmark" size={13} color={colors.accent} />}
              </Pressable>
            );
          })}
        </View>
        <Txt variant="caption" tone="faint" style={{ paddingHorizontal: gutter, marginTop: spacing.xl }}>
          {pluralize(friend.repeats.length, 'song')} shown. This is a demo friend — the songs are real, the person and
          play counts are sample data.
        </Txt>
      </ScrollView>

      {viewing && <StoryViewer friends={[friend]} startIndex={0} onClose={() => setViewing(false)} />}
    </Screen>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Txt variant="title3" tone={accent ? 'accent' : 'default'}>
        {value}
      </Txt>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    top: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg, marginTop: spacing.sm },
    stats: { flex: 1, flexDirection: 'row', paddingBottom: spacing.lg },
    buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    primary: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 40,
      borderRadius: radii.sm,
      backgroundColor: palette.lime,
    },
    secondary: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 40,
      borderRadius: radii.sm,
      backgroundColor: colors.card,
    },
    shared: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.card,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    repeatCard: {
      height: 128,
      borderRadius: radii.md,
      padding: spacing.md,
      justifyContent: 'space-between',
      overflow: 'hidden',
      ...noteCardShadow,
    },
    repeatArt: {
      position: 'absolute',
      right: -8,
      bottom: -6,
      transform: [{ rotate: '16deg' }],
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
  });
