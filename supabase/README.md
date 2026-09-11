# Pulse backend

Pulse runs without any of this. Catalogue search, playback, the library,
downloads, listening history and statistics are all on-device. What lives here
adds two things that genuinely need a server:

1. **Accounts and the social layer** — profiles, follows and the activity feed.
2. **The events proxy** — so the Ticketmaster key stays off the phone.

## Setting it up

```bash
supabase link --project-ref <your-project>
supabase db push                       # applies migrations/0001_pulse_social.sql
supabase secrets set TICKETMASTER_API_KEY=<your-discovery-key>
supabase functions deploy events
```

Then point the app at it:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
# optional, derived from the Supabase URL when omitted
EXPO_PUBLIC_EVENTS_PROXY_URL=https://<project>.supabase.co/functions/v1/events
```

## What is safe to ship in the app bundle

The Supabase URL and the anon key. Both are public by design: every table has
row-level security, and the policies in the migration are what actually decide
who can read or write anything.

The Ticketmaster key is **not** safe in the bundle and never appears in the app.
It is a function secret, read only by `functions/events/index.ts`.

## Privacy, enforced in the database

A user's activity row can only be inserted while their own profile has
`activity_public = true`, and can only be read by themselves or by someone who
follows them *and* whose sharing is still on. Turning sharing off in the app
stops both immediately — the check is in the policy, not in the client.
