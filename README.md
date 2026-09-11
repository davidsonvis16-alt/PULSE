# Pulse

Your music. Your way.

Pulse is a personal music manager: search, listening, downloads, a real
library, a discovery engine that learns from what you play, listening
statistics, a social layer, new-release tracking and concert discovery — in one
application rather than eight disconnected screens.

Built with Expo (React Native) for phones, tablets, laptops and desktop.

---

## What is real here

This is the part worth being precise about.

| Area | Where the data comes from |
| --- | --- |
| Search, artists, albums, songs | Apple iTunes Search API — live, no key needed |
| Cover art and artist images | The source's own artwork, requested at the size drawn |
| Playback | Official 30-second preview streams from the source |
| Downloads | The same audio, written to the device with its artwork and metadata |
| Library, playlists, favourites | A relational SQLite database on the device |
| Listening statistics | Aggregates over measured listening time, not play counters |
| Recommendations | Built from your own history, sent to the provider as seeds |
| Events and tickets | Ticketmaster Discovery, through a server proxy |

Nothing on a production screen is invented. Where a source is not configured —
events, most obviously — Pulse shows an empty state that says so and how to fix
it, rather than filling the screen with plausible-looking fiction.

**Not built:** importing audio files already on the device. The library schema
has a slot for it (`LibrarySource = 'import'`), but a file picked off the
filesystem arrives with no reliable title, artist or cover, and Pulse's whole
premise is that you never hand-attach metadata. Doing it properly means a tag
parser plus a confirmation step, and that is a feature of its own rather than a
line in this one.

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
  track|album|artist|playlist|mood/[id]
  player, queue, stats, notifications, downloads, collection, settings
src/
  providers/music/      MusicProvider interface + adapters (iTunes)
  providers/events/     EventProvider interface + adapters (Ticketmaster)
  db/                   SQLite schema, migrations, repositories
  audio/                The global player (queue, repeat, shuffle, history)
  downloads/            Download manager (progress, pause/resume, storage)
  discovery/            Taste profile, recommendation shelves, release tracking
  social/               Supabase-backed profiles, follows and activity
  share/                Share payloads and the native share sheet
  ui/                   The Pulse design system
  screens/              Larger screen implementations
supabase/               Social schema with row-level security, events proxy
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
library items, downloads, playlists, playlist tracks, favourites, follows,
listening history, recommendations, notifications, events and ticket sources,
each with real foreign keys and indexes.

Nothing about your listening leaves the device unless you switch sharing on in
Privacy — and that rule is enforced in the database policies, not just in the
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
