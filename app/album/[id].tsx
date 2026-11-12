import { Pressable, ScrollView, StyleSheet, View, type PressableStateCallbackType } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import type { Album, Track } from '@/src/core/types';
import { formatDuration, pluralize } from '@/src/core/format';
import { providerFor } from '@/src/providers/music';
import { upsertAlbum, upsertTracks } from '@/src/db/repos/catalog';
import { addAlbumToLibrary, isInLibrary, removeFromLibrary } from '@/src/db/repos/library';
import { ownedMatchOf } from '@/src/library/owned';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { useShareSheet } from '@/src/ui/share-sheet';
import { useToast } from '@/src/ui/toast';
import { albumShare } from '@/src/share/share';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { IconButton, PlayButton } from '@/src/ui/buttons';
import { ErrorState, ProgressBar, Skeleton, SkeletonRows } from '@/src/ui/states';
import { useArtworkColour } from '@/src/ui/use-artwork-colour';
import { useEffect, useMemo, useState } from 'react';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type PressState = PressableStateCallbackType & { hovered?: boolean };

const ON_SHADE = '#FFFFFF';
const ON_SHADE_SOFT = 'rgba(255, 255, 255, 0.78)';

/**
 * The album page: a header block in a Pulse shade drawn from the cover, the
 * actions under it, and a tracklist laid out as a table — number, song, a
 * tick for the songs already on this phone, length.
 */
