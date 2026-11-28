-- Draft: price snapshot per team registration, not per player or club.
-- Historical prices are not available here; existing rows use the current tournament price at migration time.
alter table public.tournament_teams add column registration_price_cents integer
  check (registration_price_cents>=0);
update public.tournament_teams team
  set registration_price_cents=coalesce(tournament.registration_fee_cents,0)
  from public.tournaments tournament where tournament.id=team.tournament_id;
alter table public.tournament_teams alter column registration_price_cents set not null;

create or replace function public.capture_tournament_registration_price()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='INSERT' then
    select coalesce(t.registration_fee_cents,0) into new.registration_price_cents
      from public.tournaments t where t.id=new.tournament_id for share;
    if not found then raise exception 'Tournament not found' using errcode='23503'; end if;
  elsif new.registration_price_cents is distinct from old.registration_price_cents
    or new.tournament_id is distinct from old.tournament_id then
    raise exception 'Registration price and tournament are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.capture_tournament_registration_price() from public,anon,authenticated;
create trigger capture_tournament_registration_price
before insert or update of registration_price_cents,tournament_id on public.tournament_teams
for each row execute function public.capture_tournament_registration_price();
