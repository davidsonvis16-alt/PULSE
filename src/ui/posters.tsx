import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { formatRelativeTime } from '@/src/core/format';
import { isJustIn } from '@/src/news/live';
import { musicProvider } from '@/src/providers/music';
import type { FreshRelease } from '@/src/news/fresh';
import { posterWords } from '@/src/news/fresh';
import type { Story } from '@/src/news/headlines';
import type { NewsTopic } from '@/src/news/rss';
import { daysUntil, statusOf, type AwardEdition, type AwardStatus } from '@/src/news/awards';
import { Txt } from '@/src/ui/text';
import { palette, radii, spacing } from '@/src/theme/tokens';
import { useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Posters.
 *
 * News and new music are set as posters rather than list rows: the picture
 * fills the frame, a heavy headline sits over a dark fade, and a small kicker
 * says what kind of thing it is. Text on a poster is always white on that
 * fade, so posters read the same in light and dark mode.
 */

const INK = '#FFFFFF';
const INK_SOFT = 'rgba(255,255,255,0.78)';
const FADE = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.88)'] as const;

export const TOPIC_LABELS: Record<NewsTopic, string> = {
  'new-music': 'New music',
  awards: 'Awards',
  tours: 'Tours & live',
  charts: 'Charts',
  memoriam: 'In memory',
  news: 'News',
};

/** Topic colours for kickers and the picture-less fallback. */
const TOPIC_TINT: Record<NewsTopic, [string, string]> = {
  'new-music': ['#C9F62B', '#1D2A05'],
  awards: ['#E6BE5A', '#2A1F07'],
  tours: ['#FF7A59', '#2B0F07'],
  charts: ['#63B3ED', '#08192A'],
  memoriam: ['#B9B9BF', '#18181B'],
  news: ['#B08CFF', '#170F2B'],
};

function Kicker({ label, color, dark }: { label: string; color: string; dark?: boolean }) {
  return (
    <View style={[posterStyles.kicker, { backgroundColor: color }]}>
      <Txt variant="micro" style={{ color: dark ? '#0A0B0A' : INK }}>
        {label}
      </Txt>
    </View>
  );
}

