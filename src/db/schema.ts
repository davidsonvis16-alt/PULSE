/**
 * Pulse's on-device relational database (SQLite).
 *
 * Everything the user owns — library, downloads, playlists, listening history,
 * follows, notifications — lives here, normalised, so Pulse works with no
 * network and so statistics are real aggregates rather than counters we bump.
 *
 * Catalogue rows (artists / albums / tracks) are cached copies of provider data
 * keyed by the provider-qualified id, which lets a playlist keep working when
 * the device is offline and lets two providers coexist without collisions.
 *
 * Migrations are append-only. Never edit a shipped statement; add a new one.
 */

export const MIGRATIONS: string[][] = [
  // ---------------------------------------------------------------- v1: core
  [
    `CREATE TABLE IF NOT EXISTS artists (
      id                TEXT PRIMARY KEY NOT NULL,
      provider          TEXT NOT NULL,
      provider_artist_id TEXT NOT NULL,
      name              TEXT NOT NULL,
      image_url         TEXT,
      genre             TEXT,
      external_url      TEXT,
      updated_at        INTEGER NOT NULL
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_provider
       ON artists (provider, provider_artist_id);`,
    `CREATE INDEX IF NOT EXISTS idx_artists_name ON artists (name COLLATE NOCASE);`,

    `CREATE TABLE IF NOT EXISTS albums (
      id                TEXT PRIMARY KEY NOT NULL,
      provider          TEXT NOT NULL,
      provider_album_id TEXT NOT NULL,
      title             TEXT NOT NULL,
      artist_id         TEXT REFERENCES artists(id) ON DELETE SET NULL,
      artist_name       TEXT NOT NULL,
      artwork_url       TEXT,
      release_date      TEXT,
      track_count       INTEGER,
      genre             TEXT,
      copyright         TEXT,
      external_url      TEXT,
      album_type        TEXT NOT NULL DEFAULT 'album',
      updated_at        INTEGER NOT NULL
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_provider
       ON albums (provider, provider_album_id);`,
    `CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums (artist_id);`,
    `CREATE INDEX IF NOT EXISTS idx_albums_release ON albums (release_date DESC);`,

    `CREATE TABLE IF NOT EXISTS tracks (
      id                TEXT PRIMARY KEY NOT NULL,
      provider          TEXT NOT NULL,
      provider_track_id TEXT NOT NULL,
      title             TEXT NOT NULL,
      artist_id         TEXT REFERENCES artists(id) ON DELETE SET NULL,
      artist_name       TEXT NOT NULL,
      album_id          TEXT REFERENCES albums(id) ON DELETE SET NULL,
      album_title       TEXT,
      artwork_url       TEXT,
      duration_ms       INTEGER,
      release_date      TEXT,
      genre             TEXT,
      track_number      INTEGER,
      disc_number       INTEGER,
      explicit          INTEGER NOT NULL DEFAULT 0,
      external_url      TEXT,
      updated_at        INTEGER NOT NULL
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_provider
       ON tracks (provider, provider_track_id);`,
    `CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist_id);`,
    `CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks (album_id);`,
    `CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks (title COLLATE NOCASE);`,
    `CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks (genre);`,

    `CREATE TABLE IF NOT EXISTS genres (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE COLLATE NOCASE
    );`,
    `CREATE TABLE IF NOT EXISTS track_genres (
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
      PRIMARY KEY (track_id, genre_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_track_genres_genre ON track_genres (genre_id);`,
  ],

  // ------------------------------------------------------- v2: the user's own
  [
    `CREATE TABLE IF NOT EXISTS library_items (
      item_type  TEXT NOT NULL,
      item_id    TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'saved',
      added_at   INTEGER NOT NULL,
      PRIMARY KEY (item_type, item_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_library_added ON library_items (added_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_library_type ON library_items (item_type, added_at DESC);`,

    `CREATE TABLE IF NOT EXISTS downloads (
      id            TEXT PRIMARY KEY NOT NULL,
      track_id      TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      status        TEXT NOT NULL,
      progress      REAL NOT NULL DEFAULT 0,
      bytes_written INTEGER NOT NULL DEFAULT 0,
      total_bytes   INTEGER NOT NULL DEFAULT 0,
      file_uri      TEXT,
      artwork_uri   TEXT,
      source_uri    TEXT NOT NULL,
      source_label  TEXT NOT NULL,
      is_excerpt    INTEGER NOT NULL DEFAULT 0,
      resume_data   TEXT,
      error         TEXT,
      queued_at     INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      completed_at  INTEGER
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_downloads_track ON downloads (track_id);`,
    `CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads (status, queued_at);`,

    `CREATE TABLE IF NOT EXISTS playlists (
      id             TEXT PRIMARY KEY NOT NULL,
      name           TEXT NOT NULL,
      description    TEXT,
      cover_track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
      is_system      INTEGER NOT NULL DEFAULT 0,
      visibility     TEXT NOT NULL DEFAULT 'private',
      remote_id      TEXT,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_playlists_updated ON playlists (updated_at DESC);`,

    `CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      added_at    INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order
       ON playlist_tracks (playlist_id, position);`,

    `CREATE TABLE IF NOT EXISTS favorites (
      item_type  TEXT NOT NULL,
      item_id    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (item_type, item_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_favorites_created ON favorites (created_at DESC);`,

    `CREATE TABLE IF NOT EXISTS follows (
      artist_id              TEXT PRIMARY KEY NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      followed_at            INTEGER NOT NULL,
      notify                 INTEGER NOT NULL DEFAULT 1,
      last_seen_release_date TEXT,
      last_checked_at        INTEGER
    );`,
  ],

  // ------------------------------------------- v3: behaviour, taste, delivery
  [
    `CREATE TABLE IF NOT EXISTS listening_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      artist_id   TEXT,
      artist_name TEXT NOT NULL,
      album_id    TEXT,
      genre       TEXT,
      started_at  INTEGER NOT NULL,
      ms_played   INTEGER NOT NULL DEFAULT 0,
      completed   INTEGER NOT NULL DEFAULT 0,
      skipped     INTEGER NOT NULL DEFAULT 0,
      context     TEXT NOT NULL DEFAULT 'library',
      mood_id     TEXT,
      offline     INTEGER NOT NULL DEFAULT 0
    );`,
    `CREATE INDEX IF NOT EXISTS idx_history_started ON listening_history (started_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_history_track ON listening_history (track_id, started_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_history_artist ON listening_history (artist_name, started_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_history_genre ON listening_history (genre, started_at DESC);`,

    `CREATE TABLE IF NOT EXISTS recommendations (
      id           TEXT PRIMARY KEY NOT NULL,
      track_id     TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      reason_type  TEXT NOT NULL,
      reason_label TEXT NOT NULL,
      seed_ref     TEXT,
      score        REAL NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      dismissed_at INTEGER
    );`,
    `CREATE INDEX IF NOT EXISTS idx_recs_reason ON recommendations (reason_type, score DESC);`,

    `CREATE TABLE IF NOT EXISTS notifications (
      id          TEXT PRIMARY KEY NOT NULL,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT,
      entity_type TEXT,
      entity_id   TEXT,
      image_url   TEXT,
      created_at  INTEGER NOT NULL,
      read_at     INTEGER
    );`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (read_at, created_at DESC);`,

    `CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS search_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      query      TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_search_history ON search_history (created_at DESC);`,
  ],

  // ------------------------------------------------- v4: people, and the live
  [
    `CREATE TABLE IF NOT EXISTS profile (
      id             TEXT PRIMARY KEY NOT NULL,
      user_id        TEXT,
      handle         TEXT,
      display_name   TEXT,
      avatar_url     TEXT,
      bio            TEXT,
      activity_public INTEGER NOT NULL DEFAULT 0,
      stats_public    INTEGER NOT NULL DEFAULT 0,
      library_public  INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS friends (
      user_id      TEXT PRIMARY KEY NOT NULL,
      handle       TEXT NOT NULL,
      display_name TEXT,
      avatar_url   TEXT,
      relation     TEXT NOT NULL DEFAULT 'following',
      created_at   INTEGER NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_friends_relation ON friends (relation, created_at DESC);`,

    `CREATE TABLE IF NOT EXISTS activity_feed (
      id              TEXT PRIMARY KEY NOT NULL,
      actor_user_id   TEXT NOT NULL,
      actor_handle    TEXT NOT NULL,
      actor_name      TEXT,
      actor_avatar    TEXT,
      verb            TEXT NOT NULL,
      entity_type     TEXT,
      entity_id       TEXT,
      entity_title    TEXT,
      entity_subtitle TEXT,
      artwork_url     TEXT,
      created_at      INTEGER NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_feed (created_at DESC);`,

    `CREATE TABLE IF NOT EXISTS events_cache (
      id           TEXT PRIMARY KEY NOT NULL,
      provider     TEXT NOT NULL,
      name         TEXT NOT NULL,
      artist_names TEXT,
      venue_name   TEXT,
      city         TEXT,
      country      TEXT,
      starts_at    TEXT,
      image_url    TEXT,
      genre        TEXT,
      latitude     REAL,
      longitude    REAL,
      payload      TEXT NOT NULL,
      cached_at    INTEGER NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_events_starts ON events_cache (starts_at);`,
    `CREATE INDEX IF NOT EXISTS idx_events_city ON events_cache (city COLLATE NOCASE, starts_at);`,

    `CREATE TABLE IF NOT EXISTS ticket_sources (
      event_id    TEXT NOT NULL REFERENCES events_cache(id) ON DELETE CASCADE,
      seller_name TEXT NOT NULL,
      url         TEXT NOT NULL,
      status      TEXT,
      price_min   REAL,
      price_max   REAL,
      currency    TEXT,
      on_sale_at  TEXT,
      PRIMARY KEY (event_id, seller_name)
    );`,
  ],

  // ------------------------------------ v5: the user's own music, and Grooves
  [
    // One row per audio file Pulse found on the device. It points at a row in
    // `tracks` (provider 'local'), so imported music flows through exactly the
    // same library, player, history and statistics as anything else.
    `CREATE TABLE IF NOT EXISTS local_tracks (
      track_id          TEXT PRIMARY KEY NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      asset_id          TEXT,
      file_uri          TEXT NOT NULL,
      filename          TEXT NOT NULL,
      container         TEXT,
      mime_type         TEXT,
      file_size         INTEGER,
      bitrate           INTEGER,
      sample_rate       INTEGER,
      channels          INTEGER,
      album_artist      TEXT,
      /* Artwork lifted out of the file's own tags, cached next to the index. */
      embedded_art_uri  TEXT,
      /* 'tagged' | 'identified' | 'needs_identification' | 'unidentified' */
      identification    TEXT NOT NULL DEFAULT 'unidentified',
      /* 0..1 — how sure the identifier was. Null when the file had real tags. */
      confidence        REAL,
      matched_track_id  TEXT,
      source            TEXT NOT NULL DEFAULT 'device',
      added_at          INTEGER NOT NULL,
      scanned_at        INTEGER NOT NULL,
      modified_at       INTEGER
    );`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_local_uri ON local_tracks (file_uri);`,
    `CREATE INDEX IF NOT EXISTS idx_local_asset ON local_tracks (asset_id);`,
    `CREATE INDEX IF NOT EXISTS idx_local_identification ON local_tracks (identification);`,
    `CREATE INDEX IF NOT EXISTS idx_local_added ON local_tracks (added_at DESC);`,

    // A Groove is a cluster Pulse found in the user's own collection.
    `CREATE TABLE IF NOT EXISTS grooves (
      id             TEXT PRIMARY KEY NOT NULL,
      name           TEXT NOT NULL,
      description    TEXT,
      /* The cluster centroid, kept so new music can be placed without a rebuild. */
      energy         REAL NOT NULL DEFAULT 0.5,
      era            INTEGER,
      genre_family   TEXT,
      accent         TEXT,
      cover_track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
      track_count    INTEGER NOT NULL DEFAULT 0,
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      generated_at   INTEGER NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_grooves_count ON grooves (track_count DESC);`,

    // A track can sit in several Grooves; `is_primary` marks its best fit.
    `CREATE TABLE IF NOT EXISTS groove_tracks (
      groove_id  TEXT NOT NULL REFERENCES grooves(id) ON DELETE CASCADE,
      track_id   TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      score      REAL NOT NULL DEFAULT 0,
      is_primary INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (groove_id, track_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_groove_tracks_track ON groove_tracks (track_id);`,
    `CREATE INDEX IF NOT EXISTS idx_groove_tracks_score ON groove_tracks (groove_id, score DESC);`,
  ],
];

export const TARGET_SCHEMA_VERSION = MIGRATIONS.length;
