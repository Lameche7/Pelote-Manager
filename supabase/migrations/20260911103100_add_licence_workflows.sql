begin;

create or replace function public.get_my_licence_portal()
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
  target_club_id uuid;
  campaign_row public.licence_campaigns%rowtype;
  season_row public.club_seasons%rowtype;
  request_row public.licence_requests%rowtype;
  payment_row public.payments%rowtype;
  licensed_for_campaign boolean := false;
begin
  if actor_id is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  select * into profile_row from public.profiles where id = actor_id;
  if profile_row.id is null then raise exception 'Profil introuvable' using errcode = 'P0002'; end if;

  if profile_row.member_id is not null then
    select * into member_row from public.club_members where id = profile_row.member_id;
    target_club_id := member_row.club_id;
  else
    select club.id into target_club_id from public.clubs club order by club.created_at limit 1;
  end if;

  if target_club_id is null then
    return jsonb_build_object('campaign', null, 'request', null, 'member', null, 'recommendedType', 'first_application');
  end if;

  select campaign.* into campaign_row
  from public.licence_campaigns campaign
  join public.club_seasons season on season.id = campaign.club_season_id
  where campaign.club_id = target_club_id
  order by
    case when campaign.is_open
      and (campaign.opens_at is null or campaign.opens_at <= now())
      and (campaign.closes_at is null or campaign.closes_at >= now())
      then 0 else 1 end,
    season.starts_on desc,
    campaign.created_at desc
  limit 1;

  if campaign_row.id is null then
    return jsonb_build_object(
      'campaign', null,
      'request', null,
      'member', case when member_row.id is null then null else jsonb_build_object(
        'id', member_row.id,
        'licenceNumber', member_row.licence_number,
        'firstName', member_row.first_name,
        'lastName', member_row.last_name
      ) end,
      'recommendedType', case when member_row.id is null then 'first_application' else 'renewal' end
    );
  end if;

  select * into season_row from public.club_seasons where id = campaign_row.club_season_id;

  if member_row.id is not null then
    select coalesce(member_season.is_licensed, false)
    into licensed_for_campaign
    from public.club_member_seasons member_season
    where member_season.club_member_id = member_row.id
      and member_season.club_season_id = campaign_row.club_season_id;
    licensed_for_campaign := coalesce(licensed_for_campaign, false);
  end if;

  select * into request_row
  from public.licence_requests request
  where request.campaign_id = campaign_row.id and request.profile_id = actor_id
  limit 1;

  if request_row.id is not null then
    select * into payment_row
    from public.payments payment
    where payment.licence_request_id = request_row.id
    order by
      case when payment.status = 'paid' then 0
           when payment.status in ('pending', 'authorized') then 1
           else 2 end,
      payment.created_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'campaign', jsonb_build_object(
      'id', campaign_row.id,
      'clubId', campaign_row.club_id,
      'seasonId', campaign_row.club_season_id,
      'seasonName', season_row.name,
      'isOpen', campaign_row.is_open
        and (campaign_row.opens_at is null or campaign_row.opens_at <= now())
        and (campaign_row.closes_at is null or campaign_row.closes_at >= now()),
      'opensAt', campaign_row.opens_at,
      'closesAt', campaign_row.closes_at,
      'renewalPriceCents', campaign_row.renewal_price_cents,
      'firstApplicationPriceCents', campaign_row.first_application_price_cents,
      'applicationFormPath', campaign_row.application_form_path,
      'instructions', campaign_row.instructions
    ),
    'member', case when member_row.id is null then null else jsonb_build_object(
      'id', member_row.id,
      'licenceNumber', member_row.licence_number,
      'firstName', member_row.first_name,
      'lastName', member_row.last_name
    ) end,
    'licensedForCampaign', licensed_for_campaign,
    'recommendedType', case when member_row.id is null then 'first_application' else 'renewal' end,
    'request', case when request_row.id is null then null else jsonb_build_object(
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
      'payment', case when payment_row.id is null then null else jsonb_build_object(
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
revoke all on function public.get_my_licence_portal() from public, anon, authenticated;
grant execute on function public.get_my_licence_portal() to authenticated;

create or replace function public.start_my_licence_request(payload jsonb default '{}'::jsonb)
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
  target_club_id uuid;
  request_kind public.licence_request_type;
  request_amount integer;
  saved_request_id uuid;
  first_name_value text;
  last_name_value text;
  birth_date_value date;
  gender_value text;
  phone_value text;
begin
  if actor_id is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  select * into profile_row from public.profiles where id = actor_id;
  if profile_row.id is null then raise exception 'Profil introuvable' using errcode = 'P0002'; end if;

  if profile_row.member_id is not null then
    select * into member_row from public.club_members where id = profile_row.member_id and is_active;
    target_club_id := member_row.club_id;
  else
    select club.id into target_club_id from public.clubs club order by club.created_at limit 1;
  end if;

  select campaign.* into campaign_row
  from public.licence_campaigns campaign
  join public.club_seasons season on season.id = campaign.club_season_id
  where campaign.club_id = target_club_id
    and campaign.is_open
    and (campaign.opens_at is null or campaign.opens_at <= now())
    and (campaign.closes_at is null or campaign.closes_at >= now())
  order by season.starts_on desc, campaign.created_at desc
  limit 1;
  if campaign_row.id is null then raise exception 'Aucune campagne de licence ouverte' using errcode = 'P0002'; end if;

  select request.id into saved_request_id
  from public.licence_requests request
  where request.campaign_id = campaign_row.id and request.profile_id = actor_id;
  if saved_request_id is not null then return saved_request_id; end if;

  if member_row.id is not null then
    if exists (
      select 1 from public.club_member_seasons member_season
      where member_season.club_member_id = member_row.id
        and member_season.club_season_id = campaign_row.club_season_id
        and member_season.is_licensed
    ) then
      raise exception 'Votre licence est déjà valide pour cette saison' using errcode = 'P0001';
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
      raise exception 'Le formulaire de première licence n’est pas encore disponible' using errcode = 'P0001';
    end if;
    first_name_value := coalesce(nullif(btrim(payload->>'firstName'), ''), nullif(btrim(profile_row.first_name), ''));
    last_name_value := coalesce(nullif(btrim(payload->>'lastName'), ''), nullif(btrim(profile_row.last_name), ''));
    birth_date_value := nullif(payload->>'birthDate', '')::date;
    gender_value := nullif(payload->>'gender', '');
    phone_value := nullif(btrim(payload->>'phone'), '');
    if first_name_value is null or last_name_value is null or birth_date_value is null or gender_value not in ('male', 'female') then
      raise exception 'Nom, prénom, date de naissance et sexe sont obligatoires' using errcode = '22023';
    end if;
  end if;

  if request_amount <= 0 then raise exception 'Le tarif de licence n’est pas configuré' using errcode = 'P0001'; end if;

  insert into public.licence_requests (
    campaign_id, club_id, club_season_id, profile_id, club_member_id,
    request_type, status, amount_cents, first_name, last_name,
    birth_date, gender, email, phone
  ) values (
    campaign_row.id, campaign_row.club_id, campaign_row.club_season_id,
    actor_id, member_row.id, request_kind, 'pending_documents', request_amount,
    first_name_value, last_name_value, birth_date_value, gender_value,
    profile_row.email, phone_value
  ) returning id into saved_request_id;

  return saved_request_id;
end;
$$;
revoke all on function public.start_my_licence_request(jsonb) from public, anon, authenticated;
grant execute on function public.start_my_licence_request(jsonb) to authenticated;

create or replace function public.attach_my_licence_document(
  target_request_id uuid,
  target_path text,
  original_name text,
  mime_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.licence_requests%rowtype;
  has_paid boolean;
begin
  if actor_id is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  select * into request_row from public.licence_requests
  where id = target_request_id and profile_id = actor_id for update;
  if request_row.id is null then raise exception 'Demande introuvable' using errcode='P0002'; end if;
  if request_row.status in ('approved','licensed','cancelled') then raise exception 'Cette demande ne peut plus être modifiée' using errcode='P0001'; end if;
  if target_path <> format('requests/%s/%s/document', actor_id, target_request_id) then raise exception 'Chemin de document invalide' using errcode='22023'; end if;
  if mime_type not in ('application/pdf','image/jpeg','image/png','image/webp') then raise exception 'Format de document non pris en charge' using errcode='22023'; end if;
  select exists(select 1 from public.payments payment where payment.licence_request_id=target_request_id and payment.status='paid') into has_paid;
  update public.licence_requests set
    document_path = target_path,
    document_original_name = nullif(btrim(original_name),''),
    document_mime_type = mime_type,
    document_uploaded_at = now(),
    rejection_reason = null,
    status = case when has_paid then 'ready_for_review'::public.licence_request_status else 'pending_payment'::public.licence_request_status end,
    updated_at = now()
  where id = target_request_id;
end;
$$;
revoke all on function public.attach_my_licence_document(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.attach_my_licence_document(uuid,text,text,text) to authenticated;

create or replace function public.prepare_my_licence_payment(target_request_id uuid)
returns table(
  payment_id uuid,
  status public.payment_status,
  amount_cents integer,
  currency text,
  redirect_url text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid:=auth.uid();
  request_row public.licence_requests%rowtype;
  payment_row public.payments%rowtype;
begin
  if actor_id is null then raise exception 'Connexion requise' using errcode='42501'; end if;
  select * into request_row from public.licence_requests
  where id=target_request_id and profile_id=actor_id for update;
  if request_row.id is null then raise exception 'Demande introuvable' using errcode='P0002'; end if;
  if request_row.status in ('approved','licensed','cancelled') then raise exception 'Le paiement n’est plus disponible pour cette demande' using errcode='P0001'; end if;

  select * into payment_row from public.payments payment
  where payment.licence_request_id=target_request_id and payment.status='paid'
  order by payment.created_at desc limit 1;
  if payment_row.id is not null then
    return query select payment_row.id,payment_row.status,payment_row.amount_cents,payment_row.currency,payment_row.redirect_url,payment_row.expires_at;
    return;
  end if;

  update public.payments payment set status='expired',updated_at=now()
  where payment.licence_request_id=target_request_id
    and payment.status in ('pending','authorized')
    and payment.expires_at<=now();

  select * into payment_row from public.payments payment
  where payment.licence_request_id=target_request_id
    and payment.status in ('pending','authorized')
    and payment.expires_at>now()
  order by payment.created_at desc limit 1;

  if payment_row.id is null then
    insert into public.payments(
      reservation_id, licence_request_id, payment_context, payer_profile_id,
      amount_cents, currency, expires_at, metadata
    ) values (
      null, target_request_id, 'licence', actor_id,
      request_row.amount_cents, 'EUR', now()+interval '45 minutes',
      jsonb_build_object(
        'licence_request_id',target_request_id,
        'payment_context','licence',
        'request_type',request_row.request_type,
        'club_season_id',request_row.club_season_id
      )
    ) returning * into payment_row;
  end if;

  return query select payment_row.id,payment_row.status,payment_row.amount_cents,payment_row.currency,payment_row.redirect_url,payment_row.expires_at;
end;
$$;
revoke all on function public.prepare_my_licence_payment(uuid) from public,anon,authenticated;
grant execute on function public.prepare_my_licence_payment(uuid) to authenticated;

create or replace function public.admin_get_licence_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare club_id_value uuid:=public.admin_current_club_id();
begin
  if not public.has_club_permission(club_id_value,'members.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
  return jsonb_build_object(
    'clubId',club_id_value,
    'seasons',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',season.id,'name',season.name,'startsOn',season.starts_on,
        'endsOn',season.ends_on,'isActive',season.is_active
      ) order by season.starts_on desc)
      from public.club_seasons season where season.club_id=club_id_value
    ),'[]'::jsonb),
    'campaigns',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',campaign.id,'seasonId',campaign.club_season_id,'isOpen',campaign.is_open,
        'opensAt',campaign.opens_at,'closesAt',campaign.closes_at,
        'renewalPriceCents',campaign.renewal_price_cents,
        'firstApplicationPriceCents',campaign.first_application_price_cents,
        'applicationFormPath',campaign.application_form_path,
        'instructions',campaign.instructions,'updatedAt',campaign.updated_at
      ) order by season.starts_on desc)
      from public.licence_campaigns campaign
      join public.club_seasons season on season.id=campaign.club_season_id
      where campaign.club_id=club_id_value
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_get_licence_settings() from public,anon,authenticated;
grant execute on function public.admin_get_licence_settings() to authenticated;

create or replace function public.admin_save_licence_campaign(
  target_season_id uuid,
  target_is_open boolean,
  target_renewal_price_cents integer,
  target_first_application_price_cents integer,
  target_opens_at timestamptz default null,
  target_closes_at timestamptz default null,
  target_application_form_path text default null,
  target_instructions text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  club_id_value uuid:=public.admin_current_club_id();
  season_row public.club_seasons%rowtype;
  saved_id uuid;
begin
  if not public.has_club_permission(club_id_value,'members.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into season_row from public.club_seasons where id=target_season_id and club_id=club_id_value;
  if season_row.id is null then raise exception 'Saison introuvable' using errcode='P0002'; end if;
  if target_renewal_price_cents<0 or target_first_application_price_cents<0 then raise exception 'Les tarifs ne peuvent pas être négatifs' using errcode='22023'; end if;
  if target_is_open and (
    target_renewal_price_cents<=0
    or target_first_application_price_cents<=0
    or nullif(btrim(target_application_form_path),'') is null
  ) then raise exception 'Renseignez les deux tarifs et le formulaire avant d’ouvrir la campagne' using errcode='22023'; end if;
  if target_opens_at is not null and target_closes_at is not null and target_closes_at<=target_opens_at then raise exception 'La date de clôture doit être postérieure à l’ouverture' using errcode='22023'; end if;
  if target_is_open then
    update public.licence_campaigns set is_open=false,updated_at=now(),updated_by=auth.uid()
    where club_id=club_id_value and club_season_id<>target_season_id and is_open;
  end if;
  insert into public.licence_campaigns(
    club_id,club_season_id,is_open,opens_at,closes_at,
    renewal_price_cents,first_application_price_cents,
    application_form_path,instructions,created_by,updated_by
  ) values (
    club_id_value,target_season_id,target_is_open,target_opens_at,target_closes_at,
    target_renewal_price_cents,target_first_application_price_cents,
    nullif(btrim(target_application_form_path),''),nullif(btrim(target_instructions),''),
    auth.uid(),auth.uid()
  )
  on conflict(club_id,club_season_id) do update set
    is_open=excluded.is_open,
    opens_at=excluded.opens_at,
    closes_at=excluded.closes_at,
    renewal_price_cents=excluded.renewal_price_cents,
    first_application_price_cents=excluded.first_application_price_cents,
    application_form_path=excluded.application_form_path,
    instructions=excluded.instructions,
    updated_at=now(),
    updated_by=auth.uid()
  returning id into saved_id;
  return saved_id;
end;
$$;
revoke all on function public.admin_save_licence_campaign(uuid,boolean,integer,integer,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.admin_save_licence_campaign(uuid,boolean,integer,integer,timestamptz,timestamptz,text,text) to authenticated;

create or replace function public.admin_list_licence_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare club_id_value uuid:=public.admin_current_club_id();
begin
  if not public.has_club_permission(club_id_value,'members.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',request.id,
      'campaignId',request.campaign_id,
      'seasonId',request.club_season_id,
      'seasonName',season.name,
      'profileId',request.profile_id,
      'memberId',request.club_member_id,
      'type',request.request_type,
      'status',request.status,
      'amountCents',request.amount_cents,
      'firstName',request.first_name,
      'lastName',request.last_name,
      'birthDate',request.birth_date,
      'gender',request.gender,
      'email',request.email,
      'phone',request.phone,
      'licenceNumber',member.licence_number,
      'documentPath',request.document_path,
      'documentOriginalName',request.document_original_name,
      'documentUploadedAt',request.document_uploaded_at,
      'rejectionReason',request.rejection_reason,
      'createdAt',request.created_at,
      'paymentStatus',payment.status,
      'paidAt',payment.paid_at
    ) order by request.created_at desc)
    from public.licence_requests request
    join public.club_seasons season on season.id=request.club_season_id
    left join public.club_members member on member.id=request.club_member_id
    left join lateral (
      select p.status,p.paid_at from public.payments p
      where p.licence_request_id=request.id
      order by case when p.status='paid' then 0 else 1 end,p.created_at desc
      limit 1
    ) payment on true
    where request.club_id=club_id_value
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_licence_requests() from public,anon,authenticated;
grant execute on function public.admin_list_licence_requests() to authenticated;

create or replace function public.admin_review_licence_request(
  target_request_id uuid,
  target_action text,
  target_reason text default null,
  target_licence_number text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  request_row public.licence_requests%rowtype;
  season_row public.club_seasons%rowtype;
  member_row public.club_members%rowtype;
  created_member_id uuid;
  payment_is_paid boolean;
begin
  select * into request_row from public.licence_requests where id=target_request_id for update;
  if request_row.id is null or not public.has_club_permission(request_row.club_id,'members.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into season_row from public.club_seasons where id=request_row.club_season_id;
  select exists(select 1 from public.payments payment where payment.licence_request_id=request_row.id and payment.status='paid') into payment_is_paid;

  if target_action='reject' then
    if nullif(btrim(target_reason),'') is null then raise exception 'Indiquez la raison du refus du document' using errcode='22023'; end if;
    update public.licence_requests set status='document_rejected',rejection_reason=btrim(target_reason),reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now() where id=request_row.id;
    return;
  end if;

  if target_action='approve' then
    if request_row.document_path is null or not payment_is_paid then raise exception 'Le document et le paiement doivent être reçus avant validation' using errcode='P0001'; end if;
    update public.licence_requests set status='approved',rejection_reason=null,reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now() where id=request_row.id;
    return;
  end if;

  if target_action='mark_licensed' then
    if request_row.status<>'approved' then raise exception 'Le dossier doit être validé avant de confirmer la licence' using errcode='P0001'; end if;
    if request_row.request_type='renewal' then
      select * into member_row from public.club_members
      where id=request_row.club_member_id and club_id=request_row.club_id for update;
      if member_row.id is null then raise exception 'Licencié introuvable' using errcode='P0002'; end if;
      insert into public.club_member_seasons(
        club_member_id,club_id,club_season_id,ranking,category,is_licensed,created_by,updated_by
      ) values (
        member_row.id,member_row.club_id,season_row.id,null,
        public.member_category(member_row.birth_date,season_row.ends_on),true,auth.uid(),auth.uid()
      )
      on conflict(club_member_id,club_season_id) do update set
        is_licensed=true,category=excluded.category,updated_at=now(),updated_by=auth.uid();
      insert into public.club_member_audit_log(
        club_member_id,club_id,club_season_id,author_id,action,after_values,reason
      ) values (
        member_row.id,member_row.club_id,season_row.id,auth.uid(),'licence_renewed_online',
        jsonb_build_object('licence_request_id',request_row.id),
        'Dossier de renouvellement validé dans Pelote Manager'
      );
      created_member_id:=member_row.id;
    else
      if nullif(btrim(target_licence_number),'') is null then raise exception 'Le numéro de licence attribué par la FFPB est obligatoire' using errcode='22023'; end if;
      if request_row.birth_date is null or request_row.gender not in ('male','female') then raise exception 'Identité incomplète pour créer le licencié' using errcode='22023'; end if;
      if exists(
        select 1 from public.club_members member
        where member.licence_number_normalized=public.normalize_member_licence(target_licence_number)
      ) then raise exception 'Ce numéro de licence existe déjà' using errcode='23505'; end if;
      insert into public.club_members(
        club_id,licence_number,last_name,first_name,birth_date,gender,email,phone,is_active
      ) values (
        request_row.club_id,btrim(target_licence_number),request_row.last_name,
        request_row.first_name,request_row.birth_date,request_row.gender,
        request_row.email,request_row.phone,true
      ) returning id into created_member_id;
      insert into public.club_member_seasons(
        club_member_id,club_id,club_season_id,ranking,category,is_licensed,created_by,updated_by
      ) values (
        created_member_id,request_row.club_id,season_row.id,null,
        public.member_category(request_row.birth_date,season_row.ends_on),true,auth.uid(),auth.uid()
      );
      perform set_config('app.allow_profile_member_link','on',true);
      update public.profiles set member_id=created_member_id,updated_at=now()
      where id=request_row.profile_id and member_id is null;
      if not found then raise exception 'Ce compte est déjà rattaché à une autre licence' using errcode='23505'; end if;
      insert into public.club_member_audit_log(
        club_member_id,club_id,club_season_id,author_id,action,after_values,reason
      ) values (
        created_member_id,request_row.club_id,season_row.id,auth.uid(),'first_licence_created_online',
        jsonb_build_object('licence_request_id',request_row.id),
        'Première demande de licence validée dans Pelote Manager'
      );
    end if;
    update public.licence_requests set club_member_id=created_member_id,status='licensed',licensed_at=now(),licensed_by=auth.uid(),updated_at=now() where id=request_row.id;
    return;
  end if;

  raise exception 'Action inconnue' using errcode='22023';
end;
$$;
revoke all on function public.admin_review_licence_request(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_review_licence_request(uuid,text,text,text) to authenticated;

commit;
