-- PR #327, phase 1: durable slot ownership for referees.
-- Non-disruptive: existing match-based RPCs remain in place until phase 2.
create table if not exists public.referee_slot_assignments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  resource_id uuid not null references public.reservable_resources(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  referee_profile_id uuid not null references public.profiles(id) on delete restrict,
  legacy_assignment_id uuid unique references public.referee_assignments(id) on delete set null,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referee_slot_valid_interval check (ends_at > starts_at),
  constraint referee_slot_unique_start unique (resource_id, starts_at)
);
create index if not exists referee_slot_by_referee on public.referee_slot_assignments(club_id,referee_profile_id,starts_at);
create index if not exists referee_slot_by_time on public.referee_slot_assignments(club_id,starts_at);
alter table public.referee_slot_assignments enable row level security;
revoke all on public.referee_slot_assignments from public, anon, authenticated;

-- The historical match assignment is used ONLY to find the original slot.
-- The resulting slot is independent of subsequent match reschedules.
with candidates as (
  select ra.id legacy_assignment_id, ra.club_id, pl.resource_id,
    public.tournament_planning_starts_at(pl.play_date,pl.starts_at,rr.timezone) starts_at,
    public.tournament_planning_starts_at(pl.play_date,pl.ends_at,rr.timezone) ends_at,
    ra.referee_profile_id,ra.assigned_by,ra.assigned_at
  from public.referee_assignments ra
  join public.tournament_match_planning pl on pl.match_id=ra.tournament_match_id
  join public.reservable_resources rr on rr.id=pl.resource_id and rr.club_id=ra.club_id
  where ra.source_type='tournament' and ra.referee_profile_id is not null
  union all
  select ra.id,ra.club_id,r.resource_id,r.starts_at,r.ends_at,
    ra.referee_profile_id,ra.assigned_by,ra.assigned_at
  from public.referee_assignments ra
  join public.reservations r on r.championship_match_id=ra.championship_match_id
    and r.status in ('pending','confirmed')
  join public.reservable_resources rr on rr.id=r.resource_id and rr.club_id=ra.club_id
  where ra.source_type='championship' and ra.referee_profile_id is not null
    and not exists (
      select 1 from public.reservations earlier
      where earlier.championship_match_id=r.championship_match_id
        and earlier.status in ('pending','confirmed')
        and (earlier.starts_at,earlier.id)<(r.starts_at,r.id)
    )
), unambiguous as (
 select c.*,count(*) over (partition by c.resource_id,c.starts_at) competing
 from candidates c where c.ends_at>c.starts_at
)
insert into public.referee_slot_assignments
 (club_id,resource_id,starts_at,ends_at,referee_profile_id,legacy_assignment_id,assigned_by,assigned_at)
select club_id,resource_id,starts_at,ends_at,referee_profile_id,legacy_assignment_id,assigned_by,coalesce(assigned_at,now())
from unambiguous where competing=1
on conflict do nothing;

-- Audit rather than guessing: every historic assignment not migrated must be
-- reviewed before switching the live read/write RPCs to this table.
create or replace view public.referee_slot_migration_audit
with (security_invoker=true) as
select ra.id assignment_id,ra.club_id,ra.source_type,
       ra.championship_match_id,ra.tournament_match_id,
       ra.referee_profile_id
from public.referee_assignments ra
where ra.referee_profile_id is not null
  and not exists (
    select 1 from public.referee_slot_assignments sa
    where sa.legacy_assignment_id=ra.id
  );
revoke all on public.referee_slot_migration_audit from public, anon, authenticated;
