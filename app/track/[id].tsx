import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import type { Artist, Track } from '@/src/core/types';
import { formatDuration, formatReleaseDate } from '@/src/core/format';
import { providerFor, musicProvider } from '@/src/providers/music';
import { getSimilarTracks } from '@/src/discovery/engine';
import { getCachedTrack, upsertTrack } from '@/src/db/repos/catalog';
import { getLocalTrack, type LocalTrackRecord } from '@/src/db/repos/local';
import { groovesForTrack, type Groove } from '@/src/db/repos/grooves';
import { GrooveChip } from '@/src/screens/grooves';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useSavedState } from '@/src/hooks/use-library-state';
import { useTrackActions } from '@/src/ui/track-actions';
import { useShareSheet } from '@/src/ui/share-sheet';
import { useToast } from '@/src/ui/toast';
import { trackShare } from '@/src/share/share';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { IconButton, PlayButton } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { SectionHeader, Shelf } from '@/src/ui/section';
import { ArtistCard } from '@/src/ui/cards';
import { ErrorState, Skeleton, SkeletonRows } from '@/src/ui/states';
import { colors, radii, spacing } from '@/src/theme/tokens';

interface TrackPageData {
  track: Track;
  related: Track[];
  similarArtists: Artist[];
  /** Present when this is a file on the device rather than a catalogue entry. */
  local: LocalTrackRecord | null;
  grooves: Groove[];
}

