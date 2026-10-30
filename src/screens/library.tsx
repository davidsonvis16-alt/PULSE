import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pluralize } from '@/src/core/format';
import { getLibraryCounts, getRecentlyAdded } from '@/src/db/repos/library';
import { getLocalCounts } from '@/src/db/repos/local';
import { GroovesList } from '@/src/screens/grooves';
import { ingestEngine } from '@/src/ingestion/ingest';
import { artworkRepair } from '@/src/ingestion/artwork/backfill';
import { useStore } from '@/src/hooks/use-store';
import { createPlaylist, listPlaylists, type Playlist } from '@/src/db/repos/playlists';
import { playerStore } from '@/src/audio/player';
import { useAsync } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button, SegmentedControl } from '@/src/ui/buttons';
import { Shelf } from '@/src/ui/section';
import { TrackCard } from '@/src/ui/cards';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { Sheet } from '@/src/ui/sheet';
import { DownloadsScreen } from '@/src/screens/downloads';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type Tab = 'music' | 'grooves' | 'downloaded' | 'playlists';

type IconName = keyof typeof Ionicons.glyphMap;

const SECTIONS: { id: string; title: string; icon: IconName }[] = [
  { id: 'all', title: 'All music', icon: 'musical-notes-outline' },
  { id: 'local', title: 'On this device', icon: 'phone-portrait-outline' },
  { id: 'recent', title: 'Recently added', icon: 'time-outline' },
  { id: 'played', title: 'Recently played', icon: 'play-circle-outline' },
  { id: 'downloads', title: 'Downloads', icon: 'arrow-down-circle-outline' },
  { id: 'songs', title: 'Songs', icon: 'musical-note-outline' },
  { id: 'albums', title: 'Albums', icon: 'disc-outline' },
  { id: 'artists', title: 'Artists', icon: 'people-outline' },
  { id: 'favorites', title: 'Favorites', icon: 'heart-outline' },
];

