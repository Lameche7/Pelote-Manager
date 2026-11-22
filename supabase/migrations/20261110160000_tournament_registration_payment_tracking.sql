-- Additive payment tracking: does NOT change tournament_teams.status,
-- capacity calculations, registration RPCs, notifications or existing teams.
create table public.tournament_registration_payments (
  team_id uuid primary key references public.tournament_teams(id) on delete cascade,
  club_id uuid not null references public.clubs(id),
  tournament_id uuid not null references public.tournaments(id),
  amount_due_cents integer not null check (amount_due_cents >= 0),
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  status text not null default 'unpaid'
    check (status in ('unpaid','partial','paid','cancelled','refunded')),
  confirmation_policy text not null check (confirmation_policy in ('deferred','payment_required')),
  hold_place boolean not null,
  hold_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_paid_cents <= amount_due_cents),
  check (hold_until is null or hold_place)
);
create index tournament_registration_payments_club_status_idx
  on public.tournament_registration_payments (club_id,status);
alter table public.tournament_registration_payments enable row level security;
revoke all on public.tournament_registration_payments from anon, authenticated;
grant all on public.tournament_registration_payments to service_role;

create or replace function public.track_tournament_registration_payment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  club uuid;
  fee integer;
  policy record;
begin
  select t.club_id, coalesce(t.registration_fee_cents,0)
  into club,fee from public.tournaments t where t.id = new.tournament_id;
  if club is null then raise exception 'Tournament club missing'; end if;
  select p.tournament_confirmation,p.tournament_hold_place,p.tournament_hold_hours
  into policy from public.club_payment_policies p where p.club_id=club;
  -- No configured policy: preserve legacy behavior. Tracking remains independent.
  insert into public.tournament_registration_payments (
    team_id,club_id,tournament_id,amount_due_cents,status,
    confirmation_policy,hold_place,hold_until
  ) values (
    new.id,club,new.tournament_id,fee,
    case when fee=0 then 'paid' else 'unpaid' end,
    coalesce(policy.tournament_confirmation,'deferred'),
    coalesce(policy.tournament_hold_place,true),
    case when fee>0 and coalesce(policy.tournament_hold_place,true)
      then now() + make_interval(hours => coalesce(policy.tournament_hold_hours,48))
      else null end
  ) on conflict (team_id) do nothing;
  return new;
end;
$$;
create trigger tournament_registration_payment_tracking
after insert on public.tournament_teams
for each row execute function public.track_tournament_registration_payment();

create or replace function public.admin_list_tournament_registration_payments()
returns table (
  team_id uuid,tournament_id uuid,tournament_name text,
  team_status text,amount_due_cents integer,amount_paid_cents integer,
  payment_status text,confirmation_policy text,hold_until timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare club uuid := public.admin_current_club_id();
begin
  if club is null or not (
    public.has_club_permission(club,'tournaments.manage')
    or public.has_club_permission(club,'payments.read')
  ) then raise exception 'Accès administrateur requis' using errcode='42501'; end if;
  return query select p.team_id,p.tournament_id,t.name,tt.status::text,
    p.amount_due_cents,p.amount_paid_cents,p.status,p.confirmation_policy,p.hold_until
  from public.tournament_registration_payments p
  join public.tournaments t on t.id=p.tournament_id and t.club_id=club
  join public.tournament_teams tt on tt.id=p.team_id
  where p.club_id=club order by p.created_at desc;
end;
$$;
revoke all on function public.admin_list_tournament_registration_payments() from public;
grant execute on function public.admin_list_tournament_registration_payments() to authenticated;
