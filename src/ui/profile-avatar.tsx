import { useEffect, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/src/auth/auth';
import { initialsOf } from '@/src/core/format';
import { useStore } from '@/src/hooks/use-store';
import { avatarSchedule } from '@/src/profile/avatar';
import { getFeeling, lookAt, nextChangeAt, type AvatarLook } from '@/src/profile/schedule';
import { Artwork } from '@/src/ui/artwork';
import { Txt } from '@/src/ui/text';
import { useTheme } from '@/src/theme/theme';

/** One look from the schedule, drawn as a round picture. */
export function LookBadge({ look, size }: { look: AvatarLook; size: number }) {
  if (look.kind === 'feeling') {
    const feeling = getFeeling(look.feelingId);
    if (!feeling) return null;
    return (
      <LinearGradient
        colors={feeling.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.center, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <Ionicons
          name={feeling.icon as keyof typeof Ionicons.glyphMap}
          size={size * 0.48}
          color="#FFFFFF"
          accessibilityLabel={feeling.name}
        />
      </LinearGradient>
    );
  }
  return <Artwork uri={look.kind === 'photo' ? look.uri : look.imageUrl} size={size} rounded />;
}

/** Re-renders when the current part of the day ends, so the next look takes over. */
function useScheduledLook(): AvatarLook | null {
  const { schedule } = useStore(avatarSchedule);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void avatarSchedule.load();
  }, []);

  useEffect(() => {
    if (!schedule.enabled) return;
    const wait = nextChangeAt(schedule.slots.length).getTime() - Date.now();
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(1000, wait + 500));
    return () => clearTimeout(timer);
  }, [schedule, tick]);

  return lookAt(schedule);
}

/**
 * The listener's own avatar: the look scheduled for this part of the day, else
 * the profile photo, else their initials.
 */
export function ProfileAvatar({ size, style }: { size: number; style?: ViewStyle }) {
  const { colors } = useTheme();
  const { profile } = useAuth();
  const look = useScheduledLook();

  return (
    <View
      style={[
        styles.center,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent, overflow: 'hidden' },
        style,
      ]}
    >
      {look ? (
        <LookBadge look={look} size={size} />
      ) : profile?.avatarUrl ? (
        <Artwork uri={profile.avatarUrl} size={size} rounded />
      ) : (
        <Txt variant={size >= 56 ? 'title2' : 'callout'} tone="onAccent">
          {initialsOf(profile?.displayName)}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
