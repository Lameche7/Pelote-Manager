alter table public.clubs
add column short_name text,
add column location text,
add column venue_name text,
add column tagline text,
add column founded_year smallint,
add column description text,
add column logo_alt text,
add column hero_image_url text,
add column primary_color text not null default '#0f3d2e',
add column secondary_color text not null default '#0d2b6c',
add column accent_color text not null default '#d62828',
add column neutral_color text not null default '#65717c';

update public.clubs
set
  short_name = coalesce(nullif(btrim(short_name), ''), name),
  logo_alt = coalesce(nullif(btrim(logo_alt), ''), name)
where short_name is null
   or btrim(short_name) = ''
   or logo_alt is null
   or btrim(logo_alt) = '';

update public.clubs
set
  short_name = 'Pelotaris Club Lourdais',
  location = 'Lourdes',
  venue_name = 'Trinquet Robert Cathala',
  tagline = 'Plus qu’un Club, une Histoire.',
  founded_year = 1957,
  description = 'Le Pelotaris Club Lourdais fait vivre la pelote basque au cœur de Lourdes. Pelote Manager accompagne la vie quotidienne du club et de ses pratiquants.',
  logo_alt = 'Pelotaris Club Lourdais',
  logo_url = coalesce(logo_url, '/branding/pcl-logo.png'),
  hero_image_url = '/branding/trinquet-hero.jpg',
  primary_color = '#0f3d2e',
  secondary_color = '#0d2b6c',
  accent_color = '#d62828',
  neutral_color = '#65717c'
where slug = 'pelotaris-club-lourdais';

alter table public.clubs
alter column short_name set not null,
alter column short_name set default 'Club',
alter column logo_alt set not null,
alter column logo_alt set default 'Logo du club';

alter table public.clubs
add constraint clubs_short_name_not_blank check (btrim(short_name) <> ''),
add constraint clubs_logo_alt_not_blank check (btrim(logo_alt) <> ''),
add constraint clubs_founded_year_valid check (
  founded_year is null or founded_year between 1800 and 2200
),
add constraint clubs_primary_color_valid check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
add constraint clubs_secondary_color_valid check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
add constraint clubs_accent_color_valid check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
add constraint clubs_neutral_color_valid check (neutral_color ~ '^#[0-9A-Fa-f]{6}$');

create table public.club_identity_audit_log (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  previous_data jsonb not null,
  new_data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.club_identity_audit_log enable row level security;

create policy club_identity_audit_authorized_read
on public.club_identity_audit_log
for select
to authenticated
using (public.has_club_permission(club_id, 'club.manage'));

create function public.admin_get_club_identity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
begin
  target_club_id := public.admin_current_club_id();

  if not public.has_club_permission(target_club_id, 'club.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'id', clubs.id,
      'name', clubs.name,
      'short_name', clubs.short_name,
      'affiliation_number', clubs.affiliation_number,
      'email', clubs.email,
      'phone', clubs.phone,
      'website', clubs.website,
      'address', clubs.address,
      'social_links', clubs.social_links,
      'notes', clubs.notes,
      'location', clubs.location,
      'venue_name', clubs.venue_name,
      'tagline', clubs.tagline,
      'founded_year', clubs.founded_year,
      'description', clubs.description,
      'logo_url', clubs.logo_url,
      'logo_alt', clubs.logo_alt,
      'hero_image_url', clubs.hero_image_url,
      'primary_color', clubs.primary_color,
      'secondary_color', clubs.secondary_color,
      'accent_color', clubs.accent_color,
      'neutral_color', clubs.neutral_color,
      'updated_at', clubs.updated_at
    )
    from public.clubs as clubs
    where clubs.id = target_club_id
  );
end;
$$;

