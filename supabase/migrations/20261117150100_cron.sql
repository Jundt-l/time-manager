-- Раз в минуту база будит функцию рассылки, и она отправляет напоминания, время которых пришло.
-- __PROJECT_REF__ подставляет GitHub при выкладке.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'push-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://__PROJECT_REF__.supabase.co/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