/** A tall poster for a new release: cover, "New single", title, and why it is here. */
export function ReleasePoster({
  release,
  width,
  onPress,
}: {
  release: FreshRelease;
  width: number;
  onPress: () => void;
}) {
  const { album } = release;
  const words = posterWords(release);
  const height = Math.round(width * 1.32);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${words.kicker.toLowerCase()}: ${album.title} by ${album.artistName}. ${words.when}`}
      style={({ pressed }) => [posterStyles.frame, { width, height }, pressed && { opacity: 0.85 }]}
    >
      <Image
        source={musicProvider().getArtwork(album.artworkUrl, 600) ?? album.artworkUrl ?? undefined}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={200}
      />
      <LinearGradient colors={FADE} locations={[0.3, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={posterStyles.top}>
        <Kicker label={words.kicker} color={palette.terracotta} />
        {/* New music has a shelf life. This says when a record is near the end
            of its run on the rail rather than letting it vanish unannounced. */}
        {release.leavingSoon && <Kicker label="Last days" color="rgba(10,11,10,0.66)" />}
      </View>
      <View style={posterStyles.bottom}>
        <Txt variant="micro" style={{ color: '#C9F62B' }} numberOfLines={1}>
          {words.when.toUpperCase()}
        </Txt>
        <Txt style={posterStyles.releaseTitle} numberOfLines={2}>
          {album.title}
        </Txt>
        <Txt variant="callout" style={{ color: INK }} numberOfLines={1}>
          {album.artistName}
        </Txt>
        <Txt variant="caption" style={{ color: INK_SOFT }} numberOfLines={1}>
          {[words.why, album.genre].filter(Boolean).join(' · ')}
        </Txt>
      </View>
    </Pressable>
  );
}

function StoryMeta({ story }: { story: Story }) {
  const others = story.sources.length - 1;
  return (
    <Txt variant="caption" style={{ color: INK_SOFT }} numberOfLines={1}>
      {story.source}
      {others > 0 ? ` + ${others} more` : ''}
      {story.publishedAt ? ` · ${formatRelativeTime(story.publishedAt)}` : ''}
    </Txt>
  );
}

/** The lead story, full width. */
export function HeadlinePoster({
  story,
  width,
  onPress,
}: {
  story: Story;
  width: number;
  onPress: () => void;
}) {
  const tint = TOPIC_TINT[story.topic];
  const height = Math.round(Math.min(width * 1.05, 460));
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${story.title}. ${story.source}`}
      style={({ pressed }) => [posterStyles.frame, { width, height }, pressed && { opacity: 0.9 }]}
    >
      {story.imageUrl ? (
        <Image source={story.imageUrl} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        <LinearGradient colors={[tint[0], tint[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient colors={FADE} locations={[0.25, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <View style={posterStyles.top}>
        <Kicker label={TOPIC_LABELS[story.topic]} color={tint[0]} dark />
        {isJustIn(story.publishedAt) && <Kicker label="Just in" color="#FF4D4D" />}
        {story.sources.length > 2 && (
          <View style={posterStyles.glass}>
            <Ionicons name="flame" size={12} color={INK} />
            <Txt variant="micro" style={{ color: INK }}>
              {'EVERYONE’S COVERING IT'}
            </Txt>
          </View>
        )}
      </View>
      <View style={posterStyles.bottom}>
        {story.mentions.length > 0 && (
          <Txt variant="micro" style={{ color: '#C9F62B' }} numberOfLines={1}>
            {`ABOUT ${story.mentions.join(', ').toUpperCase()}`}
          </Txt>
        )}
        <Txt style={posterStyles.leadTitle} numberOfLines={4}>
          {story.title}
        </Txt>
        {!!story.summary && (
          <Txt variant="callout" style={{ color: INK_SOFT, fontWeight: '500' }} numberOfLines={2}>
            {story.summary}
          </Txt>
        )}
        <StoryMeta story={story} />
      </View>
    </Pressable>
  );
}

/** A compact story card for the running list. */
export function StoryRow({ story, onPress }: { story: Story; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const tint = TOPIC_TINT[story.topic];
  const others = story.sources.length - 1;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${story.title}. ${story.source}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={[styles.dot, { backgroundColor: isJustIn(story.publishedAt) ? '#FF4D4D' : tint[0] }]} />
          <Txt variant="micro" tone="muted" numberOfLines={1}>
            {isJustIn(story.publishedAt) ? 'JUST IN · ' : ''}
            {TOPIC_LABELS[story.topic].toUpperCase()}
            {story.mentions.length ? ` · ${story.mentions[0].toUpperCase()}` : ''}
          </Txt>
        </View>
        <Txt variant="bodyStrong" numberOfLines={3}>
          {story.title}
        </Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {story.source}
          {others > 0 ? ` + ${others} more` : ''}
          {story.publishedAt ? ` · ${formatRelativeTime(story.publishedAt)}` : ''}
        </Txt>
      </View>
      {story.imageUrl ? (
        <Image source={story.imageUrl} style={styles.thumb} contentFit="cover" transition={150} />
      ) : (
        <LinearGradient colors={[tint[0], tint[1]]} style={styles.thumb}>
          <Ionicons name="newspaper-outline" size={22} color={INK} />
        </LinearGradient>
      )}
    </Pressable>
  );
}

export const STATUS_LABELS: Record<AwardStatus, string> = {
  today: 'Tonight',
  nominees: 'Nominees out',
  'awaiting-winners': 'Winners coming in',
  winners: 'Winners announced',
  upcoming: 'Coming up',
};

export function awardWhen(edition: AwardEdition): string {
  const days = daysUntil(edition.info.date);
  if (days === null) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `In ${days} days`;
  if (days === -1) return 'Yesterday';
  return `${-days} days ago`;
}

export function formatAwardDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** An award ceremony as a poster: the show, its status, the date, and your stake in it. */
export function AwardPoster({
  edition,
  width,
  yourNominees,
  onPress,
}: {
  edition: AwardEdition;
  width: number;
  /** How many of the listener's artists are nominated. */
  yourNominees: number;
  onPress: () => void;
}) {
  const status = statusOf(edition);
  const [light, dark] = edition.tint;
  const height = Math.round(width * 1.25);
  const live = status === 'today' || status === 'awaiting-winners';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${edition.title}. ${STATUS_LABELS[status]}. ${formatAwardDate(edition.info.date)}`}
      style={({ pressed }) => [posterStyles.frame, { width, height }, pressed && { opacity: 0.85 }]}
    >
      <LinearGradient colors={[light, dark, '#050505']} locations={[0, 0.62, 1]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <Ionicons name="trophy" size={width * 0.62} color="rgba(255,255,255,0.10)" style={posterStyles.trophy} />
      <View style={posterStyles.top}>
        <Kicker label={STATUS_LABELS[status]} color={live ? '#FF4D4D' : 'rgba(0,0,0,0.45)'} />
      </View>
      <View style={posterStyles.bottom}>
        <Txt variant="micro" style={{ color: INK_SOFT }}>
          {String(edition.year)}
        </Txt>
        <Txt style={posterStyles.awardName} numberOfLines={2} adjustsFontSizeToFit>
          {edition.shortName}
        </Txt>
        <Txt variant="callout" style={{ color: INK }} numberOfLines={1}>
          {[formatAwardDate(edition.info.date), awardWhen(edition)].filter(Boolean).join(' · ')}
        </Txt>
        <Txt variant="caption" style={{ color: yourNominees ? '#C9F62B' : INK_SOFT }} numberOfLines={2}>
          {yourNominees
            ? `${yourNominees} of your artists ${yourNominees === 1 ? 'is' : 'are'} in the running`
            : edition.categories.length
              ? edition.info.mostNominations
                ? `Most nominated: ${edition.info.mostNominations}`
                : `${edition.categories.length} categories`
              : 'Nominees not announced yet'}
        </Txt>
      </View>
    </Pressable>
  );
}

const posterStyles = StyleSheet.create({
  frame: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: '#111113',
    justifyContent: 'space-between',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    padding: spacing.md,
  },
  bottom: { padding: spacing.lg, gap: 4 },
  kicker: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.xs,
  },
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  releaseTitle: {
    color: INK,
    fontSize: 24,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  leadTitle: {
    color: INK,
    fontSize: 27,
    lineHeight: 31,
    fontWeight: '900',
    letterSpacing: -0.7,
  },
  awardName: {
    color: INK,
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: -1,
  },
  trophy: { position: 'absolute', right: -18, top: '18%' },
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    dot: { width: 7, height: 7, borderRadius: 4 },
    thumb: {
      width: 92,
      height: 92,
      borderRadius: radii.md,
      backgroundColor: colors.cardHigh,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
  });
