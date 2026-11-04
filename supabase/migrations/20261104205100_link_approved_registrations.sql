-- Link the approved source request to its central commercial club record.
-- Cross-project UUID only: no foreign key or remote resource is created.
alter table public.network_club_registration_requests
  add column if not exists platform_club_id uuid;

create unique index if not exists network_registration_platform_club_unique
  on public.network_club_registration_requests(platform_club_id)
  where platform_club_id is not null;

revoke all on public.network_club_registration_requests
  from public,anon,authenticated;
