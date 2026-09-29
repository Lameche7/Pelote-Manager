begin;

create or replace function public.list_my_licence_clubs()
returns table (
  club_id uuid,
  club_name text,
  member_id uuid,
  is_default boolean,
  campaign_id uuid,
  season_name text,
  campaign_is_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select profile.member_id
    from public.profiles as profile
    where profile.id = auth.uid()
  )
  select
    club.id,
    club.name,
    public.profile_club_member_id(auth.uid(), club.id) as member_id,
    public.profile_club_member_id(auth.uid(), club.id) = actor.member_id as is_default,
    campaign.id,
    season.name,
    (
      campaign.is_open
      and (campaign.opens_at is null or campaign.opens_at <= now())
      and (campaign.closes_at is null or campaign.closes_at >= now())
    ) as campaign_is_open
  from public.clubs as club
  join lateral (
    select licence_campaign.*
    from public.licence_campaigns as licence_campaign
    join public.club_seasons as club_season
      on club_season.id = licence_campaign.club_season_id
    where licence_campaign.club_id = club.id
    order by
      case
        when licence_campaign.is_open
          and (licence_campaign.opens_at is null or licence_campaign.opens_at <= now())
          and (licence_campaign.closes_at is null or licence_campaign.closes_at >= now())
        then 0 else 1
      end,
      club_season.starts_on desc,
      licence_campaign.created_at desc
    limit 1
  ) as campaign on true
  join public.club_seasons as season
    on season.id = campaign.club_season_id
  cross join actor
  order by
    (public.profile_club_member_id(auth.uid(), club.id) = actor.member_id) desc,
    (public.profile_club_member_id(auth.uid(), club.id) is not null) desc,
    club.name,
    club.id;
$$;

revoke all on function public.list_my_licence_clubs()
  from public, anon, authenticated;
grant execute on function public.list_my_licence_clubs()
  to authenticated;

create or replace function public.get_my_licence_portal_for_club(
  target_club_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  member_row public.club_members%rowtype;
  campaign_row public.licence_campaigns%rowtype;
  season_row public.club_seasons%rowtype;
  request_row public.licence_requests%rowtype;
  payment_row public.payments%rowtype;
  licensed_for_campaign boolean := false;
  target_member_id uuid;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if target_club_id is null
    or not exists (
      select 1 from public.clubs as club where club.id = target_club_id
    )
  then
    raise exception 'Club introuvable' using errcode = 'P0002';
  end if;

  select * into profile_row
  from public.profiles
  where id = actor_id;

  if profile_row.id is null then
    raise exception 'Profil introuvable' using errcode = 'P0002';
  end if;

  target_member_id := public.profile_club_member_id(actor_id, target_club_id);

  if target_member_id is not null then
    select *
    into member_row
    from public.club_members
    where id = target_member_id
      and club_id = target_club_id;
  end if;

  select campaign.*
  into campaign_row
  from public.licence_campaigns as campaign
  join public.club_seasons as season
    on season.id = campaign.club_season_id
  where campaign.club_id = target_club_id
  order by
    case
      when campaign.is_open
        and (campaign.opens_at is null or campaign.opens_at <= now())
        and (campaign.closes_at is null or campaign.closes_at >= now())
      then 0 else 1
    end,
    season.starts_on desc,
    campaign.created_at desc
  limit 1;

  if campaign_row.id is null then
    return jsonb_build_object(
      'clubId', target_club_id,
      'campaign', null,
      'request', null,
      'member',
        case when member_row.id is null then null
        else jsonb_build_object(
          'id', member_row.id,
          'licenceNumber', member_row.licence_number,
          'firstName', member_row.first_name,
          'lastName', member_row.last_name
        ) end,
      'recommendedType',
        case when member_row.id is null then 'first_application' else 'renewal' end
    );
  end if;

  select * into season_row
  from public.club_seasons
  where id = campaign_row.club_season_id;

  if member_row.id is not null then
    select coalesce(member_season.is_licensed, false)
    into licensed_for_campaign
    from public.club_member_seasons as member_season
    where member_season.club_member_id = member_row.id
      and member_season.club_season_id = campaign_row.club_season_id;

    licensed_for_campaign := coalesce(licensed_for_campaign, false);
  end if;

  select *
  into request_row
  from public.licence_requests as request
  where request.campaign_id = campaign_row.id
    and request.profile_id = actor_id
  limit 1;

  if request_row.id is not null then
    select *
    into payment_row
    from public.payments as payment
    where payment.licence_request_id = request_row.id
    order by
      case
        when payment.status = 'paid' then 0
        when payment.status in ('pending', 'authorized') then 1
        else 2
      end,
      payment.created_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'clubId', target_club_id,
    'campaign', jsonb_build_object(
      'id', campaign_row.id,
      'clubId', campaign_row.club_id,
      'seasonId', campaign_row.club_season_id,
      'seasonName', season_row.name,
      'isOpen',
        campaign_row.is_open
        and (campaign_row.opens_at is null or campaign_row.opens_at <= now())
        and (campaign_row.closes_at is null or campaign_row.closes_at >= now()),
      'opensAt', campaign_row.opens_at,
      'closesAt', campaign_row.closes_at,
      'renewalPriceCents', campaign_row.renewal_price_cents,
      'firstApplicationPriceCents', campaign_row.first_application_price_cents,
      'applicationFormPath', campaign_row.application_form_path,
      'instructions', campaign_row.instructions,
      'paymentMode', campaign_row.payment_mode
    ),
    'member',
      case when member_row.id is null then null
      else jsonb_build_object(
        'id', member_row.id,
        'licenceNumber', member_row.licence_number,
        'firstName', member_row.first_name,
        'lastName', member_row.last_name
      ) end,
    'licensedForCampaign', licensed_for_campaign,
    'recommendedType',
      case when member_row.id is null then 'first_application' else 'renewal' end,
    'request',
      case when request_row.id is null then null
      else jsonb_build_object(
        'id', request_row.id,
        'type', request_row.request_type,
        'status', request_row.status,
        'amountCents', request_row.amount_cents,
        'firstName', request_row.first_name,
        'lastName', request_row.last_name,
        'birthDate', request_row.birth_date,
        'gender', request_row.gender,
        'email', request_row.email,
        'phone', request_row.phone,
        'documentPath', request_row.document_path,
        'documentOriginalName', request_row.document_original_name,
        'documentUploadedAt', request_row.document_uploaded_at,
        'rejectionReason', request_row.rejection_reason,
        'createdAt', request_row.created_at,
        'payment',
          case when payment_row.id is null then null
          else jsonb_build_object(
            'id', payment_row.id,
            'status', payment_row.status,
            'amountCents', payment_row.amount_cents,
            'redirectUrl', payment_row.redirect_url,
            'paidAt', payment_row.paid_at,
            'expiresAt', payment_row.expires_at
          ) end
      ) end
  );
