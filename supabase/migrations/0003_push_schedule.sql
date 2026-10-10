-- Running the push job.
--
-- The job itself is an edge function; this is what wakes it up. Every fifteen
-- minutes is often enough that winners announced on stage reach a phone while
-- people are still watching, and rare enough to stay well inside the free tier
-- (96 runs a day, each a handful of HTTP requests).
--
-- Two settings must exist before this works. Set them once, as the database
-- owner, with the project's own values:
--
--   alter database postgres set app.pulse_functions_url = 'https://<project>.supabase.co/functions/v1';
--   alter database postgres set app.pulse_job_secret    = '<the same PUSH_JOB_SECRET as the function>';

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.run_music_news_push()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base   text := current_setting('app.pulse_functions_url', true);
  secret text := current_setting('app.pulse_job_secret', true);
begin
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

-- Every fifteen minutes, and a tidy-up once a week.
select cron.unschedule('pulse-music-news-push') where exists (
  select 1 from cron.job where jobname = 'pulse-music-news-push'
);
select cron.schedule('pulse-music-news-push', '*/15 * * * *', $$select public.run_music_news_push();$$);

select cron.unschedule('pulse-prune-push-state') where exists (
  select 1 from cron.job where jobname = 'pulse-prune-push-state'
);
select cron.schedule('pulse-prune-push-state', '17 4 * * 0', $$select public.prune_push_state();$$);
