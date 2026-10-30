import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/src/core/types';
import { pluralize } from '@/src/core/format';
import { listLocalTracks } from '@/src/db/repos/local';
import { getAllDownloads } from '@/src/db/repos/downloads';
import { listPlaylists, getPlaylistTracks } from '@/src/db/repos/playlists';
import { getRecentlyPlayed } from '@/src/db/repos/history';
import { playerStore } from '@/src/audio/player';
import { oneCoverEach } from '@/src/discovery/variety';
import { useAsync } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useTrackActions } from '@/src/ui/track-actions';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { ProfileAvatar } from '@/src/ui/profile-avatar';
import { Artwork } from '@/src/ui/artwork';
import { Shelf } from '@/src/ui/section';
import { TrackRow } from '@/src/ui/rows';
import { DiscoveryCard } from '@/src/ui/editorial';
import { Txt } from '@/src/ui/text';
import { EmptyState } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/theme';

interface OfflineMusic {
  /** Every song that plays with no internet: the listener's own files and downloads. */
  all: Track[];
  own: Track[];
  downloaded: Track[];
  recent: Track[];
  playlists: { id: string; name: string; tracks: Track[] }[];
}

/**
 * Home without the internet.
 *
 * Only what plays offline is here, arranged so the page still feels full:
 * Offline Radio (a nonstop shuffle of everything on the phone), the playlists
 * that still have songs to play, recently played, downloads and the
 * listener's own files. Nothing that would need a connection is shown.
 */
export function OfflineHome() {
  const { colors } = useTheme();
  const router = useRouter();
  const actions = useTrackActions();
  const { gutter, isTabletUp, pageWidth } = useResponsive();
  const bottomInset = useBottomInset();

  const music = useAsync<OfflineMusic>(async () => {
    const [local, downloads, recent, playlists] = await Promise.all([
      listLocalTracks({ limit: 2000 }),
      getAllDownloads(),
      getRecentlyPlayed(40),
      listPlaylists(),
    ]);
    const own = local.map((entry) => entry.track);
    const downloaded = downloads.filter((d) => d.status === 'completed').map((d) => d.track);
    const playable = new Set([...own, ...downloaded].map((t) => t.id));
    const withSongs = await Promise.all(
      playlists.map(async (playlist) => ({
        id: playlist.id,
        name: playlist.name,
        tracks: (await getPlaylistTracks(playlist.id)).filter((t) => playable.has(t.id)),
      })),
    );
    return {
      all: [...own, ...downloaded.filter((t) => !own.some((o) => o.id === t.id))],
      own,
      downloaded,
      recent: recent.filter((t) => playable.has(t.id)),
      playlists: withSongs.filter((p) => p.tracks.length > 0),
    };
  }, []);
  useFocusReload(music.reload);

  const data = music.data;
  const play = useCallback((tracks: Track[], index: number, label: string, shuffle = false) => {
    if (tracks.length === 0) return;
    void playerStore.playQueue(tracks, { startIndex: index, context: 'library', contextLabel: label, shuffle });
  }, []);

  const tileWidth = useMemo(() => {
    const columns = isTabletUp ? 4 : 2;
    return (pageWidth - gutter * 2 - spacing.sm * (columns - 1)) / columns;
  }, [isTabletUp, pageWidth, gutter]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }} showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { paddingHorizontal: gutter }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => router.push('/profile')}>
            <ProfileAvatar size={38} />
          </Pressable>
          <View style={[styles.offlinePill, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Ionicons name="cloud-offline-outline" size={15} color={colors.textMuted} />
            <Txt variant="caption" tone="muted">
              Offline · your music still plays
            </Txt>
          </View>
        </View>

        {/* Offline Radio: everything on the phone, shuffled, nonstop. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Play Offline Radio"
          disabled={!data?.all.length}
          onPress={() => data && play(data.all, 0, 'Offline Radio', true)}
          style={({ pressed }) => [
            styles.radio,
            { marginHorizontal: gutter, backgroundColor: colors.accent },
            pressed && { opacity: 0.9 },
          ]}
        >
          <View style={styles.radioIcon}>
            <Ionicons name="radio" size={26} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="title2" tone="onAccent">
              Offline Radio
            </Txt>
            <Txt variant="caption" tone="onAccent">
              {data?.all.length
                ? `A nonstop shuffle of your ${pluralize(data.all.length, 'song')}`
                : 'Your songs will play here'}
            </Txt>
          </View>
          <Ionicons name="play-circle" size={40} color="#0A0B0A" />
        </Pressable>

        {!!data?.playlists.length && (
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl }}>
            <Txt variant="title2" style={{ marginBottom: spacing.md }}>
              Playlists you can play now
            </Txt>
            <View style={styles.grid}>
              {data.playlists.slice(0, 8).map((playlist) => (
                <Pressable
                  key={playlist.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${playlist.name}`}
                  onPress={() => play(playlist.tracks, 0, playlist.name)}
                  style={({ pressed }) => [
                    styles.tile,
                    { width: tileWidth, borderColor: colors.border, backgroundColor: colors.card },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Artwork uri={playlist.tracks.find((t) => t.artworkUrl)?.artworkUrl} size={56} radius={0} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="callout" numberOfLines={1}>
                      {playlist.name}
                    </Txt>
                    <Txt variant="caption" tone="muted">
                      {pluralize(playlist.tracks.length, 'song')} offline
                    </Txt>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {!!data?.recent.length && (
          <View style={{ marginTop: spacing.xl }}>
            <Txt variant="title2" style={{ paddingHorizontal: gutter, marginBottom: spacing.md }}>
              Recently played
            </Txt>
            <Shelf
              data={oneCoverEach(data.recent)}
              gutter={gutter}
              keyExtractor={(track) => track.id}
              renderItem={(track) => (
                <DiscoveryCard
                  track={track}
                  width={140}
                  onPlay={() => play(data.recent, Math.max(0, data.recent.indexOf(track)), 'Recently played')}
                  onMore={() => actions.openTrack(track, { queue: data.recent })}
                />
              )}
            />
          </View>
        )}

        {!!data?.downloaded.length && (
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl }}>
            <Txt variant="title2" style={{ marginBottom: spacing.sm }}>
              Downloaded
            </Txt>
            {data.downloaded.slice(0, 20).map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                isDownloaded
                onPress={() => play(data.downloaded, index, 'Downloaded')}
                onMore={() => actions.openTrack(track, { queue: data.downloaded })}
              />
            ))}
          </View>
        )}

        {!!data?.own.length && (
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl }}>
            <Txt variant="title2" style={{ marginBottom: spacing.sm }}>
              On this phone
            </Txt>
            {data.own.slice(0, 40).map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                onPress={() => play(data.own, index, 'Your music')}
                onMore={() => actions.openTrack(track, { queue: data.own })}
              />
            ))}
            {data.own.length > 40 && (
              <Pressable accessibilityRole="button" onPress={() => router.push('/library')} style={{ paddingVertical: spacing.md }}>
                <Txt variant="callout" tone="accent">
                  All {pluralize(data.own.length, 'song')} in your Library
                </Txt>
              </Pressable>
            )}
          </View>
        )}

        {data && data.all.length === 0 && (
          <EmptyState
            icon="cloud-offline-outline"
            title="Nothing to play offline yet"
            message="Songs on your phone and songs you download play without the internet. When you are back online, tap the download button on any song."
          />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.sm },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  radio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  radioIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: '#0A0B0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 56,
    paddingRight: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
