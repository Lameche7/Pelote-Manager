-- Permet de déprogrammer une rencontre de tournoi non jouée malgré un report en attente.
CREATE OR REPLACE FUNCTION public.admin_unprogram_tournament_match(target_match_id uuid, reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- La déprogrammation admin rend la demande de report sans objet.
  -- Supprimer la référence active et conserver la demande historisée.
  update public.tournament_reschedule_requests as req
  set status = 'stale',
      stale_reason = 'Partie déprogrammée par un administrateur',
      updated_at = now()
  where req.id in (
    select a.request_id from public.tournament_reschedule_active_matches a
    where a.match_id = m.id
  ) and req.status = 'pending';

  delete from public.tournament_reschedule_active_matches a
  where a.match_id = m.id
    and exists (
      select 1 from public.tournament_reschedule_requests req
      where req.id = a.request_id and req.status = 'stale'
    );

  if exists(select 1 from public.tournament_reschedule_active_matches a where a.match_id=m.id) then
    raise exception 'Une demande de report non clôturable est encore active.' using errcode='P0001';
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
$function$
;
