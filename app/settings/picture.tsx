import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getHeadlines } from '@/src/news/headlines';
import { useNow } from '@/src/news/live';
import { avatarSchedule, pickAvatarPhoto } from '@/src/profile/avatar';
import {
  FEELINGS,
  getFeeling,
  nextChangeAt,
  resizeSlots,
  slotIndexAt,
  slotLabel,
  SLOT_COUNTS,
  type AvatarLook,
  type AvatarSchedule,
} from '@/src/profile/schedule';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useStore } from '@/src/hooks/use-store';
import { Chip } from '@/src/ui/buttons';
import { LookBadge, ProfileAvatar } from '@/src/ui/profile-avatar';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { SectionHeader } from '@/src/ui/section';
import { Sheet, SheetAction } from '@/src/ui/sheet';
import { useToast } from '@/src/ui/toast';
import { Txt } from '@/src/ui/text';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Profile picture through the day.
 *
 * The day is split into equal parts and each part gets its own picture — how
 * you feel, a photo of your own, or a story from the news. Pulse switches to
 * the next one as the day moves on, and starts over at midnight.
 */
export default function PictureSettings() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const toast = useToast();
  const { schedule } = useStore(avatarSchedule);
  const [choosing, setChoosing] = useState<number | null>(null);
  const now = useNow();

  const count = schedule.slots.length;
  const current = slotIndexAt(count, new Date(now));

  const save = (next: AvatarSchedule) =>
    avatarSchedule.save(next).catch(() => toast('Could not save your picture schedule', 'error'));

  const setLook = (index: number, look: AvatarLook | null) => {
    const slots = [...schedule.slots];
    slots[index] = look;
    // Choosing a picture is a clear sign the listener wants the schedule on.
    void save({ enabled: look ? true : schedule.enabled, slots });
    setChoosing(null);
  };

  const choosePhoto = async (index: number) => {
    try {
      const uri = await pickAvatarPhoto();
      if (uri) setLook(index, { kind: 'photo', uri });
    } catch {
      toast('Could not use that photo', 'error');
    }
  };

  return (
    <Screen>
      <PageHeader title="Profile picture" subtitle="A different look for each part of the day" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.preview}>
          <ProfileAvatar size={96} />
          <Txt variant="caption" tone="muted" align="center">
            {schedule.enabled
              ? `Showing the ${slotLabel(current, count)} picture${
                  count > 1 ? ` · changes at ${formatTime(nextChangeAt(count, new Date(now)))}` : ''
                }`
              : 'Your usual picture'}
          </Txt>
        </View>

        <View style={styles.group}>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">Change through the day</Txt>
              <Txt variant="caption" tone="muted">
                Your picture follows the schedule below and starts over every midnight. A part left
                empty shows your usual picture.
              </Txt>
            </View>
            <Switch
              value={schedule.enabled}
              onValueChange={(enabled) => void save({ ...schedule, enabled })}
              trackColor={{ true: colors.accent, false: colors.cardHigh }}
              thumbColor={colors.text}
              accessibilityLabel="Change profile picture through the day"
            />
          </View>
        </View>

        <SectionHeader title="Split the day into" style={{ marginTop: spacing.xxl }} />
        <View style={styles.chips}>
          {SLOT_COUNTS.map((value) => (
            <Chip
              key={value}
              label={value === 1 ? 'One' : `${value} parts`}
              active={count === value}
              onPress={() => void save({ ...schedule, slots: resizeSlots(schedule.slots, value) })}
            />
          ))}
        </View>
        <Txt variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
          {count === 1
            ? 'One picture for the whole day.'
            : `Each part is ${24 / count} hours.`}
        </Txt>

        <SectionHeader title="Your day" style={{ marginTop: spacing.xxl }} />
        <View style={styles.group}>
          {schedule.slots.map((look, index) => (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={`Choose the picture for ${slotLabel(index, count)}`}
              onPress={() => setChoosing(index)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.divider,
                pressed && { opacity: 0.7 },
              ]}
            >
              {look ? (
                <LookBadge look={look} size={44} />
              ) : (
                <View style={styles.empty}>
                  <Ionicons name="add" size={20} color={colors.textMuted} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.slotTitle}>
                  <Txt variant="bodyStrong">{slotLabel(index, count)}</Txt>
                  {schedule.enabled && index === current && (
                    <Txt variant="micro" tone="accent" uppercase>
                      Now
                    </Txt>
                  )}
                </View>
                <Txt variant="caption" tone="muted" numberOfLines={1}>
                  {describe(look)}
                </Txt>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <LookChooser
        index={choosing}
        count={count}
        hasLook={choosing !== null && !!schedule.slots[choosing]}
        onClose={() => setChoosing(null)}
        onChoose={(look) => choosing !== null && setLook(choosing, look)}
        onPhoto={() => choosing !== null && void choosePhoto(choosing)}
      />
    </Screen>
  );
}

/** Picks the look for one part of the day. */
function LookChooser({
  index,
  count,
  hasLook,
  onClose,
  onChoose,
  onPhoto,
}: {
  index: number | null;
  count: number;
  hasLook: boolean;
  onClose: () => void;
  onChoose: (look: AvatarLook | null) => void;
  onPhoto: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const open = index !== null;

  // Only fetch the news once someone is actually choosing.
  const stories = useAsync(
    async () =>
      open ? (await getHeadlines()).filter((story) => story.imageUrl).slice(0, 12) : [],
    [open],
  );

  return (
    <Sheet
      visible={open}
      onClose={onClose}
      title="Choose a picture"
      subtitle={index !== null ? slotLabel(index, count) : undefined}
    >
      <Txt variant="caption" tone="muted" style={styles.sheetLabel}>
        How you feel
      </Txt>
      <View style={styles.feelings}>
        {FEELINGS.map((feeling) => (
          <Pressable
            key={feeling.id}
            accessibilityRole="button"
            accessibilityLabel={feeling.name}
            onPress={() => onChoose({ kind: 'feeling', feelingId: feeling.id })}
            style={({ pressed }) => [styles.feeling, pressed && { opacity: 0.7 }]}
          >
            <LookBadge look={{ kind: 'feeling', feelingId: feeling.id }} size={52} />
            <Txt variant="caption" tone="secondary" numberOfLines={1}>
              {feeling.name}
            </Txt>
          </Pressable>
        ))}
      </View>

      <SheetAction icon="image-outline" label="Choose a photo" onPress={onPhoto} />

      <Txt variant="caption" tone="muted" style={styles.sheetLabel}>
        From today&rsquo;s news
      </Txt>
      {stories.loading ? (
        <Txt variant="caption" tone="faint">
          Loading the headlines…
        </Txt>
      ) : (stories.data ?? []).length === 0 ? (
        <Txt variant="caption" tone="faint">
          {stories.error ? 'The news could not be reached right now.' : 'No stories with pictures right now.'}
        </Txt>
      ) : (
        (stories.data ?? []).map((story) => (
          <Pressable
            key={story.id}
            accessibilityRole="button"
            onPress={() =>
              onChoose({
                kind: 'news',
                imageUrl: story.imageUrl!,
                title: story.title,
                link: story.url,
              })
            }
            style={({ pressed }) => [styles.story, pressed && { opacity: 0.7 }]}
          >
            <LookBadge
              look={{ kind: 'news', imageUrl: story.imageUrl!, title: story.title, link: story.url }}
              size={44}
            />
            <View style={{ flex: 1 }}>
              <Txt variant="callout" numberOfLines={2}>
                {story.title}
              </Txt>
              <Txt variant="caption" tone="muted">
                {story.source}
              </Txt>
            </View>
          </Pressable>
        ))
      )}

      {hasLook && (
        <View style={{ marginTop: spacing.lg }}>
          <SheetAction
            icon="close-circle-outline"
            label="Use my usual picture"
            detail="Leave this part of the day empty"
            tone="danger"
            onPress={() => onChoose(null)}
          />
        </View>
      )}
    </Sheet>
  );
}

function describe(look: AvatarLook | null): string {
  if (!look) return 'Your usual picture';
  if (look.kind === 'feeling') return `Feeling ${getFeeling(look.feelingId)?.name.toLowerCase() ?? ''}`;
  if (look.kind === 'photo') return 'Your photo';
  return `News · ${look.title}`;
}

function formatTime(date: Date): string {
  const hour = date.getHours();
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    preview: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
    group: {
      backgroundColor: colors.card,
      borderRadius: radii.lg,
      paddingHorizontal: spacing.lg,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      paddingVertical: spacing.lg,
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.borderSoft },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    slotTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    empty: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetLabel: { marginTop: spacing.lg, marginBottom: spacing.sm },
    feelings: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md },
    feeling: { width: 68, alignItems: 'center', gap: 4 },
    story: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  });
