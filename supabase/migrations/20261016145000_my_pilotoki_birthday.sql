-- Return only the signed-in player's birthday, never another member's date.
create or replace function public.my_pilotoki_birthday()
returns date language sql stable security definer set search_path = ''
as $$
  select coalesce(cm.birth_date, sp.birth_date)
  from public.profiles p
  left join public.club_members cm on cm.id = p.member_id
  left join public.sport_players sp on sp.id = coalesce(p.sport_player_id, cm.sport_player_id)
  where p.id = auth.uid()
  limit 1;
$$;
revoke all on function public.my_pilotoki_birthday() from public, anon;
grant execute on function public.my_pilotoki_birthday() to authenticated;
