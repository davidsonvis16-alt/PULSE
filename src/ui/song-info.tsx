import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import type { Track } from '@/src/core/types';
import { formatReleaseDate, formatRelativeTime } from '@/src/core/format';
import { getSongPopularity, type SongPopularity } from '@/src/discovery/popularity';
import { Sheet } from '@/src/ui/sheet';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Where a song sits in the world.
 *
 * Opened from the release date, because that is the fact a listener notices
 * first and the natural door to the rest of it. What is behind the door is
 * every audience figure the platforms actually publish — and, said plainly,
 * the ones that do not.
 */

const SongInfoContext = createContext<(track: Track) => void>(() => {});

export function useSongInfo() {
  return useContext(SongInfoContext);
}

export function SongInfoProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<Track | null>(null);
  const [data, setData] = useState<SongPopularity | null>(null);
  const [loading, setLoading] = useState(false);

  const open = useCallback((next: Track) => {
    setTrack(next);
    setData(null);
    setLoading(true);
    void getSongPopularity(next)
      .then(setData)
      .catch(() => setData({ stats: [], hasFigures: false }))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => open, [open]);

  return (
    <SongInfoContext.Provider value={value}>
      {children}
      <SongInfoSheet track={track} data={data} loading={loading} onClose={() => setTrack(null)} />
    </SongInfoContext.Provider>
  );
}

function SongInfoSheet({
  track,
  data,
  loading,
  onClose,
}: {
  track: Track | null;
  data: SongPopularity | null;
  loading: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Sheet visible={!!track} onClose={onClose} title="About this song">
      {track && (
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
          <View style={styles.head}>
            <Artwork uri={track.artworkUrl} size={64} radius={radii.sm} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" numberOfLines={2}>
                {track.title}
              </Txt>
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {track.artistName}
              </Txt>
            </View>
          </View>

          <View style={styles.releaseBox}>
            <Txt variant="micro" tone="muted" uppercase>
              Released
            </Txt>
            <Txt variant="title3" style={{ marginTop: 2 }}>
              {track.releaseDate ? formatReleaseDate(track.releaseDate) : 'Not published'}
            </Txt>
            {!!track.releaseDate && (
              <Txt variant="caption" tone="muted">
                {formatRelativeTime(Date.parse(track.releaseDate))}
                {track.albumTitle ? ` · on ${track.albumTitle}` : ''}
              </Txt>
            )}
          </View>

          <Txt variant="micro" tone="muted" uppercase style={{ marginTop: spacing.xl }}>
            Audience
          </Txt>

          {loading && !data ? (
            <Txt variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
              Checking what each platform publishes…
            </Txt>
          ) : (
            (data?.stats ?? []).map((stat) => (
              <Pressable
                key={stat.id}
                accessibilityRole={stat.url ? 'link' : 'text'}
                disabled={!stat.url}
                onPress={() => stat.url && void WebBrowser.openBrowserAsync(stat.url)}
                style={({ pressed }) => [styles.stat, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name={stat.icon} size={18} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <View style={styles.statLine}>
                    <Txt variant="callout">{stat.label}</Txt>
                    <Txt variant="bodyStrong" tone={stat.value ? 'accent' : 'faint'}>
                      {stat.value ?? 'Not published'}
                    </Txt>
                  </View>
                  <Txt variant="caption" tone="muted">
                    {stat.note}
                  </Txt>
                </View>
                {!!stat.url && (
                  <Ionicons name="open-outline" size={14} color={colors.textFaint} />
                )}
              </Pressable>
            ))
          )}

          <Txt variant="caption" tone="faint" style={{ marginTop: spacing.lg }}>
            Pulse shows only figures a platform actually publishes. Where a service keeps its play
            counts to itself, this says so rather than guessing at a number.
          </Txt>
        </ScrollView>
      )}
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    releaseBox: {
      marginTop: spacing.lg,
      padding: spacing.lg,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
    stat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSoft,
    },
    statLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  });
