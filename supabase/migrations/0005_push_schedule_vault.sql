-- Reading the push job's settings from Vault.
--
-- 0003 read the functions address and the job secret from database settings
-- (`alter database postgres set app.…`). Hosted Supabase no longer lets the
-- project's own role set those, so the job now reads both from Vault, the
-- project's encrypted secret store. The old settings are still honoured when
-- present, so a project set up the old way keeps working.
--
-- Store the two values once, in the SQL editor, with the project's own values:
--
--   select vault.create_secret('https://<project>.supabase.co/functions/v1', 'pulse_functions_url');
--   select vault.create_secret('<the same PUSH_JOB_SECRET as the function>', 'pulse_job_secret');
--
-- To change one later: select vault.update_secret(id, '<new value>') using the
-- id from `select id, name from vault.secrets;`.

create extension if not exists supabase_vault;

create or replace function public.run_music_news_push()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base   text;
  secret text;
begin
  select decrypted_secret into base
    from vault.decrypted_secrets where name = 'pulse_functions_url' limit 1;
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'pulse_job_secret' limit 1;

  base   := coalesce(base, current_setting('app.pulse_functions_url', true));
  secret := coalesce(secret, current_setting('app.pulse_job_secret', true));

  if base is null or secret is null then
    raise notice 'music news push is not configured; skipping';
    return;
  end if;

  perform net.http_post(
    url     := base || '/music-news-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pulse-job-secret', secret
    ),
    body    := '{}'::jsonb
  );
end;
$$;

-- Only the scheduler, running as the owner, should call this.
revoke execute on function public.run_music_news_push() from public, anon, authenticated;
