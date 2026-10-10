import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Track } from '@/src/core/types';
import { formatRelativeTime, pluralize } from '@/src/core/format';
import { musicProvider } from '@/src/providers/music';
import { config } from '@/src/core/config';
import { getRecentlyPlayed } from '@/src/db/repos/history';
import { playerStore } from '@/src/audio/player';
import {
  AUTO_REASON_LABEL,
  buildBlend,
  cardColor,
  FEELINGS,
  feelingById,
  isCurrent,
  notesStore,
  tasteMatch,
  type NoteFriend,
  type NoteScope,
  type SongNote,
} from '@/src/social/notes';
import { useAuth } from '@/src/auth/auth';
import { useStore } from '@/src/hooks/use-store';
import { useDebounced } from '@/src/hooks/use-async';
import { likesStore } from '@/src/ui/likes';
import { useToast } from '@/src/ui/toast';
import { Artwork } from '@/src/ui/artwork';
import { ProfileAvatar } from '@/src/ui/profile-avatar';
import { Sheet } from '@/src/ui/sheet';
import { Txt } from '@/src/ui/text';
import { palette, radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/** Pulse's own ring colours: the lime of the mark, brightening toward its top. */
const RING = [palette.limeBright, palette.lime, '#8FD61E'] as const;

// ---------------------------------------------------------------------------
// Story ring

/**
 * A picture with a story ring. Unopened: a lime gradient ring with a soft lime
 * glow behind it that breathes. Opened: a quiet grey ring. None: no ring.
 */
export function StoryRing({
  size,
  state,
  live,
  children,
}: {
  size: number;
  state: 'unseen' | 'seen' | 'none';
  live?: boolean;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state !== 'unseen') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, state]);

  const ring = state === 'none' ? 0 : 3;
  const gap = state === 'none' ? 0 : 2.5;
  const outer = size + (ring + gap) * 2;

  return (
    <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}>
      {state === 'unseen' && (
        <Animated.View
          pointerEvents="none"
          style={[
            ringStyles.glow,
            {
              width: outer + 10,
              height: outer + 10,
              borderRadius: (outer + 10) / 2,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
            },
          ]}
        />
      )}
      {state === 'unseen' ? (
        <LinearGradient
          colors={RING}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: outer / 2 }]}
        />
      ) : state === 'seen' ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: outer / 2, borderWidth: 1.5, borderColor: colors.border },
          ]}
        />
      ) : null}
      <View
        style={{
          width: size + gap * 2,
          height: size + gap * 2,
          borderRadius: (size + gap * 2) / 2,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
          {children}
        </View>
      </View>
      {live && (
        <View style={[ringStyles.live, { borderColor: colors.background }]}>
          <Txt variant="micro" style={{ color: '#0A0B0A', fontSize: 8, lineHeight: 10 }}>
            LIVE
          </Txt>
        </View>
      )}
    </View>
  );
}

const ringStyles = StyleSheet.create({
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(201, 246, 43, 0.28)',
    shadowColor: palette.lime,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  live: {
    position: 'absolute',
    bottom: -2,
    alignSelf: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 2,
    backgroundColor: palette.lime,
  },
});

/** A real photo inside a story ring. */
export function FriendAvatar({
  friend,
  size,
  ring = true,
}: {
  friend: NoteFriend;
  size: number;
  ring?: boolean;
}) {
  const notes = useStore(notesStore);
  const unseen = !!friend.note && !notes.seen.has(friend.note.id);
  return (
    <StoryRing size={size} state={!ring || !friend.note ? 'none' : unseen ? 'unseen' : 'seen'} live={ring && friend.live}>
      <Image
        source={{ uri: friend.avatarUrl }}
        style={{ width: size, height: size }}
        contentFit="cover"
        cachePolicy="disk"
        transition={180}
        accessibilityLabel={friend.name}
      />
    </StoryRing>
  );
}

// ---------------------------------------------------------------------------
// The note bubble

