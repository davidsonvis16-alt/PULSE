# Launching Pulse

Pulse needs three things before other people can use it:

1. **A server**, so people can make accounts and the radio is shared (Supabase, free).
2. **A web link** anyone can open in a browser (Vercel, free).
3. **Phone apps**: an Android install link, then the app stores (Expo EAS).

Do them in this order. Each step says what you get at the end of it.

---

## 1. The server (about 15 minutes)

You get: working sign-up and login, freestyle uploads, and the live radio.

1. Make a free account at <https://supabase.com> and click **New project**.
   Pick a name and a database password, and save the password somewhere.
2. In the project, open **Project Settings → API**. Copy the **Project URL**
   and the **anon public** key.
3. In the Pulse folder, make a file called `.env` with these lines:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```

   Both values are safe to publish. Every table is locked down by row-level
   security, and those rules decide who can do what.
4. Put the database and functions on the project:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF   # the part before .supabase.co
   npx supabase db push                               # accounts, friends, radio, storage
   npx supabase functions deploy web-proxy            # lets the web version reach the catalogue
   ```

5. In Supabase, open **Authentication → Sign In / Providers → Email**:
   - For the quickest start, turn **Confirm email** off, so people are in as
     soon as they sign up. Leaving it on is safer: people confirm by email first.
6. Once you have your web link (step 2), set it as the address password-reset
   emails go to. Open **Authentication → URL Configuration** and set **Site URL**
   to that link.

Optional extras (Pulse works without them):

- **Concerts near you:** get a free Ticketmaster key at
  <https://developer.ticketmaster.com>, then run
  `npx supabase secrets set TICKETMASTER_API_KEY=...` and
  `npx supabase functions deploy events`.
- **Music news push alerts:** see `supabase/README.md`.

## 2. The web link (about 10 minutes)

You get: a link like `https://pulse-yourname.vercel.app` that anyone can open.

```bash
npx vercel login
npx vercel --prod
```

The first time, it asks a few questions. Accept the defaults, because
`vercel.json` already holds the build settings. When it finishes, it prints
your link.

Then:

- Add the same two `EXPO_PUBLIC_SUPABASE_*` values in the Vercel dashboard
  (**Project → Settings → Environment Variables**). Add
  `EXPO_PUBLIC_SHARE_BASE_URL=<your link>` there too, and in your `.env`.
  Then run `npx vercel --prod` again.
- Put the link into Supabase as the **Site URL** (step 1.6).

What works in a browser: accounts, Pulse Radio (listening, recording and
uploading freestyles), search, recommendations, charts, and importing music
from your computer. Imported songs stay in that browser. They are never
uploaded.

What does not work in a browser: scanning a whole phone library, downloads,
and lock-screen controls. Those need the app.

The web version needs a recent Chrome, Edge, Firefox or Samsung Internet. On
iPhones, the app (step 3) is the dependable route.

## 3. Phone apps

### Android install link (about 20 minutes, mostly waiting)

You get: a link people tap to install Pulse on Android, with no Play Store needed.

```bash
npm i -g eas-cli
eas login                                    # free Expo account
eas build -p android --profile preview
```

When the build finishes, EAS shows a link and a QR code. Anyone with the link
can install the app. Android asks them to allow installing from their browser
once.

Prefer to build on this computer instead: `npm run build:android` makes
`dist/pulse.apk`, which you can upload anywhere.

### App stores (when you are ready to go public)

| | Google Play | Apple App Store |
|---|---|---|
| Account | $25 once — play.google.com/console | $99/year — developer.apple.com |
| Build | `eas build -p android --profile production` | `eas build -p ios --profile production` |
| Upload | `eas submit -p android` | `eas submit -p ios` |
| Testing first | Internal testing track | TestFlight (public link for up to 10,000 testers) |

Both stores ask for a **privacy policy URL**. Both also check that apps with
user uploads can report content and remove it. Pulse already has both:
listeners can report a freestyle, three reports take it off air, and people
can delete their own. Write down a contact email for reports in the store
listing.

### Updating everyone later

Changes to screens and logic reach installed apps without a new store build:

```bash
eas update --channel production --message "what changed"
```

Run a new `eas build` only when you add a native package or change
`app.json`. Redeploy the web link with `npx vercel --prod`.

---

## What each person gets

- **Their own account.** Nobody shares a profile. When someone else signs in on
  the same phone, the previous person's library, history, playlists and
  downloads are cleared first.
- **Their own music, fast.** On first launch, Pulse imports their first 20 songs
  all the way: tags, identification, covers and Grooves. They can start
  listening within seconds while the rest import in the background.
- **Recommendations from their own taste.** Nothing is seeded from anyone else.
- **Pulse Radio.** It's always on, and everyone hears the same freestyle at the
  same moment. Tap the green **Radio** button on Home, then
  **Drop a freestyle** to record one or upload a file.

## Moderating the radio

Open Supabase → **Table Editor → freestyles**:

- `hidden = true` means it was reported by 3 people and is off air. To put it
  back, set `hidden` to false and `report_count` to 0. To remove it for good,
  delete the row.
- `freestyle_reports` lists who reported what, and why.
