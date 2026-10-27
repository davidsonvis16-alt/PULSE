-- Pulse Radio: freestyles.
--
-- Anyone signed in can upload a freestyle of their own, and everyone tuned in
-- hears the same one at the same moment. The station is not a server process:
-- the rotation is the list of freestyles in upload order, and every phone works
-- out where in it "now" falls from a clock they all share (`radio_clock`).
--
-- The audio lives in a public Storage bucket — it is broadcast, after all —
-- but each person can only write and delete inside their own folder.
-- Listeners can report a freestyle; three reports take it off the air until
-- someone looks at it.

-- --------------------------------------------------------------- freestyles

create table if not exists public.freestyles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 80),
  -- "<user id>/<file>" inside the freestyles bucket.
  storage_path  text not null unique,
  duration_ms   integer not null check (duration_ms between 5000 and 600000),
  hidden        boolean not null default false,
  report_count  integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint path_is_owners check (split_part(storage_path, '/', 1) = user_id::text)
);

create index if not exists freestyles_rotation_idx on public.freestyles (created_at, id) where not hidden;
create index if not exists freestyles_user_idx on public.freestyles (user_id, created_at desc);

alter table public.freestyles enable row level security;

drop policy if exists "hear what is on air" on public.freestyles;
create policy "hear what is on air"
  on public.freestyles for select
  to authenticated
  using (not hidden or user_id = auth.uid());

drop policy if exists "upload your own freestyles" on public.freestyles;
create policy "upload your own freestyles"
  on public.freestyles for insert
  to authenticated
  with check (user_id = auth.uid() and not hidden and report_count = 0);

drop policy if exists "take down your own freestyles" on public.freestyles;
create policy "take down your own freestyles"
  on public.freestyles for delete
  to authenticated
  using (user_id = auth.uid());

-- No update policy: a freestyle is fixed once it is on air. Reports change it
-- through the trigger below, which runs with the owner's rights.

-- Ten a day each, so one person cannot take over the station.
create or replace function public.freestyle_upload_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*) from public.freestyles
    where user_id = new.user_id and created_at > now() - interval '1 day'
  ) >= 10 then
    raise exception 'You can put up to 10 freestyles on the radio a day.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists freestyle_upload_limit on public.freestyles;
create trigger freestyle_upload_limit
  before insert on public.freestyles
  for each row execute function public.freestyle_upload_limit();

-- ------------------------------------------------------------------ reports

create table if not exists public.freestyle_reports (
  freestyle_id uuid not null references public.freestyles (id) on delete cascade,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  reason       text check (reason is null or char_length(reason) <= 200),
  created_at   timestamptz not null default now(),
  primary key (freestyle_id, reporter_id)
);

alter table public.freestyle_reports enable row level security;

drop policy if exists "report as yourself" on public.freestyle_reports;
create policy "report as yourself"
  on public.freestyle_reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "see your own reports" on public.freestyle_reports;
create policy "see your own reports"
  on public.freestyle_reports for select
  to authenticated
  using (reporter_id = auth.uid());

create or replace function public.count_freestyle_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.freestyles
     set report_count = report_count + 1,
         hidden = hidden or report_count + 1 >= 3
   where id = new.freestyle_id;
  return new;
end;
$$;

drop trigger if exists count_freestyle_report on public.freestyle_reports;
create trigger count_freestyle_report
  after insert on public.freestyle_reports
  for each row execute function public.count_freestyle_report();

-- -------------------------------------------------------------- the station

-- What is in rotation, oldest first, with who made each one. Security invoker
-- keeps the policies above in charge.
create or replace view public.radio_rotation
with (security_invoker = true)
as
select
  f.id,
  f.user_id,
  f.title,
  f.storage_path,
  f.duration_ms,
  f.created_at,
  p.display_name,
  p.handle,
  p.avatar_url
from public.freestyles f
join public.profiles p on p.id = f.user_id
where not f.hidden;

-- One clock for every listener, so phones with a slow or fast clock still hear
-- the same second of the same freestyle.
create or replace function public.radio_clock()
returns bigint
language sql
stable
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

grant execute on function public.radio_clock() to authenticated;

-- ------------------------------------------------------------------ storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'freestyles',
  'freestyles',
  true,
  26214400, -- 25 MB
  array['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/mp3',
        'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload freestyles to your own folder" on storage.objects;
create policy "upload freestyles to your own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'freestyles'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "delete freestyles from your own folder" on storage.objects;
create policy "delete freestyles from your own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'freestyles'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
