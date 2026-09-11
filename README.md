# Pulse

Your music. Your way.

Pulse is a personal music manager: search, listening, downloads, a real
library, a discovery engine that learns from what you play, listening
statistics, a social layer, new-release tracking and concert discovery — in one
application rather than eight disconnected screens.

Built with Expo (React Native) for phones, tablets, laptops and desktop.

---

## The idea

Pulse starts from the music you already own. It reads the audio files on your
device, gives them real artwork, groups them into **Grooves**, and builds your
taste profile from what is actually in your collection — not from what happens
to be charting. Listening behaviour refines that over time rather than
replacing it.

```
MY MUSIC → PULSE UNDERSTANDS IT → ORGANISES IT → GIVES IT REAL ARTWORK
        → CREATES GROOVES → LEARNS MY TASTE → FINDS RELATED MUSIC
```

## What is real here

This is the part worth being precise about.

| Area | Where the data comes from |
| --- | --- |
| Your library | Audio files on your device, read with your permission |
| Titles, artists, albums | The files' own ID3, MP4, FLAC, Ogg and WAV tags |
| Missing metadata | Matched against the catalogue, and only when confident |
| Cover art | Embedded art first, then official artwork, then nothing |
| Grooves | Clustered from your own collection, named after what is in it |
| Recommendations | Seeded by your collection and bounded by your taste |
| Search, artists, albums, songs | Apple iTunes Search API — live, no key needed |
| Playback | Your own files, plus official preview streams from the source |
| Downloads | The same audio, written to the device with its artwork and metadata |
| Library, playlists, favourites | A relational SQLite database on the device |
| Listening statistics | Aggregates over measured listening time, not play counters |
| Events and tickets | Ticketmaster Discovery, through a server proxy |

Nothing on a production screen is invented. Where a source is not configured —
events, most obviously — Pulse shows an empty state that says so and how to fix
it, rather than filling the screen with plausible-looking fiction.

**On reading your device:** Android exposes the media store, so Pulse can scan a
whole collection once you allow it, and notice music you add later. iOS keeps
the Music app's library behind a framework an Expo app cannot reach, so there
you pick files from Files or iCloud Drive instead. Both paths end in the same
library. See `docs/library-and-taste.md`.

**On full-length audio:** the default source licenses 30-second previews, not
complete recordings. Pulse plays and stores exactly what the source permits and
labels it honestly in the player and in the download list. Pointing Pulse at a
catalogue that licenses full tracks means writing one adapter — see below — and
changing nothing else.

## Running it

```bash
npm install
npx expo start
```

Then press `i` for the iOS simulator, `a` for Android, `w` for the browser, or
scan the QR code with **Expo Go** on your phone — the app runs there with no
build step. That is enough for the whole music experience. To add accounts, friends and
live events, copy `.env.example` to `.env` and follow `supabase/README.md`.

```bash
npm test            # tag readers, identification, Grooves, taste boundary
npm run typecheck   # tsc --noEmit
npm run lint
```

The web target bundles and runs, but `expo-sqlite` uses a WebAssembly build that
needs cross-origin isolation, so serve the web export with `Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. iOS and Android
need nothing extra.

## How it is put together

```
app/                    Screens (expo-router file routes)
  (tabs)/               Home · Discover · Library · Events · Profile
  track|album|artist|playlist|mood|groove/[id]
  import, identify, grooves, player, queue, stats, notifications,
  downloads, collection, settings
src/
  ingestion/
    scanner/            MusicScanner: media store and file picker
    tags/               ID3, MP4, FLAC, Ogg and WAV readers
    identify/           MusicIdentifier and confidence scoring
    artwork/            ArtworkProvider
    ingest.ts           The import pipeline, with progress
    watch.ts            Notices music added to the device later
  grooves/              GrooveEngine: clustering and naming
  discovery/            TasteEngine, recommendation shelves, release tracking
  providers/music/      MusicProvider interface + adapters (iTunes, local)
  providers/events/     EventProvider interface + adapters (Ticketmaster)
  db/                   SQLite schema, migrations, repositories
  audio/                The global player (queue, repeat, shuffle, history)
  downloads/            Download manager (progress, pause/resume, storage)
  social/               Supabase-backed profiles, follows and activity
  share/                Share payloads and the native share sheet
  ui/                   The Pulse design system
  screens/              Larger screen implementations
supabase/               Social schema with row-level security, events proxy
tests/                  Tag, identification, Groove and taste-boundary tests
docs/                   Architecture notes
```

### Swapping the music source

Every screen talks to the `MusicProvider` interface and never to provider JSON.
Adding a source means implementing that interface and registering it:

```ts
import { registerMusicProvider, setActiveMusicProvider } from '@/src/providers/music';

registerMusicProvider(myProvider);
setActiveMusicProvider('my-provider');
```

Ids are provider-qualified (`itunes:track:1440857781`), so tracks saved from one
source keep working after another is added. `capabilities.download` decides
whether download controls appear at all; `capabilities.excerptsOnly` decides how
Pulse describes what it is playing.

### Where your data lives

On the device, in a normalised SQLite database: artists, albums, tracks, genres,
local files, Grooves, Groove memberships, library items, downloads, playlists,
playlist tracks, favourites, follows, listening history, recommendations,
notifications, events and ticket sources, each with real foreign keys and
indexes.

Your music files are read, never written. The index, the cached covers and the
Grooves all live on the device, and Privacy has a one-tap action to remove them.
Identification sends a title and artist to the catalogue — the same request
typing it into search would make — and nothing else.

Nothing about your listening leaves the device unless you switch sharing on in
Privacy, and that rule is enforced in the database policies, not just in the
app.

## Security

- Secrets never ship in the bundle. The Ticketmaster key lives in a Supabase
  edge function that validates and rate-limits every query.
- The Supabase anon key is public by design; row-level security decides access.
- Auth is Supabase email/password with a persisted, auto-refreshing session,
  and inputs are validated before they reach the network.
- Location is read once, on request, for nearby events. Never in the background.
- External links open in the system browser, never in a web view pretending to
  be Pulse.