end;
$$;

revoke all on function public.get_my_licence_portal_for_club(uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_licence_portal_for_club(uuid)
  to authenticated;

create or replace function public.start_my_licence_request_for_club(
  target_club_id uuid,
  payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  member_row public.club_members%rowtype;
  campaign_row public.licence_campaigns%rowtype;
  request_kind public.licence_request_type;
  request_amount integer;
  saved_request_id uuid;
  first_name_value text;
  last_name_value text;
  birth_date_value date;
  gender_value text;
  phone_value text;
  target_member_id uuid;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if target_club_id is null
    or not exists (
      select 1 from public.clubs as club where club.id = target_club_id
    )
  then
    raise exception 'Club introuvable' using errcode = 'P0002';
  end if;

  select *
  into profile_row
  from public.profiles
  where id = actor_id;

  if profile_row.id is null then
    raise exception 'Profil introuvable' using errcode = 'P0002';
  end if;

  target_member_id := public.profile_club_member_id(actor_id, target_club_id);

  if target_member_id is not null then
    select *
    into member_row
    from public.club_members
    where id = target_member_id
      and club_id = target_club_id
      and is_active;
  end if;

  select campaign.*
  into campaign_row
  from public.licence_campaigns as campaign
  join public.club_seasons as season
    on season.id = campaign.club_season_id
  where campaign.club_id = target_club_id
    and campaign.is_open
    and (campaign.opens_at is null or campaign.opens_at <= now())
    and (campaign.closes_at is null or campaign.closes_at >= now())
  order by season.starts_on desc, campaign.created_at desc
  limit 1;

  if campaign_row.id is null then
    raise exception 'Aucune campagne de licence ouverte'
      using errcode = 'P0002';
  end if;

  select request.id
  into saved_request_id
  from public.licence_requests as request
  where request.campaign_id = campaign_row.id
    and request.profile_id = actor_id;

  if saved_request_id is not null then
    return saved_request_id;
  end if;

  if member_row.id is not null then
    if exists (
      select 1
      from public.club_member_seasons as member_season
      where member_season.club_member_id = member_row.id
        and member_season.club_season_id = campaign_row.club_season_id
        and member_season.is_licensed
    ) then
      raise exception 'Votre licence est déjà valide pour cette saison'
        using errcode = 'P0001';
    end if;

    request_kind := 'renewal';
    request_amount := campaign_row.renewal_price_cents;
    first_name_value := member_row.first_name;
    last_name_value := member_row.last_name;
    birth_date_value := member_row.birth_date;
    gender_value := member_row.gender;
    phone_value := member_row.phone;
  else
    request_kind := 'first_application';
    request_amount := campaign_row.first_application_price_cents;

    if nullif(btrim(campaign_row.application_form_path), '') is null then
      raise exception 'Le formulaire de première licence n’est pas encore disponible'
        using errcode = 'P0001';
    end if;

    first_name_value := coalesce(
      nullif(btrim(payload->>'firstName'), ''),
      nullif(btrim(profile_row.first_name), '')
    );
    last_name_value := coalesce(
      nullif(btrim(payload->>'lastName'), ''),
      nullif(btrim(profile_row.last_name), '')
    );
    birth_date_value := nullif(payload->>'birthDate', '')::date;
    gender_value := nullif(payload->>'gender', '');
    phone_value := nullif(btrim(payload->>'phone'), '');

    if first_name_value is null
      or last_name_value is null
      or birth_date_value is null
      or gender_value not in ('male', 'female')
    then
      raise exception 'Nom, prénom, date de naissance et sexe sont obligatoires'
        using errcode = '22023';
    end if;
  end if;

  if request_amount <= 0 then
    raise exception 'Le tarif de licence n’est pas configuré'
      using errcode = 'P0001';
  end if;

  insert into public.licence_requests (
    campaign_id,
    club_id,
    club_season_id,
    profile_id,
    club_member_id,
    request_type,
    status,
    amount_cents,
    first_name,
    last_name,
    birth_date,
    gender,
    email,
    phone
  )
  values (
    campaign_row.id,
    campaign_row.club_id,
    campaign_row.club_season_id,
    actor_id,
    member_row.id,
    request_kind,
    'pending_documents',
    request_amount,
    first_name_value,
    last_name_value,
    birth_date_value,
    gender_value,
    profile_row.email,
    phone_value
  )
  returning id into saved_request_id;

  return saved_request_id;
end;
$$;

revoke all on function public.start_my_licence_request_for_club(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_my_licence_request_for_club(uuid, jsonb)
  to authenticated;

commit;
