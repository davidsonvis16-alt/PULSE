import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Track } from '@/src/core/types';
import {
  listFriends,
  replaceActivityFeed,
  removeFriend,
  upsertFriend,
  getProfile,
  type ActivityItem,
  type Friend,
} from '@/src/db/repos/social';
import { getPrivacyPrefs } from '@/src/db/repos/settings';

/**
 * The social layer.
 *
 * Two rules run through all of it:
 *
 *  1. Nothing about the user's listening leaves the device unless they have
 *     turned that sharing on. `publishListening` checks the preference every
 *     time rather than trusting a cached flag.
 *  2. Without a configured backend these functions are honest no-ops and the
 *     UI shows a "connect an account" state instead of an empty feed.
 */

export function isSocialAvailable(): boolean {
  return isSupabaseConfigured && !!supabase;
}

export interface PublicUser {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export async function searchUsers(query: string): Promise<PublicUser[]> {
  const client = supabase;
  const clean = query.trim();
  if (!client || clean.length < 2) return [];
  const { data, error } = await client
    .from('profiles')
    .select('id, handle, display_name, avatar_url')
    .ilike('handle', `%${clean}%`)
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    userId: row.id as string,
    handle: row.handle as string,
    displayName: (row.display_name as string) ?? null,
    avatarUrl: (row.avatar_url as string) ?? null,
  }));
}

export async function followUser(user: PublicUser): Promise<void> {
  const client = supabase;
  if (!client) throw new Error('Accounts are not available in this build.');
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error('Sign in to follow people.');
  const { error } = await client
    .from('friendships')
    .upsert({ follower_id: auth.user.id, followee_id: user.userId }, { onConflict: 'follower_id,followee_id' });
  if (error) throw new Error(error.message);
  await upsertFriend({
    userId: user.userId,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    relation: 'following',
  });
}

export async function unfollowUser(userId: string): Promise<void> {
  const client = supabase;
  if (client) {
    const { data: auth } = await client.auth.getUser();
    if (auth.user) {
      await client
        .from('friendships')
        .delete()
        .eq('follower_id', auth.user.id)
        .eq('followee_id', userId);
    }
  }
  await removeFriend(userId);
}

/**
 * Publishes one listening event — but only when the user has opted in.
 * Called on play; failures are swallowed so the music never stops for this.
 */
export async function publishListening(track: Track): Promise<void> {
  const client = supabase;
  if (!client) return;
  const prefs = await getPrivacyPrefs();
  if (!prefs.shareListeningActivity) return;

  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return;

  await client.from('activity').insert({
    actor_id: auth.user.id,
    verb: 'played',
    entity_type: 'track',
    entity_id: track.id,
    entity_title: track.title,
    entity_subtitle: track.artistName,
    artwork_url: track.artworkUrl,
  });
}

export async function publishEvent(input: {
  verb: ActivityItem['verb'];
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string | null;
  artworkUrl?: string | null;
}): Promise<void> {
  const client = supabase;
  if (!client) return;
  const prefs = await getPrivacyPrefs();
  if (!prefs.shareListeningActivity) return;
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return;

  await client.from('activity').insert({
    actor_id: auth.user.id,
    verb: input.verb,
    entity_type: input.entityType,
    entity_id: input.entityId,
    entity_title: input.title,
    entity_subtitle: input.subtitle ?? null,
    artwork_url: input.artworkUrl ?? null,
  });
}

/** Pulls the feed for everyone the user follows and mirrors it locally. */
export async function syncFriendActivity(): Promise<ActivityItem[]> {
  const client = supabase;
  if (!client) return [];
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return [];

  const { data, error } = await client
    .from('friend_activity')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);

  const items: ActivityItem[] = (data ?? []).map((row) => ({
    id: String(row.id),
    actorUserId: row.actor_id as string,
    actorHandle: (row.actor_handle as string) ?? 'someone',
    actorName: (row.actor_name as string) ?? null,
    actorAvatar: (row.actor_avatar as string) ?? null,
    verb: (row.verb as ActivityItem['verb']) ?? 'played',
    entityType: (row.entity_type as string) ?? null,
    entityId: (row.entity_id as string) ?? null,
    entityTitle: (row.entity_title as string) ?? null,
    entitySubtitle: (row.entity_subtitle as string) ?? null,
    artworkUrl: (row.artwork_url as string) ?? null,
    createdAt: new Date(row.created_at as string).getTime(),
  }));

  await replaceActivityFeed(items);
  return items;
}

export async function syncFriends(): Promise<Friend[]> {
  const client = supabase;
  if (!client) return listFriends();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return listFriends();

  const { data, error } = await client
    .from('friendships_view')
    .select('other_id, handle, display_name, avatar_url, relation');
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    await upsertFriend({
      userId: row.other_id as string,
      handle: (row.handle as string) ?? 'someone',
      displayName: (row.display_name as string) ?? null,
      avatarUrl: (row.avatar_url as string) ?? null,
      relation: (row.relation as Friend['relation']) ?? 'following',
    });
  }
  return listFriends();
}

/** Mirrors the local profile up to the backend when one is connected. */
export async function pushProfile(): Promise<void> {
  const client = supabase;
  if (!client) return;
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return;
  const profile = await getProfile();
  if (!profile) return;

  await client.from('profiles').upsert({
    id: auth.user.id,
    handle: profile.handle,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    bio: profile.bio,
    activity_public: profile.activityPublic,
    stats_public: profile.statsPublic,
    library_public: profile.libraryPublic,
  });
}