/** The little speech bubble above a picture, the way notes sit on Instagram. */
export function NoteBubble({
  note,
  maxWidth = 96,
  placeholder,
}: {
  note: SongNote | null;
  maxWidth?: number;
  placeholder?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const feeling = note ? feelingById(note.feeling) : null;
  return (
    <View style={[styles.bubbleWrap, { maxWidth }]}>
      <View style={styles.bubble}>
        {note ? (
          <>
            <Txt variant="micro" numberOfLines={1} style={styles.bubbleTitle}>
              {feeling?.emoji} {note.track.title}
            </Txt>
            <Txt variant="micro" tone="muted" numberOfLines={1} style={styles.bubbleArtist}>
              {note.track.artistName}
            </Txt>
          </>
        ) : (
          <Txt variant="micro" tone="muted" numberOfLines={2} style={styles.bubbleArtist}>
            {placeholder ?? 'Song of the day?'}
          </Txt>
        )}
      </View>
      <View style={styles.bubbleTail} />
      <View style={styles.bubbleTailSmall} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// The row of notes at the top of Home

export function NotesRow({ gutter }: { gutter: number }) {
  const styles = useThemedStyles(makeStyles);
  const notes = useStore(notesStore);
  const { profile } = useAuth();
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  useEffect(() => {
    void notesStore.load();
  }, []);

  const withNotes = notes.friends.filter((friend) => !!friend.note);
  const mine = isCurrent(notes.mine) ? notes.mine : null;

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.md, paddingTop: spacing.xs }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mine ? 'Your note' : 'Add a song note'}
          onPress={() => setComposing(true)}
          style={styles.person}
        >
          <NoteBubble note={mine} placeholder="Song of the day?" />
          <View>
            <StoryRing size={62} state={mine ? 'seen' : 'none'}>
              <ProfileAvatar size={62} />
            </StoryRing>
            {!mine && (
              <View style={styles.plus}>
                <Ionicons name="add" size={14} color="#0A0B0A" />
              </View>
            )}
          </View>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {mine ? 'Your note' : profile?.displayName?.split(' ')[0] ?? 'You'}
          </Txt>
        </Pressable>

        {notes.friends.map((friend) => (
          <Pressable
            key={friend.id}
            accessibilityRole="button"
            accessibilityLabel={
              friend.note
                ? `${friend.name}'s note: ${friend.note.track.title} by ${friend.note.track.artistName}`
                : friend.name
            }
            onPress={() => {
              const index = withNotes.findIndex((entry) => entry.id === friend.id);
              if (index >= 0) setViewing(index);
            }}
            style={styles.person}
          >
            <NoteBubble note={friend.note} />
            <FriendAvatar friend={friend} size={62} />
            <Txt variant="caption" numberOfLines={1} style={{ maxWidth: 76 }}>
              {friend.name.split(' ')[0]}
            </Txt>
          </Pressable>
        ))}

        {!notes.friends.length &&
          [0, 1, 2, 3].map((index) => (
            <View key={index} style={styles.person}>
              <View style={[styles.skeletonBubble]} />
              <View style={styles.skeletonAvatar} />
            </View>
          ))}
      </ScrollView>

      <ComposeNoteSheet visible={composing} onClose={() => setComposing(false)} />
      {viewing !== null && (
        <StoryViewer friends={withNotes} startIndex={viewing} onClose={() => setViewing(null)} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rectangular cards

/**
 * A friend's note as a wide card: a solid colour of its own, the cover tilted
 * off the edge, and a shadow in the card's colour so it lifts off the page.
 */
export function FriendNoteCard({
  friend,
  width,
  onPress,
}: {
  friend: NoteFriend;
  width: number;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const note = friend.note!;
  const color = cardColor(friend.id + note.track.id);
  const feeling = feelingById(note.feeling);
  const art = Math.round(width * 0.42);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${friend.name} is on ${note.track.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.noteCard,
        { width, backgroundColor: color, shadowColor: color },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <LinearGradient
        colors={['rgba(255,255,255,0.14)', 'rgba(0,0,0,0.22)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radii.lg }]}
      />
      <View style={[styles.noteArt, { width: art, height: art, right: -art * 0.16, bottom: -art * 0.1 }]}>
        <Artwork uri={musicProvider().getArtwork(note.track.artworkUrl, 300)} size={art} radius={radii.sm} />
      </View>

      <View style={styles.noteCardTop}>
        <FriendAvatar friend={friend} size={30} ring={false} />
        <View style={{ flex: 1 }}>
          <Txt variant="callout" numberOfLines={1} style={{ color: '#fff' }}>
            {friend.name.split(' ')[0]}
          </Txt>
          <Txt variant="micro" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.75)' }}>
            {formatRelativeTime(note.createdAt)}
          </Txt>
        </View>
      </View>

      <View style={{ maxWidth: width - art * 0.9 - spacing.lg }}>
        <Txt variant="title3" numberOfLines={2} style={{ color: '#fff' }}>
          {note.track.title}
        </Txt>
        <Txt variant="caption" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.82)' }}>
          {note.track.artistName}
        </Txt>
        <View style={styles.noteChips}>
          <View style={styles.chipOnColor}>
            <Txt variant="micro" style={{ color: '#fff' }}>
              {feeling.emoji} {feeling.label}
            </Txt>
          </View>
          {note.plays ? (
            <View style={styles.chipOnColor}>
              <Txt variant="micro" style={{ color: '#fff' }}>
                {note.plays}× {note.scope === 'day' ? 'today' : 'this week'}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/** Taste match: how close a friend's listening is to yours, and a blend button. */
export function TasteMatchCard({
  friend,
  width,
  onOpen,
}: {
  friend: NoteFriend;
  width: number;
  onOpen: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const notes = useStore(notesStore);
  const toast = useToast();
  const router = useRouter();
  const [blending, setBlending] = useState(false);
  const match = tasteMatch(friend, notes.taste);
  const color = cardColor(friend.handle);

  const shared = match.sharedArtists.length
    ? `You both play ${match.sharedArtists.slice(0, 2).join(' & ')}`
    : match.sharedGenres.length
      ? `You both lean ${match.sharedGenres[0]}`
      : 'Different lanes — a blend could surprise you';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${friend.name}, ${match.percent}% taste match`}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.matchCard,
        { width, shadowColor: color },
        pressed && { opacity: 0.9 },
      ]}
    >
      <LinearGradient
        colors={[color, `${color}55`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.matchBand}
      >
        <FriendAvatar friend={friend} size={46} ring={false} />
        <View style={{ flex: 1 }}>
          <Txt variant="title2" style={{ color: '#fff' }}>
            {notes.taste?.hasData ? `${match.percent}%` : '—'}
          </Txt>
          <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.85)' }}>
            TASTE MATCH
          </Txt>
        </View>
      </LinearGradient>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Txt variant="callout" numberOfLines={1}>
          {friend.name}
        </Txt>
        <Txt variant="caption" tone="muted" numberOfLines={2} style={{ minHeight: 34 }}>
          {shared}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Blend your taste with ${friend.name}`}
          disabled={blending}
          onPress={async () => {
            setBlending(true);
            try {
              const blend = await buildBlend(friend);
              if (!blend.tracks.length) {
                toast('Could not reach the catalogue for a blend', 'error');
                return;
              }
              void playerStore.playQueue(blend.tracks, {
                context: 'recommendation',
                contextLabel: blend.name,
              });
              toast(`${blend.name} — ${blend.tracks.length} songs`, 'success');
              router.push(`/playlist/${encodeURIComponent(blend.id)}`);
            } finally {
              setBlending(false);
            }
          }}
          style={({ pressed }) => [styles.blendButton, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name={blending ? 'hourglass-outline' : 'git-merge-outline'} size={15} color="#0A0B0A" />
          <Txt variant="callout" style={{ color: '#0A0B0A' }}>
            {blending ? 'Mixing…' : 'Mix our taste'}
          </Txt>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Story viewer

const STORY_MS = 7000;
const REACTIONS = ['🔥', '😍', '😭', '🎧', '💯', '🙌'];

export function StoryViewer({
  friends,
  startIndex,
  onClose,
}: {
  friends: NoteFriend[];
  startIndex: number;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const notes = useStore(notesStore);
  const likes = useStore(likesStore);
  const [index, setIndex] = useState(startIndex);
  const [paused, setPaused] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const friend = friends[index];
  const note = friend?.note ?? null;

  useEffect(() => {
    if (note) void notesStore.markSeen(note.id);
  }, [note]);

  useEffect(() => {
    if (!note || paused) return;
    progress.setValue(0);
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: STORY_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    run.start(({ finished }) => {
      if (!finished) return;
      if (index < friends.length - 1) setIndex(index + 1);
      else onClose();
    });
    return () => run.stop();
  }, [index, paused, note, friends.length, onClose, progress]);

  if (!friend || !note) return null;
  const feeling = feelingById(note.feeling);
  const color = cardColor(friend.id + note.track.id);
  const reacted = notes.reactions[note.id];
  const liked = likes.ids.has(note.track.id);
  const art = musicProvider().getArtwork(note.track.artworkUrl, 600);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.viewer, { backgroundColor: color }]}>
        {art && (
          <Image source={{ uri: art }} style={StyleSheet.absoluteFill} blurRadius={40} contentFit="cover" />
        )}
        <LinearGradient
          colors={[`${color}CC`, 'rgba(7,7,8,0.55)', 'rgba(7,7,8,0.94)']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* Progress */}
        <View style={[styles.bars, { top: insets.top + spacing.sm }]}>
          {friends.map((entry, i) => (
            <View key={entry.id} style={styles.bar}>
              <Animated.View
                style={[
                  styles.barFill,
                  {
                    width:
                      i < index
                        ? '100%'
                        : i === index
                          ? progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                          : '0%',
                  },
                ]}
              />
            </View>
          ))}
        </View>

        {/* Who */}
        <View style={[styles.viewerHead, { top: insets.top + spacing.xl }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${friend.name}'s profile`}
            onPress={() => {
              onClose();
              router.push(`/friend/${friend.id}`);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}
          >
            <FriendAvatar friend={friend} size={34} ring={false} />
            <View style={{ flex: 1 }}>
              <Txt variant="callout" style={{ color: '#fff' }} numberOfLines={1}>
                {friend.name}
              </Txt>
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {formatRelativeTime(note.createdAt)} · {note.scope === 'day' ? 'Song of the day' : 'Song of the week'}
              </Txt>
            </View>
          </Pressable>
          <Pressable accessibilityLabel="Close" hitSlop={12} onPress={onClose}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>

        {/* Tap zones: left goes back, right goes on, hold pauses */}
        <View style={styles.tapZones}>
          <Pressable
            style={{ flex: 1 }}
            onPress={() => setIndex(Math.max(0, index - 1))}
            onLongPress={() => setPaused(true)}
            onPressOut={() => setPaused(false)}
            accessibilityLabel="Previous note"
          />
          <Pressable
            style={{ flex: 2 }}
            onPress={() => (index < friends.length - 1 ? setIndex(index + 1) : onClose())}
            onLongPress={() => setPaused(true)}
            onPressOut={() => setPaused(false)}
            accessibilityLabel="Next note"
          />
        </View>

        {/* The song */}
        <View style={styles.viewerBody} pointerEvents="box-none">
          <View style={[styles.viewerArt, { shadowColor: color }]}>
            <Artwork uri={art} size={248} radius={radii.lg} />
          </View>
          <Txt variant="title1" align="center" style={{ color: '#fff', marginTop: spacing.xl }} numberOfLines={2}>
            {note.track.title}
          </Txt>
          <Txt variant="body" align="center" style={{ color: 'rgba(255,255,255,0.8)' }} numberOfLines={1}>
            {note.track.artistName}
          </Txt>

          <View style={[styles.noteChips, { justifyContent: 'center', marginTop: spacing.md }]}>
            <View style={[styles.feelingChip, { backgroundColor: `${feeling.color}33`, borderColor: feeling.color }]}>
              <Txt variant="callout" style={{ color: '#fff' }}>
                {feeling.emoji} feeling {feeling.label.toLowerCase()}
              </Txt>
            </View>
          </View>

          <View style={[styles.noteChips, { justifyContent: 'center' }]}>
            {note.plays ? (
              <View style={styles.chipOnColor}>
                <Txt variant="micro" style={{ color: '#fff' }}>
                  ▶ {pluralize(note.plays, 'play')} {note.scope === 'day' ? 'today' : 'this week'}
                </Txt>
              </View>
            ) : null}
            {note.auto && (
              <View style={styles.chipOnColor}>
                <Txt variant="micro" style={{ color: '#fff' }}>
                  ⟳ Auto · {AUTO_REASON_LABEL[note.auto]}
                  {note.detail ? ` · ${note.detail}` : ''}
                </Txt>
              </View>
            )}
          </View>

          {note.caption && (
            <Txt variant="bodyStrong" align="center" style={{ color: '#fff', marginTop: spacing.md }}>
              “{note.caption}”
            </Txt>
          )}
        </View>

        {/* Actions */}
        <View style={[styles.viewerFoot, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.reactions}>
            {REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityLabel={`React ${emoji}`}
                onPress={() => {
                  const next = reacted === emoji ? null : emoji;
                  void notesStore.react(note.id, next);
                  if (next) toast(`Sent ${emoji} to ${friend.name.split(' ')[0]}`);
                }}
                style={[styles.reaction, reacted === emoji && styles.reactionOn]}
              >
                <Txt style={{ fontSize: 22, lineHeight: 28 }}>{emoji}</Txt>
              </Pressable>
            ))}
          </View>
          <View style={styles.viewerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Play"
              onPress={() => {
                setPaused(true);
                void playerStore.playQueue([note.track, ...friend.repeats.map((r) => r.track).filter((t) => t.id !== note.track.id)], {
                  context: 'recommendation',
                  contextLabel: `${friend.name.split(' ')[0]}'s note`,
                });
              }}
              style={({ pressed }) => [styles.playButton, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="play" size={18} color="#0A0B0A" />
              <Txt variant="bodyStrong" style={{ color: '#0A0B0A' }}>
                Play
              </Txt>
            </Pressable>
            <RoundAction
              icon={liked ? 'heart' : 'heart-outline'}
              tint={liked ? palette.lime : '#fff'}
              label={liked ? 'Liked' : 'Like'}
              onPress={async () => {
                const now = await likesStore.toggle(note.track);
                toast(now ? 'Added to Liked songs' : 'Removed from Liked songs');
              }}
            />
            <RoundAction
              icon="git-merge-outline"
              label="Blend"
              onPress={async () => {
                setPaused(true);
                const blend = await buildBlend(friend);
                if (!blend.tracks.length) return toast('Could not make a blend right now', 'error');
                onClose();
                void playerStore.playQueue(blend.tracks, { context: 'recommendation', contextLabel: blend.name });
                router.push(`/playlist/${encodeURIComponent(blend.id)}`);
              }}
            />
            <RoundAction
              icon="person-outline"
              label="Profile"
              onPress={() => {
                onClose();
                router.push(`/friend/${friend.id}`);
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RoundAction({
  icon,
  label,
  tint = '#fff',
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint?: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.roundAction}>
      <View style={styles.roundIcon}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.8)' }}>
        {label}
      </Txt>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Compose

export function ComposeNoteSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const toast = useToast();
  const notes = useStore(notesStore);
  const player = useStore(playerStore);
  const [track, setTrack] = useState<Track | null>(null);
  const [feeling, setFeeling] = useState(FEELINGS[0].id);
  const [scope, setScope] = useState<NoteScope>('day');
  const [caption, setCaption] = useState('');
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<Track[]>([]);
  const [results, setResults] = useState<Track[]>([]);
  const debounced = useDebounced(query);
  const mine = isCurrent(notes.mine) ? notes.mine : null;

  useEffect(() => {
    if (!visible) return;
    setTrack(mine?.track ?? player.current ?? null);
    setFeeling(mine?.feeling ?? FEELINGS[0].id);
    setScope(mine?.scope ?? 'day');
    setCaption(mine?.caption ?? '');
    setQuery('');
    void getRecentlyPlayed(12).then(setRecent).catch(() => setRecent([]));
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    musicProvider()
      .searchTracks(debounced.trim(), { limit: 8, country: config.music.country })
      .then((found) => !cancelled && setResults(found))
      .catch(() => !cancelled && setResults([]));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const choices = useMemo(() => {
    const list = query.trim().length >= 2 ? results : recent;
    const current = player.current && !list.some((t) => t.id === player.current!.id) && !query ? [player.current] : [];
    return [...current, ...list];
  }, [query, results, recent, player]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Your song note" subtitle="Friends see it over your picture">
      <View style={{ gap: spacing.lg }}>
        {/* Preview */}
        <View style={styles.composePreview}>
          <NoteBubble
            note={track ? { ...(mine ?? ({} as SongNote)), track, feeling, scope } as SongNote : null}
            maxWidth={150}
            placeholder="Pick a song below"
          />
          <StoryRing size={70} state="unseen">
            <ProfileAvatar size={70} />
          </StoryRing>
        </View>

        {/* Day or week */}
        <View style={styles.segment}>
          {(['day', 'week'] as NoteScope[]).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: scope === value }}
              onPress={() => setScope(value)}
              style={[styles.segmentItem, scope === value && { backgroundColor: colors.accent }]}
            >
              <Txt variant="callout" style={{ color: scope === value ? colors.onAccent : colors.text }}>
                {value === 'day' ? 'Song of the day' : 'Song of the week'}
              </Txt>
            </Pressable>
          ))}
        </View>

        {/* Feeling */}
        <View>
          <Txt variant="micro" tone="muted" uppercase style={{ marginBottom: spacing.sm }}>
            How it makes you feel
          </Txt>
          <View style={styles.feelings}>
            {FEELINGS.map((item) => {
              const on = item.id === feeling;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setFeeling(item.id)}
                  style={[
                    styles.feelingPick,
                    { borderColor: on ? item.color : colors.borderSoft, backgroundColor: on ? `${item.color}26` : colors.card },
                  ]}
                >
                  <Txt variant="callout">
                    {item.emoji} {item.label}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Song */}
        <View>
          <Txt variant="micro" tone="muted" uppercase style={{ marginBottom: spacing.sm }}>
            The song
          </Txt>
          <View style={styles.search}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search any song"
              placeholderTextColor={colors.textFaint}
              style={[styles.searchInput, { color: colors.text }]}
              returnKeyType="search"
            />
          </View>
          <View style={{ marginTop: spacing.sm }}>
            {choices.slice(0, 8).map((item) => {
              const on = item.id === track?.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setTrack(item)}
                  style={[styles.songRow, on && { backgroundColor: colors.accentGlow }]}
                >
                  <Artwork uri={item.artworkUrl} size={42} radius={radii.xs} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="callout" numberOfLines={1}>
                      {item.title}
                    </Txt>
                    <Txt variant="caption" tone="muted" numberOfLines={1}>
                      {player.current?.id === item.id ? 'Playing now · ' : ''}
                      {item.artistName}
                    </Txt>
                  </View>
                  {on && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
                </Pressable>
              );
            })}
            {!choices.length && (
              <Txt variant="caption" tone="muted">
                Play something or search, and it will show up here.
              </Txt>
            )}
          </View>
        </View>

        <TextInput
          value={caption}
          onChangeText={(text) => setCaption(text.slice(0, 60))}
          placeholder="Add a line (optional)"
          placeholderTextColor={colors.textFaint}
          style={[styles.caption, { color: colors.text }]}
        />

        {/* Auto-post */}
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: notes.autoPost }}
          onPress={async () => {
            await notesStore.setAutoPost(!notes.autoPost);
          }}
          style={styles.autoRow}
        >
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">Auto-post my song</Txt>
            <Txt variant="caption" tone="muted">
              When you have not posted, Pulse picks one for you each day — most repeated, most liked, your top
              genre or a new release from artists you follow.
            </Txt>
          </View>
          <View style={[styles.toggle, notes.autoPost && { backgroundColor: colors.accent }]}>
            <View style={[styles.knob, notes.autoPost && { transform: [{ translateX: 18 }] }]} />
          </View>
        </Pressable>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {mine && (
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                await notesStore.clearNote();
                toast('Note removed');
                onClose();
              }}
              style={[styles.secondary]}
            >
              <Txt variant="bodyStrong" tone="danger">
                Remove
              </Txt>
            </Pressable>
          )}
          {notes.autoPost && (
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                const auto = await notesStore.autoPostNow();
                toast(auto ? `Posted ${auto.track.title}` : 'Play a few songs first, then Pulse can pick');
                if (auto) onClose();
              }}
              style={styles.secondary}
            >
              <Txt variant="bodyStrong">Pick for me</Txt>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={!track}
            onPress={async () => {
              if (!track) return;
              await notesStore.postNote({ track, feeling, scope, caption });
              toast('Your note is up');
              onClose();
            }}
            style={({ pressed }) => [styles.post, (!track || pressed) && { opacity: 0.6 }]}
          >
            <Txt variant="bodyStrong" tone="onAccent">
              {mine ? 'Update note' : 'Share note'}
            </Txt>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

export const noteCardShadow: ViewStyle = {
  shadowOpacity: 0.55,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 10 },
  elevation: 12,
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    person: { alignItems: 'center', width: 82, gap: 4 },
    plus: {
      position: 'absolute',
      right: 2,
      bottom: 2,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: palette.lime,
      borderWidth: 2,
      borderColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bubbleWrap: { alignItems: 'center', marginBottom: -6, zIndex: 2, minHeight: 40, justifyContent: 'flex-end' },
    bubble: {
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 14,
      backgroundColor: colors.cardHigh,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    bubbleTitle: { fontSize: 10.5, lineHeight: 13, letterSpacing: 0, color: colors.text },
    bubbleArtist: { fontSize: 9.5, lineHeight: 12, letterSpacing: 0, fontWeight: '600' },
    bubbleTail: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginTop: 2,
      marginLeft: -14,
      backgroundColor: colors.cardHigh,
    },
    bubbleTailSmall: {
      width: 4,
      height: 4,
      borderRadius: 2,
      marginTop: 1,
      marginLeft: -22,
      backgroundColor: colors.cardHigh,
    },
    skeletonBubble: { width: 64, height: 30, borderRadius: 14, backgroundColor: colors.skeleton, marginBottom: 6 },
    skeletonAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.skeleton },

    noteCard: {
      height: 168,
      borderRadius: radii.lg,
      padding: spacing.lg,
      overflow: 'visible',
      justifyContent: 'space-between',
      ...noteCardShadow,
    },
    noteArt: {
      position: 'absolute',
      transform: [{ rotate: '18deg' }],
      shadowColor: '#000',
      shadowOpacity: 0.5,
      shadowRadius: 10,
      shadowOffset: { width: -4, height: 6 },
      elevation: 10,
    },
    noteCardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    noteChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
    chipOnColor: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.pill,
      backgroundColor: 'rgba(0,0,0,0.28)',
    },

    matchCard: {
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      overflow: 'visible',
      ...noteCardShadow,
      shadowOpacity: 0.4,
    },
    matchBand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
    },
    blendButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 9,
      borderRadius: radii.pill,
      backgroundColor: palette.lime,
    },

    viewer: { flex: 1 },
    bars: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', gap: 4, zIndex: 3 },
    bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
    barFill: { height: 3, backgroundColor: '#fff' },
    viewerHead: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      zIndex: 3,
    },
    tapZones: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 1 },
    viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl, zIndex: 2 },
    viewerArt: {
      shadowOpacity: 0.8,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 16 },
      elevation: 20,
    },
    feelingChip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: radii.pill,
      borderWidth: 1.5,
    },
    viewerFoot: { paddingHorizontal: spacing.lg, gap: spacing.lg, zIndex: 3 },
    reactions: { flexDirection: 'row', justifyContent: 'space-between' },
    reaction: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.1)',
    },
    reactionOn: { backgroundColor: 'rgba(201,246,43,0.3)', borderWidth: 1.5, borderColor: palette.lime },
    viewerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
    playButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      height: 50,
      borderRadius: radii.pill,
      backgroundColor: palette.lime,
      shadowColor: palette.lime,
      shadowOpacity: 0.5,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    roundAction: { alignItems: 'center', gap: 3 },
    roundIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.14)',
    },

    composePreview: { alignItems: 'center', paddingTop: spacing.sm },
    segment: {
      flexDirection: 'row',
      padding: 4,
      borderRadius: radii.pill,
      backgroundColor: colors.card,
    },
    segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radii.pill },
    feelings: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    feelingPick: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.pill,
      borderWidth: 1.5,
    },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      height: 42,
      borderRadius: radii.md,
      backgroundColor: colors.card,
    },
    searchInput: { flex: 1, fontSize: 15 },
    songRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: 6,
      borderRadius: radii.sm,
    },
    caption: {
      height: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      fontSize: 15,
    },
    autoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.card,
    },
    toggle: {
      width: 44,
      height: 26,
      borderRadius: 13,
      padding: 3,
      backgroundColor: colors.cardHigh,
    },
    knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
    secondary: {
      paddingHorizontal: spacing.lg,
      height: 48,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    post: {
      flex: 1,
      height: 48,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
  });
