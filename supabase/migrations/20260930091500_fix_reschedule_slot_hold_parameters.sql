begin;

create or replace function public.tournament_reschedule_slot_is_held(
  target_resource_id uuid,
  target_play_date date,
  target_starts_at time without time zone,
  target_ends_at time without time zone,
  excluded_request_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tournament_reschedule_requests as request
    where request.status in ('pending', 'approved')
      and request.expires_at > now()
      and request.id is distinct from $5
      and request.target_resource_id = $1
      and request.target_play_date = $2
      and request.target_starts_at < $4
      and request.target_ends_at > $3
  );
$function$;

revoke all on function public.tournament_reschedule_slot_is_held(
  uuid, date, time without time zone, time without time zone, uuid
) from public, anon, authenticated;

commit;
