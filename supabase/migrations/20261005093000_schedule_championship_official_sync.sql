do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'pilotoki-championship-official-sync'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'pilotoki-championship-official-sync',
    '0 21,22 * * 0,1,4,5,6',
    $command$
      select net.http_post(
        url := 'https://kuvwagoshhxibhwxknij.supabase.co/functions/v1/championship-official-sync',
        body := '{"force":false}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'championship_official_sync_cron_token'
            order by created_at desc
            limit 1
          )
        ),
        timeout_milliseconds := 10000
      );
    $command$
  );
end
$$;
