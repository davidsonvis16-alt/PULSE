import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { formatListeningTime, pluralize } from '@/src/core/format';
import { listGrooves, type Groove } from '@/src/db/repos/grooves';
import { getLocalCounts } from '@/src/db/repos/local';
import { rebuildGrooves } from '@/src/grooves/engine';
import { useAsync } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { EmptyState, ErrorState, SkeletonShelf } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * The Groove index.
 *
 * Grooves are not genres and not playlists the user made — they are the shape
 * Pulse found in their collection. So this screen leads with what each Groove
 * actually contains rather than a category name.
 */
export function GroovesList({ embedded }: { embedded?: boolean } = {}) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { gutter, pageWidth: width, isTabletUp } = useResponsive();
  const toast = useToast();

  const state = useAsync(async () => {
    const [grooves, counts] = await Promise.all([listGrooves(), getLocalCounts()]);
    return { grooves, counts };
  }, []);

  useFocusReload(state.reload);

  const columns = isTabletUp ? 3 : 2;
  const padding = embedded ? 0 : gutter;
  const cardWidth = (width - padding * 2 - spacing.md * (columns - 1)) / columns;

  if (state.loading && !state.data) {
    return (
      <View style={{ paddingHorizontal: padding }}>
        <SkeletonShelf cardWidth={cardWidth} count={2} />
      </View>
    );
  }
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;

  const grooves = state.data?.grooves ?? [];
  const counts = state.data?.counts;

  if (grooves.length === 0) {
    return (
      <EmptyState
        icon="color-wand-outline"
        title={counts?.tracks ? 'Not enough music to find a pattern yet' : 'Import your music first'}
        message={
          counts?.tracks
            ? 'Pulse builds Grooves once there is enough in your library to cluster. Add more music and it will try again.'
            : 'Grooves come from the music on your device. Import it and Pulse will group it for you.'
        }
        actionLabel={counts?.tracks ? 'Add music' : 'Import my music'}
        onAction={() => router.push('/import')}
        compact={embedded}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: padding, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
      scrollEnabled={!embedded}
    >
      <View style={styles.grid}>
        {grooves.map((groove) => (
          <GrooveCard
            key={groove.id}
            groove={groove}
            width={cardWidth}
            onPress={() => router.push(`/groove/${groove.id}`)}
          />
        ))}
      </View>

      <Button
        label="Rebuild Grooves"
        variant="secondary"
        icon="refresh"
        style={{ alignSelf: 'flex-start', marginTop: spacing.xl }}
        onPress={async () => {
          const drafts = await rebuildGrooves();
          toast(`Rebuilt ${pluralize(drafts.length, 'Groove')} from your library`, 'success');
          state.reload();
        }}
      />
    </ScrollView>
  );
}

export function GrooveCard({
  groove,
  width,
  onPress,
}: {
  groove: Groove;
  width: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const accent = groove.accent ?? colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${groove.name}, ${pluralize(groove.trackCount, 'song')}`}
      onPress={onPress}
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.card, { height: width * 0.82 }]}>
        {groove.coverArtworkUrl ? (
          <Artwork uri={groove.coverArtworkUrl} size={width} radius={radii.lg} dim />
        ) : null}
        <LinearGradient
          colors={[`${accent}22`, `${accent}88`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.cardBody}>
          <View style={[styles.pill, { backgroundColor: accent }]}>
            <Txt variant="micro" style={{ color: '#0B0C0E' }}>
              GROOVE
            </Txt>
          </View>
          <View style={{ flex: 1 }} />
          <Txt variant="title3" numberOfLines={2}>
            {groove.name}
          </Txt>
          <Txt variant="caption" tone="secondary">
            {pluralize(groove.trackCount, 'song')}
            {groove.durationMs > 0 ? ` · ${formatListeningTime(groove.durationMs)}` : ''}
          </Txt>
        </View>
      </View>
    </Pressable>
  );
}

/** A compact rail of Grooves for the Home screen. */
export function GrooveRail({
  grooves,
  cardWidth,
  onOpen,
}: {
  grooves: Groove[];
  cardWidth: number;
  onOpen: (groove: Groove) => void;
}) {
  return (
    <>
      {grooves.map((groove) => (
        <GrooveCard
          key={groove.id}
          groove={groove}
          width={cardWidth}
          onPress={() => onOpen(groove)}
        />
      ))}
    </>
  );
}

/** Small inline badge used on the track page to show a song's Grooves. */
export function GrooveChip({ groove, onPress }: { groove: Groove; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}
    >
      <View style={[styles.chipDot, { backgroundColor: groove.accent ?? colors.accent }]} />
      <Txt variant="caption">{groove.name}</Txt>
      <Ionicons name="chevron-forward" size={11} color={colors.textFaint} />
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    card: {
      borderRadius: radii.lg,
      overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
    cardBody: { flex: 1, padding: spacing.md, gap: 2 },
    pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipDot: { width: 7, height: 7, borderRadius: 4 },
  });
