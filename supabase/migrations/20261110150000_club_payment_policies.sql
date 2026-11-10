-- Per-club payment preferences. This is configuration only: existing checkout
-- and licence/tournament flows are deliberately unchanged until explicitly migrated.
create table if not exists public.club_payment_policies (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  helloasso_enabled boolean not null default false,
  cash_enabled boolean not null default true,
  cheque_enabled boolean not null default true,
  bank_transfer_enabled boolean not null default true,
  licence_confirmation text not null default 'deferred'
    check (licence_confirmation in ('deferred', 'payment_required')),
  tournament_confirmation text not null default 'deferred'
    check (tournament_confirmation in ('deferred', 'payment_required')),
  tournament_hold_place boolean not null default true,
  tournament_hold_hours integer not null default 48
    check (tournament_hold_hours between 1 and 720),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.club_payment_policies enable row level security;
revoke all on public.club_payment_policies from anon, authenticated;
grant select, insert, update, delete on public.club_payment_policies to service_role;

create or replace function public.admin_get_club_payment_policy()
returns table (
  helloasso_enabled boolean, cash_enabled boolean, cheque_enabled boolean,
  bank_transfer_enabled boolean, licence_confirmation text,
  tournament_confirmation text, tournament_hold_place boolean,
  tournament_hold_hours integer
)
language plpgsql stable security definer set search_path = ''
as $$
declare target_club_id uuid := public.admin_current_club_id();
begin
  if target_club_id is null or not (
    public.has_club_permission(target_club_id, 'settings.manage')
    or public.has_club_permission(target_club_id, 'payments.manage')
  ) then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  return query
  select coalesce(p.helloasso_enabled, false), coalesce(p.cash_enabled, true),
         coalesce(p.cheque_enabled, true), coalesce(p.bank_transfer_enabled, true),
         coalesce(p.licence_confirmation, 'deferred'::text),
         coalesce(p.tournament_confirmation, 'deferred'::text),
         coalesce(p.tournament_hold_place, true),
         coalesce(p.tournament_hold_hours, 48)
  from (select 1) as seed
  left join public.club_payment_policies p on p.club_id = target_club_id;
end;
$$;

create or replace function public.admin_save_club_payment_policy(
  new_helloasso_enabled boolean, new_cash_enabled boolean,
  new_cheque_enabled boolean, new_bank_transfer_enabled boolean,
  new_licence_confirmation text, new_tournament_confirmation text,
  new_tournament_hold_place boolean, new_tournament_hold_hours integer
) returns void
language plpgsql security definer set search_path = ''
as $$
declare target_club_id uuid := public.admin_current_club_id();
begin
  if target_club_id is null or not (
    public.has_club_permission(target_club_id, 'settings.manage')
    or public.has_club_permission(target_club_id, 'payments.manage')
  ) then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  if new_licence_confirmation is null or new_licence_confirmation not in ('deferred','payment_required')
     or new_tournament_confirmation is null or new_tournament_confirmation not in ('deferred','payment_required')
     or new_tournament_hold_hours is null or new_tournament_hold_hours not between 1 and 720
     or new_helloasso_enabled is null or new_cash_enabled is null
     or new_cheque_enabled is null or new_bank_transfer_enabled is null
     or new_tournament_hold_place is null then
    raise exception 'Paramètres de paiement invalides' using errcode = '22023';
  end if;
  if (new_licence_confirmation = 'payment_required' or new_tournament_confirmation = 'payment_required')
      and not new_helloasso_enabled then
    raise exception 'Un paiement en ligne actif est nécessaire pour imposer le paiement immédiat'
      using errcode = '22023';
  end if;
  insert into public.club_payment_policies (
    club_id, helloasso_enabled, cash_enabled, cheque_enabled, bank_transfer_enabled,
    licence_confirmation, tournament_confirmation, tournament_hold_place,
    tournament_hold_hours, updated_at, updated_by
  ) values (
    target_club_id, new_helloasso_enabled, new_cash_enabled, new_cheque_enabled,
    new_bank_transfer_enabled, new_licence_confirmation, new_tournament_confirmation,
    new_tournament_hold_place, new_tournament_hold_hours, now(), auth.uid()
  )
  on conflict (club_id) do update set
    helloasso_enabled = excluded.helloasso_enabled,
    cash_enabled = excluded.cash_enabled,
    cheque_enabled = excluded.cheque_enabled,
    bank_transfer_enabled = excluded.bank_transfer_enabled,
    licence_confirmation = excluded.licence_confirmation,
    tournament_confirmation = excluded.tournament_confirmation,
    tournament_hold_place = excluded.tournament_hold_place,
    tournament_hold_hours = excluded.tournament_hold_hours,
    updated_at = now(), updated_by = auth.uid();
end;
$$;
revoke all on function public.admin_get_club_payment_policy() from public;
revoke all on function public.admin_save_club_payment_policy(boolean,boolean,boolean,boolean,text,text,boolean,integer) from public;
grant execute on function public.admin_get_club_payment_policy() to authenticated;
grant execute on function public.admin_save_club_payment_policy(boolean,boolean,boolean,boolean,text,text,boolean,integer) to authenticated;
