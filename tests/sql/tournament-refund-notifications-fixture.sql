-- Minimal communication pipeline fixture, no real notification delivery.
create type public.communication_email_status as enum ('unavailable','not_configured');
create table public.club_communications(
 id uuid primary key default gen_random_uuid(),club_id uuid not null references public.clubs(id),
 title text not null,body text not null,priority text,status text,show_on_home boolean,
 expires_at timestamptz,created_by uuid,updated_by uuid,published_at timestamptz,updated_at timestamptz
);
create table public.communication_deliveries(
 communication_id uuid references public.club_communications(id),club_id uuid references public.clubs(id),
 club_member_id uuid references public.club_members(id),profile_id_at_publication uuid references public.profiles(id),
 email_snapshot text,email_status public.communication_email_status,
 primary key(communication_id,profile_id_at_publication)
);
create table public.communication_audit_log(
 club_id uuid references public.clubs(id),communication_id uuid references public.club_communications(id),
 action text,actor_id uuid,new_data jsonb
);
create or replace function public.profile_club_member_id(target_profile_id uuid,target_club_id uuid)
returns uuid language sql stable set search_path='' as $$
 select m.id from public.club_members m join public.profiles p
 on p.id=target_profile_id and (m.sport_player_id=p.sport_player_id or m.id=p.member_id)
 where m.club_id=target_club_id and m.is_active order by m.id limit 1
$$;
