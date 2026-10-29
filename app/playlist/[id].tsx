import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Track } from '@/src/core/types';
import { formatDuration, pluralize } from '@/src/core/format';
import { musicProvider } from '@/src/providers/music';
import {
  addTracksToPlaylist,
  deletePlaylist,
  getPlaylist,
  getPlaylistTracks,
  playlistProfile,
  removeTrackFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
  setPlaylistVisibility,
  type Playlist,
} from '@/src/db/repos/playlists';
import { getPlaylistSuggestions } from '@/src/discovery/engine';
import { playerStore } from '@/src/audio/player';
import { downloadManager } from '@/src/downloads/manager';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { useTrackActions } from '@/src/ui/track-actions';
import { useShareSheet } from '@/src/ui/share-sheet';
import { useToast } from '@/src/ui/toast';
import { playlistShare } from '@/src/share/share';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button, IconButton } from '@/src/ui/buttons';
import { TrackRow } from '@/src/ui/rows';
import { SectionHeader } from '@/src/ui/section';
import { Sheet, SheetAction } from '@/src/ui/sheet';
import { EmptyState, ErrorState, ProgressBar, SkeletonRows } from '@/src/ui/states';
import { LibraryPicker } from '@/src/ui/library-picker';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/** A playlist the user built, plus songs Pulse thinks belong in it. */
export default function PlaylistScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { gutter, pageWidth: width, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const actions = useTrackActions();
  const share = useShareSheet();
  const toast = useToast();
  const downloads = useStore(downloadManager);

  const [menuTrack, setMenuTrack] = useState<{ track: Track; index: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState('');

  const state = useAsync<{ playlist: Playlist; tracks: Track[] }>(async () => {
    const playlist = await getPlaylist(id!);
    if (!playlist) throw new Error('That playlist no longer exists.');
    const tracks = await getPlaylistTracks(playlist.id);
    return { playlist, tracks };
  }, [id]);

  const suggestions = useAsync<Track[]>(async () => {
    if (!id) return [];
    const seed = await playlistProfile(id);
    if (seed.trackIds.length === 0) return [];
    return getPlaylistSuggestions(seed, 12).catch(() => []);
  }, [id, state.data?.tracks.length]);

  const playlist = state.data?.playlist;
  const tracks = state.data?.tracks ?? [];
  const totalMs = tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  const artSize = Math.min(width - gutter * 2, isTabletUp ? 260 : 200);

  const downloadedCount = tracks.filter(
    (t) => downloads.byTrackId[t.id]?.status === 'completed',
  ).length;
  const canDownload = musicProvider().capabilities.download;

  const reload = useCallback(() => {
    state.reload();
    suggestions.reload();
  }, [state, suggestions]);

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
      <PageHeader
        transparent
        right={
          playlist ? (
            <IconButton
              name="ellipsis-horizontal"
              label="Playlist options"
              onPress={() => {
                setName(playlist.name);
                setSettingsOpen(true);
              }}
            />
          ) : undefined
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: gutter, alignItems: 'center' }}>
          <Artwork uri={playlist?.coverArtworkUrl} size={artSize} radius={radii.lg} />
        </View>

        {playlist && (
          <>
            <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl, gap: 4 }}>
              <Txt variant="title1">{playlist.name}</Txt>
              {playlist.description ? (
                <Txt variant="body" tone="secondary">
                  {playlist.description}
                </Txt>
              ) : null}
              <Txt variant="caption" tone="muted">
                {pluralize(tracks.length, 'song')}
                {tracks.length > 0 ? ` · ${formatDuration(totalMs)}` : ''}
                {downloadedCount > 0 ? ` · ${downloadedCount} downloaded` : ''}
              </Txt>
              <Txt variant="caption" tone="faint">
                {playlist.visibility === 'private'
                  ? 'Private to you'
                  : playlist.visibility === 'friends'
                    ? 'Visible to friends'
                    : 'Public'}
              </Txt>
            </View>

            <View style={[styles.actions, { paddingHorizontal: gutter }]}>
              <Button
                label="Play"
                icon="play"
                disabled={tracks.length === 0}
                onPress={() =>
                  void playerStore.playQueue(tracks, {
                    context: 'playlist',
                    contextLabel: playlist.name,
                  })
                }
              />
              <IconButton
                name="shuffle"
                label="Shuffle this playlist"
                onPress={() =>
                  tracks.length &&
                  void playerStore.playQueue(tracks, {
                    context: 'playlist',
                    contextLabel: playlist.name,
                    shuffle: true,
                  })
                }
              />
              {canDownload && tracks.length > 0 && (
                <IconButton
                  name={
                    downloadedCount === tracks.length ? 'checkmark-circle' : 'arrow-down-circle-outline'
                  }
                  label="Download this playlist"
                  color={downloadedCount === tracks.length ? colors.accentInk : colors.text}
                  onPress={async () => {
                    const { queued } = await downloadManager.enqueueMany(tracks);
                    toast(
                      queued > 0
                        ? `Downloading ${queued} song${queued === 1 ? '' : 's'}`
                        : 'Everything here is already downloaded',
                      queued > 0 ? 'success' : 'default',
                    );
                  }}
                />
              )}
              <IconButton
                name="share-outline"
                label="Share this playlist"
                onPress={() => share(playlistShare(playlist))}
              />
            </View>

            {downloadedCount > 0 && downloadedCount < tracks.length && (
              <View style={{ paddingHorizontal: gutter, marginTop: spacing.lg }}>
                <ProgressBar progress={downloadedCount / tracks.length} />
              </View>
            )}

            <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl }}>
              {/* Your own music first: it is the most likely source of a playlist. */}
              <Button
                label="Add from your library"
                icon="add"
                variant="secondary"
                full
                style={{ marginBottom: spacing.lg }}
                onPress={() => setPickerOpen(true)}
              />

              {state.loading ? (
                <SkeletonRows count={5} />
              ) : tracks.length === 0 ? (
                <EmptyState
                  icon="musical-notes-outline"
                  title="This playlist is empty"
                  message="Add your own songs with the button above, or take one of the suggestions below."
                  actionLabel="Find music"
                  onAction={() => router.push('/discover')}
                  compact
                />
              ) : (
                tracks.map((track, index) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={index}
                    isDownloaded={downloads.byTrackId[track.id]?.status === 'completed'}
                    onPress={() =>
                      void playerStore.playQueue(tracks, {
                        startIndex: index,
                        context: 'playlist',
                        contextLabel: playlist.name,
                      })
                    }
                    onMore={() => setMenuTrack({ track, index })}
                  />
                ))
              )}
            </View>

            {/* Suggestions */}
            {!!suggestions.data?.length && (
              <View style={{ marginTop: spacing.xxl, paddingHorizontal: gutter }}>
                <SectionHeader
                  title="Suggested for this playlist"
                  subtitle="Based on what is already in it"
                />
                {suggestions.data.slice(0, 8).map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    onPress={() => void playerStore.playTrack(track, { queue: suggestions.data })}
                    trailing={
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${track.title} to ${playlist.name}`}
                        hitSlop={8}
                        onPress={async () => {
                          await addTracksToPlaylist(playlist.id, [track]);
                          toast(`Added to ${playlist.name}`, 'success');
                          reload();
                        }}
                      >
                        <Txt variant="callout" tone="accent">
                          Add
                        </Txt>
                      </Pressable>
                    }
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Per-track menu */}
      <Sheet
        visible={!!menuTrack}
        onClose={() => setMenuTrack(null)}
        title={menuTrack?.track.title}
        subtitle={menuTrack?.track.artistName}
        menu
      >
        {menuTrack && playlist && (
          <>
            <SheetAction
              icon="arrow-up-outline"
              label="Move up"
              disabled={menuTrack.index === 0}
              onPress={async () => {
                await reorderPlaylist(playlist.id, menuTrack.track.id, menuTrack.index - 1);
                setMenuTrack(null);
                reload();
              }}
            />
            <SheetAction
              icon="arrow-down-outline"
              label="Move down"
              disabled={menuTrack.index >= tracks.length - 1}
              onPress={async () => {
                await reorderPlaylist(playlist.id, menuTrack.track.id, menuTrack.index + 1);
                setMenuTrack(null);
                reload();
              }}
            />
            <SheetAction
              icon="arrow-up-circle-outline"
              label="Move to top"
              disabled={menuTrack.index === 0}
              onPress={async () => {
                await reorderPlaylist(playlist.id, menuTrack.track.id, 0);
                setMenuTrack(null);
                reload();
              }}
            />
            <SheetAction
              icon="ellipsis-horizontal"
              label="More actions for this song"
              onPress={() => {
                const track = menuTrack.track;
                setMenuTrack(null);
                setTimeout(() => actions.openTrack(track, { queue: tracks }), 220);
              }}
            />
            <SheetAction
              icon="remove-circle-outline"
              label="Remove from playlist"
              tone="danger"
              onPress={async () => {
                await removeTrackFromPlaylist(playlist.id, menuTrack.track.id);
                setMenuTrack(null);
                toast('Removed from the playlist');
                reload();
              }}
            />
          </>
        )}
      </Sheet>

      {/* Playlist settings */}
      <LibraryPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        existingIds={new Set(tracks.map((track) => track.id))}
        onAdd={async (picked) => {
          const added = await addTracksToPlaylist(id!, picked);
          toast(`Added ${added} song${added === 1 ? '' : 's'} to ${playlist?.name ?? 'the playlist'}`, 'success');
          reload();
        }}
      />

      <Sheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} title="Playlist">
        {playlist && (
          <>
            {renaming ? (
              <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  style={styles.input}
                  placeholder="Playlist name"
                  placeholderTextColor={colors.textFaint}
                  maxLength={80}
                  autoFocus
                />
                <Button
                  label="Save"
                  full
                  disabled={name.trim().length === 0}
                  onPress={async () => {
                    await renamePlaylist(playlist.id, name);
                    setRenaming(false);
                    setSettingsOpen(false);
                    toast('Playlist renamed');
                    reload();
                  }}
                />
              </View>
            ) : (
              <>
                <SheetAction icon="create-outline" label="Rename" onPress={() => setRenaming(true)} />
                <SheetAction
                  icon="share-outline"
                  label="Share"
                  onPress={() => {
                    setSettingsOpen(false);
                    setTimeout(() => share(playlistShare(playlist)), 220);
                  }}
                />
                <SheetAction
                  icon={playlist.visibility === 'private' ? 'lock-closed-outline' : 'globe-outline'}
                  label={
                    playlist.visibility === 'private'
                      ? 'Make visible to friends'
                      : 'Make private again'
                  }
                  detail={
                    playlist.visibility === 'private'
                      ? 'Friends will be able to open it'
                      : 'Only you will see it'
                  }
                  onPress={async () => {
                    await setPlaylistVisibility(
                      playlist.id,
                      playlist.visibility === 'private' ? 'friends' : 'private',
                    );
                    setSettingsOpen(false);
                    reload();
                  }}
                />
                <SheetAction
                  icon="trash-outline"
                  label="Delete playlist"
                  tone="danger"
                  onPress={async () => {
                    await deletePlaylist(playlist.id);
                    setSettingsOpen(false);
                    toast('Playlist deleted');
                    router.back();
                  }}
                />
              </>
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: spacing.xl,
      flexWrap: 'wrap',
    },
    input: {
      backgroundColor: colors.card,
      borderRadius: radii.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
      color: colors.text,
      fontSize: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
  });
