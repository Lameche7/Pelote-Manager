begin;

revoke all on function public.profile_club_member_id(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.profile_club_member_id(uuid, uuid)
  to authenticated;

commit;
