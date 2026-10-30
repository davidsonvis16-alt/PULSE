import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { formatDuration } from '@/src/core/format';
import { playerStore } from '@/src/audio/player';
import { radioStation } from '@/src/radio/station';
import {
  MAX_FREESTYLE_MS,
  MAX_TITLE_LENGTH,
  measureDuration,
  uploadFreestyle,
  validateFreestyle,
} from '@/src/radio/freestyles';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { Screen } from '@/src/ui/screen';
import { Txt } from '@/src/ui/text';
import { Button, IconButton } from '@/src/ui/buttons';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

interface Take {
  uri: string;
  durationMs: number | null;
  mimeType: string | null;
  /** Where it came from, for the label under the preview. */
  origin: 'recorded' | 'file';
  name?: string;
}

/**
 * Drop a freestyle.
 *
 * Record one right here or pick a recording already on the phone, hear it
 * back, name it, and put it on Pulse Radio for everyone.
 */
export function FreestyleUploadScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const toast = useToast();
  const { gutter, isTabletUp } = useResponsive();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 250);

  const [take, setTake] = useState<Take | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<null | 'recording' | 'reading' | 'uploading'>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useAudioPlayer(take?.uri ? { uri: take.uri } : null);
  const previewStatus = useAudioPlayerStatus(preview);

  const recordingRef = useRef(false);
  recordingRef.current = recording.isRecording;

  // The recorder changes the phone's audio session; give it back to playback
  // whenever this screen goes away, however it goes away.
  useEffect(
    () => () => {
      if (recordingRef.current) void recorder.stop().catch(() => {});
      void playerStore.restoreAudioMode();
    },
    [recorder],
  );

  const stopRecording = useCallback(async () => {
    await recorder.stop();
    const durationMs = recording.durationMillis || (recorder.uri ? await measureDuration(recorder.uri) : null);
    await playerStore.restoreAudioMode();
    setBusy(null);
    if (recorder.uri) {
      setTake({ uri: recorder.uri, durationMs, mimeType: 'audio/mp4', origin: 'recorded' });
    }
  }, [recorder, recording.durationMillis]);

  // A freestyle is at most ten minutes; the recorder stops itself there.
  useEffect(() => {
    if (recording.isRecording && recording.durationMillis >= MAX_FREESTYLE_MS) void stopRecording();
  }, [recording.isRecording, recording.durationMillis, stopRecording]);

  const startRecording = useCallback(async () => {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError('Pulse needs the microphone to record. You can allow it in your phone settings.');
      return;
    }
    // Whatever is playing would end up on the recording.
    playerStore.pause();
    preview.pause();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setTake(null);
    setBusy('recording');
  }, [recorder, preview]);

  const pickFile = useCallback(async () => {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setBusy('reading');
    const durationMs = await measureDuration(asset.uri).catch(() => null);
    setBusy(null);
    setTake({
      uri: asset.uri,
      durationMs,
      mimeType: asset.mimeType ?? null,
      origin: 'file',
      name: asset.name,
    });
    if (!title.trim() && asset.name) setTitle(asset.name.replace(/\.[^.]+$/, '').slice(0, MAX_TITLE_LENGTH));
  }, [title]);

  const upload = useCallback(async () => {
    if (!take) return;
    const problem = validateFreestyle(title, take.durationMs);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy('uploading');
    preview.pause();
    try {
      await uploadFreestyle({ uri: take.uri, title, durationMs: take.durationMs, mimeType: take.mimeType });
      void radioStation.load();
      toast('Your freestyle is on the radio', 'success');
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload did not go through.');
    } finally {
      setBusy(null);
    }
  }, [take, title, preview, toast, router]);

  const isRecording = busy === 'recording';
  const previewing = previewStatus.playing;

  return (
    <Screen>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <IconButton name="close" label="Close" onPress={() => router.back()} />
        <Txt variant="title3" style={{ flex: 1 }}>
          Drop a freestyle
        </Txt>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingHorizontal: gutter },
          isTabletUp && { maxWidth: 520, alignSelf: 'center', width: '100%' },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Txt variant="body" tone="muted" align="center">
          Everyone tuned in to Pulse Radio hears it, live. Up to 10 minutes, your own voice only.
        </Txt>

        <View style={styles.recordArea}>
          <IconButton
            name={isRecording ? 'stop' : 'mic'}
            label={isRecording ? 'Stop recording' : 'Start recording'}
            size={40}
            color={colors.onAccent}
            style={StyleSheet.flatten([styles.recordButton, isRecording && { backgroundColor: colors.danger }])}
            disabled={busy === 'uploading' || busy === 'reading'}
            onPress={() => void (isRecording ? stopRecording() : startRecording())}
          />
          <Txt variant="title2">
            {isRecording
              ? clock(recording.durationMillis)
              : take
                ? clock(take.durationMs ?? 0)
                : 'Tap to record'}
          </Txt>
          {isRecording && (
            <Txt variant="caption" tone="danger">
              Recording…
            </Txt>
          )}
        </View>

        {!isRecording && (
          <Button
            label={busy === 'reading' ? 'Reading the file…' : 'Pick a recording from this phone'}
            icon="document-outline"
            variant="secondary"
            full
            loading={busy === 'reading'}
            disabled={busy === 'uploading'}
            onPress={() => void pickFile()}
          />
        )}

        {take && !isRecording && (
          <View style={styles.preview}>
            <IconButton
              name={previewing ? 'pause-circle' : 'play-circle'}
              label={previewing ? 'Pause preview' : 'Hear it back'}
              size={40}
              color={colors.accentInk}
              onPress={() => {
                if (previewing) preview.pause();
                else {
                  playerStore.pause();
                  if (previewStatus.didJustFinish || previewStatus.currentTime >= previewStatus.duration) {
                    void preview.seekTo(0);
                  }
                  preview.play();
                }
              }}
            />
            <View style={{ flex: 1 }}>
              <Txt variant="callout" numberOfLines={1}>
                {take.origin === 'recorded' ? 'Your recording' : (take.name ?? 'Your file')}
              </Txt>
              <Txt variant="caption" tone="muted">
                {take.durationMs ? formatDuration(take.durationMs) : 'Length unknown'}
              </Txt>
            </View>
            <Ionicons name="checkmark-circle" size={20} color={colors.accentInk} />
          </View>
        )}

        {take && !isRecording && (
          <View style={{ gap: 6 }}>
            <Txt variant="caption" tone="muted">
              Name it
            </Txt>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="What is this one called?"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              accessibilityLabel="Freestyle name"
            />
          </View>
        )}

        {error && (
          <Txt variant="caption" tone="danger" align="center">
            {error}
          </Txt>
        )}

        {take && !isRecording && (
          <Button
            label={busy === 'uploading' ? 'Putting it on air…' : 'Put it on the radio'}
            icon="radio"
            full
            loading={busy === 'uploading'}
            onPress={() => void upload()}
          />
        )}

        <Txt variant="caption" tone="faint" align="center">
          Only upload your own freestyles. Listeners can report a freestyle, and ones reported by
          several people come off air.
        </Txt>
      </ScrollView>
    </Screen>
  );
}

/** m:ss, starting from 0:00 — a recording timer, not a song length. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
    body: { gap: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.huge },
    recordArea: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
    recordButton: {
      width: 96,
      height: 96,
      borderRadius: 48,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    preview: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
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
