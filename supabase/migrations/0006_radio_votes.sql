-- Pulse Radio: Songs of the Week.
--
-- Each week (Monday to Sunday, UTC) the first twenty freestyles uploaded make
-- the ballot. Every listener may pick a top five, in order: first place is
-- worth five points, fifth place one. The ballot closes by itself when the week
-- ends, and last week's top five can be read by anyone.
--
-- Who voted for what is private. Listeners read totals through the functions
-- below, never each other's votes, and the only way to vote is
-- submit_radio_votes, which checks the whole top five at once.

create or replace function public.radio_week_start(at timestamptz default now())
returns date
language sql
immutable
as $$
  select date_trunc('week', at at time zone 'utc')::date;
$$;

create table if not exists public.radio_votes (
  week_start    date not null,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  freestyle_id  uuid not null references public.freestyles (id) on delete cascade,
  rank          smallint not null check (rank between 1 and 5),
  created_at    timestamptz not null default now(),
  primary key (week_start, user_id, rank),
  unique (week_start, user_id, freestyle_id)
);

create index if not exists radio_votes_freestyle_idx on public.radio_votes (week_start, freestyle_id);

alter table public.radio_votes enable row level security;

-- Listeners see their own picks; nobody else's.
drop policy if exists "see your own votes" on public.radio_votes;
create policy "see your own votes"
  on public.radio_votes for select
  to authenticated
  using (user_id = auth.uid());

-- No insert, update or delete policies: votes only change through
-- submit_radio_votes, which runs the checks.

-- The twenty freestyles on a week's ballot: the first twenty uploaded that
-- week that are still on air.
create or replace function public.radio_ballot_ids(week date)
returns table (freestyle_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select f.id
  from public.freestyles f
  where not f.hidden
    and f.created_at >= week::timestamp at time zone 'utc'
    and f.created_at < (week + 7)::timestamp at time zone 'utc'
  order by f.created_at, f.id
  limit 20;
$$;

-- This week's ballot with its running totals and the caller's own picks.
create or replace function public.radio_week_ballot()
returns table (
  id uuid,
  user_id uuid,
  title text,
  storage_path text,
  duration_ms integer,
  created_at timestamptz,
  display_name text,
  handle text,
  avatar_url text,
  points integer,
  voters integer,
  my_rank smallint,
  week_start date
)
language sql
stable
security definer
set search_path = public
as $$
  with week as (select public.radio_week_start() as start)
  select
    f.id, f.user_id, f.title, f.storage_path, f.duration_ms, f.created_at,
    p.display_name, p.handle, p.avatar_url,
    coalesce(sum(6 - v.rank), 0)::integer as points,
    count(v.user_id)::integer as voters,
    max(case when v.user_id = auth.uid() then v.rank end)::smallint as my_rank,
    (select start from week) as week_start
  from public.radio_ballot_ids((select start from week)) b
  join public.freestyles f on f.id = b.freestyle_id
  join public.profiles p on p.id = f.user_id
  left join public.radio_votes v
    on v.freestyle_id = f.id and v.week_start = (select start from week)
  group by f.id, p.id
  order by f.created_at, f.id;
$$;

-- A finished week's top five.
create or replace function public.radio_week_results(week date)
returns table (
  id uuid,
  title text,
  storage_path text,
  duration_ms integer,
  display_name text,
  handle text,
  avatar_url text,
  points integer,
  voters integer,
  place integer
)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select
      f.id, f.title, f.storage_path, f.duration_ms,
      p.display_name, p.handle, p.avatar_url,
      sum(6 - v.rank)::integer as points,
      count(*)::integer as voters,
      (row_number() over (order by sum(6 - v.rank) desc, count(*) desc, min(f.created_at)))::integer as place
    from public.radio_votes v
    join public.freestyles f on f.id = v.freestyle_id and not f.hidden
    join public.profiles p on p.id = f.user_id
    where v.week_start = week
      and week < public.radio_week_start()
    group by f.id, p.id
  ) ranked
  where place <= 5
  order by place;
$$;

-- Replaces the caller's top five for this week. picks[1] is first place.
create or replace function public.submit_radio_votes(picks uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  week date := public.radio_week_start();
  n integer := coalesce(array_length(picks, 1), 0);
begin
  if me is null then
    raise exception 'Sign in to vote.';
  end if;
  if n > 5 then
    raise exception 'Pick up to five songs.';
  end if;
  if n <> (select count(distinct x) from unnest(picks) x) then
    raise exception 'Each song can only be picked once.';
  end if;
  if exists (
    select 1 from unnest(picks) x
    where x not in (select freestyle_id from public.radio_ballot_ids(week))
  ) then
    raise exception 'That song is not on this week''s ballot.';
  end if;
  if exists (
    select 1 from public.freestyles f
    where f.id = any (picks) and f.user_id = me
  ) then
    raise exception 'You cannot vote for your own song.';
  end if;

  delete from public.radio_votes where week_start = week and user_id = me;
  insert into public.radio_votes (week_start, user_id, freestyle_id, rank)
  select week, me, picks[i], i from generate_series(1, n) i;
end;
$$;

revoke execute on function public.submit_radio_votes(uuid[]) from public, anon;
grant execute on function public.submit_radio_votes(uuid[]) to authenticated;
revoke execute on function public.radio_week_ballot() from public, anon;
grant execute on function public.radio_week_ballot() to authenticated;
revoke execute on function public.radio_week_results(date) from public, anon;
grant execute on function public.radio_week_results(date) to authenticated;
revoke execute on function public.radio_ballot_ids(date) from public, anon, authenticated;
