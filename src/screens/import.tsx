import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatBytes } from '@/src/downloads/manager';
import { pluralize } from '@/src/core/format';
import {
  enumeratingScanner,
  pickerScanner,
  type MusicScanner,
  type ScanDiagnostics,
} from '@/src/ingestion/scanner';
import { FIRST_BATCH, ingestEngine, MAX_PER_IMPORT, PHASE_LABELS } from '@/src/ingestion/ingest';
import { getLocalCounts } from '@/src/db/repos/local';
import { listGrooves, type Groove } from '@/src/db/repos/grooves';
import { getTopArtists } from '@/src/db/repos/history';
import { buildTasteProfile, type TasteProfile } from '@/src/discovery/taste';
import { getSetting, setSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { artworkRepair } from '@/src/ingestion/artwork/backfill';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
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
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type Stage = 'intro' | 'running' | 'background' | 'covers' | 'empty' | 'summary';

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { gutter, isTabletUp } = useResponsive();
  const toast = useToast();
  const state = useStore(ingestEngine);
  const repair = useStore(artworkRepair);

  const [stage, setStage] = useState<Stage>('intro');
  const [scanner, setScanner] = useState<MusicScanner | null>(null);
  const [checking, setChecking] = useState(true);
  const [deniedMessage, setDeniedMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ScanDiagnostics | null>(null);
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
      setDiagnostics(null);

      const target = mode === 'device' ? (scanner ?? (await enumeratingScanner())) : pickerScanner();

      if (mode === 'device' && target) {
        const permission = await target.requestPermission();
        if (permission.state !== 'granted' && permission.state !== 'limited') {
          // Say what happened here rather than starting a scan that cannot work.
          setDiagnostics(await target.diagnose());
          setStage('empty');
          return;
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
        if (mode === 'picker') {
          // The user closed the picker without choosing anything.
          setStage('intro');
          return;
        }
        // A scan that found nothing has a reason, and the user should get it.
        setDiagnostics(target ? await target.diagnose() : null);
        setStage('empty');
        return;
      }

      // On Android, ask once to keep working in the background — covers keep
      // arriving and music keeps playing with the screen off — then find covers.
      const asked = await getSetting(SETTINGS_KEYS.backgroundAsked).catch(() => null);
      if (Platform.OS === 'android' && !asked) {
        setStage('background');
        return;
      }
      await findCovers();
    },
    // findCovers is defined below and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scanner, finish, toast],
  );

  /** The cover search, shown with its progress, then the summary. */
  const findCovers = useCallback(async () => {
    setStage('covers');
    await artworkRepair.run().catch(() => undefined);
    await finish();
  }, [finish]);

  const allowBackground = useCallback(async () => {
    await setSetting(SETTINGS_KEYS.backgroundAsked, 'true');
    try {
      // Android's own "Let app always run in background?" question.
      await IntentLauncher.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', {
        data: `package:${Application.applicationId ?? 'app.pulse.music'}`,
      });
    } catch {
      // Some phones hide that question; their battery settings page does the same job.
      await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(
        () => {},
      );
    }
    await findCovers();
  }, [findCovers]);

  const done = () => {
    // Skipping counts: Pulse offers the import once, then Library is where music is added.
    void setSetting(SETTINGS_KEYS.onboardingDone, 'true');
    if (onFinished) {
      // Shown before the app's screens exist, so there is nowhere to navigate yet.
      onFinished();
      return;
    }
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
                This device does not let Pulse read your music library directly, so choose the audio
                files you want and Pulse imports those.
              </Txt>
            )}
          </View>
        )}

        {stage === 'background' && (
          <View style={[styles.centered, isTabletUp && { maxWidth: 520, alignSelf: 'center' }]}>
            <View style={styles.emptyIcon}>
              <Ionicons name="moon-outline" size={26} color={colors.accentInk} />
            </View>
            <Txt variant="title2" align="center" style={{ marginTop: spacing.md }}>
              Let Pulse keep working
            </Txt>
            <Txt variant="body" tone="secondary" align="center">
              Your songs are in. Allow Pulse to run in the background so it can finish finding
              covers and keep your music playing when the screen is off.
            </Txt>
            <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.xl }}>
              <Button label="Allow" icon="checkmark" full onPress={() => void allowBackground()} />
              <Button
                label="Not now"
                variant="ghost"
                full
                onPress={() => {
                  void setSetting(SETTINGS_KEYS.backgroundAsked, 'true');
                  void findCovers();
                }}
              />
            </View>
          </View>
        )}

        {stage === 'covers' && (
          <View style={[styles.centered, isTabletUp && { maxWidth: 520, alignSelf: 'center' }]}>
            <View style={styles.emptyIcon}>
              <Ionicons name="image-outline" size={26} color={colors.accentInk} />
            </View>
            <Txt variant="title2" align="center" style={{ marginTop: spacing.md }}>
              Finding covers
            </Txt>
            <Txt variant="body" tone="secondary" align="center">
              {repair.total > 0
                ? `${repair.checked} of ${repair.total} checked · ${pluralize(repair.found, 'cover')} found`
                : 'Checking which songs need a cover…'}
            </Txt>
            <View style={{ width: '100%', marginTop: spacing.lg }}>
              <ProgressBar progress={repair.total ? repair.checked / repair.total : 0} />
            </View>
            <Button
              label="Skip, keep going in the background"
              variant="ghost"
              onPress={() => void finish()}
              style={{ marginTop: spacing.xl }}
            />
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
                      color={status === 'pending' ? colors.textFaint : colors.accentInk}
                    />
                    <Txt variant="callout" tone={status === 'pending' ? 'faint' : 'default'}>
                      {step.label}
                    </Txt>
                    {status === 'active' && state.processed > 0 && (
                      <Txt variant="caption" tone="muted">
                        {state.total ? `${state.processed} of ${state.total}` : state.processed}
                      </Txt>
                    )}
                  </View>
                );
              })}
            </View>

            {state.firstBatchReady && state.total > FIRST_BATCH && (
              <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.xl }}>
                <Button
                  label="Start listening"
                  icon="play"
                  full
                  onPress={() => {
                    // The import carries on in the background; Home shows its progress.
                    void setSetting(SETTINGS_KEYS.onboardingDone, 'true');
                    done();
                  }}
                />
                <Txt variant="caption" tone="muted" align="center">
                  Your first {FIRST_BATCH} songs are ready. The other{' '}
                  {pluralize(state.total - FIRST_BATCH, 'song')} keep importing while you listen.
                </Txt>
              </View>
            )}

            <Button
              label="Stop"
              variant="ghost"
              onPress={() => ingestEngine.cancel()}
              style={{ marginTop: spacing.xl }}
            />
          </View>
        )}

        {stage === 'empty' && (
          <View style={[styles.centered, isTabletUp && { maxWidth: 520, alignSelf: 'center' }]}>
            <View style={styles.emptyIcon}>
              <Ionicons name="help-circle-outline" size={28} color={colors.warning} />
            </View>
            <Txt variant="title2" align="center" style={{ marginTop: spacing.md }}>
              Pulse found no music to import
            </Txt>
            <Txt variant="body" tone="secondary" align="center">
              {diagnostics?.summary ?? 'The scan came back empty.'}
            </Txt>
            <Txt variant="body" tone="muted" align="center" style={{ marginTop: spacing.sm }}>
              {diagnostics?.suggestion ??
                'Choose your audio files by hand and Pulse will import them the same way.'}
            </Txt>

            {diagnostics && (
              <View style={styles.diagnostics}>
                <Detail label="Media access" value={permissionLabel(diagnostics)} />
                <Detail
                  label="Audio files visible"
                  value={diagnostics.audioCount === null ? 'could not check' : String(diagnostics.audioCount)}
                />
                <Detail
                  label="Media of any kind"
                  value={
                    diagnostics.anyMediaCount === null ? 'could not check' : String(diagnostics.anyMediaCount)
                  }
                />
              </View>
            )}

            <View style={{ gap: spacing.md, width: '100%', marginTop: spacing.xl }}>
              <Button
                label="Choose my music files"
                icon="folder-open-outline"
                full
                onPress={() => void start('picker')}
              />
              {scanner && (
                <Button
                  label="Scan this device again"
                  variant="secondary"
                  icon="refresh"
                  full
                  onPress={() => void start('device')}
                />
              )}
              <Pressable onPress={done} accessibilityRole="button">
                <Txt variant="callout" tone="muted" align="center">
                  Skip for now
                </Txt>
              </Pressable>
            </View>
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
              {state.remaining > 0 && (
                <Txt variant="callout" tone="accent" align="center" style={{ marginTop: spacing.sm }}>
                  Pulse brought in {MAX_PER_IMPORT} songs to start. You have{' '}
                  {pluralize(state.remaining, 'more song')} — tap “Add more music” for the next{' '}
                  {Math.min(MAX_PER_IMPORT, state.remaining)} whenever you like.
                </Txt>
              )}
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

function Detail({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.detail}>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      <Txt variant="caption">{value}</Txt>
    </View>
  );
}

function permissionLabel(diagnostics: ScanDiagnostics): string {
  if (!diagnostics.available) return 'not supported here';
  switch (diagnostics.permission.state) {
    case 'granted':
      return 'granted';
    case 'limited':
      return 'granted for selected items';
    case 'denied':
      return diagnostics.permission.blocked ? 'denied, and will not ask again' : 'denied';
    case 'undetermined':
      return 'not asked yet';
    default:
      return 'unavailable';
  }
}

function Assurance({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.assurance}>
      <Ionicons name={icon} size={17} color={colors.accentInk} />
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
      borderWidth: 1,
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
      borderWidth: 1,
      borderColor: colors.border,
    },
    grooveDot: { width: 10, height: 10, borderRadius: 5 },
    emptyIcon: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    diagnostics: {
      width: '100%',
      marginTop: spacing.xl,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      gap: 6,
    },
    detail: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  });
