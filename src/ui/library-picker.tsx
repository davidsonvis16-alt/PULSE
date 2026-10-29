import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@/src/core/types';
import { pluralize } from '@/src/core/format';
import { getLibraryTracks } from '@/src/db/repos/library';
import { useAsync, useDebounced } from '@/src/hooks/use-async';
import { Sheet } from '@/src/ui/sheet';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { Button } from '@/src/ui/buttons';
import { EmptyState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Picking from your own music.
 *
 * Your library is the first place a playlist should be built from, so this is a
 * plain searchable list of what you already have, with the songs already in the
 * playlist marked rather than hidden — seeing that something is in there is
 * more useful than wondering where it went.
 */
export function LibraryPicker({
  visible,
  onClose,
  onAdd,
  existingIds,
  title = 'Add from your library',
}: {
  visible: boolean;
  onClose: () => void;
  /** Returns the number added, so the sheet can confirm it. */
  onAdd: (tracks: Track[]) => Promise<void>;
  existingIds: Set<string>;
  title?: string;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Track[]>([]);
  const [saving, setSaving] = useState(false);
  const debounced = useDebounced(search.trim(), 250);

  const tracks = useAsync(
    () => getLibraryTracks({ sort: 'recent', search: debounced, limit: 300 }),
    [debounced, visible],
  );

  const close = () => {
    setPicked([]);
    setSearch('');
    onClose();
  };

  const toggle = (track: Track) => {
    setPicked((current) =>
      current.some((item) => item.id === track.id)
        ? current.filter((item) => item.id !== track.id)
        : [...current, track],
    );
  };

  const save = async () => {
    if (picked.length === 0) return;
    setSaving(true);
    try {
      await onAdd(picked);
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title={title}>
      <View style={styles.field}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search your music"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCorrect={false}
          accessibilityLabel="Search your library"
        />
      </View>

      {tracks.loading && !tracks.data ? (
        <SkeletonRows count={5} />
      ) : (
        <FlatList
          data={tracks.data ?? []}
          keyExtractor={(item) => item.id}
          style={{ maxHeight: 380, marginTop: spacing.md }}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          renderItem={({ item }) => {
            const already = existingIds.has(item.id);
            const selected = picked.some((track) => track.id === item.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected || already, disabled: already }}
                accessibilityLabel={`${item.title} by ${item.artistName}`}
                disabled={already}
                onPress={() => toggle(item)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <Artwork uri={item.artworkUrl} size={42} radius={radii.sm} />
                <View style={{ flex: 1 }}>
                  <Txt variant="callout" numberOfLines={1} tone={already ? 'muted' : 'default'}>
                    {item.title}
                  </Txt>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {already ? 'Already in this playlist' : item.artistName}
                  </Txt>
                </View>
                <Ionicons
                  name={
                    already ? 'checkmark-circle' : selected ? 'checkmark-circle' : 'ellipse-outline'
                  }
                  size={22}
                  color={already ? colors.textFaint : selected ? colors.accentInk : colors.textMuted}
                />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="musical-notes-outline"
              title={debounced ? 'Nothing matches that' : 'No music in your library yet'}
              message={debounced ? 'Try a different word.' : 'Import your music and it shows up here.'}
              compact
            />
          }
        />
      )}

      <Button
        label={picked.length > 0 ? `Add ${pluralize(picked.length, 'song')}` : 'Select songs to add'}
        full
        disabled={picked.length === 0}
        loading={saving}
        style={{ marginTop: spacing.md }}
        onPress={() => void save()}
      />
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      height: 42,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    input: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  });
