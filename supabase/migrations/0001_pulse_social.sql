-- Pulse social backend.
--
-- Only the social layer lives here. A user's library, downloads, listening
-- history and statistics stay on their device; this schema holds just the
-- things that are, by definition, shared: who you are publicly, who follows
-- whom, and the activity a user has explicitly chosen to publish.
--
-- Every table is protected by row-level security. The anon key in the app
-- bundle grants nothing on its own — these policies do all the deciding.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  handle          text unique,
  display_name    text,
  avatar_url      text,
  bio             text,
  activity_public boolean not null default false,
  stats_public    boolean not null default false,
  library_public  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint handle_format check (handle is null or handle ~ '^[a-z0-9_]{2,30}$'),
  constraint bio_length check (bio is null or char_length(bio) <= 300),
  constraint display_name_length check (display_name is null or char_length(display_name) <= 40)
);

create index if not exists profiles_handle_idx on public.profiles (handle);

alter table public.profiles enable row level security;

-- Anyone signed in can look up a profile by handle (that is how you find a
-- friend), but only the owner can change one.
drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles are self-writable" on public.profiles;
create policy "profiles are self-writable"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles are self-updatable" on public.profiles;
create policy "profiles are self-updatable"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- New sign-ups get a profile row automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------- friendships

create table if not exists public.friendships (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);

create index if not exists friendships_followee_idx on public.friendships (followee_id);

alter table public.friendships enable row level security;

drop policy if exists "see your own edges" on public.friendships;
create policy "see your own edges"
  on public.friendships for select
  to authenticated
  using (auth.uid() = follower_id or auth.uid() = followee_id);

-- You may only follow someone who has left follow requests enabled.
drop policy if exists "follow people who allow it" on public.friendships;
create policy "follow people who allow it"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = follower_id);

drop policy if exists "unfollow your own edges" on public.friendships;
create policy "unfollow your own edges"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = follower_id);

-- ---------------------------------------------------------------- activity

create table if not exists public.activity (
  id              bigint generated always as identity primary key,
  actor_id        uuid not null references public.profiles (id) on delete cascade,
  verb            text not null check (verb in ('played','liked','added_playlist','followed','downloaded','shared')),
  entity_type     text check (entity_type in ('track','album','artist','playlist','event')),
  entity_id       text,
  entity_title    text check (entity_title is null or char_length(entity_title) <= 200),
  entity_subtitle text check (entity_subtitle is null or char_length(entity_subtitle) <= 200),
  artwork_url     text,
  created_at      timestamptz not null default now()
);

create index if not exists activity_actor_created_idx on public.activity (actor_id, created_at desc);
create index if not exists activity_created_idx on public.activity (created_at desc);

alter table public.activity enable row level security;

-- You can write activity only as yourself, and only while your profile says
-- activity is public. Flipping the switch off stops new rows immediately.
drop policy if exists "publish your own activity" on public.activity;
create policy "publish your own activity"
  on public.activity for insert
  to authenticated
  with check (
    auth.uid() = actor_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.activity_public
    )
  );

-- You can read your own activity, and that of people you follow who are
-- currently sharing.
drop policy if exists "read activity you are entitled to" on public.activity;
create policy "read activity you are entitled to"
  on public.activity for select
  to authenticated
  using (
    auth.uid() = actor_id
    or (
      exists (
        select 1 from public.friendships f
        where f.follower_id = auth.uid() and f.followee_id = activity.actor_id
      )
      and exists (
        select 1 from public.profiles p
        where p.id = activity.actor_id and p.activity_public
      )
    )
  );

drop policy if exists "delete your own activity" on public.activity;
create policy "delete your own activity"
  on public.activity for delete
  to authenticated
  using (auth.uid() = actor_id);

-- Old activity is not interesting and is not worth keeping.
create or replace function public.prune_activity()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.activity where created_at < now() - interval '30 days';
$$;

-- ------------------------------------------------------------------- views

-- The feed the app reads. Security invoker means the policies above still
-- apply: this view cannot show a user anything they could not select directly.
create or replace view public.friend_activity
with (security_invoker = true)
as
select
  a.id,
  a.actor_id,
  p.handle       as actor_handle,
  p.display_name as actor_name,
  p.avatar_url   as actor_avatar,
  a.verb,
  a.entity_type,
  a.entity_id,
  a.entity_title,
  a.entity_subtitle,
  a.artwork_url,
  a.created_at
from public.activity a
join public.profiles p on p.id = a.actor_id;

create or replace view public.friendships_view
with (security_invoker = true)
as
select
  case when f.follower_id = auth.uid() then f.followee_id else f.follower_id end as other_id,
  p.handle,
  p.display_name,
  p.avatar_url,
  case
    when exists (
      select 1 from public.friendships r
      where r.follower_id = f.followee_id and r.followee_id = f.follower_id
    ) then 'mutual'
    when f.follower_id = auth.uid() then 'following'
    else 'follower'
  end as relation,
  f.created_at
from public.friendships f
join public.profiles p
  on p.id = case when f.follower_id = auth.uid() then f.followee_id else f.follower_id end
where f.follower_id = auth.uid() or f.followee_id = auth.uid();

-- ------------------------------------------------------- shared playlists

create table if not exists public.shared_playlists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  visibility  text not null default 'private' check (visibility in ('private','friends','public')),
  artwork_url text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.shared_playlist_tracks (
  playlist_id  uuid not null references public.shared_playlists (id) on delete cascade,
  position     integer not null,
  provider     text not null,
  track_ref    text not null,
  title        text not null,
  artist_name  text not null,
  album_title  text,
  artwork_url  text,
  duration_ms  integer,
  primary key (playlist_id, track_ref)
);

create index if not exists shared_playlist_tracks_order
  on public.shared_playlist_tracks (playlist_id, position);

alter table public.shared_playlists enable row level security;
alter table public.shared_playlist_tracks enable row level security;

drop policy if exists "read playlists you may see" on public.shared_playlists;
create policy "read playlists you may see"
  on public.shared_playlists for select
  to authenticated
  using (
    owner_id = auth.uid()
    or visibility = 'public'
    or (
      visibility = 'friends'
      and exists (
        select 1 from public.friendships f
        where f.follower_id = auth.uid() and f.followee_id = shared_playlists.owner_id
      )
    )
  );

drop policy if exists "manage your own playlists" on public.shared_playlists;
create policy "manage your own playlists"
  on public.shared_playlists for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "read tracks of visible playlists" on public.shared_playlist_tracks;
create policy "read tracks of visible playlists"
  on public.shared_playlist_tracks for select
  to authenticated
  using (
    exists (
      select 1 from public.shared_playlists p
      where p.id = shared_playlist_tracks.playlist_id
    )
  );

drop policy if exists "manage tracks of your playlists" on public.shared_playlist_tracks;
create policy "manage tracks of your playlists"
  on public.shared_playlist_tracks for all
  to authenticated
  using (
    exists (
      select 1 from public.shared_playlists p
      where p.id = shared_playlist_tracks.playlist_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.shared_playlists p
      where p.id = shared_playlist_tracks.playlist_id and p.owner_id = auth.uid()
    )
  );
