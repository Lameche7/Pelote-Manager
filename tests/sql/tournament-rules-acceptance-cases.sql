-- Ephemeral CI: exercise the shared player registration RPC, not a mock.
begin;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $check$
declare
  t uuid;
  s uuid;
  team uuid;
  actor uuid := auth.uid();
  p jsonb;
  rule_v1 text := E'Règlement initial\nRespect des horaires.';
  rule_v2 text := E'Règlement révisé\nRespect des arbitres.';
begin
  insert into public.tournaments(club_id,season_id,name,status,starts_on,ends_on,registration_opens_at,registration_closes_at,rules)
  values('00000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000002','Rules CI','registrations_open',current_date+2,current_date+8,now()-interval '1 hour',now()+interval '1 day',rule_v1)
  returning id into t;
  insert into public.tournament_series(tournament_id,name,capacity,enabled)
  values(t,'CI series',8,true) returning id into s;
  p:=jsonb_build_object('series_id',s,'submitter_role','front','submitter_first_name','CI','submitter_last_name','Player','submitter_club_name','CI A','contact_email','rules@example.test','contact_phone','0600000001','partner_first_name','CI','partner_last_name','Partner','partner_club_name','CI B','partner_email','partner@example.test','partner_phone','0600000002','availability_rules','[]'::jsonb);
  begin
    perform public.save_my_tournament_registration(t,p);
    raise exception 'Missing acknowledgement was accepted' using errcode='XX000';
  exception when invalid_parameter_value then
    if sqlerrm<>'Tournament rules acceptance required or rules changed' then raise; end if;
  end;
  begin
    perform public.save_my_tournament_registration(t,p||jsonb_build_object('accepted_rules','obsolete'));
    raise exception 'Obsolete rules accepted' using errcode='XX000';
  exception when invalid_parameter_value then
    if sqlerrm<>'Tournament rules acceptance required or rules changed' then raise; end if;
  end;
  team:=public.save_my_tournament_registration(t,p||jsonb_build_object('accepted_rules',rule_v1));
  if not exists(select 1 from pilotoki_private.tournament_rules_acceptances a
    where a.team_id=team and a.tournament_id=t and a.actor_id=actor and a.rules_text=rule_v1 and a.accepted_at is not null) then
    raise exception 'Acceptance evidence not stored';
  end if;
  update public.tournaments set rules=rule_v2 where id=t;
  begin
    perform public.save_my_tournament_registration(t,p||jsonb_build_object('accepted_rules',rule_v1));
    raise exception 'Previous version accepted after rule update' using errcode='XX000';
  exception when invalid_parameter_value then
    if sqlerrm<>'Tournament rules acceptance required or rules changed' then raise; end if;
  end;
  if public.save_my_tournament_registration(t,p||jsonb_build_object('accepted_rules',rule_v2)) is distinct from team then
    raise exception 'Rule update duplicated existing team';
  end if;
  if (select count(distinct rules_text) from pilotoki_private.tournament_rules_acceptances where team_id=team)<>2 then
    raise exception 'Previous rule acceptance evidence lost';
  end if;
  update public.tournaments set rules='' where id=t;
  if public.save_my_tournament_registration(t,p) is distinct from team then
    raise exception 'Blank rules prevented existing team update';
  end if;
  if (select count(*) from pilotoki_private.tournament_rules_acceptances where team_id=team)<>2 then
    raise exception 'Blank rules created false acceptance evidence';
  end if;
  if has_table_privilege('authenticated','pilotoki_private.tournament_rules_acceptances','SELECT')
    or has_table_privilege('authenticated','pilotoki_private.tournament_rules_acceptances','INSERT')
    or has_table_privilege('anon','pilotoki_private.tournament_rules_acceptances','SELECT') then
    raise exception 'Private evidence table exposed';
  end if;
end $check$;
rollback;
