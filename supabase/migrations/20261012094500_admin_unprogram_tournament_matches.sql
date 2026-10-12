begin;

-- File d'attente des rencontres temporairement déprogrammées.
create table public.tournament_unprogrammed_matches (
  match_id uuid primary key references public.tournament_matches(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  previous_resource_id uuid not null references public.reservable_resources(id),
  previous_play_date date not null,
  previous_starts_at time not null,
  previous_ends_at time not null,
  reason text not null,
  unprogrammed_by uuid references auth.users(id),
  unprogrammed_at timestamptz not null default now()
);
create index tournament_unprogrammed_matches_tournament_idx
on public.tournament_unprogrammed_matches(tournament_id, unprogrammed_at);
alter table public.tournament_unprogrammed_matches enable row level security;
revoke all on public.tournament_unprogrammed_matches from public, anon, authenticated;

create function public.admin_unprogram_tournament_match(target_match_id uuid, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.tournament_matches%rowtype;
  t public.tournaments%rowtype;
  p public.tournament_match_planning%rowtype;
  target_event uuid;
  cleaned_reason text := nullif(btrim(reason), '');
begin
  if cleaned_reason is null or char_length(cleaned_reason) > 500 then
    raise exception 'Indiquez un motif (500 caractères maximum).' using errcode='22023';
  end if;
  select * into m from public.tournament_matches where id=target_match_id for update;
  if m.id is null then raise exception 'Partie introuvable.' using errcode='P0002'; end if;
  select * into t from public.tournaments where id=m.tournament_id;
  if t.club_id is distinct from public.admin_current_club_id()
     or not public.has_club_permission(t.club_id,'tournaments.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if t.status not in ('planning_published','in_progress') then
    raise exception 'Tournoi non ouvert aux reports.' using errcode='P0001';
  end if;
  if exists(select 1 from public.tournament_match_results r where r.match_id=m.id) then
    raise exception 'Une partie avec un résultat saisi ne peut pas être déprogrammée.' using errcode='P0001';
  end if;
  if exists(select 1 from public.tournament_reschedule_active_matches a where a.match_id=m.id) then
    raise exception 'Une demande de report est déjà active.' using errcode='P0001';
  end if;
  if exists(select 1 from public.tournament_unprogrammed_matches q where q.match_id=m.id) then
    raise exception 'Cette partie est déjà à programmer.' using errcode='P0001';
  end if;
  select * into p from public.tournament_match_planning where match_id=m.id for update;
  if p.match_id is null then raise exception 'Partie déjà sans créneau.' using errcode='P0001'; end if;
  select link.event_id into target_event
  from public.tournament_match_events link
  where link.match_id=m.id;
  if target_event is null then raise exception 'Événement du tournoi introuvable.' using errcode='P0002'; end if;

  insert into public.tournament_unprogrammed_matches(
    match_id,tournament_id,previous_resource_id,previous_play_date,
    previous_starts_at,previous_ends_at,reason,unprogrammed_by
  ) values(m.id,m.tournament_id,p.resource_id,p.play_date,p.starts_at,p.ends_at,cleaned_reason,auth.uid());

  perform set_config('app.allow_tournament_event_sync','on',true);
  update public.events
  set publication_status='draft', updated_by=auth.uid(), updated_at=now()
  where id=target_event;
  delete from public.calendar_occupations o using public.event_resources er
  where er.event_id=target_event and er.calendar_occupation_id=o.id;
  delete from public.event_resources where event_id=target_event;
  delete from public.tournament_match_planning where match_id=m.id;

  if m.final_round_number is not null then
    update public.tournament_final_planning_nodes
    set resource_id=null,play_date=null,starts_at=null,ends_at=null,
        source='manual',updated_at=now()
    where tournament_id=m.tournament_id and series_id=m.series_id
      and round_number=m.final_round_number and display_order=m.display_order;
  end if;
  insert into public.tournament_audit_log(tournament_id,action,payload,created_by)
  values(m.tournament_id,'match_unprogrammed',
    jsonb_build_object('match_id',m.id,'reason',cleaned_reason,
      'previous_date',p.play_date,'previous_start',p.starts_at,
      'previous_end',p.ends_at,'previous_resource_id',p.resource_id),auth.uid());
end;
$$;

create function public.admin_list_unprogrammed_tournament_matches()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'match_id',q.match_id,'tournament_id',q.tournament_id,
    'tournament_name',t.name,'phase',m.phase,
    'series_name',s.name,
    'team_a',public.tournament_team_public_label(m.team_a_id),
    'team_b',public.tournament_team_public_label(m.team_b_id),
    'previous_date',q.previous_play_date,
    'previous_start',q.previous_starts_at,
    'previous_end',q.previous_ends_at,
    'reason',q.reason,'unprogrammed_at',q.unprogrammed_at,
    'resources',coalesce((
      select jsonb_agg(jsonb_build_object('id',rr.id,'name',rr.name) order by rr.name)
      from public.tournament_resources tr
      join public.reservable_resources rr on rr.id=tr.resource_id
      where tr.tournament_id=t.id and rr.is_active
    ),'[]'::jsonb)
  ) order by q.unprogrammed_at desc), '[]'::jsonb)
  from public.tournament_unprogrammed_matches q
  join public.tournaments t on t.id=q.tournament_id
  join public.tournament_matches m on m.id=q.match_id
  join public.tournament_series s on s.id=m.series_id
  where t.club_id=public.admin_current_club_id()
    and public.has_club_permission(t.club_id,'tournaments.manage');
$$;