/** The user's own music: what they saved, downloaded, liked and built. */
export function LibraryScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { gutter, shelfCardWidth } = useResponsive();
  const bottomInset = useBottomInset();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('music');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const data = useAsync(
    async () => {
      const [counts, local, recentlyAdded, playlists] = await Promise.all([
        getLibraryCounts(),
        getLocalCounts(),
        getRecentlyAdded(12),
        listPlaylists(),
      ]);
      return { counts, local, recentlyAdded, playlists };
    },
    [],
  );

  const ingest = useStore(ingestEngine);
  const repair = useStore(artworkRepair);

  useFocusReload(data.reload);

  const local = data.data?.local;
  const missingCovers = local ? Math.max(0, local.tracks - local.withArtwork) : 0;

  const create = useCallback(async () => {
    try {
      const playlist = await createPlaylist(newName);
      setCreating(false);
      setNewName('');
      data.reload();
      router.push(`/playlist/${playlist.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not create the playlist', 'error');
    }
  }, [newName, data, router, toast]);

  const counts = data.data?.counts;

  return (
    <Screen>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <Txt variant="title1">Library</Txt>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search your library"
          hitSlop={8}
          onPress={() => router.push('/collection/all')}
        >
          <Ionicons name="search-outline" size={21} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Import music from this device"
          hitSlop={8}
          onPress={() => router.push('/import')}
        >
          <Ionicons name="add-circle-outline" size={21} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Downloads"
          hitSlop={8}
          onPress={() => setTab('downloaded')}
        >
          <Ionicons name="arrow-down-circle-outline" size={21} color={colors.text} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: gutter, marginBottom: spacing.lg }}>
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'music', label: 'Music' },
            { value: 'grooves', label: 'Grooves' },
            { value: 'downloaded', label: 'Downloaded' },
            { value: 'playlists', label: 'Playlists' },
          ]}
        />
      </View>

      {tab === 'downloaded' ? (
        <DownloadsScreen embedded />
      ) : tab === 'grooves' ? (
        <GroovesList />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomInset }}
          showsVerticalScrollIndicator={false}
        >
          {data.loading && !data.data ? (
            <View style={{ paddingHorizontal: gutter }}>
              <SkeletonRows count={7} height={48} />
            </View>
          ) : data.error ? (
            <ErrorState error={data.error} onRetry={data.reload} />
          ) : tab === 'music' ? (
            <>
              {ingest.phase !== 'idle' && ingest.phase !== 'done' && ingest.phase !== 'error' && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/import')}
                  style={({ pressed }) => [
                    styles.banner,
                    { marginHorizontal: gutter },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Ionicons name="sync-outline" size={18} color={colors.accentInk} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="callout">Importing your music…</Txt>
                    <Txt variant="caption" tone="muted">
                      {ingest.found} found · {Math.round(ingest.progress * 100)}%
                    </Txt>
                  </View>
                </Pressable>
              )}

              {missingCovers > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Find covers for ${pluralize(missingCovers, 'song')}`}
                  disabled={repair.running}
                  onPress={() => void artworkRepair.run()}
                  style={({ pressed }) => [
                    styles.banner,
                    { marginHorizontal: gutter },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Ionicons name="image-outline" size={18} color={colors.accentInk} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="callout">
                      {repair.running
                        ? 'Finding covers…'
                        : `${pluralize(missingCovers, 'song')} without a cover`}
                    </Txt>
                    <Txt variant="caption" tone="muted">
                      {repair.running
                        ? `${repair.checked} of ${repair.total} checked · ${repair.found} found`
                        : 'Pulse can look up the real artwork for these.'}
                    </Txt>
                  </View>
                  {!repair.running && (
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  )}
                </Pressable>
              )}

              {!!data.data?.local.needsIdentification && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/identify')}
                  style={({ pressed }) => [
                    styles.banner,
                    { marginHorizontal: gutter },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Ionicons name="help-circle-outline" size={18} color={colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="callout">
                      {pluralize(data.data.local.needsIdentification, 'track')} need identifying
                    </Txt>
                    <Txt variant="caption" tone="muted">
                      Confirm a match and Pulse fills in the details and artwork.
                    </Txt>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                </Pressable>
              )}

              <View style={{ paddingHorizontal: gutter }}>
                {SECTIONS.map((section) => (
                  <Pressable
                    key={section.id}
                    accessibilityRole="button"
                    accessibilityLabel={section.title}
                    onPress={() => router.push(`/collection/${section.id}`)}
                    style={({ pressed }) => [styles.sectionRow, pressed && { opacity: 0.65 }]}
                  >
                    <View style={styles.sectionIcon}>
                      <Ionicons name={section.icon} size={18} color={colors.accentInk} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong">{section.title}</Txt>
                      <Txt variant="caption" tone="muted">
                        {countLabel(section.id, counts)}
                      </Txt>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                  </Pressable>
                ))}
              </View>

              {!!data.data?.recentlyAdded.length && (
                <View style={{ marginTop: spacing.xxl }}>
                  <Txt variant="title3" style={{ paddingHorizontal: gutter, marginBottom: spacing.md }}>
                    Recently added
                  </Txt>
                  <Shelf
                    data={data.data.recentlyAdded}
                    gutter={gutter}
                    keyExtractor={(item) => item.id}
                    renderItem={(item, index) => (
                      <TrackCard
                        track={item}
                        width={shelfCardWidth}
                        onPress={() =>
                          void playerStore.playQueue(data.data!.recentlyAdded, {
                            startIndex: index,
                            context: 'library',
                            contextLabel: 'Recently added',
                          })
                        }
                      />
                    )}
                  />
                </View>
              )}

              {counts && counts.tracks === 0 && counts.downloads === 0 && (
                <EmptyState
                  icon="library-outline"
                  title="Your library is empty"
                  message="Import the music already on your device and Pulse will give it real artwork, group it into Grooves and learn your taste from it."
                  actionLabel="Import my music"
                  onAction={() => router.push('/import')}
                />
              )}
            </>
          ) : (
            <View style={{ paddingHorizontal: gutter }}>
              <Button
                label="Create playlist"
                icon="add"
                onPress={() => setCreating(true)}
                style={{ alignSelf: 'flex-start', marginBottom: spacing.lg }}
              />
              {(data.data?.playlists ?? []).map((playlist) => (
                <PlaylistRow
                  key={playlist.id}
                  playlist={playlist}
                  onPress={() => router.push(`/playlist/${playlist.id}`)}
                />
              ))}
              {data.data?.playlists.length === 0 && (
                <EmptyState
                  icon="albums-outline"
                  title="No playlists yet"
                  message="Build one from anything you find, and Pulse will suggest songs that fit it."
                  compact
                />
              )}
            </View>
          )}
        </ScrollView>
      )}

      <Sheet visible={creating} onClose={() => setCreating(false)} title="New playlist">
        <View style={{ gap: spacing.lg, paddingTop: spacing.sm }}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Playlist name"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            maxLength={80}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={create}
          />
          <Button label="Create" full onPress={create} disabled={newName.trim().length === 0} />
        </View>
      </Sheet>
    </Screen>
  );
}

function PlaylistRow({ playlist, onPress }: { playlist: Playlist; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playlist.name}
      onPress={onPress}
      style={({ pressed }) => [styles.playlistRow, pressed && { opacity: 0.7 }]}
    >
      <Artwork uri={playlist.coverArtworkUrl} size={52} radius={radii.sm} />
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {playlist.name}
        </Txt>
        <Txt variant="caption" tone="muted">
          {pluralize(playlist.trackCount, 'song')}
        </Txt>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

function countLabel(sectionId: string, counts?: Awaited<ReturnType<typeof getLibraryCounts>>) {
  if (!counts) return ' ';
  switch (sectionId) {
    case 'all':
    case 'songs':
      return pluralize(counts.tracks, 'song');
    case 'albums':
      return pluralize(counts.albums, 'album');
    case 'artists':
      return pluralize(counts.artists, 'artist');
    case 'local':
      return 'Music you imported';
    case 'downloads':
      return pluralize(counts.downloads, 'song');
    case 'favorites':
      return pluralize(counts.favorites, 'song');
    case 'recent':
      return 'Newest first';
    case 'played':
      return 'Your listening history';
    default:
      return ' ';
  }
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      paddingVertical: spacing.md,
    },
    sectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11 },
    sectionIcon: {
      width: 38,
      height: 38,
      borderRadius: radii.sm,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    playlistRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
    input: {
      backgroundColor: colors.card,
      borderRadius: radii.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
      color: colors.text,
      fontSize: 15,
      borderWidth: 1,
      borderColor: colors.border,
    },
  });
