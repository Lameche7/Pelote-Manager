begin;

alter table public.licence_campaigns
add column if not exists payment_mode text not null default 'test';

alter table public.licence_campaigns
drop constraint if exists licence_campaigns_payment_mode_check;

alter table public.licence_campaigns
add constraint licence_campaigns_payment_mode_check
check (payment_mode in ('test', 'helloasso'));

create or replace function public.get_licence_payment_mode(
  target_payment_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
  mode_value text;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if target_payment_id is not null then
    select campaign.payment_mode
    into mode_value
    from public.payments payment
    join public.licence_requests request
      on request.id = payment.licence_request_id
    join public.licence_campaigns campaign
      on campaign.id = request.campaign_id
    where payment.id = target_payment_id
      and payment.payment_context = 'licence'
      and request.profile_id = actor_id
    limit 1;

    if mode_value is null then
      raise exception 'Paiement de licence introuvable' using errcode = 'P0002';
    end if;

    return mode_value;
  end if;

  select member.club_id
  into target_club_id
  from public.profiles profile
  left join public.club_members member on member.id = profile.member_id
  where profile.id = actor_id;

  if target_club_id is null then
    select club.id
    into target_club_id
    from public.clubs club
    order by club.created_at
    limit 1;
  end if;

  select campaign.payment_mode
  into mode_value
  from public.licence_campaigns campaign
  join public.club_seasons season on season.id = campaign.club_season_id
  where campaign.club_id = target_club_id
  order by
    case
      when campaign.is_open
        and (campaign.opens_at is null or campaign.opens_at <= now())
        and (campaign.closes_at is null or campaign.closes_at >= now())
      then 0
      else 1
    end,
    season.starts_on desc,
    campaign.created_at desc
  limit 1;

  return coalesce(mode_value, 'test');
end;
$$;

revoke all on function public.get_licence_payment_mode(uuid)
from public, anon, authenticated;
grant execute on function public.get_licence_payment_mode(uuid)
to authenticated;

create or replace function public.admin_get_licence_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  club_id_value uuid := public.admin_current_club_id();
begin
  if not public.has_club_permission(club_id_value, 'members.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'clubId', club_id_value,
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', season.id,
        'name', season.name,
        'startsOn', season.starts_on,
        'endsOn', season.ends_on,
        'isActive', season.is_active
      ) order by season.starts_on desc)
      from public.club_seasons season
      where season.club_id = club_id_value
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', campaign.id,
        'seasonId', campaign.club_season_id,
        'isOpen', campaign.is_open,
        'opensAt', campaign.opens_at,
        'closesAt', campaign.closes_at,
        'renewalPriceCents', campaign.renewal_price_cents,
        'firstApplicationPriceCents', campaign.first_application_price_cents,
        'applicationFormPath', campaign.application_form_path,
        'instructions', campaign.instructions,
        'paymentMode', campaign.payment_mode,
        'updatedAt', campaign.updated_at
      ) order by season.starts_on desc)
      from public.licence_campaigns campaign
      join public.club_seasons season on season.id = campaign.club_season_id
      where campaign.club_id = club_id_value
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_licence_settings()
from public, anon, authenticated;
grant execute on function public.admin_get_licence_settings()
to authenticated;

