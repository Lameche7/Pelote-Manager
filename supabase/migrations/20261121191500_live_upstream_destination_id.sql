-- A destination is attached only after Upstream confirms its creation.
-- Its key is write-only on Upstream, and never stored here.
alter table public.pilotoki_live_upstream_bindings
  add column if not exists upstream_destination_id uuid;
create unique index if not exists pilotoki_live_upstream_destination_unique
  on public.pilotoki_live_upstream_bindings(upstream_destination_id)
  where upstream_destination_id is not null;
