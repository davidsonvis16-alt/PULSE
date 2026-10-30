import { db, newId, now, transaction } from '@/src/db/client';

export interface PulseProfile {
  id: string;
  userId: string | null;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  activityPublic: boolean;
  statsPublic: boolean;
  libraryPublic: boolean;
}

export interface Friend {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  relation: 'following' | 'follower' | 'mutual';
  createdAt: number;
}

export interface ActivityItem {
  id: string;
  actorUserId: string;
  actorHandle: string;
  actorName: string | null;
  actorAvatar: string | null;
  verb: 'played' | 'liked' | 'added_playlist' | 'followed' | 'downloaded' | 'shared';
  entityType: string | null;
  entityId: string | null;
  entityTitle: string | null;
  entitySubtitle: string | null;
  artworkUrl: string | null;
  createdAt: number;
}

const ME = 'me';

export async function getProfile(): Promise<PulseProfile | null> {
  const instance = await db();
  const row = await instance.getFirstAsync<Record<string, any>>(
    'SELECT * FROM profile WHERE id = ?;',
    [ME],
  );
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id ?? null,
    handle: row.handle ?? null,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? null,
    activityPublic: !!row.activity_public,
    statsPublic: !!row.stats_public,
    libraryPublic: !!row.library_public,
  };
}

export async function saveProfile(patch: Partial<Omit<PulseProfile, 'id'>>) {
  const instance = await db();
  const existing = await getProfile();
  const merged = { ...existing, ...patch };
  await instance.runAsync(
    `INSERT INTO profile (id, user_id, handle, display_name, avatar_url, bio,
                          activity_public, stats_public, library_public, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       handle = excluded.handle,
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       bio = excluded.bio,
       activity_public = excluded.activity_public,
       stats_public = excluded.stats_public,
       library_public = excluded.library_public,
       updated_at = excluded.updated_at;`,
    [
      ME,
      merged.userId ?? null,
      merged.handle ?? null,
      merged.displayName ?? null,
      merged.avatarUrl ?? null,
      merged.bio ?? null,
      merged.activityPublic ? 1 : 0,
      merged.statsPublic ? 1 : 0,
      merged.libraryPublic ? 1 : 0,
      now(),
    ],
  );
}

export async function upsertFriend(friend: Omit<Friend, 'createdAt'>) {
  const instance = await db();
  await instance.runAsync(
    `INSERT INTO friends (user_id, handle, display_name, avatar_url, relation, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       handle = excluded.handle,
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       relation = excluded.relation;`,
    [friend.userId, friend.handle, friend.displayName, friend.avatarUrl, friend.relation, now()],
  );
}

export async function removeFriend(userId: string) {
  const instance = await db();
  await instance.runAsync('DELETE FROM friends WHERE user_id = ?;', [userId]);
  await instance.runAsync('DELETE FROM activity_feed WHERE actor_user_id = ?;', [userId]);
}

export async function listFriends(relation?: Friend['relation']): Promise<Friend[]> {
  const instance = await db();
  const rows = relation
    ? await instance.getAllAsync<Record<string, any>>(
        'SELECT * FROM friends WHERE relation = ? ORDER BY created_at DESC;',
        [relation],
      )
    : await instance.getAllAsync<Record<string, any>>(
        'SELECT * FROM friends ORDER BY created_at DESC;',
      );
  return rows.map((r) => ({
    userId: r.user_id,
    handle: r.handle,
    displayName: r.display_name ?? null,
    avatarUrl: r.avatar_url ?? null,
    relation: r.relation,
    createdAt: r.created_at,
  }));
}

export async function replaceActivityFeed(items: Omit<ActivityItem, 'id'>[] & { id?: string }[]) {
  await transaction(async (tx) => {
    await tx.runAsync('DELETE FROM activity_feed;');
    for (const item of items) {
      await tx.runAsync(
        `INSERT OR REPLACE INTO activity_feed
           (id, actor_user_id, actor_handle, actor_name, actor_avatar, verb, entity_type,
            entity_id, entity_title, entity_subtitle, artwork_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          item.id ?? newId('af'),
          item.actorUserId,
          item.actorHandle,
          item.actorName ?? null,
          item.actorAvatar ?? null,
          item.verb,
          item.entityType ?? null,
          item.entityId ?? null,
          item.entityTitle ?? null,
          item.entitySubtitle ?? null,
          item.artworkUrl ?? null,
          item.createdAt,
        ],
      );
    }
  });
}

export async function listActivity(limit = 50): Promise<ActivityItem[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    'SELECT * FROM activity_feed ORDER BY created_at DESC LIMIT ?;',
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    actorHandle: r.actor_handle,
    actorName: r.actor_name ?? null,
    actorAvatar: r.actor_avatar ?? null,
    verb: r.verb,
    entityType: r.entity_type ?? null,
    entityId: r.entity_id ?? null,
    entityTitle: r.entity_title ?? null,
    entitySubtitle: r.entity_subtitle ?? null,
    artworkUrl: r.artwork_url ?? null,
    createdAt: r.created_at,
  }));
}
