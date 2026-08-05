-- À exécuter uniquement sur un projet Supabase neuf après toutes les migrations.
-- Ce script n'est volontairement pas placé dans supabase/migrations : il ne doit
-- jamais être appliqué automatiquement à une instance existante.

begin;

do $$
declare
  target_club_name constant text := 'À REMPLACER — NOM DU CLUB';
  target_club_slug constant text := 'a-remplacer';
  target_club_id uuid;
begin
  if target_club_name = 'À REMPLACER — NOM DU CLUB'
    or target_club_slug = 'a-remplacer' then
    raise exception 'Renseignez le nom et le slug du nouveau club avant exécution';
  end if;

  if target_club_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Le slug doit contenir uniquement des minuscules, chiffres et tirets';
  end if;

  if (select count(*) from public.clubs) <> 1 then
    raise exception 'Une instance neuve doit contenir exactement un club technique';
  end if;

  -- La remise à zéro est interdite dès qu'une donnée réelle ou un compte existe.
  if exists (select 1 from auth.users)
    or exists (select 1 from public.profiles)
    or exists (select 1 from public.club_memberships)
    or exists (select 1 from public.club_members)
    or exists (select 1 from public.reservations)
    or exists (select 1 from public.calendar_occupations)
    or exists (select 1 from public.payments)
    or exists (select 1 from public.events) then
    raise exception 'Instance non vierge : bootstrap refusé pour protéger les données';
  end if;

  select id into strict target_club_id from public.clubs;

  -- Supprime les ressources de démonstration héritées de la première instance.
  -- Les horaires associés sont supprimés par cascade.
  delete from public.reservable_resources;

  delete from public.club_prices where club_id = target_club_id;
  delete from public.club_seasons where club_id = target_club_id;

  update public.clubs
  set name = btrim(target_club_name),
      slug = target_club_slug,
      logo_url = null,
      address = null,
      phone = null,
      email = null,
      website = null,
      social_links = null,
      affiliation_number = null,
      notes = null,
      updated_at = now()
  where id = target_club_id;

  -- Valeurs neutres modifiables ensuite par l'administrateur du club.
  update public.reservation_settings
  set licensee_advance_hours = 72,
      public_advance_hours = 48,
      licensee_price_cents = 1200,
      public_price_cents = 1800,
      default_duration_minutes = 60,
      booking_step_minutes = 60,
      minimum_notice_minutes = 60,
      updated_at = now(),
      updated_by = null
  where id;
end;
$$;

commit;