export default function AlbumScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { gutter, pageWidth: width, isTabletUp, isLaptopUp } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const share = useShareSheet();
  const toast = useToast();
  const downloads = useStore(downloadManager);
  const player = useStore(playerStore);
  const [saved, setSaved] = useState(false);

  const state = useAsync<{ album: Album; tracks: Track[]; owned: Set<string> }>(async () => {
    const albumId = decodeURIComponent(id ?? '');
    const provider = providerFor(albumId.split(':')[0]);
    const album = await provider.getAlbum(albumId);
    if (!album) throw new Error('That album is not available from this source.');
    const tracks = await provider.getAlbumTracks(albumId, 60).catch(() => [] as Track[]);
    await upsertAlbum(album);
    await upsertTracks(tracks);
    // The songs they already have: ticked, and played in full from their own copy.
    const matches = await Promise.all(tracks.map((t) => ownedMatchOf(t).catch(() => null)));
    const owned = new Set(tracks.filter((_, i) => !!matches[i]).map((t) => t.id));
    return { album, tracks, owned };
  }, [id]);

  const album = state.data?.album;
  const tracks = useMemo(() => state.data?.tracks ?? [], [state.data]);
  const owned = state.data?.owned;
  const shade = useArtworkColour(album?.artworkUrl, album?.title ?? '');

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
  const inFlight = albumDownloads.filter((d) => ['queued', 'preparing', 'downloading'].includes(d.status));
  const albumProgress =
    tracks.length > 0 ? (completedCount + inFlight.reduce((sum, d) => sum + d.progress, 0)) / tracks.length : 0;
  const fullyDownloaded = tracks.length > 0 && completedCount === tracks.length;
  const canDownload = album ? providerFor(album.provider).capabilities.download : false;

  const totalMs = tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  const artSize = isTabletUp ? 232 : Math.min(width - gutter * 2, 220);
  const year = album?.releaseDate?.slice(0, 4);
  const kind = album?.albumType === 'single' ? 'Single' : album?.albumType === 'ep' ? 'EP' : 'Album';
  const playing = player.current?.id;

  const play = (startIndex = 0, shuffle = false) =>
    tracks.length &&
    void playerStore.playQueue(tracks, { startIndex, context: 'album', contextLabel: album?.title, shuffle });

  if (state.error) {
    return (
      <Screen>
        <View style={{ paddingTop: spacing.md, paddingHorizontal: gutter }}>
          <IconButton name="chevron-back" label="Go back" onPress={() => router.back()} />
        </View>
        <ErrorState error={state.error} onRetry={state.reload} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }} showsVerticalScrollIndicator={false}>
        {/* The header block, in this album's Pulse shade. */}
        <LinearGradient colors={[shade.top, shade.deep]} style={styles.hero}>
          <View style={[styles.heroTop, { paddingHorizontal: gutter }]}>
            <IconButton
              name="chevron-back"
              label="Go back"
              background="glass"
              color={ON_SHADE}
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            />
          </View>
          <View style={[styles.heroBody, { paddingHorizontal: gutter }, !isTabletUp && styles.heroBodyStacked]}>
            <View style={styles.artShadow}>
              {state.loading && !album ? (
                <Skeleton width={artSize} height={artSize} radius={radii.sm} />
              ) : (
                <Artwork uri={album!.artworkUrl} size={artSize} radius={radii.sm} />
              )}
            </View>
            {album && (
              <View style={[styles.heroText, !isTabletUp && { alignItems: 'center' }]}>
                <Txt variant="micro" uppercase style={{ color: ON_SHADE_SOFT }}>
                  {kind}
                </Txt>
                <Txt
                  variant={isLaptopUp ? (album.title.length > 22 ? 'title1' : 'hero') : 'title1'}
                  numberOfLines={3}
                  align={isTabletUp ? 'left' : 'center'}
                  style={{ color: ON_SHADE }}
                >
                  {album.title}
                </Txt>
                <View style={[styles.factLine, !isTabletUp && { justifyContent: 'center' }]}>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() =>
                      album.artistId
                        ? router.push(`/artist/${encodeURIComponent(album.artistId)}`)
                        : router.push({ pathname: '/discover', params: { q: album.artistName } })
                    }
                  >
                    <Txt variant="bodyStrong" style={{ color: ON_SHADE }}>
                      {album.artistName}
                    </Txt>
                  </Pressable>
                  <Txt variant="body" style={{ color: ON_SHADE_SOFT }}>
                    {[year, tracks.length ? `${pluralize(tracks.length, 'song')}, ${formatDuration(totalMs)}` : null]
                      .filter(Boolean)
                      .map((part) => ` · ${part}`)
                      .join('')}
                  </Txt>
                </View>
                {!!owned?.size && (
                  <View style={styles.ownedLine}>
                    <Ionicons name="checkmark-circle" size={15} color={ON_SHADE} />
                    <Txt variant="caption" style={{ color: ON_SHADE }}>
                      {owned.size === tracks.length
                        ? 'You have every song on this one · plays in full'
                        : `You have ${owned.size} of these ${tracks.length} songs · they play in full`}
                    </Txt>
                  </View>
                )}
              </View>
            )}
          </View>
        </LinearGradient>

        {album && (
          <>
            {/* The actions sit on the shade fading into the page. */}
            <LinearGradient colors={[shade.deep, colors.backgroundElevated]} style={styles.fade}>
              <View style={[styles.actions, { paddingHorizontal: gutter }]}>
                <PlayButton
                  playing={player.context === 'album' && player.contextLabel === album.title && player.isPlaying}
                  onPress={() =>
                    player.context === 'album' && player.contextLabel === album.title ? playerStore.toggle() : play()
                  }
                  size={56}
                />
                <IconButton name="shuffle" label="Shuffle this album" size={24} onPress={() => play(0, true)} />
                <IconButton
                  name={saved ? 'checkmark-circle' : 'add-circle-outline'}
                  label={saved ? 'Remove from library' : 'Add to library'}
                  size={26}
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
                {canDownload && (
                  <IconButton
                    name={fullyDownloaded ? 'arrow-down-circle' : 'arrow-down-circle-outline'}
                    label={fullyDownloaded ? 'Album downloaded' : 'Download this album'}
                    size={26}
                    color={fullyDownloaded ? colors.accentInk : colors.text}
                    onPress={() =>
                      fullyDownloaded ? toast('The whole album is already downloaded') : void actions.downloadAlbum(album, tracks)
                    }
                  />
                )}
                <IconButton
                  name="albums-outline"
                  label="Add these songs to a playlist"
                  size={24}
                  onPress={() => actions.addToPlaylist(tracks)}
                />
                <IconButton name="share-outline" label="Share this album" size={24} onPress={() => share(albumShare(album))} />
              </View>
            </LinearGradient>

            {inFlight.length > 0 && (
              <View style={{ paddingHorizontal: gutter, gap: 6, paddingBottom: spacing.md }}>
                <Txt variant="caption" tone="accent">
                  Downloading {completedCount + inFlight.length} of {tracks.length}
                </Txt>
                <ProgressBar progress={albumProgress} />
              </View>
            )}

            {/* The tracklist, as a table. */}
            <View style={{ paddingHorizontal: gutter }}>
              {state.loading ? (
                <SkeletonRows count={6} />
              ) : tracks.length === 0 ? (
                <Txt variant="body" tone="muted">
                  This source does not list a tracklist for this release.
                </Txt>
              ) : (
                <>
                  <View style={styles.tableHead}>
                    <Txt variant="caption" tone="muted" style={styles.colIndex}>
                      #
                    </Txt>
                    <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
                      Title
                    </Txt>
                    <Txt variant="caption" tone="muted" style={styles.colOwned}>
                      {owned?.size ? 'Yours' : ''}
                    </Txt>
                    <Ionicons name="time-outline" size={15} color={colors.textMuted} style={styles.colTime} />
                    <View style={styles.colMore} />
                  </View>
                  {tracks.map((track, index) => {
                    const isPlaying = playing === track.id;
                    const mine = owned?.has(track.id);
                    return (
                      <Pressable
                        key={track.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Play ${track.title}${mine ? ', on your phone' : ''}`}
                        onPress={() => play(index)}
                        style={(s: PressState) => [styles.tr, s.hovered && { backgroundColor: colors.card }]}
                      >
                        {(s: PressState) => (
                          <>
                            <View style={styles.colIndex}>
                              {isPlaying ? (
                                <Ionicons name="volume-medium" size={16} color={colors.accentInk} />
                              ) : s.hovered ? (
                                <Ionicons name="play" size={14} color={colors.text} />
                              ) : (
                                <Txt variant="callout" tone="muted">
                                  {index + 1}
                                </Txt>
                              )}
                            </View>
                            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Txt
                                  variant="bodyStrong"
                                  numberOfLines={1}
                                  style={[{ flexShrink: 1 }, isPlaying && { color: colors.accentInk }]}
                                >
                                  {track.title}
                                </Txt>
                                {track.explicit && (
                                  <View style={[styles.explicit, { backgroundColor: colors.cardHigh }]}>
                                    <Txt variant="micro" tone="muted">
                                      E
                                    </Txt>
                                  </View>
                                )}
                              </View>
                              <Txt variant="caption" tone="muted" numberOfLines={1}>
                                {track.artistName}
                              </Txt>
                            </View>
                            <View style={styles.colOwned}>
                              {mine && <Ionicons name="checkmark-circle" size={18} color={colors.accentInk} />}
                            </View>
                            <Txt variant="caption" tone="muted" style={styles.colTime}>
                              {formatDuration(track.durationMs)}
                            </Txt>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`More options for ${track.title}`}
                              hitSlop={8}
                              onPress={() => actions.openTrack(track, { queue: tracks })}
                              style={styles.colMore}
                            >
                              <Ionicons name="ellipsis-horizontal" size={17} color={colors.textMuted} />
                            </Pressable>
                          </>
                        )}
                      </Pressable>
                    );
                  })}
                </>
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
                  <Txt variant="caption" tone="accent" onPress={() => void WebBrowser.openBrowserAsync(album.externalUrl!)}>
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    hero: { paddingBottom: spacing.xl },
    heroTop: { flexDirection: 'row', paddingTop: spacing.md },
    heroBody: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xl, paddingTop: spacing.lg },
    heroBodyStacked: { flexDirection: 'column', alignItems: 'center' },
    heroText: { flex: 1, gap: 6, minWidth: 0 },
    artShadow: {
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 14 },
      elevation: 14,
    },
    factLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 },
    ownedLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    fade: { paddingTop: spacing.lg, paddingBottom: spacing.lg },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
    tableHead: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.sm,
      marginBottom: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tr: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      borderRadius: radii.xs,
    },
    colIndex: { width: 34, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
    colOwned: { width: 44, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
    colTime: { width: 52, textAlign: 'right', fontVariant: ['tabular-nums'] },
    colMore: { width: 36, alignItems: 'flex-end', justifyContent: 'center' },
    explicit: { paddingHorizontal: 4, borderRadius: 3 },
  });
