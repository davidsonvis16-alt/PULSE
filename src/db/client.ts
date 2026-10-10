import * as SQLite from 'expo-sqlite';
import { MIGRATIONS, TARGET_SCHEMA_VERSION } from '@/src/db/schema';

const DATABASE_NAME = 'pulse.db';

let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * One statement at a time.
 *
 * Pulse touches the database from everywhere at once: screens load in
 * `Promise.all`, the importer writes while a screen reads, downloads write
 * progress on a timer. A single SQLite connection cannot prepare and finalise
 * statements in parallel — doing so surfaces as `NativeStatement.finalizeAsync
 * has been rejected` and the odd "database is locked". Every call is therefore
 * pushed through this queue, which costs nothing measurable and removes the
 * whole class of failure.
 */
let queue: Promise<unknown> = Promise.resolve();
/** Greater than zero while a transaction body is running, so its own
 *  statements run straight through instead of deadlocking behind it. */
let insideTransaction = 0;

function serialize<T>(work: () => Promise<T>): Promise<T> {
  if (insideTransaction > 0) return work();
  const run = queue.then(work, work);
  // A failed call must not poison the queue for everyone behind it.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const SERIALIZED = [
  'execAsync',
  'runAsync',
  'getFirstAsync',
  'getAllAsync',
  'prepareAsync',
] as const;

const TRANSACTIONAL = ['withTransactionAsync', 'withExclusiveTransactionAsync'] as const;

/** Wraps the connection so every async call goes through the queue. */
function guard(instance: SQLite.SQLiteDatabase): SQLite.SQLiteDatabase {
  const cache = new Map<string, unknown>();
  return new Proxy(instance, {
    get(target, property, receiver) {
      const key = String(property);
      if (cache.has(key)) return cache.get(key);

      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;

      let wrapped: unknown;
      if ((SERIALIZED as readonly string[]).includes(key)) {
        wrapped = (...args: unknown[]) => serialize(() => value.apply(target, args));
      } else if ((TRANSACTIONAL as readonly string[]).includes(key)) {
        wrapped = (...args: unknown[]) =>
          serialize(async () => {
            insideTransaction += 1;
            try {
              return await value.apply(target, args);
            } finally {
              insideTransaction -= 1;
            }
          });
      } else {
        wrapped = value.bind(target);
      }
      cache.set(key, wrapped);
      return wrapped;
    },
  });
}

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
    await instance.execAsync('PRAGMA busy_timeout = 5000;');
    await migrate(instance);
    database = guard(instance);
    return database;
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
