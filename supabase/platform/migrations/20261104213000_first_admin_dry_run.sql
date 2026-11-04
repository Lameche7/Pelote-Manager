-- Base CENTRALE de Pelote Manager uniquement
-- Store a strictly non-operational first-admin rehearsal for fake clubs.
-- Never creates Auth identities, club memberships, billing or infrastructure.
begin;

create table if not exists public.platform_first_admin_dry_runs (
  club_id uuid primary key references public.platform_clubs(id) on delete cascade,
  candidate_email text not null,
  prepared_by uuid not null references auth.users(id) on delete restrict,
  prepared_at timestamptz not null default now(),
  constraint platform_first_admin_dry_runs_test_email
    check (candidate_email ~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.invalid$')
);

alter table public.platform_first_admin_dry_runs enable row level security;
revoke all on public.platform_first_admin_dry_runs from public,anon,authenticated;

create or replace function public.platform_prepare_first_admin_dry_run(
  target_club_id uuid,
  target_candidate_email text
)
returns void language plpgsql security definer set search_path='' as $$
declare
  registered_club public.platform_clubs%rowtype;
  normalized_email text := lower(btrim(coalesce(target_candidate_email,'')));
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Accès refusé' using errcode='42501';
  end if;

  select * into registered_club
  from public.platform_clubs where id=target_club_id for update;
  if registered_club.id is null then
    raise exception 'Club introuvable' using errcode='22023';
  end if;
  if registered_club.source_registration_request_id is null
    or registered_club.slug not like 'test-%'
    or registered_club.status <> 'provisioning'
    or registered_club.supabase_project_ref is not null
    or registered_club.vercel_project_name is not null
    or registered_club.deployment_url is not null then
    raise exception 'Préparation réservée aux clubs fictifs sans ressources'
      using errcode='42501';
  end if;

  if char_length(normalized_email) not between 8 and 254
    or normalized_email !~* '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.invalid$' then
    raise exception 'Adresse fictive .invalid requise' using errcode='22023';
  end if;

  insert into public.platform_first_admin_dry_runs(
    club_id,candidate_email,prepared_by,prepared_at
  ) values (registered_club.id,normalized_email,auth.uid(),now())
  on conflict (club_id) do update
    set candidate_email=excluded.candidate_email,
        prepared_by=excluded.prepared_by,
        prepared_at=excluded.prepared_at;

  insert into public.platform_audit_log (
    actor_user_id,action,target_club_id,details
  ) values (
    auth.uid(),'first_admin.dry_run_prepared',registered_club.id,
    jsonb_build_object(
      'candidate_email',normalized_email,
      'auth_user_created',false,
      'membership_created',false,
      'instance_created',false,
      'payments_started',false
    )
  );
end;
$$;

create or replace function public.platform_list_first_admin_dry_runs()
returns table(
  club_id uuid,
  candidate_email text,
  prepared_at timestamptz
)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Accès refusé' using errcode='42501';
  end if;

  return query
  select r.club_id,r.candidate_email,r.prepared_at
  from public.platform_first_admin_dry_runs r
  order by r.prepared_at desc;
end;
$$;

revoke all on function public.platform_prepare_first_admin_dry_run(uuid,text)
  from public,anon,authenticated;
grant execute on function public.platform_prepare_first_admin_dry_run(uuid,text)
  to authenticated;
revoke all on function public.platform_list_first_admin_dry_runs()
  from public,anon,authenticated;
grant execute on function public.platform_list_first_admin_dry_runs()
  to authenticated;

commit;
