create or replace function public.admin_list_opening_hours(target_resource_id uuid)
returns table (
  id bigint,
  resource_id uuid,
  weekday smallint,
  opens_at time,
  closes_at time,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  return query
  select
    hours.id,
    hours.resource_id,
    case when hours.weekday = 0 then 7 else hours.weekday end::smallint,
    hours.opens_at,
    hours.closes_at,
    hours.is_open
  from public.resource_opening_hours as hours
  where hours.resource_id = target_resource_id
  order by case when hours.weekday = 0 then 7 else hours.weekday end,
    hours.opens_at;
end;
$$;

create or replace function public.admin_save_opening_hour(
  target_id bigint,
  target_resource_id uuid,
  target_weekday smallint,
  target_opens_at time,
  target_closes_at time,
  target_is_active boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
  database_weekday smallint;
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if target_weekday not between 1 and 7 or target_closes_at <= target_opens_at then
    raise exception 'Horaire invalide' using errcode = '22023';
  end if;

  database_weekday := case when target_weekday = 7 then 0 else target_weekday end;

  if target_id is null then
    insert into public.resource_opening_hours (
      resource_id, weekday, opens_at, closes_at, is_open
    ) values (
      target_resource_id, database_weekday, target_opens_at,
      target_closes_at, target_is_active
    ) returning id into saved_id;
  else
    update public.resource_opening_hours
    set resource_id = target_resource_id,
        weekday = database_weekday,
        opens_at = target_opens_at,
        closes_at = target_closes_at,
        is_open = target_is_active,
        updated_at = now()
    where id = target_id
    returning id into saved_id;
  end if;

  return saved_id;
end;
$$;
