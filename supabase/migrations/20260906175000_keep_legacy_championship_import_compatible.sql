-- Keep older preview builds usable while the duplicate-safe import RPC rolls out.
-- New clients call admin_import_championship_sources_safe(); this grant only avoids
-- turning an older cached client into a misleading authorization error.
grant execute on function public.admin_import_championship_sources(jsonb)
to authenticated;

-- Last-resort database protection for a club importing the same semantic
-- championship twice through an older client that does not yet call the safe RPC.
create unique index if not exists championships_creator_semantic_identity_unique
on public.championships (
  created_by_club_id,
  source_provider,
  public.championship_import_normalize(name),
  public.championship_import_normalize(specialty),
  public.championship_import_normalize(season_label)
)
where created_by_club_id is not null;
