import * as SQLite from 'expo-sqlite';
import { MIGRATIONS, TARGET_SCHEMA_VERSION } from '@/src/db/schema';

const DATABASE_NAME = 'pulse.db';

let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens the database once per app launch and brings it up to the current
 * schema version. Callers just `await db()` — migration is not their problem.
 */
export function db(): Promise<SQLite.SQLiteDatabase> {
  if (database) return Promise.resolve(database);
  if (opening) return opening;

  opening = (async () => {
    const instance = await SQLite.openDatabaseAsync(DATABASE_NAME);
    // WAL keeps reads from blocking while a download writes progress.
    await instance.execAsync('PRAGMA journal_mode = WAL;');
    await instance.execAsync('PRAGMA foreign_keys = ON;');
    await migrate(instance);
    database = instance;
    return instance;
  })();

  return opening;
}

async function migrate(instance: SQLite.SQLiteDatabase) {
  const row = await instance.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  let version = row?.user_version ?? 0;

  while (version < TARGET_SCHEMA_VERSION) {
    const statements = MIGRATIONS[version];
    await instance.withTransactionAsync(async () => {
      for (const statement of statements) {
        await instance.execAsync(statement);
      }
    });
    version += 1;
    // PRAGMA does not accept bound parameters; version is a loop counter.
    await instance.execAsync(`PRAGMA user_version = ${version};`);
  }
}

/** Test/debug helper: wipes the user's data but keeps the schema. */
export async function resetUserData() {
  const instance = await db();
  const tables = [
    'activity_feed',
    'friends',
    'ticket_sources',
    'events_cache',
    'search_history',
    'notifications',
    'recommendations',
    'listening_history',
    'follows',
    'favorites',
    'playlist_tracks',
    'playlists',
    'downloads',
    'library_items',
  ];
  await instance.withTransactionAsync(async () => {
    for (const table of tables) await instance.execAsync(`DELETE FROM ${table};`);
  });
}

export const now = () => Date.now();

/** Stable id generator — SQLite has no uuid() and we want offline-safe ids. */
export function newId(prefix = 'p'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}
