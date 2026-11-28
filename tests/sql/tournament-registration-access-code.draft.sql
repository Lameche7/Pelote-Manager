-- Draft: tournament-specific priority registration, disabled by default.
create table if not exists pilotoki_private.tournament_registration_access (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  code_hash text not null,
  opens_public_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table pilotoki_private.tournament_registration_access enable row level security;
revoke all on pilotoki_private.tournament_registration_access from public, anon, authenticated;

create or replace function public.admin_set_tournament_registration_access(
  target_tournament_id uuid, access_mode text, access_code text, public_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  target_club uuid;
begin
  select club_id into target_club from public.tournaments where id=target_tournament_id for update;
  if auth.uid() is null or target_club is null or not coalesce(
    public.can_administer_club(target_club,'tournaments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  if access_mode='free' then
    delete from pilotoki_private.tournament_registration_access where tournament_id=target_tournament_id;
    return;
  end if;
  if access_mode is null or access_mode not in ('locked','temporary')
    or (access_mode='temporary' and (public_at is null or public_at<=now()))
  then raise exception 'Invalid access mode or opening date' using errcode='22023'; end if;
  if access_code is not null and (char_length(btrim(access_code))<8 or octet_length(btrim(access_code))>72)
  then raise exception 'Access code must contain at least 8 characters and at most 72 bytes' using errcode='22023'; end if;
  if access_code is null then
    update pilotoki_private.tournament_registration_access set
      opens_public_at=case when access_mode='temporary' then public_at else null end,updated_at=now()
      where tournament_id=target_tournament_id;
    if not found then raise exception 'Access code required' using errcode='22023'; end if;
  else
    insert into pilotoki_private.tournament_registration_access(tournament_id,code_hash,opens_public_at)
    values(target_tournament_id,extensions.crypt(btrim(access_code),extensions.gen_salt('bf',10)),
      case when access_mode='temporary' then public_at else null end)
    on conflict(tournament_id) do update set code_hash=excluded.code_hash,
      opens_public_at=excluded.opens_public_at,updated_at=now();
  end if;
end; $$;
revoke all on function public.admin_set_tournament_registration_access(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.admin_set_tournament_registration_access(uuid,text,text,timestamptz) to authenticated;

create or replace function public.get_tournament_registration_access(target_tournament_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code_required', coalesce(a.tournament_id is not null and (a.opens_public_at is null or a.opens_public_at>now()),false),
    'opens_public_at', a.opens_public_at
  )
  from public.tournaments t left join pilotoki_private.tournament_registration_access a on a.tournament_id=t.id
  where t.id=target_tournament_id;
$$;
revoke all on function public.get_tournament_registration_access(uuid) from public,anon;
grant execute on function public.get_tournament_registration_access(uuid) to authenticated;
