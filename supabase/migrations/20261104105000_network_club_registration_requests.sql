-- Public expressions of interest. No club, account, invoice or payment is created.
-- Data is private until reviewed and manually transferred into the platform registry.
create table if not exists public.network_club_registration_requests (
  id uuid primary key default gen_random_uuid(),
  club_name text not null,
  city text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  requested_plan text not null
    check (requested_plan in ('essentiel', 'club', 'premium')),
  status text not null default 'pending'
    check (status in ('pending', 'contacted', 'approved', 'rejected')),
  accepted_privacy_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists network_club_registration_requests_email_created_idx
  on public.network_club_registration_requests (contact_email, created_at desc);
alter table public.network_club_registration_requests enable row level security;
revoke all on public.network_club_registration_requests
  from public, anon, authenticated;

create or replace function public.submit_network_club_registration_request(
  target_club_name text,
  target_city text,
  target_contact_name text,
  target_contact_email text,
  target_contact_phone text,
  target_plan text,
  target_privacy_accepted boolean,
  target_website text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_club text := btrim(coalesce(target_club_name, ''));
  clean_city text := btrim(coalesce(target_city, ''));
  clean_name text := btrim(coalesce(target_contact_name, ''));
  clean_email text := lower(btrim(coalesce(target_contact_email, '')));
  clean_phone text := nullif(btrim(coalesce(target_contact_phone, '')), '');
begin
  -- Invisible honeypot: quietly reject automated submissions.
  if nullif(btrim(coalesce(target_website, '')), '') is not null then
    return;
  end if;

  if target_privacy_accepted is distinct from true
    or char_length(clean_club) not between 3 and 120
    or char_length(clean_city) not between 2 and 100
    or char_length(clean_name) not between 3 and 120
    or char_length(clean_email) not between 6 and 254
    or clean_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
    or char_length(coalesce(clean_phone, '')) > 32
    or target_plan not in ('essentiel', 'club', 'premium') then
    raise exception 'Informations d’inscription invalides.' using errcode = '22023';
  end if;

  -- Serialise requests from the same address, including concurrent submissions.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(clean_email, 0)
  );

  if exists (
    select 1
    from public.network_club_registration_requests as request
    where request.contact_email = clean_email
      and request.created_at > now() - interval '24 hours'
  ) then
    raise exception 'Une demande a déjà été enregistrée pour cette adresse récemment.'
      using errcode = '23505';
  end if;

  insert into public.network_club_registration_requests(
    club_name,city,contact_name,contact_email,contact_phone,requested_plan
  ) values (
    clean_club,clean_city,clean_name,clean_email,clean_phone,target_plan
  );
end;
$$;
revoke all on function public.submit_network_club_registration_request(
  text,text,text,text,text,text,boolean,text
) from public, anon, authenticated;
grant execute on function public.submit_network_club_registration_request(
  text,text,text,text,text,text,boolean,text
) to anon, authenticated;
