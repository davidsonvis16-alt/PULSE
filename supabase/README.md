# Pulse backend

Pulse needs this to run: every listener signs in with an account. The library,
downloads, listening history and statistics still live on each person's
device. What lives here is what genuinely needs a server:

1. **Accounts and the social layer**: profiles, follows and the activity feed.
2. **Pulse Radio**: the freestyles people upload, their audio in Storage,
   reports, and the shared clock that keeps every listener on the same second.
3. **The web relay** (`web-proxy`): lets the browser version reach the
   catalogue and music press, which send no CORS headers.
4. **The events proxy**, so the Ticketmaster key stays off the phone.
5. **Music news alerts**: a job that watches the music press and the award
   pages and pushes to phones, so news arrives while Pulse is closed.

For the full step-by-step, including the web link and phone builds, see
`docs/LAUNCH.md`.

## Setting it up

```bash
supabase link --project-ref <your-project>
supabase db push                       # applies every migration, including 0004 (radio)
supabase functions deploy web-proxy
supabase secrets set TICKETMASTER_API_KEY=<your-discovery-key>
supabase functions deploy events
```

### Music news alerts

```bash
supabase db push                              # adds 0002 and 0003
supabase secrets set PUSH_JOB_SECRET=$(openssl rand -hex 32)
supabase functions deploy register-device
supabase functions deploy music-news-push
```

Then tell the database where the functions live and what the secret is, so the
scheduler can call the job. They go in Vault, the project's encrypted secret
store (hosted Supabase no longer allows `alter database … set app.…`). In the
SQL editor:

```sql
select vault.create_secret('https://<project>.supabase.co/functions/v1', 'pulse_functions_url');
select vault.create_secret('<the same PUSH_JOB_SECRET>', 'pulse_job_secret');
```

The job runs every fifteen minutes. To watch what it decides without waiting:

```bash
curl -X POST https://<project>.supabase.co/functions/v1/music-news-push \
  -H "x-pulse-job-secret: <secret>"
```

It answers with what it considered and what it sent. Nothing is ever sent
twice: every alert is keyed in `push_sent` before delivery.

**Before any of this reaches a phone**, the push credentials have to exist, and
only the project owner can create them:

- **Android** — upload a Firebase Cloud Messaging V1 service account key:
  `eas credentials` → Android → push notifications.
- **iOS** — an APNs key from the Apple Developer account:
  `eas credentials` → iOS → push notifications.

Both are one-time. Expo's push service uses them to deliver; Pulse never holds
either key.

### What the server knows about a listener

A row in `push_devices` is a push token, a platform, which kinds of alert were
asked for, and — only when "Use my artists" is switched on in the app — the
**names** of artists in that library. Never a listening history, never what was
played or when, and no account is required. Switching it off sends an empty
list, which erases what was stored.

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
