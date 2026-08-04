-- Les montants configurés dans Administration > Tarifs deviennent la source de
-- vérité utilisée par l'aperçu et la création des réservations.
create or replace function public.admin_get_reservation_prices()
returns table (
  licensee_price_cents integer,
  public_price_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
begin
  target_club_id := public.admin_current_club_id();

  if not public.has_club_permission(target_club_id, 'pricing.manage') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  return query
  select
    settings.licensee_price_cents,
    settings.public_price_cents
  from public.reservation_settings as settings
  where settings.id;
end;
$$;

create or replace function public.admin_update_reservation_prices(
  new_licensee_price_cents integer,
  new_public_price_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
begin
  target_club_id := public.admin_current_club_id();

  if not public.has_club_permission(target_club_id, 'pricing.manage') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  if new_licensee_price_cents is null
    or new_public_price_cents is null
    or new_licensee_price_cents < 0
    or new_public_price_cents < 0 then
    raise exception 'Les tarifs sont invalides' using errcode = '22023';
  end if;

  update public.reservation_settings
  set licensee_price_cents = new_licensee_price_cents,
      public_price_cents = new_public_price_cents,
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

revoke all on function public.admin_get_reservation_prices()
from public, anon, authenticated;
revoke all on function public.admin_update_reservation_prices(integer, integer)
from public, anon, authenticated;

grant execute on function public.admin_get_reservation_prices()
to authenticated;
grant execute on function public.admin_update_reservation_prices(integer, integer)
to authenticated;
