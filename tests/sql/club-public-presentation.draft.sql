-- Club-specific public presentation; historical values are data, not application logic.
alter table public.clubs
  add column if not exists founded_year text check (founded_year is null or founded_year ~ '^[0-9]{4}$'),
  add column if not exists tagline text check (char_length(tagline) <= 200),
  add column if not exists presentation_title text check (char_length(presentation_title) <= 200),
  add column if not exists presentation_text text check (char_length(presentation_text) <= 3000);

update public.clubs set
  founded_year = coalesce(founded_year,'1957'),
  tagline = coalesce(tagline,'Plus qu’un Club, une Histoire.'),
  presentation_title = coalesce(presentation_title,'Le club, notre passion.'),
  presentation_text = coalesce(presentation_text,'Le Pelotaris Club Lourdais fait vivre la pelote basque au cœur de Lourdes. PILOTOKI accompagne la vie quotidienne du club et de ses pratiquants.')
where slug='pelotaris-club-lourdais';

CREATE OR REPLACE FUNCTION public.get_public_club_branding()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (
      select jsonb_build_object(
        'name', clubs.name,
        'founded_year', clubs.founded_year,
        'tagline', clubs.tagline,
        'presentation_title', clubs.presentation_title,
        'presentation_text', clubs.presentation_text,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_public_club_branding_for_slug(target_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (
      select jsonb_build_object(
        'name', club.name,
        'founded_year', club.founded_year,
        'tagline', club.tagline,
        'presentation_title', club.presentation_title,
        'presentation_text', club.presentation_text,
        'logo_url', club.logo_url,
        'hero_image_url', club.hero_image_url,
        'primary_color', club.primary_color,
        'secondary_color', club.secondary_color,
        'accent_color', club.accent_color,
        'neutral_color', club.neutral_color,
        'slug', club.slug
      )
      from public.clubs as club
      where club.slug = nullif(btrim(target_slug), '')
      limit 1
    ),
    '{}'::jsonb
  );
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_get_club_information(target_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  club_info jsonb;
begin
  if auth.uid() is null
     or target_club_id is null
     or not pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id) then
    raise exception 'Club information access denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
        'founded_year', c.founded_year,
        'tagline', c.tagline,
        'presentation_title', c.presentation_title,
        'presentation_text', c.presentation_text,
    'logo_url', c.logo_url,
    'hero_image_url', c.hero_image_url,
    'primary_color', c.primary_color,
    'secondary_color', c.secondary_color,
    'accent_color', c.accent_color,
    'neutral_color', c.neutral_color,
    'address', c.address,
    'phone', c.phone,
    'email', c.email,
    'website', c.website,
    'social_links', c.social_links,
    'affiliation_number', c.affiliation_number,
    'notes', c.notes
  )
  into club_info
  from public.clubs c
  where c.id = target_club_id;

  if club_info is null then
    raise exception 'Club information unavailable' using errcode = 'P0002';
  end if;
  return club_info;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_admin_update_club_information(target_club_id uuid, changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null
     or target_club_id is null
     or not pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id) then
    raise exception 'Club information update denied' using errcode = '42501';
  end if;
  if changes is null
     or jsonb_typeof(changes) <> 'object'
     or changes = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(changes) as field(key)
       where field.key not in (
         'name',
         'primary_color', 'secondary_color', 'accent_color',
         'neutral_color', 'address', 'phone', 'email',
         'website', 'social_links', 'affiliation_number', 'notes',
         'founded_year', 'tagline', 'presentation_title', 'presentation_text'
       )
     ) then
    raise exception 'Invalid club information fields' using errcode = '22023';
  end if;

  update public.clubs c
  set name = case when changes ? 'name' then changes->>'name' else c.name end,
      primary_color = case when changes ? 'primary_color' then changes->>'primary_color' else c.primary_color end,
      secondary_color = case when changes ? 'secondary_color' then changes->>'secondary_color' else c.secondary_color end,
      accent_color = case when changes ? 'accent_color' then changes->>'accent_color' else c.accent_color end,
      neutral_color = case when changes ? 'neutral_color' then changes->>'neutral_color' else c.neutral_color end,
      address = case when changes ? 'address' then changes->>'address' else c.address end,
      phone = case when changes ? 'phone' then changes->>'phone' else c.phone end,
      email = case when changes ? 'email' then changes->>'email' else c.email end,
      website = case when changes ? 'website' then changes->>'website' else c.website end,
      social_links = case when changes ? 'social_links' then changes->>'social_links' else c.social_links end,
      affiliation_number = case when changes ? 'affiliation_number' then changes->>'affiliation_number' else c.affiliation_number end,
      notes = case when changes ? 'notes' then changes->>'notes' else c.notes end,
      founded_year = case when changes ? 'founded_year' then nullif(btrim(changes->>'founded_year'),'') else c.founded_year end,
      tagline = case when changes ? 'tagline' then nullif(btrim(changes->>'tagline'),'') else c.tagline end,
      presentation_title = case when changes ? 'presentation_title' then nullif(btrim(changes->>'presentation_title'),'') else c.presentation_title end,
      presentation_text = case when changes ? 'presentation_text' then nullif(btrim(changes->>'presentation_text'),'') else c.presentation_text end
  where c.id = target_club_id
  returning jsonb_build_object('id', c.id) into result;

  if result is null then
    raise exception 'Club information unavailable' using errcode = 'P0002';
  end if;
  return result;
end;
$function$;

