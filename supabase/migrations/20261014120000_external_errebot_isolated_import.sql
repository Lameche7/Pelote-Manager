-- External Errebot tournaments are intentionally not native tournaments: no resource_id,
-- no reservation, no TV schedule and no local reschedule can be generated.
create table if not exists public.external_errebot_tournaments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  source_hash text not null,
  title text not null,
  venue_name text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, source_hash),
  check (length(trim(venue_name)) > 0)
);
create table if not exists public.external_errebot_participants (
  tournament_id uuid not null references public.external_errebot_tournaments(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  external_team_id text not null,
  primary key (tournament_id, profile_id, external_team_id)
);
alter table public.external_errebot_tournaments enable row level security;
alter table public.external_errebot_participants enable row level security;
revoke all on public.external_errebot_tournaments, public.external_errebot_participants from anon, authenticated;
create or replace function public.admin_import_external_errebot(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  owner_club uuid;
  new_id uuid;
  fixtures jsonb := payload->'fixtures';
  teams jsonb := payload->'teams';
  import_hash text := nullif(trim(payload->'file'->>'hash'),'');
  import_title text := nullif(trim(payload->>'name'),'');
  venue text := nullif(trim(payload->>'venueName'),'');
begin
  owner_club := public.admin_current_club_id();
  if actor is null or owner_club is null then
    raise exception 'Club administrator required' using errcode='42501';
  end if;
  if import_hash is null or import_title is null or venue is null or
     jsonb_typeof(fixtures) <> 'array' or jsonb_typeof(teams) <> 'array' or
     jsonb_array_length(fixtures)=0 or jsonb_array_length(teams)=0 then
    raise exception 'Invalid external tournament payload' using errcode='22023';
  end if;
  insert into public.external_errebot_tournaments(club_id,source_hash,title,venue_name,content)
  values(owner_club,import_hash,import_title,venue,payload)
  on conflict (club_id,source_hash) do update
    set content=excluded.content,title=excluded.title,venue_name=excluded.venue_name,updated_at=now()
  returning id into new_id;

  delete from public.external_errebot_participants where tournament_id=new_id;
  insert into public.external_errebot_participants(tournament_id,profile_id,external_team_id)
  select distinct new_id, ident.profile_id, team_data.team->>'externalId'
  from jsonb_array_elements(teams) as team_data(team)
  cross join lateral jsonb_array_elements(team_data.team->'players') as player_data(player)
  join public.tournament_external_player_identities ident
    on public.normalize_member_identity(ident.first_name)=public.normalize_member_identity(player_data.player->>'firstName')
   and public.normalize_member_identity(ident.last_name)=public.normalize_member_identity(player_data.player->>'lastName')
   and regexp_replace(coalesce(ident.phone,''),'[^0-9]','','g')=regexp_replace(coalesce(player_data.player->>'phone',''),'[^0-9]','','g')
  where ident.profile_id is not null and ident.status='verified'
    and length(regexp_replace(coalesce(player_data.player->>'phone',''),'[^0-9]','','g'))>=8
  on conflict do nothing;

  return jsonb_build_object('id',new_id,'imported',true,
      'matchCount',jsonb_array_length(fixtures),
      'participantCount',(select count(*) from public.external_errebot_participants where tournament_id=new_id));
end $$;
revoke all on function public.admin_import_external_errebot(jsonb) from public,anon;
grant execute on function public.admin_import_external_errebot(jsonb) to authenticated;

create or replace function public.list_my_external_errebot_tournaments()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',t.id,'name',t.title,'venueName',t.venue_name,
  'fixtures',t.content->'fixtures','teams',t.content->'teams',
  'pools',t.content->'pools') order by t.created_at desc),'[]'::jsonb)
 from public.external_errebot_tournaments t
 join public.external_errebot_participants ep on ep.tournament_id=t.id
 where ep.profile_id=auth.uid()
$$;
revoke all on function public.list_my_external_errebot_tournaments() from public,anon;
grant execute on function public.list_my_external_errebot_tournaments() to authenticated;
