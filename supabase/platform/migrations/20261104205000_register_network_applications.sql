-- CENTRAL PLATFORM PROJECT ONLY: track the public application of a registered club.
-- This creates a commercial record, never an instance, payment or Auth user.
alter table public.platform_clubs
  add column if not exists source_registration_request_id uuid;
create unique index if not exists platform_clubs_registration_source_unique
  on public.platform_clubs (source_registration_request_id)
  where source_registration_request_id is not null;

create or replace function public.platform_register_network_application(
  target_request_id uuid,
  target_name text,
  target_slug text,
  target_contact_email text,
  target_plan text,
  target_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  registered_id uuid;
  normalized_slug text := lower(btrim(coalesce(target_slug,'')));
  normalized_email text := lower(btrim(coalesce(target_contact_email,'')));
begin
  if not public.is_platform_admin() or auth.uid() is null then
    raise exception 'Accès refusé' using errcode='42501';
  end if;

  if target_request_id is null then
    raise exception 'Identifiant de demande manquant' using errcode='22023';
  end if;

  -- Concurrent retries, including after a partial cross-database failure,
  -- must return exactly the same central club and never create duplicates.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_request_id::text, 0)
  );

  select id into registered_id from public.platform_clubs
  where source_registration_request_id=target_request_id;
  if registered_id is not null then return registered_id; end if;

  if char_length(btrim(coalesce(target_name,''))) not between 3 and 120
     or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or char_length(normalized_slug)>80
     or char_length(normalized_email) not between 6 and 254
     or normalized_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
     or target_plan not in ('essentiel','club','premium') then
    raise exception 'Informations de candidature invalides' using errcode='22023';
  end if;

  if exists (
    select 1 from public.platform_clubs
    where slug=normalized_slug and source_registration_request_id is distinct from target_request_id
  ) then
    raise exception 'Identifiant club déjà utilisé' using errcode='23505';
  end if;

  insert into public.platform_clubs (
    name,slug,contact_email,subscription_plan,notes,created_by,
    source_registration_request_id
  ) values (
    btrim(target_name),normalized_slug,normalized_email,target_plan,
    nullif(btrim(coalesce(target_notes,'')),''),auth.uid(),target_request_id
  ) returning id into registered_id;

  insert into public.platform_audit_log(
    actor_user_id,action,target_club_id,details
  ) values (
    auth.uid(),'club.created_from_network',registered_id,
    jsonb_build_object(
      'registration_request_id',target_request_id,
      'subscription_plan',target_plan,
      'provisioning_requested',false,
      'payment_started',false
    )
  );

  return registered_id;
end;
$$;

revoke all on function public.platform_register_network_application(
  uuid,text,text,text,text,text
) from public,anon;
grant execute on function public.platform_register_network_application(
  uuid,text,text,text,text,text
) to authenticated;
