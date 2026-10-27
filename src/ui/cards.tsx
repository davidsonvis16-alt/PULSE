import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Artwork } from '@/src/ui/artwork';
import { DownloadButton } from '@/src/ui/download-button';
import { likesStore } from '@/src/ui/likes';
import { useDoubleTapLike } from '@/src/ui/use-double-tap-like';
import { useStore } from '@/src/hooks/use-store';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';
import { formatEventDate, formatPriceRange } from '@/src/core/format';
import type { Album, Artist, Mood, MusicEvent, Track } from '@/src/core/types';

/** Square artwork card used in every horizontal shelf. */
export const ArtCard = memo(function ArtCard({
  title,
  subtitle,
  artworkUrl,
  width,
  onPress,
  rounded,
  badge,
  liked,
}: {
  title: string;
  subtitle?: string | null;
  artworkUrl: string | null | undefined;
  width: number;
  onPress: () => void;
  rounded?: boolean;
  badge?: string;
  liked?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        { width },
        // With a mouse, the art rises to meet the pointer.
        hovered && { transform: [{ translateY: -4 }] },
        pressed && { opacity: 0.75 },
      ]}
    >
      <View style={styles.artLift}>
        <Artwork uri={artworkUrl} size={width} rounded={rounded} radius={radii.md} />
        {badge && (
          <View style={styles.badge}>
            <Txt variant="micro" tone="onAccent">
              {badge}
            </Txt>
          </View>
        )}
        {liked && (
          <View style={styles.liked}>
            <Ionicons name="heart" size={13} color={colors.accent} />
          </View>
        )}
      </View>
      <Txt
        variant="callout"
        numberOfLines={1}
        align={rounded ? 'center' : undefined}
        style={{ marginTop: 10 }}
      >
        {title}
      </Txt>
      {subtitle ? (
        <Txt
          variant="caption"
          tone="muted"
          numberOfLines={1}
          align={rounded ? 'center' : undefined}
          style={{ marginTop: 2 }}
        >
          {subtitle}
        </Txt>
      ) : null}
    </Pressable>
  );
});

export function TrackCard({
  track,
  width,
  onPress,
  downloadable,
}: {
  track: Track;
  width: number;
  onPress: () => void;
  /** Recommendations carry a keep button so a find can be taken offline here. */
  downloadable?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const likeOnDoubleTap = useDoubleTapLike();
  const likes = useStore(likesStore);
  return (
    <View style={{ width }}>
      <ArtCard
        title={track.title}
        subtitle={track.artistName}
        artworkUrl={track.artworkUrl}
        width={width}
        liked={likes.ids.has(track.id)}
        onPress={() => {
          // Second tap of a double tap likes it rather than restarting it.
          if (likeOnDoubleTap(track)) return;
          onPress();
        }}
      />
      {downloadable && (
        <View style={[styles.cardDownload, { top: width - 42 }]}>
          <DownloadButton track={track} size={34} onSurface />
        </View>
      )}
    </View>
  );
}

export function AlbumCard({
  album,
  width,
  onPress,
}: {
  album: Album;
  width: number;
  onPress: () => void;
}) {
  const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : null;
  return (
    <ArtCard
      title={album.title}
      subtitle={[album.artistName, year].filter(Boolean).join(' · ')}
      artworkUrl={album.artworkUrl}
      width={width}
      onPress={onPress}
    />
  );
}

export function ArtistCard({
  artist,
  width,
  onPress,
  detail,
}: {
  artist: Artist;
  width: number;
  onPress: () => void;
  detail?: string;
}) {
  return (
    <ArtCard
      title={artist.name}
      subtitle={detail ?? artist.genre}
      artworkUrl={artist.imageUrl}
      width={width}
      onPress={onPress}
      rounded
    />
  );
}

/** Mood tile: artwork-free by design, carrying its own colour wash. */
export function MoodCard({
  mood,
  width,
  height,
  onPress,
}: {
  mood: Mood;
  width: number;
  height?: number;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${mood.name}: ${mood.tagline}`}
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
    >
      {/* A poster, not a tile: the tagline up top, the mood's name set big at the foot. */}
      <LinearGradient
        colors={[mood.accent, shade(mood.accent, -0.35)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.4, y: 1 }}
        style={[styles.mood, { width, height: height ?? width * 0.72 }]}
      >
        <View style={styles.moodPulse} />
        <Txt variant="micro" uppercase numberOfLines={2} style={{ color: 'rgba(255,255,255,0.86)' }}>
          {mood.tagline}
        </Txt>
        <Txt
          variant={width >= 160 ? 'display' : 'title1'}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ color: '#fff' }}
        >
          {mood.name}
        </Txt>
      </LinearGradient>
    </Pressable>
  );
}

export function EventCard({
  event,
  onPress,
  onTickets,
  width,
}: {
  event: MusicEvent;
  onPress: () => void;
  onTickets?: () => void;
  width?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const where = [event.venueName, event.city].filter(Boolean).join(' · ');
  const price = event.ticket
    ? formatPriceRange(event.ticket.priceMin, event.ticket.priceMax, event.ticket.currency)
    : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.name}, ${formatEventDate(event.startsAt)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.event, width ? { width } : null, pressed && { opacity: 0.85 }]}
    >
      <Artwork uri={event.imageUrl} size={74} radius={radii.sm} />
      <View style={styles.eventBody}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {event.name}
        </Txt>
        <Txt variant="caption" tone="secondary" numberOfLines={1}>
          {formatEventDate(event.startsAt)}
          {event.localTimeLabel ? ` · ${event.localTimeLabel}` : ''}
        </Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {where || 'Venue to be announced'}
        </Txt>
        {(price || event.distanceKm != null) && (
          <Txt variant="caption" tone="faint" numberOfLines={1}>
            {[price, event.distanceKm != null ? `${Math.round(event.distanceKm)} km away` : null]
              .filter(Boolean)
              .join(' · ')}
          </Txt>
        )}
      </View>
      {event.ticket && onTickets && (
        <Pressable
          onPress={onTickets}
          accessibilityRole="link"
          accessibilityLabel={`Get tickets from ${event.ticket.sellerName}`}
          style={({ pressed }) => [styles.tickets, pressed && { opacity: 0.8 }]}
        >
          <Txt variant="micro" tone="onAccent">
            TICKETS
          </Txt>
        </Pressable>
      )}
    </Pressable>
  );
}

export function StatTile({
  value,
  label,
  icon,
  flex = 1,
}: {
  value: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  flex?: number;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.stat, { flex }]}>
      {icon && <Ionicons name={icon} size={15} color={colors.accent} />}
      <Txt variant="title2" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Txt>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
    </View>
  );
}

/** Lightens or darkens a hex colour; used for the mood gradients. */
function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, '$1$1') : value, 16);
  const channels = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map((c) => {
    const next = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.max(0, Math.min(255, Math.round(next)));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    cardDownload: { position: 'absolute', right: 8 },
    liked: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.scrim,
    },
    badge: {
      position: 'absolute',
      top: 8,
      left: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
    },
    mood: {
      borderRadius: radii.lg,
      padding: spacing.lg,
      justifyContent: 'space-between',
      overflow: 'hidden',
    },
    moodPulse: {
      position: 'absolute',
      right: -40,
      bottom: -40,
      width: 150,
      height: 150,
      borderRadius: 75,
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    artLift: {
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
    },
    event: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
    eventBody: { flex: 1, gap: 3 },
    tickets: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
    },
    stat: {
      gap: 4,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
  });
