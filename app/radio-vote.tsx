import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { initialsOf, pluralize } from '@/src/core/format';
import { useAuth } from '@/src/auth/auth';
import { freestyleTrack } from '@/src/radio/freestyles';
import {
  fetchBallot,
  fetchLastWeekResults,
  submitVotes,
  TOP_PICKS,
  votingClosesIn,
  type BallotEntry,
} from '@/src/radio/votes';
import { playerStore } from '@/src/audio/player';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { SketchArt } from '@/src/ui/sketch-art';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { fonts, radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Songs of the Week: the twenty freestyles uploaded to Pulse Radio this week,
 * and each listener's top five. Listen on the cards, tap Vote in the order you
 * rank them, send. The winners are shown the week after.
 */
export default function RadioVoteScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const toast = useToast();
  const { session } = useAuth();
  const { gutter, pageWidth: width, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();

  const ballot = useAsync(() => fetchBallot(), []);
  const results = useAsync(() => fetchLastWeekResults().catch(() => []), []);
  const entries = useMemo(() => ballot.data?.entries ?? [], [ballot.data]);

  // The listener's picks, first place first, starting from what they sent before.
  const [picks, setPicks] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const sent = entries
      .filter((entry) => entry.myRank != null)
      .sort((a, b) => a.myRank! - b.myRank!)
      .map((entry) => entry.id);
    setPicks(sent);
  }, [entries]);

  const me = session?.user.id;
  const eligible = entries.filter((entry) => entry.userId !== me).length;
  const needed = Math.min(TOP_PICKS, eligible);
  const full = picks.length >= needed;
  const alreadySent = entries.some((entry) => entry.myRank != null);

  const toggle = (entry: BallotEntry) => {
    setPicks((current) =>
      current.includes(entry.id)
        ? current.filter((id) => id !== entry.id)
        : current.length >= TOP_PICKS
          ? current
          : [...current, entry.id],
    );
  };

  const send = async () => {
    setSending(true);
    try {
      await submitVotes(picks);
      toast('Your top 5 is in. Results come out on Monday.', 'success');
      ballot.reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not send your votes', 'error');
    } finally {
      setSending(false);
    }
  };

  const listen = (index: number) => {
    void playerStore.playQueue(entries.map(freestyleTrack), {
      startIndex: index,
      context: 'radio',
      contextLabel: 'Songs of the Week',
    });
  };

  const left = votingClosesIn();
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const columns = isTabletUp ? Math.max(3, Math.floor((width - gutter * 2 + spacing.xl) / (210 + spacing.xl))) : 2;
  const cardWidth = (width - gutter * 2 - spacing.lg * (columns - 1)) / columns;
  const hero = entries[0]?.avatarUrl ?? null;

  return (
    <Screen>
      <PageHeader title="Songs of the Week" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset + 96 }}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        <View style={[styles.hero, { marginHorizontal: gutter }]}>
          {hero ? (
            <Image source={{ uri: hero }} blurRadius={40} contentFit="cover" style={StyleSheet.absoluteFill} />
          ) : null}
          <LinearGradient
            colors={['rgba(10,11,10,0.92)', 'rgba(10,11,10,0.45)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.liveTag}>
            <View style={styles.liveDot} />
            <Txt variant="micro" uppercase tone="onAccent">
              Pulse Radio
            </Txt>
          </View>
          <Txt style={[styles.marker, { fontSize: isTabletUp ? 30 : 24, lineHeight: isTabletUp ? 36 : 30 }]}>
            Songs of the Week
          </Txt>
          <Txt variant="body" style={{ color: 'rgba(255,255,255,0.85)', maxWidth: 560 }}>
            {pluralize(entries.length, 'song')} uploaded to Pulse Radio this week. Listen, then pick your top 5. The
            winners are announced on Monday.
          </Txt>
          <Txt variant="callout" style={{ color: colors.accent, marginTop: spacing.sm }}>
            Voting closes in {days}d {hours}h
          </Txt>
        </View>

        {/* Your top five stays in view while you scroll the ballot. */}
        <View style={[styles.trayWrap, { paddingHorizontal: gutter }]}>
          <View style={styles.tray}>
            <View style={{ minWidth: 110 }}>
              <Txt variant="title3">Your top 5</Txt>
              <Txt variant="caption" tone="muted">
                {picks.length} of {needed || TOP_PICKS} picked
              </Txt>
            </View>
            <View style={styles.slots}>
              {Array.from({ length: TOP_PICKS }, (_, slot) => {
                const entry = entries.find((e) => e.id === picks[slot]);
                return (
                  <View
                    key={slot}
                    style={[
                      styles.slot,
                      entry && { borderColor: colors.accent, borderStyle: 'solid', backgroundColor: colors.accentGlow },
                    ]}
                  >
                    <View style={[styles.slotNumber, entry && { backgroundColor: colors.accent }]}>
                      <Txt variant="micro" style={{ color: entry ? colors.onAccent : colors.textMuted }}>
                        {slot + 1}
                      </Txt>
                    </View>
                    {entry && isTabletUp ? (
                      <Txt variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                        {entry.title}
                      </Txt>
                    ) : null}
                  </View>
                );
              })}
            </View>
            <Button
              label={alreadySent ? 'Update my votes' : 'Send my votes'}
              disabled={!full || picks.length === 0}
              loading={sending}
              onPress={() => void send()}
            />
          </View>
        </View>

        <View style={{ paddingHorizontal: gutter, marginTop: spacing.lg }}>
          {ballot.loading && !ballot.data ? (
            <SkeletonRows count={6} />
          ) : ballot.error ? (
            <ErrorState error={ballot.error} onRetry={ballot.reload} />
          ) : entries.length === 0 ? (
            <EmptyState
              icon="mic-outline"
              title="Nothing uploaded this week yet"
              message="The first 20 freestyles uploaded this week make the ballot. Yours could be one."
              actionLabel="Upload a freestyle"
              onAction={() => router.push('/freestyle')}
              compact
            />
          ) : (
            <View style={styles.grid}>
              {entries.map((entry, index) => {
                const rank = picks.indexOf(entry.id);
                const mine = entry.userId === me;
                const locked = rank < 0 && picks.length >= TOP_PICKS;
                return (
                  <View
                    key={entry.id}
                    style={[styles.card, { width: cardWidth }, rank >= 0 && { borderColor: colors.accent }]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Listen to ${entry.title} by ${entry.artistName}`}
                      onPress={() => listen(index)}
                      style={[styles.cardArt, { height: cardWidth }]}
                    >
                      {entry.avatarUrl ? (
                        <SketchArt uri={entry.avatarUrl} />
                      ) : (
                        <View style={styles.initials}>
                          <Txt style={styles.initialsText}>{initialsOf(entry.artistName)}</Txt>
                        </View>
                      )}
                      <View style={styles.playDot}>
                        <Ionicons name="play" size={14} color="#0A0B0A" style={{ marginLeft: 2 }} />
                      </View>
                      {rank >= 0 && (
                        <View style={styles.rankBadge}>
                          <Txt variant="title3" tone="onAccent">
                            {rank + 1}
                          </Txt>
                        </View>
                      )}
                    </Pressable>
                    <View style={styles.cardBody}>
                      <Txt variant="callout" numberOfLines={1}>
                        {entry.title}
                      </Txt>
                      <Txt variant="caption" tone="muted" numberOfLines={1}>
                        {entry.artistName}
                        {alreadySent ? ` · ${pluralize(entry.points, 'point')}` : ''}
                      </Txt>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: rank >= 0, disabled: mine || locked }}
                        disabled={mine || locked}
                        onPress={() => toggle(entry)}
                        style={[
                          styles.vote,
                          rank >= 0
                            ? { borderWidth: 1, borderColor: colors.accentInk }
                            : mine || locked
                              ? { backgroundColor: colors.cardHigh }
                              : { backgroundColor: colors.accent },
                        ]}
                      >
                        <Txt
                          variant="callout"
                          style={{
                            color:
                              rank >= 0 ? colors.accentInk : mine || locked ? colors.textFaint : colors.onAccent,
                          }}
                        >
                          {mine ? 'Your song' : rank >= 0 ? `Remove #${rank + 1}` : locked ? 'Top 5 is full' : 'Vote'}
                        </Txt>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {!!results.data?.length && (
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.xxxl, gap: spacing.sm }}>
            <Txt variant="title2">{"Last week's top 5"}</Txt>
            {results.data.map((result) => (
              <Pressable
                key={result.freestyle.id}
                accessibilityRole="button"
                accessibilityLabel={`Number ${result.place}: ${result.freestyle.title}`}
                onPress={() =>
                  void playerStore.playQueue(
                    results.data!.map((r) => freestyleTrack(r.freestyle)),
                    { startIndex: result.place - 1, context: 'radio', contextLabel: "Last week's top 5" },
                  )
                }
                style={({ pressed }) => [styles.resultRow, pressed && { opacity: 0.8 }]}
              >
                <Txt variant="title2" tone="accent" style={{ width: 28 }}>
                  {result.place}
                </Txt>
                <Artwork uri={result.freestyle.avatarUrl} size={48} radius={radii.sm} />
                <View style={{ flex: 1 }}>
                  <Txt variant="callout" numberOfLines={1}>
                    {result.freestyle.title}
                  </Txt>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {result.freestyle.artistName} · {pluralize(result.points, 'point')}
                  </Txt>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    hero: {
      borderRadius: radii.xl,
      overflow: 'hidden',
      padding: spacing.xxl,
      gap: spacing.sm,
      backgroundColor: '#141614',
      minHeight: 220,
      justifyContent: 'flex-end',
    },
    liveTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      backgroundColor: colors.accent,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.pill,
    },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.onAccent },
    marker: {
      fontFamily: fonts.display,
      color: '#FFFFFF',
      letterSpacing: -0.4,
    },
    trayWrap: { paddingTop: spacing.lg, backgroundColor: colors.background },
    tray: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.backgroundElevated,
    },
    slots: { flex: 1, minWidth: 220, flexDirection: 'row', gap: spacing.sm },
    slot: {
      flex: 1,
      minWidth: 0,
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 6,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
    },
    slotNumber: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cardHigh,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
    card: {
      borderRadius: radii.lg,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: colors.card,
    },
    cardArt: { width: '100%', overflow: 'hidden', backgroundColor: colors.cardRaised },
    initials: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardHigh },
    initialsText: { fontFamily: fonts.display, fontSize: 32, color: colors.textSecondary },
    playDot: {
      position: 'absolute',
      left: 10,
      bottom: 10,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
    },
    rankBadge: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardBody: { padding: spacing.md, gap: 2 },
    vote: {
      marginTop: spacing.sm,
      height: 40,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  });
