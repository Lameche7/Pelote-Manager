-- One club-scoped push/in-app communication per newly identified fixture/outcome.
-- Uses the existing communications -> push dispatch pipeline.
begin;

create table if not exists public.tournament_final_admin_auto_outcomes (
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  outcome text not null check(outcome in ('scheduled','blocked')),
  communication_id uuid references public.club_communications(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(match_id,outcome)
);
alter table public.tournament_final_admin_auto_outcomes enable row level security;
revoke all on public.tournament_final_admin_auto_outcomes from public,anon,authenticated;

create or replace function public.notify_tournament_final_admin_auto_outcome(
  target_match_id uuid
)
returns void language plpgsql security definer set search_path=''
as $function$
declare
  target record;
  final_state text;
  message_id uuid;
  recipient_count integer;
begin
  select m.*,t.club_id,t.name tournament_name,s.name series_name,
    p.play_date,p.starts_at,r.name resource_name,
    e.match_id is not null as published
  into target
  from public.tournament_matches m
  join public.tournaments t on t.id=m.tournament_id
  join public.tournament_series s on s.id=m.series_id
  left join public.tournament_match_planning p on p.match_id=m.id
  left join public.reservable_resources r on r.id=p.resource_id
  left join public.tournament_match_events e on e.match_id=m.id
  where m.id=target_match_id and m.phase='finals'
    and m.team_a_id is not null and m.team_b_id is not null;
  if not found then return; end if;
  final_state:=case when target.published then 'scheduled' else 'blocked' end;

  if exists(select 1 from public.tournament_final_admin_auto_outcomes o
    where o.match_id=target_match_id and o.outcome=final_state) then return; end if;

  insert into public.tournament_final_admin_auto_outcomes(match_id,outcome)
  values(target_match_id,final_state) on conflict do nothing;
  if not found then return; end if;

  -- An admin must receive the message even if the players have already
  -- received their own (separate) match publication notification.
  insert into public.club_communications(
    club_id,title,body,priority,status,show_on_home,expires_at,created_by,updated_by
  ) values(
    target.club_id,
    case when final_state='scheduled'
      then 'Phase finale programmée : ' else 'Phase finale à programmer : ' end
      ||target.series_name,
    concat(
      target.tournament_name,' · ',
      public.tournament_team_public_label(target.team_a_id),' contre ',
      public.tournament_team_public_label(target.team_b_id),
      case when final_state='scheduled'
        then concat(' : partie automatiquement programmée le ',
          to_char(target.play_date,'DD/MM/YYYY'),' à ',
          to_char(target.starts_at,'HH24:MI'),' sur ',target.resource_name,'.')
        else ' : aucun créneau compatible confirmé. Intervention administrateur requise.'
      end
    ),
    'important','draft',false,now()+interval '20 days',null,null
  ) returning id into message_id;

  with recipients as (
    select distinct membership.profile_id,
      member.id club_member_id,
      coalesce(nullif(btrim(member.email),''),nullif(btrim(profile.email),'')) email_snapshot
    from public.club_memberships membership
    join public.club_role_permissions permission
      on permission.role_id=membership.role_id
      and permission.permission_key='tournaments.manage'
    join public.profiles profile on profile.id=membership.profile_id
    left join public.club_members member
      on member.id=profile.member_id and member.club_id=target.club_id
      and member.is_active
    where membership.club_id=target.club_id
  )
  insert into public.communication_deliveries(
    communication_id,club_id,club_member_id,
    profile_id_at_publication,email_snapshot,email_status
  )
  select message_id,target.club_id,club_member_id,profile_id,email_snapshot,
    case when email_snapshot is null then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status end
  from recipients
  on conflict do nothing;
  get diagnostics recipient_count=row_count;
  if recipient_count=0 then
    delete from public.tournament_final_admin_auto_outcomes
      where match_id=target_match_id and outcome=final_state;
    delete from public.club_communications where id=message_id;
    return;
  end if;

  update public.tournament_final_admin_auto_outcomes
  set communication_id=message_id
  where match_id=target_match_id and outcome=final_state;
  update public.club_communications
  set status='published',published_at=now(),updated_at=now()
  where id=message_id;
end;
$function$;
revoke all on function public.notify_tournament_final_admin_auto_outcome(uuid)
from public,anon,authenticated;

commit;