create function public.admin_reprogram_tournament_match(
  target_match_id uuid,target_resource_id uuid,target_play_date date,
  target_starts_at time,target_ends_at time
) returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.tournament_matches%rowtype;
  t public.tournaments%rowtype;
  q public.tournament_unprogrammed_matches%rowtype;
  resource public.reservable_resources%rowtype;
  target_event uuid;
  absolute_start timestamptz;
  absolute_end timestamptz;
begin
  select * into m from public.tournament_matches where id=target_match_id for update;
  if m.id is null then raise exception 'Partie introuvable.' using errcode='P0002'; end if;
  select * into t from public.tournaments where id=m.tournament_id;
  if t.club_id is distinct from public.admin_current_club_id()
     or not public.has_club_permission(t.club_id,'tournaments.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if t.status not in ('planning_published','in_progress') then
    raise exception 'Tournoi non ouvert aux reports.' using errcode='P0001';
  end if;
  select * into q from public.tournament_unprogrammed_matches where match_id=m.id for update;
  if q.match_id is null then raise exception 'Cette partie ne figure pas parmi les parties à programmer.' using errcode='P0001'; end if;
  if exists(select 1 from public.tournament_match_results r where r.match_id=m.id) then
    raise exception 'Cette partie possède un résultat.' using errcode='P0001';
  end if;
  if exists(select 1 from public.tournament_reschedule_active_matches a where a.match_id=m.id) then
    raise exception 'Une demande de report est active.' using errcode='P0001';
  end if;
  if exists(select 1 from public.tournament_match_planning p where p.match_id=m.id) then
    raise exception 'Cette partie est déjà programmée.' using errcode='P0001';
  end if;
  select r.* into resource from public.reservable_resources r
  join public.tournament_resources tr on tr.resource_id=r.id
  where tr.tournament_id=m.tournament_id and r.id=target_resource_id and r.is_active;
  if resource.id is null then raise exception 'Terrain non autorisé.' using errcode='22023'; end if;
  if target_ends_at<=target_starts_at then raise exception 'Horaires invalides.' using errcode='22023'; end if;
  absolute_start:=public.tournament_planning_starts_at(target_play_date,target_starts_at,resource.timezone);
  absolute_end:=public.tournament_planning_starts_at(target_play_date,target_ends_at,resource.timezone);
  if absolute_start<=now() then raise exception 'Le nouveau créneau doit être futur.' using errcode='22023'; end if;
  if exists(select 1 from public.calendar_occupations o
    where o.resource_id=resource.id and o.cancelled_at is null
      and o.starts_at<absolute_end and o.ends_at>absolute_start) then
    raise exception 'Créneau déjà occupé dans le calendrier.' using errcode='P0001';
  end if;
  if exists(select 1 from public.tournament_match_planning p
    where p.resource_id=resource.id and p.play_date=target_play_date
      and p.starts_at<target_ends_at and p.ends_at>target_starts_at) then
    raise exception 'Créneau occupé par une partie du tournoi.' using errcode='P0001';
  end if;
  if exists(select 1 from public.tournament_match_planning p
    join public.tournament_matches other on other.id=p.match_id
    where other.id<>m.id and p.play_date=target_play_date
      and p.starts_at<target_ends_at and p.ends_at>target_starts_at
      and (m.team_a_id in (other.team_a_id,other.team_b_id)
        or m.team_b_id in (other.team_a_id,other.team_b_id))) then
    raise exception 'Une équipe joue déjà sur ce créneau.' using errcode='P0001';
  end if;
  select event_id into target_event from public.tournament_match_events where match_id=m.id;
  if target_event is null then raise exception 'Événement du tournoi introuvable.' using errcode='P0002'; end if;

  insert into public.tournament_match_planning(
    match_id,tournament_id,resource_id,play_date,starts_at,ends_at,source
  ) values(m.id,m.tournament_id,resource.id,target_play_date,target_starts_at,target_ends_at,'manual');
  perform set_config('app.allow_tournament_event_sync','on',true);
  update public.events
  set starts_at=absolute_start,ends_at=absolute_end,publication_status='published',
      archived_at=null,updated_by=auth.uid(),updated_at=now()
  where id=target_event;
  insert into public.event_resources(event_id,resource_id) values(target_event,resource.id);
  perform public.sync_event_occupations(target_event);
  if m.final_round_number is not null then
    update public.tournament_final_planning_nodes
    set resource_id=resource.id,play_date=target_play_date,
        starts_at=target_starts_at,ends_at=target_ends_at,source='manual',updated_at=now()
    where tournament_id=m.tournament_id and series_id=m.series_id
      and round_number=m.final_round_number and display_order=m.display_order;
  end if;
  delete from public.tournament_unprogrammed_matches where match_id=m.id;
  insert into public.tournament_audit_log(tournament_id,action,payload,created_by)
  values(m.tournament_id,'match_reprogrammed',
    jsonb_build_object('match_id',m.id,'resource_id',resource.id,
      'play_date',target_play_date,'starts_at',target_starts_at,'ends_at',target_ends_at),auth.uid());
end;
$$;

revoke all on function public.admin_unprogram_tournament_match(uuid,text),
  public.admin_list_unprogrammed_tournament_matches(),
  public.admin_reprogram_tournament_match(uuid,uuid,date,time,time)
from public,anon,authenticated;
grant execute on function public.admin_unprogram_tournament_match(uuid,text),
  public.admin_list_unprogrammed_tournament_matches(),
  public.admin_reprogram_tournament_match(uuid,uuid,date,time,time)
to authenticated;

commit;
