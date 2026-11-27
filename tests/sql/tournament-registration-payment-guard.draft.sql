-- Draft: payment-required registration guard. Install after price and Stripe storage.
-- Existing accepted registrations are grandfathered when a club changes its policy.
-- Payment evidence is read only from server-controlled live attempts and receipts.
create or replace function public.auto_accept_tournament_registration()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  requires_payment boolean;
  received bigint;
  target_club uuid;
begin
  if new.submitted_by is null or new.status not in ('pending','accepted') then
    return new;
  end if;
  select t.club_id,coalesce(p.tournament_confirmation='payment_required',false)
    into target_club,requires_payment
    from public.tournaments t left join public.club_payment_policies p on p.club_id=t.club_id
    where t.id=new.tournament_id;
  if tg_op='UPDATE' and old.status='accepted' then
    new.status:='accepted';
    new.validated_at:=old.validated_at;
    new.validated_by:=old.validated_by;
    return new;
  end if;
  if requires_payment and coalesce(new.registration_price_cents,0)>0 then
    select coalesce(sum(a.amount_cents),0) into received
      from public.tournament_stripe_payment_attempts a
      where a.team_id=new.id and a.tournament_id=new.tournament_id
        and a.club_id=target_club and a.livemode and a.status='paid';
    -- Count only receipts actually recorded by an authorized club administrator.
    select received + coalesce(sum(r.amount_cents),0) into received
      from public.tournament_manual_receipts r
      where r.team_id=new.id and r.tournament_id=new.tournament_id and r.club_id=target_club;
    select received - coalesce(sum(r.amount_cents),0) into received
      from public.tournament_payment_refunds r
      where r.team_id=new.id and r.tournament_id=new.tournament_id and r.club_id=target_club
        and r.status in ('requested','pending','succeeded');
    if received<new.registration_price_cents then
      if new.status='accepted' then
        raise exception 'Tournament registration requires confirmed payment' using errcode='23514';
      end if;
      new.validated_at:=null;
      new.validated_by:=null;
      return new;
    end if;
  end if;
  if new.status='pending' then
    new.status:='accepted';
    new.validated_by:=null;
    new.validated_at:=now();
  end if;
  return new;
end;
$$;
revoke all on function public.auto_accept_tournament_registration() from public,anon,authenticated;

-- Trigger name sorts after capture_tournament_registration_price on INSERT.
drop trigger if exists tournament_teams_auto_accept_registration on public.tournament_teams;
create trigger tournament_teams_auto_accept_registration
before insert or update of status,submitted_by on public.tournament_teams
for each row execute function public.auto_accept_tournament_registration();

-- Called only after the verified payment attempt is recorded. Sandbox payments
-- never change team status. A withdrawn or rejected team is never resurrected.
create or replace function public.confirm_paid_tournament_registration()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.livemode and new.status='paid' and old.status is distinct from new.status then
    update public.tournament_teams t set status='pending'
      where t.id=new.team_id and t.tournament_id=new.tournament_id
        and t.status='pending'
        and t.registration_price_cents>0
        and exists(select 1 from public.tournaments tour
          join public.club_payment_policies p on p.club_id=tour.club_id
          where tour.id=t.tournament_id and tour.club_id=new.club_id
            and p.tournament_confirmation='payment_required');
  end if;
  return new;
end;
$$;
revoke all on function public.confirm_paid_tournament_registration() from public,anon,authenticated;
create trigger confirm_paid_tournament_registration
after update of status on public.tournament_stripe_payment_attempts
for each row execute function public.confirm_paid_tournament_registration();

-- A fully received manual payment follows the same registration guard.
create or replace function public.confirm_manual_tournament_registration()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.tournament_teams t set status='pending'
    where t.id=new.team_id and t.tournament_id=new.tournament_id
      and t.status='pending' and t.registration_price_cents>0
      and exists(select 1 from public.tournaments tour
        join public.club_payment_policies p on p.club_id=tour.club_id
        where tour.id=t.tournament_id and tour.club_id=new.club_id
          and p.tournament_confirmation='payment_required');
  return new;
end;
$$;
revoke all on function public.confirm_manual_tournament_registration() from public,anon,authenticated;
create trigger confirm_manual_tournament_registration
after insert on public.tournament_manual_receipts
for each row execute function public.confirm_manual_tournament_registration();
