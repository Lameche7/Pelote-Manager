-- Not deployed: server-only Stripe Connect storage.
-- Account linkage must be verified by the server before activation.
create table public.club_stripe_connections (
  club_id uuid primary key references public.clubs(id) on delete restrict,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode boolean not null default false,
  charges_enabled boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (not charges_enabled or verified_at is not null)
);

create table public.tournament_stripe_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  team_id uuid not null references public.tournament_teams(id) on delete restrict,
  stripe_account_id text not null,
  livemode boolean not null default false,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  status text not null default 'creating' check (status in ('creating','open','processing','paid','expired','failed','refunded','disputed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  check (status <> 'paid' or (paid_at is not null and stripe_payment_intent_id is not null))
);
create unique index tournament_stripe_one_active_attempt
on public.tournament_stripe_payment_attempts(team_id,livemode)
where status in ('creating','open','processing','paid','disputed');

-- Reject mismatched club/tournament/team/account tuples even for server writes.
create function public.check_tournament_stripe_payment_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.tournament_teams team
    join public.tournaments tournament on tournament.id = team.tournament_id
    join public.club_stripe_connections connection on connection.club_id = tournament.club_id
    where team.id = new.team_id and tournament.id = new.tournament_id
      and tournament.club_id = new.club_id
      and connection.stripe_account_id = new.stripe_account_id
      and connection.livemode = new.livemode
  ) then
    raise exception 'Payment scope mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if row(new.club_id,new.tournament_id,new.team_id,new.stripe_account_id,new.livemode,new.amount_cents,new.currency)
       is distinct from row(old.club_id,old.tournament_id,old.team_id,old.stripe_account_id,old.livemode,old.amount_cents,old.currency) then
      raise exception 'Payment scope and amount are immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger tournament_stripe_payment_scope
before insert or update on public.tournament_stripe_payment_attempts
for each row execute function public.check_tournament_stripe_payment_scope();

create table public.stripe_processed_events (
  stripe_event_id text primary key,
  stripe_account_id text not null,
  livemode boolean not null,
  processed_at timestamptz not null default now()
);

alter table public.club_stripe_connections enable row level security;
alter table public.tournament_stripe_payment_attempts enable row level security;
alter table public.stripe_processed_events enable row level security;
revoke all on public.club_stripe_connections, public.tournament_stripe_payment_attempts, public.stripe_processed_events from public, anon, authenticated;
grant select,insert,update on public.club_stripe_connections, public.tournament_stripe_payment_attempts to service_role;
grant select,insert on public.stripe_processed_events to service_role;
revoke all on function public.check_tournament_stripe_payment_scope() from public, anon, authenticated;
grant execute on function public.check_tournament_stripe_payment_scope() to service_role;