create function public.admin_save_licence_campaign(
  target_season_id uuid,
  target_is_open boolean,
  target_renewal_price_cents integer,
  target_first_application_price_cents integer,
  target_opens_at timestamptz,
  target_closes_at timestamptz,
  target_application_form_path text,
  target_instructions text,
  target_payment_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  club_id_value uuid := public.admin_current_club_id();
  season_row public.club_seasons%rowtype;
  saved_id uuid;
begin
  if not public.has_club_permission(club_id_value, 'members.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select *
  into season_row
  from public.club_seasons
  where id = target_season_id
    and club_id = club_id_value;

  if season_row.id is null then
    raise exception 'Saison introuvable' using errcode = 'P0002';
  end if;

  if target_renewal_price_cents < 0
    or target_first_application_price_cents < 0 then
    raise exception 'Les tarifs ne peuvent pas être négatifs'
      using errcode = '22023';
  end if;

  if target_payment_mode not in ('test', 'helloasso') then
    raise exception 'Mode de paiement invalide' using errcode = '22023';
  end if;

  if target_is_open and (
    target_renewal_price_cents <= 0
    or target_first_application_price_cents <= 0
    or nullif(btrim(target_application_form_path), '') is null
  ) then
    raise exception 'Renseignez les deux tarifs et le formulaire avant d’ouvrir la campagne'
      using errcode = '22023';
  end if;

  if target_opens_at is not null
    and target_closes_at is not null
    and target_closes_at <= target_opens_at then
    raise exception 'La date de clôture doit être postérieure à l’ouverture'
      using errcode = '22023';
  end if;

  if target_is_open then
    update public.licence_campaigns
    set is_open = false,
        updated_at = now(),
        updated_by = auth.uid()
    where club_id = club_id_value
      and club_season_id <> target_season_id
      and is_open;
  end if;

  insert into public.licence_campaigns(
    club_id,
    club_season_id,
    is_open,
    opens_at,
    closes_at,
    renewal_price_cents,
    first_application_price_cents,
    application_form_path,
    instructions,
    payment_mode,
    created_by,
    updated_by
  ) values (
    club_id_value,
    target_season_id,
    target_is_open,
    target_opens_at,
    target_closes_at,
    target_renewal_price_cents,
    target_first_application_price_cents,
    nullif(btrim(target_application_form_path), ''),
    nullif(btrim(target_instructions), ''),
    target_payment_mode,
    auth.uid(),
    auth.uid()
  )
  on conflict(club_id, club_season_id) do update set
    is_open = excluded.is_open,
    opens_at = excluded.opens_at,
    closes_at = excluded.closes_at,
    renewal_price_cents = excluded.renewal_price_cents,
    first_application_price_cents = excluded.first_application_price_cents,
    application_form_path = excluded.application_form_path,
    instructions = excluded.instructions,
    payment_mode = excluded.payment_mode,
    updated_at = now(),
    updated_by = auth.uid()
  returning id into saved_id;

  return saved_id;
end;
$$;

revoke all on function public.admin_save_licence_campaign(
  uuid, boolean, integer, integer, timestamptz, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.admin_save_licence_campaign(
  uuid, boolean, integer, integer, timestamptz, timestamptz, text, text, text
) to authenticated;

create or replace function public.simulate_licence_payment(
  target_payment_id uuid,
  simulated_outcome text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  payment_row public.payments%rowtype;
  request_row public.licence_requests%rowtype;
  final_status public.payment_status;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if simulated_outcome not in ('paid', 'failed', 'cancelled') then
    raise exception 'Résultat de simulation invalide' using errcode = '22023';
  end if;

  select payment.*
  into payment_row
  from public.payments payment
  join public.licence_requests request
    on request.id = payment.licence_request_id
  join public.licence_campaigns campaign
    on campaign.id = request.campaign_id
  where payment.id = target_payment_id
    and payment.payment_context = 'licence'
    and payment.status = 'pending'
    and payment.provider_checkout_intent_id is null
    and request.profile_id = actor_id
    and request.status not in ('approved', 'licensed', 'cancelled')
    and campaign.payment_mode = 'test'
  for update of payment;

  if payment_row.id is null then
    raise exception 'Paiement simulable introuvable ou mode test désactivé'
      using errcode = 'P0002';
  end if;

  final_status := simulated_outcome::public.payment_status;

  update public.payments
  set status = final_status,
      paid_at = case
        when final_status = 'paid' then now()
        else paid_at
      end,
      failure_reason = case
        when final_status = 'failed' then 'Paiement refusé en mode test'
        when final_status = 'cancelled' then 'Paiement annulé en mode test'
        else null
      end,
      metadata = metadata || jsonb_build_object(
        'simulated', true,
        'outcome', simulated_outcome
      ),
      updated_at = now()
  where id = payment_row.id
  returning * into payment_row;

  select request.*
  into request_row
  from public.licence_requests request
  where request.id = payment_row.licence_request_id
  for update;

  update public.licence_requests
  set status = case
      when final_status = 'paid' and request_row.document_path is not null
        then 'ready_for_review'::public.licence_request_status
      when final_status = 'paid'
        then 'pending_documents'::public.licence_request_status
      when request_row.document_path is not null
        then 'pending_payment'::public.licence_request_status
      else 'pending_documents'::public.licence_request_status
    end,
    updated_at = now()
  where id = request_row.id;

  return simulated_outcome;
end;
$$;

revoke all on function public.simulate_licence_payment(uuid, text)
from public, anon, authenticated;
grant execute on function public.simulate_licence_payment(uuid, text)
to authenticated;

commit;
