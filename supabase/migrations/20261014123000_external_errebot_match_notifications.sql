-- Only verified team participants receive match-day communications; no local resources.
create table if not exists public.external_errebot_reminder_events (
 tournament_id uuid not null references public.external_errebot_tournaments(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 fixture_key text not null,
 communication_id uuid not null references public.club_communications(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(tournament_id,profile_id,fixture_key)
);
alter table public.external_errebot_reminder_events enable row level security;
revoke all on public.external_errebot_reminder_events from public,anon,authenticated;

create or replace function public.publish_external_errebot_match_day_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
 row_t record;
 fixture jsonb;
 match_key text;
 player record;
 comm_id uuid;
 sent integer := 0;
begin
 if (now() at time zone 'Europe/Paris')::time < time '10:00' then return 0; end if;
 for row_t in select t.* from public.external_errebot_tournaments t loop
  for fixture in select value from jsonb_array_elements(row_t.content->'fixtures') loop
   if fixture->>'date' <> (now() at time zone 'Europe/Paris')::date::text then continue; end if;
   match_key := concat_ws('|',fixture->>'date',fixture->>'time',fixture->>'series',
                                      fixture->>'pool',fixture->>'team1ExternalId',fixture->>'team2ExternalId');
   for player in
     select distinct p.id,p.email
     from public.external_errebot_participants ep
     join public.profiles p on p.id=ep.profile_id
     where ep.tournament_id=row_t.id
       and ep.external_team_id in (fixture->>'team1ExternalId',fixture->>'team2ExternalId')
   loop
    if exists (select 1 from public.external_errebot_reminder_events e
       where e.tournament_id=row_t.id and e.profile_id=player.id and e.fixture_key=match_key)
    then continue; end if;
    insert into public.club_communications
      (club_id,title,body,priority,status,show_on_home,published_at,expires_at)
    values(row_t.club_id,
      concat('Votre match aujourd’hui : ',row_t.title),
      concat('Tournoi extérieur · ',row_t.venue_name,' · ',fixture->>'series',
             ' · ',fixture->>'time',' (heure locale).'),
      'important','published',false,now(),
      ((fixture->>'date')::date + interval '1 day') at time zone 'Europe/Paris')
    returning id into comm_id;
    insert into public.external_errebot_reminder_events
      (tournament_id,profile_id,fixture_key,communication_id)
    values(row_t.id,player.id,match_key,comm_id) on conflict do nothing;
    if not found then
      delete from public.club_communications where id=comm_id;
      continue;
    end if;
    insert into public.communication_deliveries
      (communication_id,club_id,profile_id_at_publication,email_snapshot,email_status)
    values(comm_id,row_t.club_id,player.id,player.email,
      case when player.email is null then 'unavailable'::public.communication_email_status
        else 'not_configured'::public.communication_email_status end);
    sent := sent+1;
   end loop;
  end loop;
 end loop;
 return sent;
end $$;
revoke all on function public.publish_external_errebot_match_day_reminders() from public,anon,authenticated;
create extension if not exists pg_cron;
select cron.schedule('pilotoki-external-errebot-match-day','0 * * * *',
 $$select public.publish_external_errebot_match_day_reminders()$$);