/** The song page: everything the source knows about one recording. */
export default function TrackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { gutter, width, isTabletUp, shelfCardWidth } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const share = useShareSheet();
  const toast = useToast();
  const downloads = useStore(downloadManager);
  const player = useStore(playerStore);

  const state = useAsync<TrackPageData>(async () => {
    const trackId = decodeURIComponent(id ?? '');
    const provider = providerFor(trackId.split(':')[0]);
    const fetched = (await provider.getTrack(trackId)) ?? (await getCachedTrack(trackId));
    if (!fetched) throw new Error('That song is no longer available from this source.');
    await upsertTrack(fetched);

    const [related, similarArtists, local, grooves] = await Promise.all([
      getSimilarTracks(fetched, 12).catch(() => [] as Track[]),
      fetched.artistId && fetched.provider !== 'local'
        ? musicProvider().getRelatedArtists(fetched.artistId, 10).catch(() => [] as Artist[])
        : Promise.resolve([] as Artist[]),
      getLocalTrack(trackId),
      groovesForTrack(trackId),
    ]);
    return { track: fetched, related, similarArtists, local, grooves };
  }, [id]);

  const track = state.data?.track;
  const saved = useSavedState('track', track?.id ?? null);

  const artSize = Math.min(width - gutter * 2, isTabletUp ? 320 : 260);
  const record = track ? downloads.byTrackId[track.id] : undefined;
  const downloaded = record?.status === 'completed';
  const downloading = record?.status === 'downloading' || record?.status === 'queued';
  const isCurrent = player.current?.id === track?.id;
  const canDownload = track ? providerFor(track.provider).capabilities.download : false;

  if (state.error) {
    return (
      <Screen>
        <PageHeader />
        <ErrorState error={state.error} onRetry={state.reload} />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader transparent />
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: gutter, alignItems: 'center' }}>
          {state.loading && !track ? (
            <Skeleton width={artSize} height={artSize} radius={radii.xl} />
          ) : (
            <Artwork uri={track!.artworkUrl} size={artSize} radius={radii.xl} />
          )}
        </View>

        {track && (
          <>
            <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl, gap: 4 }}>
              <Txt variant="title1">{track.title}</Txt>
              <Txt
                variant="body"
                tone="secondary"
                onPress={() =>
                  track.artistId && router.push(`/artist/${encodeURIComponent(track.artistId)}`)
                }
              >
                {track.artistName}
              </Txt>
              <Txt variant="caption" tone="muted">
                {[
                  track.albumTitle,
                  track.releaseDate ? new Date(track.releaseDate).getFullYear() : null,
                  track.genre,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
              <Txt variant="caption" tone="faint">
                {formatDuration(track.durationMs)}
              </Txt>
            </View>

            {/* Primary actions */}
            <View style={[styles.actions, { paddingHorizontal: gutter }]}>
              <PlayButton
                playing={isCurrent && player.isPlaying}
                loading={isCurrent && player.isLoading}
                size={56}
                onPress={() => {
                  if (isCurrent) playerStore.toggle();
                  else
                    void playerStore.playTrack(track, {
                      queue: [track, ...(state.data?.related ?? [])],
                      context: 'search',
                      contextLabel: track.albumTitle ?? track.artistName,
                    });
                }}
              />
              <Action
                icon={downloaded ? 'checkmark-circle' : downloading ? 'time-outline' : 'arrow-down-circle-outline'}
                label={downloaded ? 'Downloaded' : downloading ? 'Downloading' : 'Download'}
                active={downloaded}
                hidden={!canDownload}
                onPress={() => {
                  if (downloaded) {
                    toast('Already in your downloads');
                    return;
                  }
                  void actions.download(track);
                }}
              />
              <Action
                icon={saved.saved ? 'checkmark-circle' : 'add-circle-outline'}
                label={saved.saved ? 'Added' : 'Add'}
                active={saved.saved}
                onPress={async () => {
                  const added = await saved.toggleSaved(track);
                  toast(added ? 'Added to your library' : 'Removed from your library');
                }}
              />
              <Action
                icon={saved.liked ? 'heart' : 'heart-outline'}
                label="Like"
                active={saved.liked}
                onPress={async () => {
                  const next = await saved.toggleLiked(track);
                  toast(next ? 'Liked' : 'Removed from liked songs');
                }}
              />
              <Action
                icon="albums-outline"
                label="Playlist"
                onPress={() => actions.addToPlaylist([track])}
              />
              <Action icon="share-outline" label="Share" onPress={() => share(trackShare(track))} />
            </View>

            {/* Where this audio actually is */}
            <View style={[styles.availability, { marginHorizontal: gutter }]}>
              <Ionicons
                name={
                  state.data?.local
                    ? 'phone-portrait-outline'
                    : downloaded
                      ? 'arrow-down-circle'
                      : 'cloud-outline'
                }
                size={14}
                color={state.data?.local || downloaded ? colors.accent : colors.textMuted}
              />
              <Txt variant="caption" tone={state.data?.local || downloaded ? 'accent' : 'muted'}>
                {state.data?.local
                  ? `On this device · ${state.data.local.container?.toUpperCase() ?? 'audio'}${
                      state.data.local.bitrate
                        ? ` · ${Math.round(state.data.local.bitrate / 1000)} kbps`
                        : ''
                    }`
                  : downloaded
                    ? 'Downloaded · plays offline'
                    : 'Streaming from the source'}
              </Txt>
            </View>

            {/* Grooves this track belongs to */}
            {!!state.data?.grooves.length && (
              <View style={{ paddingHorizontal: gutter, marginTop: spacing.lg }}>
                <Txt variant="micro" tone="muted" uppercase style={{ marginBottom: spacing.sm }}>
                  In your Grooves
                </Txt>
                <View style={styles.grooveRow}>
                  {state.data.grooves.map((groove) => (
                    <GrooveChip
                      key={groove.id}
                      groove={groove}
                      onPress={() => router.push(`/groove/${groove.id}`)}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* About */}
            <View style={{ paddingHorizontal: gutter, marginTop: spacing.xxl }}>
              <SectionHeader title="About this song" />
              <View style={styles.about}>
                <Fact label="Release date" value={formatReleaseDate(track.releaseDate) || 'Not published'} />
                <Fact label="Genre" value={track.genre ?? 'Not published'} />
                <Fact label="Album" value={track.albumTitle ?? 'Single'} />
                <Fact label="Length" value={formatDuration(track.durationMs)} />
                <Fact
                  label="Source"
                  value={
                    state.data?.local
                      ? `Your file · ${state.data.local.filename}`
                      : providerFor(track.provider).attribution
                  }
                />
                {state.data?.local?.identification === 'needs_identification' && (
                  <Fact
                    label="Identification"
                    value="Pulse is not sure about this one — tap to confirm"
                    onPress={() => router.push('/identify')}
                  />
                )}
                {track.externalUrl && (
                  <Fact
                    label="Official page"
                    value="Open on the source service"
                    onPress={() => void WebBrowser.openBrowserAsync(track.externalUrl!)}
                  />
                )}
              </View>
            </View>

            {/* Related */}
            <View style={{ marginTop: spacing.xxl }}>
              <SectionHeader title="Related songs" style={{ paddingHorizontal: gutter }} />
              {state.loading ? (
                <View style={{ paddingHorizontal: gutter }}>
                  <SkeletonRows count={4} />
                </View>
              ) : (
                <View style={{ paddingHorizontal: gutter }}>
                  {(state.data?.related ?? []).slice(0, 8).map((item, index) => (
                    <TrackRow
                      key={item.id}
                      track={item}
                      isDownloaded={downloads.byTrackId[item.id]?.status === 'completed'}
                      onPress={() =>
                        void playerStore.playQueue(state.data!.related, {
                          startIndex: index,
                          context: 'recommendation',
                          contextLabel: `More like ${track.title}`,
                        })
                      }
                      onMore={() => actions.openTrack(item, { queue: state.data?.related })}
                    />
                  ))}
                </View>
              )}
            </View>

            {/* Similar artists */}
            {!!state.data?.similarArtists.length && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader title="Similar artists" style={{ paddingHorizontal: gutter }} />
                <Shelf
                  data={state.data.similarArtists}
                  gutter={gutter}
                  keyExtractor={(artist) => artist.id}
                  renderItem={(artist) => (
                    <ArtistCard
                      artist={artist}
                      width={shelfCardWidth * 0.8}
                      onPress={() => router.push(`/artist/${encodeURIComponent(artist.id)}`)}
                    />
                  )}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Action({
  icon,
  label,
  onPress,
  active,
  hidden,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <IconButton
        name={icon}
        label={label}
        size={21}
        color={active ? colors.accent : colors.text}
        onPress={onPress}
      />
      <Txt variant="caption" tone={active ? 'accent' : 'muted'}>
        {label}
      </Txt>
    </View>
  );
}

function Fact({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <View style={styles.fact}>
      <Txt variant="caption" tone="muted" style={{ width: 108 }}>
        {label}
      </Txt>
      <Txt
        variant="callout"
        tone={onPress ? 'accent' : 'default'}
        style={{ flex: 1 }}
        onPress={onPress}
      >
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  about: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  availability: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
  },
  grooveRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
