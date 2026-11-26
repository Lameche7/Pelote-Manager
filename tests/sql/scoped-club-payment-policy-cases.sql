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


-- Ephemeral database only.
begin;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',300);
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
do $check$
declare
  a uuid := '00000000-0000-0000-0000-000000000001';
  b uuid := '00000000-0000-0000-0000-000000000002';
begin
  insert into public.club_payment_policies(club_id,tournament_hold_hours) values(a,72);
  if (select tournament_hold_hours from public.admin_get_club_payment_policy_for_club(b))<>48 then
    raise exception 'Wrong default policy';
  end if;
  perform public.admin_save_club_payment_policy_for_club(b,false,true,false,true,'deferred','deferred',true,24);
  if (select tournament_hold_hours from public.admin_get_club_payment_policy_for_club(b))<>24
    or (select tournament_hold_hours from public.club_payment_policies where club_id=a)<>72 then
    raise exception 'Club preferences not isolated';
  end if;
  begin
    perform public.admin_save_club_payment_policy_for_club(b,false,true,true,true,'deferred','payment_required',true,24);
    raise exception 'Unconfigured online payment accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_save_club_payment_policy_for_club(b,false,true,true,true,'deferred','deferred',true,721);
    raise exception 'Invalid hold duration accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
  begin
    perform public.admin_get_club_payment_policy_for_club(b);
    raise exception 'Unauthorized payment policy read' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_save_club_payment_policy_for_club(b,false,true,true,true,'deferred','deferred',true,48);
    raise exception 'Unauthorized payment policy write' using errcode='XX000';
  exception when insufficient_privilege then null; end;
end $check$;
rollback;
