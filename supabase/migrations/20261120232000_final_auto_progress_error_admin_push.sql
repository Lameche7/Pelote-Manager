-- Send a club-scoped admin notification whenever an automatic knockout
-- progression fails. The score/result remains validated and the original
-- diagnostic stays in the protected error table for the admin banner.
begin;

create table if not exists public.tournament_final_engine_error_notifications (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  first_seen_at timestamptz not null,
  communication_id uuid references public.club_communications(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, match_id)
);
alter table public.tournament_final_engine_error_notifications enable row level security;
revoke all on public.tournament_final_engine_error_notifications from public,anon,authenticated;

create or replace function public.notify_tournament_final_engine_error(
  target_tournament_id uuid, target_match_id uuid
)
returns void
language plpgsql security definer set search_path=''
as $function$
declare
  target record;
  message_id uuid;
  notified_match_id uuid;
  recipient_count integer;
begin
  select error.first_seen_at, tournament.club_id,
    tournament.name as tournament_name, series.name as series_name,
    match.team_a_id, match.team_b_id
  into target
  from public.tournament_final_auto_progress_errors error
  join public.tournaments tournament
    on tournament.id=error.tournament_id
  join public.tournament_series series
    on series.id=error.series_id
  join public.tournament_matches match
    on match.id=error.match_id
  where error.tournament_id=target_tournament_id
    and error.match_id=target_match_id
    and match.phase='finals';
  if not found then return; end if;

  -- One alert per incident, not per repeated retry. A later incident for
  -- the same match gets a new first_seen_at and therefore a new alert.
  insert into public.tournament_final_engine_error_notifications
    (tournament_id,match_id,first_seen_at)
  values (target_tournament_id,target_match_id,target.first_seen_at)
  on conflict (tournament_id,match_id) do update
    set first_seen_at=excluded.first_seen_at,
        communication_id=null,
        created_at=now()
    where public.tournament_final_engine_error_notifications.first_seen_at
      is distinct from excluded.first_seen_at
  returning match_id into notified_match_id;
  if notified_match_id is null then return; end if;

  insert into public.club_communications(
    club_id,title,body,priority,status,show_on_home,expires_at,
    created_by,updated_by
  ) values (
    target.club_id,
    'Erreur de programmation automatique : ' || target.series_name,
    concat(
      target.tournament_name,' · ',
      public.tournament_team_public_label(target.team_a_id),' contre ',
      public.tournament_team_public_label(target.team_b_id),
      '. Le résultat est bien enregistré, mais le passage automatique ',
      'au tour suivant a rencontré une erreur technique. ',
      'Ouvrez Administration > Tournois > Qualifications pour ',
      'contrôler la phase finale et relancer la programmation.'
    ),
    'important','draft',false,now()+interval '20 days',null,null
  ) returning id into message_id;

  with recipients as (
    select distinct membership.profile_id,
      member.id as club_member_id,
      coalesce(nullif(btrim(member.email),''),
               nullif(btrim(profile.email),'')) as email_snapshot
    from public.club_memberships membership
    join public.club_role_permissions permission
      on permission.role_id=membership.role_id
      and permission.permission_key='tournaments.manage'
    join public.profiles profile
      on profile.id=membership.profile_id
    left join public.club_members member
      on member.id=profile.member_id
      and member.club_id=target.club_id and member.is_active
    where membership.club_id=target.club_id
  )
  insert into public.communication_deliveries(
    communication_id,club_id,club_member_id,
    profile_id_at_publication,email_snapshot,email_status
  )
  select message_id,target.club_id,club_member_id,profile_id,email_snapshot,
    case when email_snapshot is null
      then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status end
  from recipients
  on conflict do nothing;
  get diagnostics recipient_count=row_count;
  if recipient_count=0 then
    -- Keep the underlying error for the permission-scoped banner.
    delete from public.tournament_final_engine_error_notifications
    where tournament_id=target_tournament_id
      and match_id=target_match_id;
    delete from public.club_communications where id=message_id;
    return;
  end if;

  update public.tournament_final_engine_error_notifications
  set communication_id=message_id
  where tournament_id=target_tournament_id and match_id=target_match_id;
  update public.club_communications
  set status='published',published_at=now(),updated_at=now()
  where id=message_id;
end;
$function$;
revoke all on function public.notify_tournament_final_engine_error(uuid,uuid)
  from public,anon,authenticated;

create or replace function public.after_validated_tournament_final_result_auto_progress()
returns trigger
language plpgsql security definer set search_path=''
as $function$
declare selected_series uuid;
begin
  if new.status<>'validated' then return new; end if;
  if tg_op='UPDATE' then
    if old.status='validated' then return new; end if;
  end if;
  select m.series_id into selected_series
  from public.tournament_matches m where m.id=new.match_id
    and m.phase='finals';
  if selected_series is null then return new; end if;
  begin
    perform public.auto_progress_independent_tournament_final_branches(
      new.tournament_id,selected_series);
    delete from public.tournament_final_auto_progress_errors e
    where e.tournament_id=new.tournament_id and e.series_id=selected_series;
  exception when others then
    insert into public.tournament_final_auto_progress_errors
      (tournament_id,series_id,match_id,diagnostic)
    values (new.tournament_id,selected_series,new.match_id,left(sqlerrm,500))
    on conflict (tournament_id,match_id)
    do update set
      last_seen_at=now(),
      occurrences=public.tournament_final_auto_progress_errors.occurrences+1,
      diagnostic=excluded.diagnostic;
    -- Notification failures must NEVER undo validated results.
    begin
      perform public.notify_tournament_final_engine_error(
        new.tournament_id,new.match_id);
    exception when others then
      raise warning 'Unable to notify admins of knockout engine failure for match %: %',
        new.match_id,sqlerrm;
    end;
    raise warning 'Automatic tournament-final progress failed for match %; admin alert recorded if available',
      new.match_id;
  end;
  return new;
end;
$function$;
revoke all on function public.after_validated_tournament_final_result_auto_progress()
from public,anon,authenticated;

commit;
