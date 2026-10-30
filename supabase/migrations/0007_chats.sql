-- Chats: one-to-one messages between listeners.
--
-- Off until someone switches it on. A listener with chats off can neither be
-- messaged nor send; switching it on is what profiles.chats_open records.
-- Messages are readable only by the two people in the conversation, and the
-- only change anyone can make after sending is marking what they received as
-- read (mark_chat_read).

alter table public.profiles
  add column if not exists chats_open boolean not null default false;

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  sender      uuid not null references public.profiles (id) on delete cascade,
  recipient   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  constraint not_to_yourself check (sender <> recipient)
);

create index if not exists chat_messages_recipient_idx on public.chat_messages (recipient, created_at desc);
create index if not exists chat_messages_sender_idx on public.chat_messages (sender, created_at desc);

alter table public.chat_messages enable row level security;

drop policy if exists "read your own conversations" on public.chat_messages;
create policy "read your own conversations"
  on public.chat_messages for select
  to authenticated
  using (auth.uid() in (sender, recipient));

-- Both people must have chats switched on.
drop policy if exists "send as yourself to someone with chats on" on public.chat_messages;
create policy "send as yourself to someone with chats on"
  on public.chat_messages for insert
  to authenticated
  with check (
    sender = auth.uid()
    and read_at is null
    and exists (select 1 from public.profiles p where p.id = sender and p.chats_open)
    and exists (select 1 from public.profiles p where p.id = recipient and p.chats_open)
  );

-- Marks everything one person has sent the caller as read.
create or replace function public.mark_chat_read(peer uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_messages
     set read_at = now()
   where recipient = auth.uid() and sender = peer and read_at is null;
$$;

revoke execute on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

-- One row per conversation: the other person, the last message and how many
-- of theirs are unread.
create or replace function public.chat_conversations()
returns table (
  peer uuid,
  handle text,
  display_name text,
  avatar_url text,
  last_body text,
  last_at timestamptz,
  last_from_me boolean,
  unread integer
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select
      case when m.sender = auth.uid() then m.recipient else m.sender end as peer,
      m.body, m.created_at, m.sender = auth.uid() as from_me,
      (m.recipient = auth.uid() and m.read_at is null) as unread
    from public.chat_messages m
    where auth.uid() in (m.sender, m.recipient)
  ),
  latest as (
    select distinct on (peer) peer, body, created_at, from_me
    from mine
    order by peer, created_at desc
  )
  select
    l.peer, p.handle, p.display_name, p.avatar_url,
    l.body, l.created_at, l.from_me,
    (select count(*)::integer from mine u where u.peer = l.peer and u.unread)
  from latest l
  join public.profiles p on p.id = l.peer
  order by l.created_at desc;
$$;

revoke execute on function public.chat_conversations() from public, anon;
grant execute on function public.chat_conversations() to authenticated;

-- New messages arrive live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
