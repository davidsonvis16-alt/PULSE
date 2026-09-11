import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatBytes } from '@/src/downloads/manager';
import { pluralize } from '@/src/core/format';
import { enumeratingScanner, pickerScanner, type MusicScanner } from '@/src/ingestion/scanner';
import { ingestEngine, PHASE_LABELS } from '@/src/ingestion/ingest';
import { getLocalCounts } from '@/src/db/repos/local';
import { listGrooves, type Groove } from '@/src/db/repos/grooves';
import { getTopArtists } from '@/src/db/repos/history';
import { buildTasteProfile, type TasteProfile } from '@/src/discovery/taste';
import { setSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { useStore } from '@/src/hooks/use-store';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { Screen } from '@/src/ui/screen';
import { PulseLogo } from '@/src/ui/logo';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { ProgressBar } from '@/src/ui/states';
import { StatTile } from '@/src/ui/cards';
import { colors, radii, spacing } from '@/src/theme/tokens';

type Stage = 'intro' | 'running' | 'summary';

const STEPS = [
  { phase: 'finding', label: 'Finding songs' },
  { phase: 'reading', label: 'Reading track details' },
  { phase: 'identifying', label: 'Identifying tracks' },
  { phase: 'artwork', label: 'Finding artwork' },
  { phase: 'analyzing', label: 'Analysing your collection' },
  { phase: 'grooving', label: 'Building your Grooves' },
] as const;

/**
 * The import experience.
 *
 * This is the first real thing Pulse does, and it is the thing the rest of the
 * app is built on: the user's own collection becomes their library, their
 * artwork, their Grooves and their taste profile in one pass.
 */
export function ImportScreen({ onFinished }: { onFinished?: () => void } = {}) {
  const router = useRouter();
  const { gutter, isTabletUp } = useResponsive();
  const toast = useToast();
  const state = useStore(ingestEngine);

  const [stage, setStage] = useState<Stage>('intro');
  const [scanner, setScanner] = useState<MusicScanner | null>(null);
  const [checking, setChecking] = useState(true);
  const [deniedMessage, setDeniedMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    counts: Awaited<ReturnType<typeof getLocalCounts>>;
    grooves: Groove[];
    profile: TasteProfile;
    topArtists: Awaited<ReturnType<typeof getTopArtists>>;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      setScanner(await enumeratingScanner());
      setChecking(false);
    })();
  }, []);

  const finish = useCallback(async () => {
    const [counts, grooves, profile, topArtists] = await Promise.all([
      getLocalCounts(),
      listGrooves(),
      buildTasteProfile({ fresh: true }),
      getTopArtists('all', 8),
    ]);
    setSummary({ counts, grooves, profile, topArtists });
    setStage('summary');
    await setSetting(SETTINGS_KEYS.onboardingDone, 'true');
  }, []);

  const start = useCallback(
    async (mode: 'device' | 'picker') => {
      setDeniedMessage(null);

      if (mode === 'device') {
        const target = scanner ?? (await enumeratingScanner());
        if (target) {
          const permission = await target.requestPermission();
          if (permission.state !== 'granted' && permission.state !== 'limited') {
            setDeniedMessage(
              permission.blocked
                ? 'Music access is turned off for Pulse in your system settings. You can still choose files by hand.'
                : 'Pulse needs permission to read the music on this device. You can also choose files by hand instead.',
            );
            return;
          }
        }
      }

      setStage('running');
      const result = await ingestEngine.run({ mode });
      if (result.phase === 'error') {
        toast(result.error ?? 'Importing failed', 'error');
        setStage('intro');
        return;
      }
      if (result.found === 0) {
        toast(
          mode === 'picker'
            ? 'No files were chosen.'
            : 'Pulse did not find any audio files on this device.',
        );
        setStage('intro');
        return;
      }
      await finish();
    },
    [scanner, finish, toast],
  );

  const done = () => {
    onFinished?.();
    router.replace('/');
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: spacing.huge }}
        showsVerticalScrollIndicator={false}
      >
        {stage === 'intro' && (
          <View style={[styles.centered, isTabletUp && { maxWidth: 520, alignSelf: 'center' }]}>
            <PulseLogo size={56} />
            <Txt variant="title1" align="center" style={{ marginTop: spacing.xl }}>
              Let us understand your music
            </Txt>
            <Txt variant="body" tone="muted" align="center">
              Pulse reads the songs already on your device, gives them real artwork, groups them into
              Grooves and learns your taste from what you actually own.
            </Txt>

            <View style={styles.assurances}>
              <Assurance icon="musical-notes-outline" text="Reads titles, artists, albums and covers from your files" />
              <Assurance icon="image-outline" text="Finds official artwork for anything missing one" />
              <Assurance icon="color-wand-outline" text="Builds Grooves from what is actually in your collection" />
              <Assurance icon="lock-closed-outline" text="Never changes your files and never uploads them" />
            </View>

            {deniedMessage && (
              <View style={styles.notice}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
                <Txt variant="caption" tone="secondary" style={{ flex: 1 }}>
                  {deniedMessage}
                </Txt>
              </View>
            )}

            <View style={{ gap: spacing.md, width: '100%', marginTop: spacing.xl }}>
              {!checking && scanner && (
                <Button
                  label="Allow music access"
                  icon="folder-open-outline"
                  full
                  onPress={() => void start('device')}
                />
              )}
              <Button
                label={scanner ? 'Choose files instead' : 'Choose your music files'}
                icon="add-circle-outline"
                variant={scanner ? 'secondary' : 'primary'}
                full
                onPress={() => void start('picker')}
              />
              <Pressable onPress={done} accessibilityRole="button">
                <Txt variant="callout" tone="muted" align="center">
                  Skip for now
                </Txt>
              </Pressable>
            </View>

            {!checking && !scanner && Platform.OS === 'ios' && (
              <Txt variant="caption" tone="faint" align="center" style={{ marginTop: spacing.md }}>
                iOS keeps the Music app&apos;s library private to Apple, so Pulse imports the audio
                files you choose from Files or iCloud Drive instead.
              </Txt>
            )}
          </View>
        )}

        {stage === 'running' && (
          <View style={[styles.centered, isTabletUp && { maxWidth: 520, alignSelf: 'center' }]}>
            <PulseLogo size={48} />
            <Txt variant="title2" align="center" style={{ marginTop: spacing.xl }}>
              {PHASE_LABELS[state.phase]}
            </Txt>
            {state.found > 0 && (
              <Txt variant="title3" tone="accent">
                {pluralize(state.found, 'song')} found
              </Txt>
            )}

            <ProgressBar progress={state.progress} height={6} style={{ width: '100%', marginTop: spacing.xl }} />

            <View style={styles.steps}>
              {STEPS.map((step) => {
                const order = STEPS.findIndex((s) => s.phase === step.phase);
                const current = STEPS.findIndex((s) => s.phase === state.phase);
                const status = current > order ? 'done' : current === order ? 'active' : 'pending';
                return (
                  <View key={step.phase} style={styles.step}>
                    <Ionicons
                      name={
                        status === 'done'
                          ? 'checkmark-circle'
                          : status === 'active'
                            ? 'ellipse'
                            : 'ellipse-outline'
                      }
                      size={16}
                      color={status === 'pending' ? colors.textFaint : colors.accent}
                    />
                    <Txt variant="callout" tone={status === 'pending' ? 'faint' : 'default'}>
                      {step.label}
                    </Txt>
                    {status === 'active' && state.processed > 0 && (
                      <Txt variant="caption" tone="muted">
                        {state.processed}
                      </Txt>
                    )}
                  </View>
                );
              })}
            </View>

            <Button
              label="Stop"
              variant="ghost"
              onPress={() => ingestEngine.cancel()}
              style={{ marginTop: spacing.xl }}
            />
          </View>
        )}

        {stage === 'summary' && summary && (
          <View style={[isTabletUp && { maxWidth: 620, alignSelf: 'center', width: '100%' }]}>
            <View style={styles.centered}>
              <PulseLogo size={44} />
              <Txt variant="title1" align="center" style={{ marginTop: spacing.lg }}>
                Your Pulse is ready
              </Txt>
              <Txt variant="body" tone="muted" align="center">
                Everything from here on is built from this.
              </Txt>
            </View>

            <View style={[styles.tiles, { marginTop: spacing.xxl }]}>
              <StatTile value={String(summary.counts.tracks)} label="songs" />
              <StatTile value={String(summary.counts.artists)} label="artists" />
              <StatTile value={String(summary.counts.albums)} label="albums" />
            </View>
            <View style={[styles.tiles, { marginTop: spacing.md }]}>
              <StatTile value={String(summary.grooves.length)} label="Grooves" />
              <StatTile value={String(state.artworkFound)} label="covers found" />
              <StatTile value={formatBytes(summary.counts.bytes)} label="on device" />
            </View>

            {summary.counts.needsIdentification > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/identify')}
                style={({ pressed }) => [styles.notice, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="help-circle-outline" size={18} color={colors.warning} />
                <View style={{ flex: 1 }}>
                  <Txt variant="callout">
                    {pluralize(summary.counts.needsIdentification, 'track')} need identifying
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    Pulse would rather ask than attach the wrong artist. Review them now or later.
                  </Txt>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            )}

            {summary.topArtists.length > 0 && (
              <View style={{ marginTop: spacing.xxl }}>
                <Txt variant="title3">Your top artists</Txt>
                <View style={styles.artistRow}>
                  {summary.topArtists.slice(0, 6).map((artist) => (
                    <View key={artist.name} style={{ alignItems: 'center', width: 78 }}>
                      <Artwork uri={artist.imageUrl} size={62} rounded />
                      <Txt variant="caption" numberOfLines={1} align="center" style={{ marginTop: 6 }}>
                        {artist.name}
                      </Txt>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {summary.grooves.length > 0 && (
              <View style={{ marginTop: spacing.xxl }}>
                <Txt variant="title3">Your Grooves</Txt>
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                  {summary.grooves.slice(0, 5).map((groove) => (
                    <Pressable
                      key={groove.id}
                      accessibilityRole="button"
                      onPress={() => router.push(`/groove/${groove.id}`)}
                      style={({ pressed }) => [styles.grooveRow, pressed && { opacity: 0.8 }]}
                    >
                      <View
                        style={[
                          styles.grooveDot,
                          { backgroundColor: groove.accent ?? colors.accent },
                        ]}
                      />
                      <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                        {groove.name}
                      </Txt>
                      <Txt variant="caption" tone="muted">
                        {pluralize(groove.trackCount, 'song')}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {summary.profile.genres.length > 0 && (
              <Txt variant="caption" tone="muted" style={{ marginTop: spacing.xl }}>
                Pulse will keep recommendations close to{' '}
                {summary.profile.genres.slice(0, 3).map((genre) => genre.genre).join(', ')} until
                you show it otherwise.
              </Txt>
            )}

            <View style={{ gap: spacing.md, marginTop: spacing.xxl }}>
              <Button label="Start listening" full onPress={done} />
              <Button
                label="Add more music"
                variant="secondary"
                full
                onPress={() => {
                  setStage('intro');
                  ingestEngine.reset();
                }}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Assurance({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.assurance}>
      <Ionicons name={icon} size={17} color={colors.accent} />
      <Txt variant="callout" tone="secondary" style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

/** Kept for the Library screen's "add more" entry point. */
export async function quickImport(mode: 'device' | 'picker' = 'picker') {
  if (mode === 'picker') return ingestEngine.run({ mode: 'picker' });
  const scanner = (await enumeratingScanner()) ?? pickerScanner();
  const permission = await scanner.requestPermission();
  if (permission.state !== 'granted' && permission.state !== 'limited') return null;
  return ingestEngine.run({ mode: 'device' });
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', paddingTop: spacing.huge, gap: spacing.xs, width: '100%' },
  assurances: { gap: spacing.md, marginTop: spacing.xxl, width: '100%' },
  assurance: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  steps: { gap: spacing.md, marginTop: spacing.xxl, width: '100%' },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tiles: { flexDirection: 'row', gap: spacing.md },
  artistRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  grooveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.card,
  },
  grooveDot: { width: 10, height: 10, borderRadius: 5 },
});
