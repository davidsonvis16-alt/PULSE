import { supabase } from '@/lib/supabase';
import { Store } from '@/src/core/store';
import { config } from '@/src/core/config';
import { getSetting, setSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';

/**
 * Chats: one-to-one messages between people on Pulse.
 *
 * Off until the listener switches it on in Settings. Switching it on tells
 * the server they can be messaged (profiles.chats_open) and, the first time,
 * leaves a hint on Home pointing at the profile picture, which opens Chats
 * from then on. The server holds the messages and decides who may read and
 * send them (migration 0007).
 */

export interface Conversation {
  peer: string;
  handle: string | null;
  name: string;
  avatarUrl: string | null;
  lastBody: string;
  lastAt: number;
  lastFromMe: boolean;
  unread: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  recipient: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export const MAX_MESSAGE_LENGTH = 2000;

function client() {
  if (!supabase) throw new Error('Chats need the Pulse server. This build is not connected to one.');
  return supabase;
}

function toMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    sender: row.sender as string,
    recipient: row.recipient as string,
    body: row.body as string,
    createdAt: new Date(row.created_at as string).getTime(),
    readAt: row.read_at ? new Date(row.read_at as string).getTime() : null,
  };
}

/* ------------------------------------------------------------- the switch */

interface ChatSettings {
  enabled: boolean;
  /** Show the bouncing arrow beside the profile picture on Home. */
  hintPending: boolean;
  loaded: boolean;
}

class ChatSettingsStore extends Store<ChatSettings> {
  async load() {
    if (this.getSnapshot().loaded) return;
    const [enabled, hint] = await Promise.all([
      getSetting(SETTINGS_KEYS.chatsEnabled).catch(() => null),
      getSetting(SETTINGS_KEYS.chatsHintPending).catch(() => null),
    ]);
    this.set({ enabled: enabled === 'true', hintPending: hint === 'true', loaded: true });
  }

  async setEnabled(enabled: boolean, userId: string | undefined) {
    const before = this.getSnapshot();
    // The first time chats come on, Home points at where they now live.
    const hintPending = enabled && !before.enabled ? true : enabled ? before.hintPending : false;
    this.set({ enabled, hintPending });
    await Promise.all([
      setSetting(SETTINGS_KEYS.chatsEnabled, String(enabled)),
      setSetting(SETTINGS_KEYS.chatsHintPending, String(hintPending)),
    ]);
    if (userId && supabase) {
      const { error } = await supabase.from('profiles').update({ chats_open: enabled }).eq('id', userId);
      if (error) {
        this.set(before);
        throw new Error('Could not reach the Pulse server. Try again when you are online.');
      }
    }
  }

  dismissHint() {
    if (!this.getSnapshot().hintPending) return;
    this.set({ hintPending: false });
    void setSetting(SETTINGS_KEYS.chatsHintPending, 'false').catch(() => {});
  }
}

export const chatSettings = new ChatSettingsStore({ enabled: false, hintPending: false, loaded: false });

/* ----------------------------------------------------------- conversations */

export async function listConversations(): Promise<Conversation[]> {
  const { data, error } = await client().rpc('chat_conversations');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const handle = (row.handle as string | null) ?? null;
    return {
      peer: row.peer as string,
      handle,
      name: (row.display_name as string | null) ?? (handle ? `@${handle}` : 'Someone on Pulse'),
      avatarUrl: (row.avatar_url as string | null) ?? null,
      lastBody: row.last_body as string,
      lastAt: new Date(row.last_at as string).getTime(),
      lastFromMe: !!row.last_from_me,
      unread: Number(row.unread ?? 0),
    };
  });
}

export async function fetchMessages(me: string, peer: string, limit = 200): Promise<ChatMessage[]> {
  const { data, error } = await client()
    .from('chat_messages')
    .select('*')
    .or(`and(sender.eq.${me},recipient.eq.${peer}),and(sender.eq.${peer},recipient.eq.${me})`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toMessage).reverse();
}

export async function sendMessage(me: string, peer: string, body: string): Promise<ChatMessage> {
  const text = body.trim();
  if (!text) throw new Error('Type a message first.');
  if (text.length > MAX_MESSAGE_LENGTH) throw new Error('That message is too long.');
  const { data, error } = await client()
    .from('chat_messages')
    .insert({ sender: me, recipient: peer, body: text })
    .select('*')
    .single();
  if (error) {
    throw new Error(
      error.message.includes('row-level security')
        ? 'They have not switched chats on yet, so they cannot get messages.'
        : error.message,
    );
  }
  return toMessage(data as Record<string, unknown>);
}

export async function markRead(peer: string): Promise<void> {
  await client().rpc('mark_chat_read', { peer });
}

/** The other person's public details, for the top of a conversation. */
export async function getPeer(peer: string) {
  const { data } = await client()
    .from('profiles')
    .select('handle, display_name, avatar_url, chats_open')
    .eq('id', peer)
    .maybeSingle();
  if (!data) return null;
  const handle = (data.handle as string | null) ?? null;
  return {
    handle,
    name: (data.display_name as string | null) ?? (handle ? `@${handle}` : 'Someone on Pulse'),
    avatarUrl: (data.avatar_url as string | null) ?? null,
    chatsOpen: !!data.chats_open,
  };
}

/** Calls back with every new message sent to or from this listener. */
export function onNewMessages(me: string, callback: (message: ChatMessage) => void): () => void {
  const sb = supabase;
  if (!sb) return () => {};
  const channel = sb
    .channel(`chats-${me}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `recipient=eq.${me}` },
      (payload) => callback(toMessage(payload.new as Record<string, unknown>)),
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}

/* ----------------------------------------------------------------- invites */

export function inviteText(name: string | null | undefined): { text: string; link: string } {
  const link = config.share.webBaseUrl;
  const who = name ? `${name} invited you to Pulse` : 'Join me on Pulse';
  return {
    link,
    text: `${who} — music, mood mixes and chats. Sign up here: ${link}`,
  };
}
