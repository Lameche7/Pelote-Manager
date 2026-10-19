-- Local-time filtering in the edge function selects Mon 21h and Tue 09h/21h.
-- UTC triggers cover summer and winter Paris clock changes.
do $$
declare prior bigint;
begin
  select jobid into prior from cron.job where jobname='pilotoki-championship-finals-discovery';
  if prior is not null then perform cron.unschedule(prior); end if;
  perform cron.schedule('pilotoki-championship-finals-discovery',
    '0 7,8,19,20 * * 1,2',
    $command$
      select net.http_post(
        url := 'https://kuvwagoshhxibhwxknij.supabase.co/functions/v1/championship-official-sync',
        body := '{"force":false,"finalFixtures":true}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || (
            select decrypted_secret from vault.decrypted_secrets
            where name='championship_official_sync_cron_token'
            order by created_at desc limit 1
          )
        ),
        timeout_milliseconds := 10000
      );
    $command$);
end $$;

-- Trigger a full final-fixture check for a single linked championship on admin demand.
create or replace function public.admin_request_final_fixtures_sync(target_championship_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  current_club uuid := public.admin_current_club_id();
  secret_value text;
  request_id bigint;
begin
  if auth.uid() is null or current_club is null
    or not public.championship_club_can_manage(target_championship_id,current_club) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  select decrypted_secret into secret_value
  from vault.decrypted_secrets
  where name='championship_official_sync_cron_token'
  order by created_at desc limit 1;
  if nullif(secret_value,'') is null then
    raise exception 'Official sync credential unavailable' using errcode='P0001';
  end if;
  select net.http_post(
    url := 'https://kuvwagoshhxibhwxknij.supabase.co/functions/v1/championship-official-sync',
    body := jsonb_build_object('force',true,'finalFixtures',true,'championshipId',target_championship_id),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret_value),
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end $$;
revoke all on function public.admin_request_final_fixtures_sync(uuid) from public,anon;
grant execute on function public.admin_request_final_fixtures_sync(uuid) to authenticated;
