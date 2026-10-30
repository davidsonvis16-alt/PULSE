import { db, newId, now } from '@/src/db/client';

export type NotificationType =
  | 'new_release'
  | 'event'
  | 'event_reminder'
  | 'friend_activity'
  | 'recommendation'
  | 'playlist'
  | 'download'
  | 'award'
  | 'news'
  | 'library';

export interface PulseNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  imageUrl: string | null;
  createdAt: number;
  readAt: number | null;
}

function toNotification(row: Record<string, any>): PulseNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    entityType: row.entity_type ?? null,
    entityId: row.entity_id ?? null,
    imageUrl: row.image_url ?? null,
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
  };
}

/**
 * Adds a notification unless the same thing was already announced.
 * Dedupe is on (type, entity), which is what stops Pulse from telling you about
 * the same release every time it refreshes.
 */
export async function pushNotification(input: {
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  imageUrl?: string | null;
}): Promise<boolean> {
  const instance = await db();
  if (input.entityId) {
    const existing = await instance.getFirstAsync(
      'SELECT 1 AS present FROM notifications WHERE type = ? AND entity_id = ? LIMIT 1;',
      [input.type, input.entityId],
    );
    if (existing) return false;
  }
  await instance.runAsync(
    `INSERT INTO notifications (id, type, title, body, entity_type, entity_id, image_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      newId('nt'),
      input.type,
      input.title,
      input.body ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.imageUrl ?? null,
      now(),
    ],
  );
  return true;
}

/**
 * "N songs need identifying", kept as one notification that follows the
 * count: a new number replaces the old note (and shows as unread again), and
 * when nothing is left to identify the note goes away.
 */
export async function noteSongsNeedIdentifying(count: number): Promise<void> {
  const instance = await db();
  const entityId = `identify|${count}`;
  const current = await instance.getFirstAsync<{ entity_id: string }>(
    "SELECT entity_id FROM notifications WHERE type = 'library' AND entity_type = 'identify' LIMIT 1;",
  );
  if (current?.entity_id === entityId) return;
  await instance.runAsync("DELETE FROM notifications WHERE type = 'library' AND entity_type = 'identify';");
  if (count <= 0) return;
  await pushNotification({
    type: 'library',
    title: `${count} ${count === 1 ? 'song needs' : 'songs need'} identifying`,
    body: "Pulse wasn't sure enough to name these. Tap to pick the right match.",
    entityType: 'identify',
    entityId,
  });
}

export async function listNotifications(limit = 60): Promise<PulseNotification[]> {
  const instance = await db();
  const rows = await instance.getAllAsync<Record<string, any>>(
    'SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?;',
    [limit],
  );
  return rows.map(toNotification);
}

export async function unreadNotificationCount(): Promise<number> {
  const instance = await db();
  const row = await instance.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL;',
  );
  return row?.count ?? 0;
}

export async function markNotificationRead(id: string) {
  const instance = await db();
  await instance.runAsync('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL;', [
    now(),
    id,
  ]);
}

export async function markAllNotificationsRead() {
  const instance = await db();
  await instance.runAsync('UPDATE notifications SET read_at = ? WHERE read_at IS NULL;', [now()]);
}

export async function clearNotifications() {
  const instance = await db();
  await instance.runAsync('DELETE FROM notifications;');
}

/**
 * Drops announcements that have stopped being news.
 *
 * A "new release" from two months ago is not new, and a notification centre
 * that never forgets anything is a list nobody opens. Read items go at the
 * shorter age; unread ones are given longer before they are dropped, because
 * the whole point of unread is that it has not been seen yet.
 */
export async function pruneStaleNotifications(options: { readAfterDays?: number; unreadAfterDays?: number } = {}) {
  const day = 24 * 60 * 60 * 1000;
  const readCutoff = now() - (options.readAfterDays ?? 14) * day;
  const unreadCutoff = now() - (options.unreadAfterDays ?? 45) * day;
  const instance = await db();
  await instance.runAsync(
    `DELETE FROM notifications
      WHERE (read_at IS NOT NULL AND created_at < ?)
         OR (read_at IS NULL AND created_at < ?);`,
    [readCutoff, unreadCutoff],
  );
}
