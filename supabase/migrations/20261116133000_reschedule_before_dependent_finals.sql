-- A rescheduled final-round match must finish by the day before the earliest
-- scheduled dependent match, as determined by the actual seeded bracket.
-- Preserve the existing competition-wide deadlines as a second upper bound.
begin;

create or replace function public.tournament_match_reschedule_latest_play_date(target_match_id uuid)
returns date
language plpgsql stable security definer set search_path = ''
as $function$
declare
  target_match public.tournament_matches%rowtype;
  general_deadline date;
  dependent_deadline date;
begin
  select m.* into target_match from public.tournament_matches m where m.id = target_match_id;
  if target_match.id is null then return null; end if;

  general_deadline := public.tournament_final_reschedule_last_play_date(
    target_match.tournament_id, target_match.final_round
  );
  if target_match.phase = 'finals' and target_match.final_round_number is not null then
    select min(node.play_date - 1)
    into dependent_deadline
    from public.tournament_final_planning_nodes node
    where node.tournament_id = target_match.tournament_id
      and node.series_id = target_match.series_id
      and node.play_date is not null
      and node.round_number > target_match.final_round_number
      and public.tournament_final_node_depends_on(
        target_match.series_id, node.round_number, node.display_order,
        target_match.final_round_number, target_match.display_order
      );
  end if;

  if general_deadline is null then return dependent_deadline; end if;
  if dependent_deadline is null then return general_deadline; end if;
  return least(general_deadline, dependent_deadline);
end;
$function$;
revoke all on function public.tournament_match_reschedule_latest_play_date(uuid) from public, anon;
grant execute on function public.tournament_match_reschedule_latest_play_date(uuid) to authenticated;

