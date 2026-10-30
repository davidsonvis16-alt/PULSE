import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth/auth';
import {
  fetchMessages,
  getPeer,
  markRead,
  MAX_MESSAGE_LENGTH,
  onNewMessages,
  sendMessage,
  type ChatMessage,
} from '@/src/social/chat';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useToast } from '@/src/ui/toast';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Txt } from '@/src/ui/text';
import { ErrorState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/theme';

/** One conversation: messages newest at the bottom, a box to write in. */
export default function ConversationScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { id: peer } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { gutter } = useResponsive();
  const bottomInset = useBottomInset();
  const me = session?.user.id;
  const scroller = useRef<ScrollView>(null);

  const person = useAsync(() => getPeer(peer), [peer]);
  const history = useAsync(
    async () => {
      const messages = await fetchMessages(me!, peer);
      await markRead(peer).catch(() => {});
      return messages;
    },
    [me, peer],
    { enabled: !!me },
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (history.data) setMessages(history.data);
  }, [history.data]);

  // Their replies appear as they are sent.
  useEffect(() => {
    if (!me) return;
    return onNewMessages(me, (message) => {
      if (message.sender !== peer) return;
      setMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
      void markRead(peer).catch(() => {});
    });
  }, [me, peer]);

  const send = async () => {
    if (!me || !draft.trim()) return;
    setSending(true);
    try {
      const message = await sendMessage(me, peer, draft);
      setMessages((current) => [...current, message]);
      setDraft('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not send that', 'error');
    } finally {
      setSending(false);
    }
  };

  const name = person.data?.name ?? 'Chat';

  return (
    <Screen>
      <PageHeader
        title={name}
        subtitle={
          person.data?.handle
            ? `@${person.data.handle}${person.data.chatsOpen ? '' : ' · has not switched chats on yet'}`
            : undefined
        }
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingVertical: spacing.md, gap: spacing.sm }}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          {history.loading && !history.data ? (
            <SkeletonRows count={5} />
          ) : history.error ? (
            <ErrorState error={history.error} onRetry={history.reload} />
          ) : messages.length === 0 ? (
            <Txt variant="caption" tone="muted" align="center" style={{ marginTop: spacing.xl }}>
              Say hello to {name}.
            </Txt>
          ) : (
            messages.map((message) => {
              const mine = message.sender === me;
              return (
                <View
                  key={message.id}
                  style={[
                    styles.bubble,
                    mine
                      ? { alignSelf: 'flex-end', backgroundColor: colors.accent }
                      : { alignSelf: 'flex-start', backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                  ]}
                >
                  <Txt variant="body" style={{ color: mine ? colors.onAccent : colors.text }}>
                    {message.body}
                  </Txt>
                </View>
              );
            })
          )}
        </ScrollView>

        <View
          style={[
            styles.composer,
            { paddingHorizontal: gutter, paddingBottom: bottomInset > 0 ? spacing.md : spacing.md, borderColor: colors.border },
          ]}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={colors.textFaint}
            multiline
            maxLength={MAX_MESSAGE_LENGTH}
            accessibilityLabel="Message"
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={sending || !draft.trim()}
            onPress={() => void send()}
            style={[styles.send, { backgroundColor: draft.trim() ? colors.accent : colors.cardHigh }]}
          >
            <Ionicons name="arrow-up" size={20} color={draft.trim() ? colors.onAccent : colors.textFaint} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '80%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    fontSize: 15,
  },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
