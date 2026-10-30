import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/src/core/types';
import { pluralize } from '@/src/core/format';
import { musicProvider } from '@/src/providers/music';
import { config } from '@/src/core/config';
import {
  listTracksNeedingIdentification,
  keepAllUnidentifiedAsTheyAre,
  updateIdentification,
  type LocalTrack,
} from '@/src/db/repos/local';
import { applyMatch } from '@/src/ingestion/identify/apply';
import { identify } from '@/src/ingestion/identify/identifier';
import { cleanFilename } from '@/src/ingestion/identify/text';
import { rebuildGrooves } from '@/src/grooves/engine';
import { invalidateTasteProfile } from '@/src/discovery/taste';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { noteSongsNeedIdentifying } from '@/src/db/repos/notifications';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { Sheet } from '@/src/ui/sheet';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Tracks Pulse would not guess at.
 *
 * These are the files whose tags were poor and whose best catalogue match was
 * not convincing enough to apply. Rather than attach a probably-wrong artist
 * and cover, Pulse puts them here and asks. Confirming one applies the full
 * metadata and artwork; searching lets the user point at the right record.
 */
export default function IdentifyScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const toast = useToast();

  const [picking, setPicking] = useState<LocalTrack | null>(null);
  const [candidates, setCandidates] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const state = useAsync(() => listTracksNeedingIdentification(200), []);
  const tracks = state.data ?? [];

  const apply = useCallback(
    async (local: LocalTrack, match: Track) => {
      setBusyId(local.trackId);
      try {
        await applyMatch(local, match);
        invalidateTasteProfile();
        void rebuildGrooves();
        toast(`Matched to ${match.title} by ${match.artistName}`, 'success');
        state.reload();
      } finally {
        setBusyId(null);
        setPicking(null);
      }
    },
    [state, toast],
  );

  const openSearch = useCallback(async (local: LocalTrack) => {
    setPicking(local);
    setSearching(true);
    setCandidates([]);
    try {
      const query = local.track.title || cleanFilename(local.filename);
      const results = await musicProvider().searchTracks(query, {
        limit: 15,
        country: config.music.country,
      });
      setCandidates(results);
    } catch {
      setCandidates([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const retry = useCallback(
    async (local: LocalTrack) => {
      setBusyId(local.trackId);
      try {
        const result = await identify({
          filename: local.filename,
          tags: {
            container: local.container,
            mimeType: local.mimeType,
            title: local.track.title,
            artist: local.track.artistName,
            album: local.track.albumTitle ?? undefined,
          },
          durationMs: local.track.durationMs,
        });
        if (result.status === 'identified' && result.match) {
          await apply(local, result.match);
          return;
        }
        if (result.match) {
          setPicking(local);
          setCandidates([result.match]);
          return;
        }
        toast('Still nothing convincing. Try searching for it.', 'error');
      } finally {
        setBusyId(null);
      }
    },
    [apply, toast],
  );

  const keepAsIs = useCallback(
    async (local: LocalTrack) => {
      await updateIdentification(local.trackId, {
        identification: 'tagged',
        confidence: null,
      });
      toast('Left exactly as it is');
      state.reload();
    },
    [state, toast],
  );

  /** Empties the list: every waiting song keeps the details it already has. */
  const clearAll = useCallback(() => {
    const go = async () => {
      const cleared = await keepAllUnidentifiedAsTheyAre();
      await noteSongsNeedIdentifying(0).catch(() => {});
      toast(`${pluralize(cleared, 'song')} kept as they are`, 'success');
      state.reload();
    };
    const message = 'Every song here keeps the name and details it already has. You can still fix any song later from its page.';
    if (Platform.OS === 'web') {
      if (window.confirm(`Clear the list?\n\n${message}`)) void go();
      return;
    }
    Alert.alert('Clear the list?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void go() },
    ]);
  }, [state, toast]);

  return (
    <Screen>
      <PageHeader
        title="Needs identification"
        subtitle={tracks.length > 0 ? pluralize(tracks.length, 'track') : 'Nothing waiting'}
        right={
          tracks.length > 0 ? <Button label="Clear list" variant="secondary" size="sm" onPress={clearAll} /> : undefined
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
        ) : tracks.length === 0 ? (
          <EmptyState
            icon="checkmark-circle-outline"
            title="Everything is identified"
            message="Pulse knows what every track in your library is."
            actionLabel="Back to your library"
            onAction={() => router.push('/library')}
          />
        ) : (
          <>
            <Txt variant="caption" tone="muted" style={{ marginBottom: spacing.lg }}>
              Pulse could not be sure about these, so it left them alone rather than attaching the
              wrong artist or cover. Confirm a match and it will fill in the details and artwork.
            </Txt>

            {tracks.map((local) => (
              <View key={local.trackId} style={styles.row}>
                <Artwork uri={local.track.artworkUrl} size={52} radius={radii.sm} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {local.track.title}
                  </Txt>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {local.filename}
                  </Txt>
                  <View style={styles.badge}>
                    <Ionicons name="help-circle-outline" size={12} color={colors.warning} />
                    <Txt variant="caption" tone="muted">
                      {local.confidence
                        ? `Best guess was ${Math.round(local.confidence * 100)}% sure`
                        : 'No match found'}
                    </Txt>
                  </View>
                </View>

                <View style={{ gap: 6 }}>
                  <Button
                    label="Find"
                    size="sm"
                    loading={busyId === local.trackId}
                    onPress={() => void openSearch(local)}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void retry(local)}
                    hitSlop={6}
                  >
                    <Txt variant="caption" tone="muted" align="center">
                      Retry
                    </Txt>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Sheet
        visible={!!picking}
        onClose={() => setPicking(null)}
        title="Which one is it?"
        subtitle={picking?.filename}
      >
        {searching ? (
          <SkeletonRows count={4} />
        ) : candidates.length === 0 ? (
          <Txt variant="body" tone="muted" style={{ paddingVertical: spacing.lg }}>
            Nothing came back for that. The file keeps the details it already has.
          </Txt>
        ) : (
          candidates.map((candidate) => (
            <Pressable
              key={candidate.id}
              accessibilityRole="button"
              accessibilityLabel={`Match to ${candidate.title} by ${candidate.artistName}`}
              onPress={() => picking && void apply(picking, candidate)}
              style={({ pressed }) => [styles.candidate, pressed && { opacity: 0.7 }]}
            >
              <Artwork uri={candidate.artworkUrl} size={48} radius={radii.sm} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {candidate.title}
                </Txt>
                <Txt variant="caption" tone="muted" numberOfLines={1}>
                  {[candidate.artistName, candidate.albumTitle].filter(Boolean).join(' · ')}
                </Txt>
              </View>
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.accentInk} />
            </Pressable>
          ))
        )}

        {picking && (
          <Button
            label="None of these — keep it as it is"
            variant="secondary"
            full
            style={{ marginTop: spacing.lg }}
            onPress={() => {
              const local = picking;
              setPicking(null);
              void keepAsIs(local);
            }}
          />
        )}
      </Sheet>
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
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
    },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    candidate: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  });
