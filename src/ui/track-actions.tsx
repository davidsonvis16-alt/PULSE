import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Album, Track } from '@/src/core/types';
import { providerFor } from '@/src/providers/music';
import { downloadManager, downloadsSupported } from '@/src/downloads/manager';
import { playerStore } from '@/src/audio/player';
import {
  addAlbumToLibrary,
  addTrackToLibrary,
  isFavorite,
  isInLibrary,
  removeFromLibrary,
  toggleFavorite,
} from '@/src/db/repos/library';
import {
  addTracksToPlaylist,
  createPlaylist,
  listPlaylists,
  type Playlist,
} from '@/src/db/repos/playlists';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Sheet, SheetAction } from '@/src/ui/sheet';
import { Button } from '@/src/ui/buttons';
import { useToast } from '@/src/ui/toast';
import { useShareSheet } from '@/src/ui/share-sheet';
import { trackShare } from '@/src/share/share';
import { useStore } from '@/src/hooks/use-store';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

interface TrackActionsApi {
  /** Opens the "…" menu for a track. */
  openTrack: (track: Track, options?: { queue?: Track[] }) => void;
  /** Opens the playlist picker directly. */
  addToPlaylist: (tracks: Track[]) => void;
  /** Queues a download and reports the outcome. */
  download: (track: Track) => Promise<void>;
  downloadAlbum: (album: Album, tracks: Track[]) => Promise<void>;
  saveToLibrary: (track: Track) => Promise<void>;
}

const TrackActionsContext = createContext<TrackActionsApi | null>(null);

export function useTrackActions(): TrackActionsApi {
  const context = useContext(TrackActionsContext);
  if (!context) throw new Error('useTrackActions must be used inside TrackActionsProvider');
  return context;
}

