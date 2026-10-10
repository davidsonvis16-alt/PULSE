-- Push notifications.
--
-- Two tables and nothing else: the devices that have asked to be told about
-- music news, and a record of what has already been sent so the same story is
-- never pushed twice.
--
-- Neither table is readable or writable with the anon key. Devices register
-- through the `register-device` function and alerts are sent by the
-- `music-news-push` function, both of which use the service role. That keeps
-- one device from reading, editing or deleting another device's row, and keeps
-- push tokens out of reach entirely.

-- ----------------------------------------------------------------- devices

create table if not exists public.push_devices (
  id             uuid primary key default gen_random_uuid(),
  -- Expo push token. One row per install; re-registering updates in place.
  token          text not null unique,
  platform       text not null check (platform in ('ios', 'android', 'web')),
  -- Optional: set only when the person is signed in, so a device can be
  -- cleaned up when an account goes.
  user_id        uuid references auth.users (id) on delete set null,
  enabled        boolean not null default true,
  -- What they want to hear about.
  topics         text[] not null default array['breaking', 'awards', 'new-music'],
  -- The artists they listen to, sent ONLY if they turned personalisation on.
  -- Names, never listening history, and cleared the moment they turn it off.
  artists        text[] not null default array[]::text[],
  -- Their storefront, used to decide which ceremonies are relevant to them.
  country        text,
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint artists_length check (array_length(artists, 1) is null or array_length(artists, 1) <= 300)
);

create index if not exists push_devices_enabled_idx on public.push_devices (enabled);
create index if not exists push_devices_artists_idx on public.push_devices using gin (artists);

alter table public.push_devices enable row level security;
-- No policies: the anon and authenticated roles get nothing. Only the service
-- role, which bypasses row-level security, touches this table.

-- -------------------------------------------------------------- sent alerts

create table if not exists public.push_sent (
  -- What the alert was about: "story:<url>", "award:<edition>|winners", and so
  -- on. The primary key is what stops a repeat.
  key            text primary key,
  kind           text not null,
  title          text not null,
  sent_at        timestamptz not null default now(),
  recipients     integer not null default 0
);

create index if not exists push_sent_sent_at_idx on public.push_sent (sent_at desc);

alter table public.push_sent enable row level security;

-- Housekeeping: a device that has not been seen in six months, and alert
-- records older than sixty days, are of no further use.
create or replace function public.prune_push_state()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_devices where last_seen_at < now() - interval '6 months';
  delete from public.push_sent where sent_at < now() - interval '60 days';
$$;
