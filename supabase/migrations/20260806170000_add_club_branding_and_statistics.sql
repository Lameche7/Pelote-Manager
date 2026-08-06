alter table public.clubs
add column if not exists hero_image_url text,
add column if not exists primary_color text not null default '#0F3D2E',
add column if not exists secondary_color text not null default '#1E5AA8',
add column if not exists accent_color text not null default '#B22525',
add column if not exists neutral_color text not null default '#6B7280';

alter table public.clubs
drop constraint if exists clubs_primary_color_hex,
add constraint clubs_primary_color_hex check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
drop constraint if exists clubs_secondary_color_hex,
add constraint clubs_secondary_color_hex check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
drop constraint if exists clubs_accent_color_hex,
add constraint clubs_accent_color_hex check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
drop constraint if exists clubs_neutral_color_hex,
add constraint clubs_neutral_color_hex check (neutral_color ~ '^#[0-9A-Fa-f]{6}$');

update public.clubs
set hero_image_url = coalesce(hero_image_url, '/branding/trinquet-hero.jpg')
where hero_image_url is null;

create or replace function public.get_public_club_branding()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'name', clubs.name,
        'logo_url', clubs.logo_url,
        'hero_image_url', clubs.hero_image_url,
        'primary_color', clubs.primary_color,
        'secondary_color', clubs.secondary_color,
        'accent_color', clubs.accent_color,
        'neutral_color', clubs.neutral_color
      )
      from public.clubs clubs
      order by clubs.created_at
      limit 1
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.get_public_club_branding() from public;
grant execute on function public.get_public_club_branding() to anon, authenticated;

create or replace function public.admin_get_club_statistics(
  period_start date,
  period_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  club uuid := public.admin_current_club_id();
  range_start timestamptz;
  range_end timestamptz;
begin
  if not public.has_club_permission(club, 'statistics.read') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if period_start is null or period_end is null or period_end < period_start then
    raise exception 'Invalid statistics period' using errcode = '22023';
  end if;

  if period_end - period_start > 366 then
    raise exception 'Statistics period is limited to 367 days' using errcode = '22023';
  end if;

  range_start := period_start::timestamp at time zone 'Europe/Paris';
  range_end := (period_end + 1)::timestamp at time zone 'Europe/Paris';

  return jsonb_build_object(
    'period_start', period_start,
    'period_end', period_end,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'reservations', (
        select count(*)::integer
        from public.reservations r
        join public.reservable_resources rr on rr.id = r.resource_id
        where rr.club_id = club
          and r.starts_at >= range_start and r.starts_at < range_end
          and r.status in ('pending', 'confirmed', 'completed', 'no_show')
      ),
      'cancelled', (
        select count(*)::integer
        from public.reservations r
        join public.reservable_resources rr on rr.id = r.resource_id
        where rr.club_id = club
          and r.starts_at >= range_start and r.starts_at < range_end
          and r.status = 'cancelled'
      ),
      'licensees', (
        select count(*)::integer
        from public.reservations r
        join public.reservable_resources rr on rr.id = r.resource_id
        where rr.club_id = club
          and r.starts_at >= range_start and r.starts_at < range_end
          and r.status in ('pending', 'confirmed', 'completed', 'no_show')
          and r.customer_type = 'licensee'
      ),
      'visitors', (
        select count(*)::integer
        from public.reservations r
        join public.reservable_resources rr on rr.id = r.resource_id
        where rr.club_id = club
          and r.starts_at >= range_start and r.starts_at < range_end
          and r.status in ('pending', 'confirmed', 'completed', 'no_show')
          and r.customer_type <> 'licensee'
      ),
      'revenue_cents', (
        select coalesce(sum(r.price_cents), 0)::bigint
        from public.reservations r
        join public.reservable_resources rr on rr.id = r.resource_id
        where rr.club_id = club
          and r.starts_at >= range_start and r.starts_at < range_end
          and r.status in ('confirmed', 'completed', 'no_show')
      ),
      'occupied_hours', (
        select coalesce(round(sum(extract(epoch from (r.ends_at - r.starts_at))) / 3600.0, 1), 0)
        from public.reservations r
        join public.reservable_resources rr on rr.id = r.resource_id
        where rr.club_id = club
          and r.starts_at >= range_start and r.starts_at < range_end
          and r.status in ('pending', 'confirmed', 'completed', 'no_show')
      )
    ),
    'by_resource', coalesce((
      select jsonb_agg(jsonb_build_object(
        'resource_id', data.resource_id,
        'resource_name', data.resource_name,
        'reservations', data.reservations,
        'hours', data.hours
      ) order by data.reservations desc, data.resource_name)
      from (
        select rr.id resource_id, rr.name resource_name,
          count(r.id)::integer reservations,
          coalesce(round(sum(extract(epoch from (r.ends_at - r.starts_at))) / 3600.0, 1), 0) hours
        from public.reservable_resources rr
        left join public.reservations r on r.resource_id = rr.id
          and r.starts_at >= range_start and r.starts_at < range_end
          and r.status in ('pending', 'confirmed', 'completed', 'no_show')
        where rr.club_id = club and rr.is_active
        group by rr.id, rr.name
      ) data
    ), '[]'::jsonb),
    'by_weekday', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', data.weekday,
        'reservations', data.reservations
      ) order by data.weekday)
      from (
        select extract(isodow from timezone('Europe/Paris', r.starts_at))::integer weekday,
          count(*)::integer reservations
        from public.reservations r
        join public.reservable_resources rr on rr.id = r.resource_id
        where rr.club_id = club
          and r.starts_at >= range_start and r.starts_at < range_end
          and r.status in ('pending', 'confirmed', 'completed', 'no_show')
        group by 1
      ) data
    ), '[]'::jsonb),
    'by_hour', coalesce((
      select jsonb_agg(jsonb_build_object(
        'hour', data.hour,
        'reservations', data.reservations
      ) order by data.hour)
      from (
        select extract(hour from timezone('Europe/Paris', r.starts_at))::integer hour,
          count(*)::integer reservations
        from public.reservations r
        join public.reservable_resources rr on rr.id = r.resource_id
        where rr.club_id = club
          and r.starts_at >= range_start and r.starts_at < range_end
          and r.status in ('pending', 'confirmed', 'completed', 'no_show')
        group by 1
      ) data
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_club_statistics(date, date) from public;
grant execute on function public.admin_get_club_statistics(date, date) to authenticated;
