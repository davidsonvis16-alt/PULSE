import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { libraryArtistNames } from '@/src/library/owned';
import { normalise } from '@/src/ingestion/identify/text';
import {
  getAwardEdition,
  isLibraryNominee,
  nominationsFor,
  statusOf,
  type AwardCategory,
} from '@/src/news/awards';
import { STATUS_LABELS, awardWhen, formatAwardDate } from '@/src/ui/posters';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Txt } from '@/src/ui/text';
import { Chip } from '@/src/ui/buttons';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type View_ = 'all' | 'yours';

/** One ceremony: every category, every nominee, winners marked, your artists picked out. */
export default function AwardScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const [view, setView] = useState<View_>('all');

  const edition = useAsync(() => getAwardEdition(decodeURIComponent(id ?? '')), [id]);
  const artists = useAsync(() => libraryArtistNames(), []);
  const artistKeys = useMemo(() => new Set((artists.data ?? []).map(normalise)), [artists.data]);

  const data = edition.data;
  const yours = data ? nominationsFor(data, artists.data ?? []) : [];

  const categories: AwardCategory[] = !data
    ? []
    : view === 'all'
      ? data.categories
      : data.categories.filter((c) => c.nominees.some((n) => isLibraryNominee(n.artists, artistKeys)));

  return (
    <Screen>
      <PageHeader title={data?.shortName ?? 'Awards'} subtitle={data ? STATUS_LABELS[statusOf(data)] : undefined} />
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }} showsVerticalScrollIndicator={false}>
        {edition.loading && !data ? (
          <View style={{ padding: gutter }}>
            <SkeletonRows count={8} />
          </View>
        ) : edition.error ? (
          <ErrorState error={edition.error} onRetry={edition.reload} />
        ) : !data ? (
          <EmptyState icon="trophy-outline" title="This ceremony is no longer in season" />
        ) : (
          <>
            <View style={{ paddingHorizontal: gutter }}>
              <LinearGradient
                colors={[data.tint[0], data.tint[1], '#050505']}
                locations={[0, 0.65, 1]}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={styles.hero}
              >
                <Ionicons name="trophy" size={170} color="rgba(255,255,255,0.10)" style={styles.trophy} />
                <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  {STATUS_LABELS[statusOf(data)].toUpperCase()}
                </Txt>
                <Txt style={styles.heroTitle}>{data.title}</Txt>
                <Txt variant="callout" style={{ color: '#FFFFFF' }}>
                  {[formatAwardDate(data.info.date), awardWhen(data)].filter(Boolean).join(' · ')}
                </Txt>
                {[
                  data.info.location && `At ${data.info.location}`,
                  data.info.host && `Hosted by ${data.info.host}`,
                  data.info.mostNominations && `Most nominations: ${data.info.mostNominations}`,
                  data.info.mostAwards && `Most wins: ${data.info.mostAwards}`,
                ]
                  .filter(Boolean)
                  .map((line) => (
                    <Txt key={line as string} variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
                      {line}
                    </Txt>
                  ))}
              </LinearGradient>

              {yours.length > 0 && (
                <View style={styles.yours}>
                  <Txt variant="bodyStrong">Your artists here</Txt>
                  {yours.map((entry) => (
                    <Txt key={entry.artist} variant="caption" tone="secondary">
                      {entry.artist}: {entry.categories.map((c) => (c.winner ? `${c.name} (won)` : c.name)).join(', ')}
                    </Txt>
                  ))}
                </View>
              )}

              {data.categories.length > 0 && (
                <View style={styles.filters}>
                  <Chip label={`All ${data.categories.length} categories`} active={view === 'all'} onPress={() => setView('all')} />
                  {yours.length > 0 && (
                    <Chip label="With your artists" icon="heart" active={view === 'yours'} onPress={() => setView('yours')} />
                  )}
                </View>
              )}
            </View>

            {data.categories.length === 0 ? (
              <EmptyState
                icon="time-outline"
                title="Nominees not announced yet"
                message="They appear here as soon as they are announced, and Pulse will let you know."
              />
            ) : (
              categories.map((category) => (
                <View key={category.name} style={[styles.category, { marginHorizontal: gutter }]}>
                  <Txt variant="title3">{category.name}</Txt>
                  {category.nominees.map((nominee, index) => {
                    const owned = isLibraryNominee(nominee.artists, artistKeys);
                    return (
                      <Pressable
                        key={`${nominee.credit}-${nominee.work}-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${nominee.winner ? 'Winner. ' : ''}${nominee.credit}${nominee.work ? `, ${nominee.work}` : ''}`}
                        onPress={() =>
                          router.push(`/discover?q=${encodeURIComponent(nominee.work ? `${nominee.work} ${nominee.artists[0] ?? ''}` : nominee.credit)}`)
                        }
                        style={({ pressed }) => [styles.nominee, nominee.winner && styles.winner, pressed && { opacity: 0.7 }]}
                      >
                        <Ionicons
                          name={nominee.winner ? 'trophy' : 'ellipse-outline'}
                          size={nominee.winner ? 16 : 10}
                          color={nominee.winner ? '#D9A93A' : colors.textFaint}
                          style={{ width: 18, textAlign: 'center' }}
                        />
                        <View style={{ flex: 1 }}>
                          <Txt variant={nominee.winner ? 'bodyStrong' : 'body'} numberOfLines={2}>
                            {nominee.work ?? nominee.credit}
                          </Txt>
                          {nominee.work ? (
                            <Txt variant="caption" tone="muted" numberOfLines={2}>
                              {nominee.credit}
                            </Txt>
                          ) : null}
                        </View>
                        {owned && (
                          <View style={styles.ownedTag}>
                            <Txt variant="micro" tone="onAccent">
                              IN YOUR MUSIC
                            </Txt>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}

            <Pressable
              onPress={() => void WebBrowser.openBrowserAsync(data.sourceUrl)}
              accessibilityRole="link"
              style={{ paddingHorizontal: gutter, paddingTop: spacing.xl }}
            >
              <Txt variant="caption" tone="faint" align="center">
                Nominee lists from Wikipedia, shared under CC BY-SA. Tap to see the source.
              </Txt>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    hero: {
      borderRadius: radii.xl,
      padding: spacing.xl,
      paddingTop: spacing.huge,
      gap: 4,
      overflow: 'hidden',
    },
    trophy: { position: 'absolute', right: -24, top: 4 },
    heroTitle: { color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '900', letterSpacing: -0.8 },
    yours: {
      marginTop: spacing.lg,
      padding: spacing.lg,
      gap: 4,
      borderRadius: radii.lg,
      backgroundColor: colors.accentGlow,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
    category: {
      marginTop: spacing.xl,
      padding: spacing.lg,
      gap: spacing.xs,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    nominee: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      borderRadius: radii.sm,
    },
    winner: { backgroundColor: 'rgba(217,169,58,0.14)' },
    ownedTag: {
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
    },
  });
