-- Pulse News: updates written from inside the app by Pulse's own editors.
--
-- Posts stay hidden from everyone but admins until two things are true: the
-- post itself is published, and the "pulse_news_public" switch is on. That
-- lets the desk fill up with Kenyan, American and worldwide updates before
-- anyone else sees a thing, and lets one switch open it to everybody.

-- Who is an editor. Set by hand in SQL, never from the app:
--   update public.profiles set is_admin = true where id = '<auth user id>';
alter table public.profiles add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Nobody can promote themselves through the profile update policy.
create or replace function public.keep_is_admin()
returns trigger
language plpgsql
as $$
begin
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_keep_is_admin on public.profiles;
create trigger profiles_keep_is_admin
  before update on public.profiles
  for each row execute function public.keep_is_admin();

-- App-wide switches, readable by every signed-in person, set only by admins.
create table if not exists public.app_flags (
  key text primary key,
  value boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.app_flags enable row level security;

drop policy if exists "flags are readable" on public.app_flags;
create policy "flags are readable"
  on public.app_flags for select
  to authenticated
  using (true);

drop policy if exists "admins set flags" on public.app_flags;
create policy "admins set flags"
  on public.app_flags for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.app_flags (key, value) values ('pulse_news_public', false)
  on conflict (key) do nothing;

-- The posts.
create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 4000),
  region text not null check (region in ('kenya', 'usa', 'global')),
  image_url text,
  link_url text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists news_posts_published_idx on public.news_posts (published, created_at desc);

alter table public.news_posts enable row level security;

drop policy if exists "published news is readable" on public.news_posts;
create policy "published news is readable"
  on public.news_posts for select
  to authenticated
  using (
    public.is_admin()
    or (published and exists (select 1 from public.app_flags f where f.key = 'pulse_news_public' and f.value))
  );

drop policy if exists "admins write news" on public.news_posts;
create policy "admins write news"
  on public.news_posts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