-- Filter free slots and both legs of a swap; the returned policy also gives
-- the player the effective last date (not merely the round-wide date).
do $migration$
declare definition text;
begin
  definition := replace(pg_get_functiondef(
    'public.get_my_tournament_reschedule_options(uuid,uuid)'::regprocedure
  ), chr(13), '');
  if strpos(definition, $needle_option0$latest_play_date := public.tournament_final_reschedule_last_play_date(
    selected_match.tournament_id,selected_match.final_round
  );$needle_option0$) = 0 then
    raise exception 'Missing expected option deadline clause 0';
  end if;
  definition := replace(definition, $needle_option0$latest_play_date := public.tournament_final_reschedule_last_play_date(
    selected_match.tournament_id,selected_match.final_round
  );$needle_option0$, $replacement_option0$latest_play_date := public.tournament_match_reschedule_latest_play_date(target_match_id);$replacement_option0$);
  if strpos(definition, $needle_option1$public.tournament_final_reschedule_last_play_date(
        selected_match.tournament_id,
        (select swapped.final_round
         from public.tournament_matches swapped
         where swapped.id=nullif(item.value->>'swap_match_id','')::uuid
           and swapped.tournament_id=selected_match.tournament_id)
      )$needle_option1$) = 0 then
    raise exception 'Missing expected option deadline clause 1';
  end if;
  definition := replace(definition, $needle_option1$public.tournament_final_reschedule_last_play_date(
        selected_match.tournament_id,
        (select swapped.final_round
         from public.tournament_matches swapped
         where swapped.id=nullif(item.value->>'swap_match_id','')::uuid
           and swapped.tournament_id=selected_match.tournament_id)
      )$needle_option1$, $replacement_option1$public.tournament_match_reschedule_latest_play_date(nullif(item.value->>'swap_match_id','')::uuid)$replacement_option1$);
  if strpos(definition, $needle_option2$public.tournament_final_reschedule_last_play_date(
        selected_match.tournament_id,
        (select swapped.final_round from public.tournament_matches swapped
         where swapped.id=nullif(item.value->>'swap_match_id','')::uuid
           and swapped.tournament_id=selected_match.tournament_id)
      )$needle_option2$) = 0 then
    raise exception 'Missing expected option deadline clause 2';
  end if;
  definition := replace(definition, $needle_option2$public.tournament_final_reschedule_last_play_date(
        selected_match.tournament_id,
        (select swapped.final_round from public.tournament_matches swapped
         where swapped.id=nullif(item.value->>'swap_match_id','')::uuid
           and swapped.tournament_id=selected_match.tournament_id)
      )$needle_option2$, $replacement_option2$public.tournament_match_reschedule_latest_play_date(nullif(item.value->>'swap_match_id','')::uuid)$replacement_option2$);
  if strpos(definition, 'public.tournament_final_reschedule_last_play_date(') <> 0 then
    raise exception 'An old option deadline call still remains';
  end if;
  execute definition;

  -- An already approved request is not exempt: recheck the current bracket
  -- date at application, including the swapped match's destination.
  definition := replace(pg_get_functiondef(
    'public.admin_apply_tournament_reschedule_request(uuid)'::regprocedure
  ), chr(13), '');
  if strpos(definition, $needle_apply0$public.tournament_final_reschedule_last_play_date(
      request.tournament_id,target_match.final_round
    )$needle_apply0$) = 0 then
    raise exception 'Missing expected apply deadline clause 0';
  end if;
  definition := replace(definition, $needle_apply0$public.tournament_final_reschedule_last_play_date(
      request.tournament_id,target_match.final_round
    )$needle_apply0$, $replacement_apply0$public.tournament_match_reschedule_latest_play_date(target_match.id)$replacement_apply0$);
  if strpos(definition, $needle_apply1$public.tournament_final_reschedule_last_play_date(
        request.tournament_id,target_match.final_round
      )$needle_apply1$) = 0 then
    raise exception 'Missing expected apply deadline clause 1';
  end if;
  definition := replace(definition, $needle_apply1$public.tournament_final_reschedule_last_play_date(
        request.tournament_id,target_match.final_round
      )$needle_apply1$, $replacement_apply1$public.tournament_match_reschedule_latest_play_date(target_match.id)$replacement_apply1$);
  if strpos(definition, $needle_apply2$public.tournament_final_reschedule_last_play_date(
      request.tournament_id,swap_match.final_round
    )$needle_apply2$) = 0 then
    raise exception 'Missing expected apply deadline clause 2';
  end if;
  definition := replace(definition, $needle_apply2$public.tournament_final_reschedule_last_play_date(
      request.tournament_id,swap_match.final_round
    )$needle_apply2$, $replacement_apply2$public.tournament_match_reschedule_latest_play_date(swap_match.id)$replacement_apply2$);
  if strpos(definition, $needle_apply3$public.tournament_final_reschedule_last_play_date(
        request.tournament_id,swap_match.final_round
      )$needle_apply3$) = 0 then
    raise exception 'Missing expected apply deadline clause 3';
  end if;
  definition := replace(definition, $needle_apply3$public.tournament_final_reschedule_last_play_date(
        request.tournament_id,swap_match.final_round
      )$needle_apply3$, $replacement_apply3$public.tournament_match_reschedule_latest_play_date(swap_match.id)$replacement_apply3$);
  if strpos(definition, 'public.tournament_final_reschedule_last_play_date(') <> 0 then
    raise exception 'An old apply deadline call still remains';
  end if;
  execute definition;
end;
$migration$;

-- Keep the audit history but close proposals made before the new rule which
-- would cause a participant to play after (or on) its next round.
do $close_invalid_requests$
declare invalid_request record;
begin
  for invalid_request in
    select req.id
    from public.tournament_reschedule_requests req
    where req.status in ('pending', 'approved')
      and (
        (public.tournament_match_reschedule_latest_play_date(req.match_id) is not null
          and req.target_play_date > public.tournament_match_reschedule_latest_play_date(req.match_id))
        or (req.proposal_kind = 'swap'
          and public.tournament_match_reschedule_latest_play_date(req.swap_match_id) is not null
          and req.swap_return_play_date > public.tournament_match_reschedule_latest_play_date(req.swap_match_id))
      )
  loop
    perform public.mark_tournament_reschedule_stale(
      invalid_request.id, 'next_round_precedes_proposed_reschedule'
    );
  end loop;
end;
$close_invalid_requests$;
commit;