create function public.admin_update_club_identity(target_identity jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  current_club public.clubs;
  normalized_name text := btrim(coalesce(target_identity ->> 'name', ''));
  normalized_short_name text := btrim(coalesce(target_identity ->> 'short_name', ''));
  normalized_logo_alt text := btrim(coalesce(target_identity ->> 'logo_alt', ''));
  normalized_primary_color text := lower(coalesce(target_identity ->> 'primary_color', ''));
  normalized_secondary_color text := lower(coalesce(target_identity ->> 'secondary_color', ''));
  normalized_accent_color text := lower(coalesce(target_identity ->> 'accent_color', ''));
  normalized_neutral_color text := lower(coalesce(target_identity ->> 'neutral_color', ''));
  normalized_founded_year smallint;
  previous_data jsonb;
  next_data jsonb;
begin
  target_club_id := public.admin_current_club_id();

  if not public.has_club_permission(target_club_id, 'club.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if normalized_name = '' or normalized_short_name = '' or normalized_logo_alt = '' then
    raise exception 'Le nom, le nom court et le texte alternatif du logo sont obligatoires'
      using errcode = '22023';
  end if;

  if normalized_primary_color !~ '^#[0-9a-f]{6}$'
    or normalized_secondary_color !~ '^#[0-9a-f]{6}$'
    or normalized_accent_color !~ '^#[0-9a-f]{6}$'
    or normalized_neutral_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'Les quatre couleurs doivent être au format hexadécimal #RRGGBB'
      using errcode = '22023';
  end if;

  if nullif(target_identity ->> 'founded_year', '') is not null then
    normalized_founded_year := (target_identity ->> 'founded_year')::smallint;
    if normalized_founded_year not between 1800 and 2200 then
      raise exception 'Année de fondation invalide' using errcode = '22023';
    end if;
  end if;

  if nullif(btrim(target_identity ->> 'logo_url'), '') is not null
    and not (
      btrim(target_identity ->> 'logo_url') like '/%'
      or btrim(target_identity ->> 'logo_url') ~ '^https://'
    ) then
    raise exception 'URL du logo non autorisée' using errcode = '22023';
  end if;

  if nullif(btrim(target_identity ->> 'hero_image_url'), '') is not null
    and not (
      btrim(target_identity ->> 'hero_image_url') like '/%'
      or btrim(target_identity ->> 'hero_image_url') ~ '^https://'
    ) then
    raise exception 'URL de la photo d’accueil non autorisée' using errcode = '22023';
  end if;

  select clubs.*
  into current_club
  from public.clubs as clubs
  where clubs.id = target_club_id
  for update;

  previous_data := jsonb_build_object(
    'name', current_club.name,
    'short_name', current_club.short_name,
    'logo_url', current_club.logo_url,
    'hero_image_url', current_club.hero_image_url,
    'primary_color', current_club.primary_color,
    'secondary_color', current_club.secondary_color,
    'accent_color', current_club.accent_color,
    'neutral_color', current_club.neutral_color
  );

  update public.clubs
  set
    name = normalized_name,
    short_name = normalized_short_name,
    affiliation_number = nullif(btrim(target_identity ->> 'affiliation_number'), ''),
    email = nullif(btrim(target_identity ->> 'email'), ''),
    phone = nullif(btrim(target_identity ->> 'phone'), ''),
    website = nullif(btrim(target_identity ->> 'website'), ''),
    address = nullif(btrim(target_identity ->> 'address'), ''),
    social_links = nullif(btrim(target_identity ->> 'social_links'), ''),
    notes = nullif(btrim(target_identity ->> 'notes'), ''),
    location = nullif(btrim(target_identity ->> 'location'), ''),
    venue_name = nullif(btrim(target_identity ->> 'venue_name'), ''),
    tagline = nullif(btrim(target_identity ->> 'tagline'), ''),
    founded_year = normalized_founded_year,
    description = nullif(btrim(target_identity ->> 'description'), ''),
    logo_url = nullif(btrim(target_identity ->> 'logo_url'), ''),
    logo_alt = normalized_logo_alt,
    hero_image_url = nullif(btrim(target_identity ->> 'hero_image_url'), ''),
    primary_color = normalized_primary_color,
    secondary_color = normalized_secondary_color,
    accent_color = normalized_accent_color,
    neutral_color = normalized_neutral_color,
    updated_at = now()
  where id = target_club_id;

  next_data := jsonb_build_object(
    'name', normalized_name,
    'short_name', normalized_short_name,
    'logo_url', nullif(btrim(target_identity ->> 'logo_url'), ''),
    'hero_image_url', nullif(btrim(target_identity ->> 'hero_image_url'), ''),
    'primary_color', normalized_primary_color,
    'secondary_color', normalized_secondary_color,
    'accent_color', normalized_accent_color,
    'neutral_color', normalized_neutral_color
  );

  insert into public.club_identity_audit_log (
    club_id,
    actor_id,
    previous_data,
    new_data
  ) values (
    target_club_id,
    auth.uid(),
    previous_data,
    next_data
  );

  return public.admin_get_club_identity();
end;
$$;

create function public.get_public_club_branding()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  club_count integer;
  target_club public.clubs;
begin
  select count(*)::integer into club_count from public.clubs;

  if club_count <> 1 then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select clubs.*
  into target_club
  from public.clubs as clubs
  limit 1;

  return jsonb_build_object(
    'status', 'ready',
    'name', target_club.name,
    'short_name', target_club.short_name,
    'location', target_club.location,
    'venue_name', target_club.venue_name,
    'tagline', target_club.tagline,
    'founded_year', target_club.founded_year,
    'description', target_club.description,
    'logo_url', target_club.logo_url,
    'logo_alt', target_club.logo_alt,
    'hero_image_url', target_club.hero_image_url,
    'primary_color', target_club.primary_color,
    'secondary_color', target_club.secondary_color,
    'accent_color', target_club.accent_color,
    'neutral_color', target_club.neutral_color,
    'updated_at', target_club.updated_at
  );
end;
$$;

revoke all on function public.admin_get_club_identity() from public;
revoke all on function public.admin_update_club_identity(jsonb) from public;
revoke all on function public.get_public_club_branding() from public;
grant execute on function public.admin_get_club_identity() to authenticated;
grant execute on function public.admin_update_club_identity(jsonb) to authenticated;
grant execute on function public.get_public_club_branding() to anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'club-branding',
  'club-branding',
  true,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy club_branding_public_read
on storage.objects
for select
to public
using (bucket_id = 'club-branding');

create policy club_branding_authorized_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'club-branding'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
);

create policy club_branding_authorized_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'club-branding'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
)
with check (
  bucket_id = 'club-branding'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
);

create policy club_branding_authorized_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'club-branding'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
);
