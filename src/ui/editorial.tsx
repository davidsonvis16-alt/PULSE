import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/src/core/types';
import { SketchArt } from '@/src/ui/sketch-art';
import { Txt } from '@/src/ui/text';
import { fonts, palette, radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * The editorial cards on Home: a cover drawn in pencil, its name set over it,
 * and a plain strip underneath saying what it is and playing it.
 */
export function EditorialCard({
  title,
  subtitle,
  kicker,
  artworkUrl,
  width,
  height,
  onOpen,
  onPlay,
}: {
  title: string;
  subtitle: string;
  kicker?: string;
  artworkUrl: string | null;
  width: number;
  height: number;
  onOpen: () => void;
  onPlay?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const big = width >= 300;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onOpen}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.card,
        { width, height },
        hovered && { transform: [{ translateY: -4 }] },
        pressed && { opacity: 0.92 },
      ]}
    >
      <View style={styles.art}>
        <SketchArt uri={artworkUrl} />
        {!!kicker && (
          <View style={styles.kicker}>
            <Txt variant="micro" style={{ color: '#FFFFFF' }}>
              {kicker}
            </Txt>
          </View>
        )}
        <Txt
          numberOfLines={2}
          style={[
            styles.marker,
            { fontSize: big ? 30 : 22, lineHeight: big ? 36 : 27 },
          ]}
        >
          {title}
        </Txt>
      </View>
      <View style={styles.strip}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {title}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Txt>
        </View>
        {onPlay ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Play ${title}`}
            onPress={(event) => {
              event.stopPropagation();
              onPlay();
            }}
            style={({ pressed }) => [styles.play, pressed && { transform: [{ scale: 0.94 }] }]}
          >
            <Ionicons name="play" size={17} color={colors.onAccent} style={{ marginLeft: 2 }} />
          </Pressable>
        ) : (
          <Ionicons name="arrow-forward" size={20} color={colors.accentInk} />
        )}
      </View>
    </Pressable>
  );
}

/** A song found for today: pencil cover, play on the cover, genre underneath. */
export function DiscoveryCard({
  track,
  width,
  onPlay,
  onMore,
}: {
  track: Track;
  width: number;
  onPlay: () => void;
  onMore: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${track.title} by ${track.artistName}`}
      onPress={onPlay}
      onLongPress={onMore}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        { width, gap: spacing.sm },
        hovered && { transform: [{ translateY: -4 }] },
        pressed && { opacity: 0.88 },
      ]}
    >
      <View style={[styles.cover, { width, height: width }]}>
        <SketchArt uri={track.artworkUrl} />
        <View style={styles.coverPlay}>
          <Ionicons name="play" size={15} color={colors.accent} style={{ marginLeft: 2 }} />
        </View>
      </View>
      <View>
        <Txt variant="callout" numberOfLines={1}>
          {track.title}
        </Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {track.artistName}
        </Txt>
      </View>
      {!!track.genre && (
        <View style={styles.chip}>
          <Txt variant="micro" tone="secondary" numberOfLines={1}>
            {track.genre}
          </Txt>
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderRadius: radii.xl,
      overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
    art: { flex: 1, overflow: 'hidden', padding: spacing.md, gap: spacing.sm },
    kicker: {
      alignSelf: 'flex-start',
      // Terracotta: warm, earthy, and nothing like a default UI badge.
      backgroundColor: palette.terracotta,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radii.xs,
    },
    marker: {
      fontFamily: fonts.display,
      letterSpacing: -0.4,
      color: '#FFFFFF',
      maxWidth: '85%',
      textShadowColor: 'rgba(0,0,0,0.55)',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 14,
    },
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      backgroundColor: colors.backgroundElevated,
    },
    play: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cover: { borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.cardRaised },
    coverPlay: {
      position: 'absolute',
      right: 10,
      bottom: 10,
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: '#0A0B0A',
      alignItems: 'center',
      justifyContent: 'center',
    },
    chip: {
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.pill,
      paddingHorizontal: 9,
      paddingVertical: 3,
      maxWidth: '100%',
    },
  });
