begin;

revoke all on table public.club_reservation_settings
from anon, authenticated;

revoke all on function public.get_reservation_terms_for_resource(
  uuid, uuid, timestamptz
)
from public, anon, authenticated;

revoke all on function public.is_active_licensee_for_club(
  uuid, uuid, date
)
from public, anon, authenticated;

create index if not exists club_reservation_settings_updated_by_idx
on public.club_reservation_settings(updated_by);

commit;
