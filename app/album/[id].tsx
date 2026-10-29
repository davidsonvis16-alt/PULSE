import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { Album, Track } from '@/src/core/types';
import { formatDuration, formatReleaseDate, pluralize } from '@/src/core/format';
import { providerFor } from '@/src/providers/music';
import { upsertAlbum, upsertTracks } from '@/src/db/repos/catalog';
import { addAlbumToLibrary, isInLibrary, removeFromLibrary } from '@/src/db/repos/library';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { useShareSheet } from '@/src/ui/share-sheet';
import { useToast } from '@/src/ui/toast';
import { albumShare } from '@/src/share/share';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button, IconButton } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { ErrorState, ProgressBar, Skeleton, SkeletonRows } from '@/src/ui/states';
import { useEffect, useMemo, useState } from 'react';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/theme';

/** The album page, with a real tracklist and a whole-album download. */
export default function AlbumScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { gutter, pageWidth: width, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const share = useShareSheet();
  const toast = useToast();
  const downloads = useStore(downloadManager);
  const player = useStore(playerStore);
  const [saved, setSaved] = useState(false);

  const state = useAsync<{ album: Album; tracks: Track[] }>(async () => {
    const albumId = decodeURIComponent(id ?? '');
    const provider = providerFor(albumId.split(':')[0]);
    const album = await provider.getAlbum(albumId);
    if (!album) throw new Error('That album is not available from this source.');
    const tracks = await provider.getAlbumTracks(albumId, 60).catch(() => [] as Track[]);
    await upsertAlbum(album);
    await upsertTracks(tracks);
    return { album, tracks };
  }, [id]);

  const album = state.data?.album;
  const tracks = useMemo(() => state.data?.tracks ?? [], [state.data]);

  useEffect(() => {
    if (!album) return;
    let cancelled = false;
    void isInLibrary('album', album.id).then((value) => {
      if (!cancelled) setSaved(value);
    });
    return () => {
      cancelled = true;
    };
  }, [album]);

  const albumDownloads = tracks
    .map((t) => downloads.byTrackId[t.id])
    .filter((d): d is NonNullable<typeof d> => !!d);
  const completedCount = albumDownloads.filter((d) => d.status === 'completed').length;
  const inFlight = albumDownloads.filter((d) =>
    ['queued', 'preparing', 'downloading'].includes(d.status),
  );
  const albumProgress =
    tracks.length > 0 ? (completedCount + inFlight.reduce((sum, d) => sum + d.progress, 0)) / tracks.length : 0;
  const fullyDownloaded = tracks.length > 0 && completedCount === tracks.length;
  const canDownload = album ? providerFor(album.provider).capabilities.download : false;

  const totalMs = tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  const artSize = Math.min(width - gutter * 2, isTabletUp ? 300 : 240);

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
          {state.loading && !album ? (
            <Skeleton width={artSize} height={artSize} radius={radii.lg} />
          ) : (
            <Artwork uri={album!.artworkUrl} size={artSize} radius={radii.lg} />
          )}
        </View>

        {album && (
          <>
            <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl, gap: 4 }}>
              <Txt variant="title1">{album.title}</Txt>
              <Txt
                variant="body"
                tone="secondary"
                onPress={() =>
                  album.artistId && router.push(`/artist/${encodeURIComponent(album.artistId)}`)
                }
              >
                {album.artistName}
              </Txt>
              <Txt variant="caption" tone="muted">
                {[
                  album.albumType === 'single' ? 'Single' : album.albumType === 'ep' ? 'EP' : 'Album',
                  formatReleaseDate(album.releaseDate),
                  album.genre,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
              {tracks.length > 0 && (
                <Txt variant="caption" tone="faint">
                  {pluralize(tracks.length, 'song')} · {formatDuration(totalMs)}
                </Txt>
              )}
            </View>

            <View style={[styles.actions, { paddingHorizontal: gutter }]}>
              <Button
                label="Play"
                icon="play"
                onPress={() =>
                  tracks.length &&
                  void playerStore.playQueue(tracks, {
                    context: 'album',
                    contextLabel: album.title,
                  })
                }
                disabled={tracks.length === 0}
              />
              <IconButton
                name="shuffle"
                label="Shuffle this album"
                onPress={() =>
                  tracks.length &&
                  void playerStore.playQueue(tracks, {
                    context: 'album',
                    contextLabel: album.title,
                    shuffle: true,
                  })
                }
              />
              {canDownload && (
                <IconButton
                  name={fullyDownloaded ? 'checkmark-circle' : 'arrow-down-circle-outline'}
                  label={fullyDownloaded ? 'Album downloaded' : 'Download this album'}
                  color={fullyDownloaded ? colors.accentInk : colors.text}
                  onPress={() => {
                    if (fullyDownloaded) {
                      toast('The whole album is already downloaded');
                      return;
                    }
                    void actions.downloadAlbum(album, tracks);
                  }}
                />
              )}
              <IconButton
                name={saved ? 'checkmark-circle' : 'add-circle-outline'}
                label={saved ? 'Remove from library' : 'Add to library'}
                color={saved ? colors.accentInk : colors.text}
                onPress={async () => {
                  if (saved) {
                    await removeFromLibrary('album', album.id);
                    setSaved(false);
                    toast('Removed from your library');
                  } else {
                    await addAlbumToLibrary(album);
                    setSaved(true);
                    toast('Album added to your library', 'success');
                  }
                }}
              />
              <IconButton
                name="albums-outline"
                label="Add these songs to a playlist"
                onPress={() => actions.addToPlaylist(tracks)}
              />
              <IconButton
                name="share-outline"
                label="Share this album"
                onPress={() => share(albumShare(album))}
              />
            </View>

            {inFlight.length > 0 && (
              <View style={{ paddingHorizontal: gutter, marginTop: spacing.lg, gap: 6 }}>
                <Txt variant="caption" tone="accent">
                  Downloading {completedCount + inFlight.length} of {tracks.length}
                </Txt>
                <ProgressBar progress={albumProgress} />
              </View>
            )}

            <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl }}>
              {state.loading ? (
                <SkeletonRows count={6} />
              ) : tracks.length === 0 ? (
                <Txt variant="body" tone="muted">
                  This source does not list a tracklist for this release.
                </Txt>
              ) : (
                tracks.map((track, index) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={index}
                    showArtwork={false}
                    subtitleOverride={track.artistName}
                    isPlaying={player.current?.id === track.id}
                    isDownloaded={downloads.byTrackId[track.id]?.status === 'completed'}
                    onPress={() =>
                      void playerStore.playQueue(tracks, {
                        startIndex: index,
                        context: 'album',
                        contextLabel: album.title,
                      })
                    }
                    onMore={() => actions.openTrack(track, { queue: tracks })}
                  />
                ))
              )}
            </View>

            {(album.copyright || album.externalUrl) && (
              <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl, gap: 6 }}>
                {album.copyright && (
                  <Txt variant="caption" tone="faint">
                    {album.copyright}
                  </Txt>
                )}
                {album.externalUrl && (
                  <Txt
                    variant="caption"
                    tone="accent"
                    onPress={() => void WebBrowser.openBrowserAsync(album.externalUrl!)}
                  >
                    Open on the source service
                  </Txt>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xl,
    flexWrap: 'wrap',
  },
});
