-- Allow club-affiliated Pilotoki accounts to volunteer as referees without an active licence.
-- Applies equally to championship and tournament matches; never grants access to other clubs.
create or replace function public.volunteer_for_refereeing(
 target_source_type text, target_match_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
 s record;
 actor uuid := auth.uid();
begin
 if actor is null then
   raise exception 'Connexion requise' using errcode = '42501';
 end if;
 select * into s from public.refereeing_current_match_slot(target_source_type,target_match_id);
 if not found or not (
   exists (
     select 1 from public.club_memberships cm
     where cm.profile_id = actor and cm.club_id = s.club_id
   )
   or exists (
     select 1 from public.profiles p
     join public.club_members m on m.sport_player_id = p.sport_player_id
     where p.id = actor and p.sport_player_id is not null
       and m.club_id = s.club_id and m.is_active
   )
 ) then
   raise exception 'Arbitrage non disponible pour ce club' using errcode = '42501';
 end if;
 insert into public.referee_slot_assignments
   (club_id,resource_id,starts_at,ends_at,referee_profile_id,assigned_by)
 values (s.club_id,s.resource_id,s.starts_at,s.ends_at,actor,actor);
exception when unique_violation then
 raise exception 'Ce créneau possède déjà un arbitre.';
end $$;
revoke all on function public.volunteer_for_refereeing(text,uuid) from public,anon;
grant execute on function public.volunteer_for_refereeing(text,uuid) to authenticated;

-- Administrators may also assign club-affiliated volunteers who no longer hold a licence.
create or replace function public.admin_set_referee(
 target_source_type text,target_match_id uuid,target_profile_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare s record; current_club uuid := public.admin_current_club_id();
begin
 if auth.uid() is null or current_club is null
 or not public.has_club_permission(current_club,'championships.manage')
 then raise exception 'Accès refusé' using errcode='42501'; end if;
 select * into s from public.refereeing_current_match_slot(target_source_type,target_match_id);
 if not found or s.club_id <> current_club then
   raise exception 'Partie extérieure ou sans créneau' using errcode='42501';
 end if;
 if target_profile_id is not null and not (
   exists (
     select 1 from public.club_memberships cm
     where cm.profile_id = target_profile_id and cm.club_id = current_club
   )
   or exists (
     select 1 from public.profiles p
     join public.club_members m on m.sport_player_id = p.sport_player_id
     where p.id = target_profile_id and p.sport_player_id is not null
       and m.club_id = current_club and m.is_active
   )
 ) then raise exception 'Membre non disponible'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.resource_id::text||s.starts_at::text,0));
 if target_profile_id is null then
   delete from public.referee_slot_assignments a
   where a.resource_id=s.resource_id and a.starts_at=s.starts_at and a.club_id=s.club_id;
 else
   insert into public.referee_slot_assignments
     (club_id,resource_id,starts_at,ends_at,referee_profile_id,assigned_by,assigned_at)
   values(s.club_id,s.resource_id,s.starts_at,s.ends_at,target_profile_id,auth.uid(),now())
   on conflict (resource_id,starts_at) do update
   set referee_profile_id=excluded.referee_profile_id,
       assigned_by=excluded.assigned_by,assigned_at=now(),updated_at=now()
   where public.referee_slot_assignments.club_id=excluded.club_id
     and public.referee_slot_assignments.ends_at=excluded.ends_at;
   if not found then raise exception 'Conflit de créneau'; end if;
 end if;
end $$;
revoke all on function public.admin_set_referee(text,uuid,uuid) from public,anon;
grant execute on function public.admin_set_referee(text,uuid,uuid) to authenticated;
