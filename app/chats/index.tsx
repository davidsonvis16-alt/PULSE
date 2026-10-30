import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { formatRelativeTime } from '@/src/core/format';
import { useAuth } from '@/src/auth/auth';
import { inviteText, listConversations, onNewMessages } from '@/src/social/chat';
import { searchUsers, type PublicUser } from '@/src/social/sync';
import { useAsync } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { ProfileAvatar } from '@/src/ui/profile-avatar';
import { Artwork } from '@/src/ui/artwork';
import { Sheet } from '@/src/ui/sheet';
import { Button } from '@/src/ui/buttons';
import { Txt } from '@/src/ui/text';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { palette, radii, spacing } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/theme';

/** Chats: everyone this listener is talking to, newest first. */
export default function ChatsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { session, profile } = useAuth();
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const me = session?.user.id;

  const conversations = useAsync(() => listConversations(), []);
  useFocusReload(conversations.reload);
  // A message arriving while the list is open moves its conversation to the top.
  useEffect(() => (me ? onNewMessages(me, () => conversations.reload()) : undefined), [me, conversations]);

  const [finding, setFinding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<PublicUser[]>([]);

  const search = useCallback(async (text: string) => {
    setQuery(text);
    setPeople(text.trim().length >= 2 ? await searchUsers(text).catch(() => []) : []);
  }, []);

  const invite = inviteText(profile?.displayName);
  const inviteWays: { label: string; icon: keyof typeof Ionicons.glyphMap; go: () => void }[] = [
    {
      label: 'WhatsApp',
      icon: 'logo-whatsapp',
      go: () => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(invite.text)}`),
    },
    {
      label: 'Gmail or email',
      icon: 'mail-outline',
      go: () =>
        void Linking.openURL(
          `mailto:?subject=${encodeURIComponent('Join me on Pulse')}&body=${encodeURIComponent(invite.text)}`,
        ),
    },
    {
      label: 'Copy the link',
      icon: 'link-outline',
      go: () =>
        void Clipboard.setStringAsync(invite.link).then(() => toast('Link copied', 'success')),
    },
    {
      label: 'More ways to share',
      icon: 'share-social-outline',
      go: () => void Share.share({ message: invite.text }),
    },
  ];

  const list = conversations.data ?? [];

  return (
    <Screen>
      <PageHeader
        title="Chats"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your profile"
            onPress={() => router.push('/profile')}
            hitSlop={8}
          >
            <ProfileAvatar size={32} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset }}>
        <View style={styles.actions}>
          <Button label="New chat" icon="create-outline" onPress={() => setFinding(true)} />
          <Button label="Invite friends" variant="secondary" icon="person-add-outline" onPress={() => setInviting(true)} />
        </View>

        {conversations.loading && !conversations.data ? (
          <SkeletonRows count={6} />
        ) : conversations.error ? (
          <ErrorState error={conversations.error} onRetry={conversations.reload} />
        ) : list.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title="No chats yet"
            message="Start one with someone on Pulse, or invite a friend to join you."
            compact
          />
        ) : (
          list.map((chat) => (
            <Pressable
              key={chat.peer}
              accessibilityRole="button"
              accessibilityLabel={`Chat with ${chat.name}${chat.unread ? `, ${chat.unread} unread` : ''}`}
              onPress={() => router.push(`/chats/${chat.peer}`)}
              style={({ pressed }) => [styles.row, { borderColor: colors.borderSoft }, pressed && { opacity: 0.7 }]}
            >
              <Artwork uri={chat.avatarUrl} size={48} rounded />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Txt variant="callout" numberOfLines={1} style={{ flex: 1 }}>
                    {chat.name}
                  </Txt>
                  <Txt variant="caption" tone="faint">
                    {formatRelativeTime(chat.lastAt)}
                  </Txt>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Txt
                    variant="caption"
                    tone={chat.unread ? 'default' : 'muted'}
                    numberOfLines={1}
                    style={{ flex: 1 }}
                  >
                    {chat.lastFromMe ? `You: ${chat.lastBody}` : chat.lastBody}
                  </Txt>
                  {chat.unread > 0 && (
                    <View style={styles.unread}>
                      <Txt style={styles.unreadText}>{chat.unread > 9 ? '9+' : chat.unread}</Txt>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* Start a chat with anyone on Pulse, by their handle. */}
      <Sheet visible={finding} onClose={() => setFinding(false)} title="New chat">
        <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
          <TextInput
            value={query}
            onChangeText={(text) => void search(text)}
            placeholder="Search by @handle"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoFocus
            accessibilityLabel="Search people by handle"
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          />
          {people
            .filter((person) => person.userId !== me)
            .map((person) => (
              <Pressable
                key={person.userId}
                accessibilityRole="button"
                onPress={() => {
                  setFinding(false);
                  router.push(`/chats/${person.userId}`);
                }}
                style={({ pressed }) => [styles.person, pressed && { opacity: 0.7 }]}
              >
                <Artwork uri={person.avatarUrl} size={40} rounded />
                <View style={{ flex: 1 }}>
                  <Txt variant="callout">{person.displayName ?? `@${person.handle}`}</Txt>
                  <Txt variant="caption" tone="muted">
                    @{person.handle}
                  </Txt>
                </View>
              </Pressable>
            ))}
          {query.trim().length >= 2 && people.length === 0 && (
            <Txt variant="caption" tone="muted">
              Nobody with that handle yet. Invite them instead.
            </Txt>
          )}
        </View>
      </Sheet>

      {/* Invite friends who are not on Pulse yet. */}
      <Sheet visible={inviting} onClose={() => setInviting(false)} title="Invite friends">
        <View style={{ gap: spacing.xs, paddingTop: spacing.sm }}>
          {inviteWays.map((way) => (
            <Pressable
              key={way.label}
              accessibilityRole="button"
              onPress={() => {
                setInviting(false);
                way.go();
              }}
              style={({ pressed }) => [styles.person, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.wayIcon, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name={way.icon} size={20} color={colors.text} />
              </View>
              <Txt variant="callout">{way.label}</Txt>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  unread: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.terracotta,
  },
  unreadText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  input: { height: 44, paddingHorizontal: spacing.md, borderRadius: radii.sm, borderWidth: 1, fontSize: 15 },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  wayIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
