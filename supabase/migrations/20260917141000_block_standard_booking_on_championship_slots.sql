begin;

create or replace function public.assert_not_championship_only_slot(
  target_resource_id uuid,
  target_starts_at timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resource_timezone text;
  target_day date;
  championship_only boolean;
begin
  select coalesce(resource.timezone, 'Europe/Paris')
  into resource_timezone
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if resource_timezone is null then
    return;
  end if;

  target_day := (target_starts_at at time zone resource_timezone)::date;

  select exists (
    select 1
    from public.list_available_slots_v3(
      target_resource_id,
      target_day,
      target_day
    ) as slot
    where slot.starts_at = target_starts_at
      and slot.reservation_access = 'championship'
  )
  into championship_only;

  if championship_only then
    raise exception 'Ce créneau est réservé à une rencontre de championnat. Ouvrez Mon espace → Mes championnats et choisissez la rencontre avant de réserver.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.assert_not_championship_only_slot(uuid, timestamptz)
from public, anon, authenticated;

-- Les trois parcours ci-dessous sont les réservations standards.
-- Les RPC championnat utilisent directement create_reservation_record et ne sont
-- donc pas bloqués par ce garde-fou.
do $migration$
declare
  function_signature regprocedure;
  function_definition text;
  patched_definition text;
  signature_text text;
begin
  foreach signature_text in array array[
    'public.create_reservation(uuid,timestamptz,text,text,text)',
    'public.reserve_for_payment(uuid,timestamptz,text,text,text)',
    'public.reserve_for_split_payment(uuid,timestamptz,uuid[])'
  ]
  loop
    function_signature := signature_text::regprocedure;
    function_definition := replace(pg_get_functiondef(function_signature), chr(13), '');
    patched_definition := regexp_replace(
      function_definition,
      E'\nbegin\n',
      E'\nbegin\n  perform public.assert_not_championship_only_slot(target_resource_id, target_starts_at);\n',
      1,
      1
    );

    if patched_definition = function_definition then
      raise exception 'Unable to harden %', signature_text;
    end if;

    execute patched_definition;
  end loop;
end;
$migration$;

commit;
