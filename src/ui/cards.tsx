import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Artwork } from '@/src/ui/artwork';
import { DownloadButton } from '@/src/ui/download-button';
import { Txt } from '@/src/ui/text';
import { colors, radii, spacing } from '@/src/theme/tokens';
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
}: {
  title: string;
  subtitle?: string | null;
  artworkUrl: string | null | undefined;
  width: number;
  onPress: () => void;
  rounded?: boolean;
  badge?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.75 }]}
    >
      <View>
        <Artwork uri={artworkUrl} size={width} rounded={rounded} radius={radii.md} />
        {badge && (
          <View style={styles.badge}>
            <Txt variant="micro" tone="onAccent">
              {badge}
            </Txt>
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
  return (
    <View style={{ width }}>
      <ArtCard
        title={track.title}
        subtitle={track.artistName}
        artworkUrl={track.artworkUrl}
        width={width}
        onPress={onPress}
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${mood.name}: ${mood.tagline}`}
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
    >
      <LinearGradient
        colors={[mood.accent, shade(mood.accent, -0.55)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.mood, { width, height: height ?? width * 0.72 }]}
      >
        <View style={styles.moodPulse} />
        <Txt variant="title3" style={{ color: '#fff' }}>
          {mood.name}
        </Txt>
        <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.82)' }}>
          {mood.tagline}
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

const styles = StyleSheet.create({
  cardDownload: { position: 'absolute', right: 8 },
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
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  moodPulse: {
    position: 'absolute',
    right: -30,
    top: -30,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(255,255,255,0.14)',
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