export function TrackActionsProvider({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const toast = useToast();
  const share = useShareSheet();
  const downloads = useStore(downloadManager);

  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [menuQueue, setMenuQueue] = useState<Track[] | undefined>(undefined);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);

  const [pickerTracks, setPickerTracks] = useState<Track[] | null>(null);

  useEffect(() => {
    if (!menuTrack) return;
    let cancelled = false;
    void Promise.all([isFavorite('track', menuTrack.id), isInLibrary('track', menuTrack.id)]).then(
      ([fav, lib]) => {
        if (cancelled) return;
        setLiked(fav);
        setSaved(lib);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [menuTrack]);

  const download = useCallback(
    async (track: Track) => {
      const result = await downloadManager.enqueue(track);
      toast(
        result.started ? `Downloading ${track.title}` : (result.reason ?? 'Could not download'),
        result.started ? 'success' : 'error',
      );
    },
    [toast],
  );

  const downloadAlbum = useCallback(
    async (album: Album, tracks: Track[]) => {
      if (tracks.length === 0) return;
      const { queued, skipped } = await downloadManager.enqueueMany(tracks);
      if (queued === 0) {
        toast(skipped ? 'Every track is already downloaded' : 'Nothing to download', 'error');
        return;
      }
      await addAlbumToLibrary(album);
      toast(`Downloading ${queued} track${queued === 1 ? '' : 's'} from ${album.title}`, 'success');
    },
    [toast],
  );

  const saveToLibrary = useCallback(
    async (track: Track) => {
      await addTrackToLibrary(track);
      toast('Added to your library', 'success');
    },
    [toast],
  );

  const api = useMemo<TrackActionsApi>(
    () => ({
      openTrack: (track, options) => {
        setMenuTrack(track);
        setMenuQueue(options?.queue);
      },
      addToPlaylist: (tracks) => setPickerTracks(tracks),
      download,
      downloadAlbum,
      saveToLibrary,
    }),
    [download, downloadAlbum, saveToLibrary],
  );

  const closeMenu = () => setMenuTrack(null);
  const record = menuTrack ? downloads.byTrackId[menuTrack.id] : undefined;
  const canDownload =
    downloadsSupported && menuTrack ? providerFor(menuTrack.provider).capabilities.download : false;

  return (
    <TrackActionsContext.Provider value={api}>
      {children}

      <Sheet visible={!!menuTrack} onClose={closeMenu} menu>
        {menuTrack && (
          <>
            <View style={styles.head}>
              <Artwork uri={menuTrack.artworkUrl} size={56} radius={radii.sm} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {menuTrack.title}
                </Txt>
                <Txt variant="caption" tone="muted" numberOfLines={1}>
                  {menuTrack.artistName}
                </Txt>
              </View>
            </View>

            <SheetAction
              icon="play"
              label="Play now"
              tone="accent"
              onPress={() => {
                void playerStore.playTrack(menuTrack, { queue: menuQueue });
                closeMenu();
              }}
            />
            <SheetAction
              icon="play-skip-forward-outline"
              label="Play next"
              onPress={() => {
                playerStore.addToQueue([menuTrack], 'next');
                toast('Playing next');
                closeMenu();
              }}
            />
            <SheetAction
              icon="list-outline"
              label="Add to queue"
              onPress={() => {
                playerStore.addToQueue([menuTrack]);
                toast('Added to queue');
                closeMenu();
              }}
            />
            {canDownload &&
              (record?.status === 'completed' ? (
                <SheetAction
                  icon="trash-outline"
                  label="Remove download"
                  detail="Frees the space, keeps it in your library"
                  tone="danger"
                  onPress={async () => {
                    await downloadManager.remove(menuTrack.id, { keepLibraryEntry: true });
                    toast('Download removed');
                    closeMenu();
                  }}
                />
              ) : (
                <SheetAction
                  icon="arrow-down-circle-outline"
                  label="Download"
                  detail={record?.status === 'downloading' ? 'Already downloading' : undefined}
                  disabled={record?.status === 'downloading'}
                  onPress={async () => {
                    await download(menuTrack);
                    closeMenu();
                  }}
                />
              ))}
            <SheetAction
              icon={saved ? 'checkmark-circle' : 'add-circle-outline'}
              label={saved ? 'Remove from library' : 'Add to library'}
              onPress={async () => {
                if (saved) {
                  await removeFromLibrary('track', menuTrack.id);
                  toast('Removed from your library');
                } else {
                  await addTrackToLibrary(menuTrack);
                  toast('Added to your library', 'success');
                }
                closeMenu();
              }}
            />
            <SheetAction
              icon="albums-outline"
              label="Add to playlist"
              onPress={() => {
                setPickerTracks([menuTrack]);
                closeMenu();
              }}
            />
            <SheetAction
              icon={liked ? 'heart' : 'heart-outline'}
              label={liked ? 'Unlike' : 'Like'}
              onPress={async () => {
                const nowLiked = await toggleFavorite('track', menuTrack.id);
                if (nowLiked) await addTrackToLibrary(menuTrack);
                toast(nowLiked ? 'Liked' : 'Removed from liked songs');
                closeMenu();
              }}
            />
            <SheetAction
              icon="share-outline"
              label="Share"
              onPress={() => {
                const payload = trackShare(menuTrack);
                closeMenu();
                setTimeout(() => share(payload), 220);
              }}
            />
            {menuTrack.albumId && (
              <SheetAction
                icon="disc-outline"
                label="Go to album"
                onPress={() => {
                  closeMenu();
                  router.push(`/album/${encodeURIComponent(menuTrack.albumId!)}`);
                }}
              />
            )}
            {menuTrack.artistId && (
              <SheetAction
                icon="person-outline"
                label="Go to artist"
                onPress={() => {
                  closeMenu();
                  router.push(`/artist/${encodeURIComponent(menuTrack.artistId!)}`);
                }}
              />
            )}
          </>
        )}
      </Sheet>

      <PlaylistPicker
        tracks={pickerTracks}
        onClose={() => setPickerTracks(null)}
        onDone={(playlistName, count) => {
          toast(`Added ${count} song${count === 1 ? '' : 's'} to ${playlistName}`, 'success');
          setPickerTracks(null);
        }}
      />
    </TrackActionsContext.Provider>
  );
}

function PlaylistPicker({
  tracks,
  onClose,
  onDone,
}: {
  tracks: Track[] | null;
  onClose: () => void;
  onDone: (playlistName: string, count: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!tracks) return;
    setCreating(false);
    setName('');
    void listPlaylists().then(setPlaylists);
  }, [tracks]);

  const addTo = async (playlist: Playlist) => {
    if (!tracks) return;
    setBusy(true);
    try {
      const added = await addTracksToPlaylist(playlist.id, tracks);
      onDone(playlist.name, added);
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    if (!tracks) return;
    setBusy(true);
    try {
      const playlist = await createPlaylist(name);
      const added = await addTracksToPlaylist(playlist.id, tracks);
      onDone(playlist.name, added);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not create the playlist', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={!!tracks}
      onClose={onClose}
      title="Add to playlist"
      subtitle={tracks ? `${tracks.length} song${tracks.length === 1 ? '' : 's'}` : undefined}
    >
      {creating ? (
        <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Playlist name"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            maxLength={80}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={createAndAdd}
          />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button label="Cancel" variant="secondary" onPress={() => setCreating(false)} />
            <Button
              label="Create and add"
              onPress={createAndAdd}
              loading={busy}
              disabled={name.trim().length === 0}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setCreating(true)}
            style={({ pressed }) => [styles.newRow, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.newIcon}>
              <Ionicons name="add" size={22} color={colors.onAccent} />
            </View>
            <Txt variant="bodyStrong">New playlist</Txt>
          </Pressable>

          {playlists.map((playlist) => (
            <Pressable
              key={playlist.id}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => addTo(playlist)}
              style={({ pressed }) => [styles.playlistRow, pressed && { opacity: 0.7 }]}
            >
              <Artwork uri={playlist.coverArtworkUrl} size={44} radius={radii.sm} />
              <View style={{ flex: 1 }}>
                <Txt variant="body" numberOfLines={1}>
                  {playlist.name}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {playlist.trackCount} song{playlist.trackCount === 1 ? '' : 's'}
                </Txt>
              </View>
            </Pressable>
          ))}

          {playlists.length === 0 && (
            <Txt variant="caption" tone="muted" style={{ paddingVertical: spacing.lg }}>
              You have no playlists yet. Create one above.
            </Txt>
          )}
        </>
      )}
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: 6,
      paddingBottom: spacing.md,
      marginBottom: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
    },
    newRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
    newIcon: {
      width: 44,
      height: 44,
      borderRadius: radii.sm,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playlistRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
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
