-- Read-only recipient lookup for an administrator preparing reschedule reminder emails.
-- Return only pending approvers of currently active requests for the admin's club.
create or replace function public.admin_list_pending_reschedule_email_recipients()
returns table(request_id uuid, team_id uuid, email text)
language sql stable security definer
set search_path = ''
as $$
  select distinct
    r.id as request_id,
    a.team_id,
    lower(btrim(coalesce(
      nullif(btrim(tp.email), ''),
      nullif(btrim(cm.email), ''),
      nullif(btrim(p.email), '')
    ))) as email
  from public.tournament_reschedule_requests r
  join public.tournaments t on t.id = r.tournament_id
  join public.tournament_reschedule_approvals a
    on a.request_id = r.id
  join public.tournament_team_players tp
    on tp.team_id = a.team_id and tp.tournament_id = r.tournament_id
  left join public.club_members cm on cm.id = tp.member_id and cm.club_id = t.club_id
  left join public.profiles p on p.member_id = cm.id
  where t.club_id = public.admin_current_club_id()
    and public.has_club_permission(t.club_id, 'tournaments.manage')
    and r.status = 'pending'
    and r.expires_at > now()
    and a.decision = 'pending'
    and not a.is_requester
    and coalesce(nullif(btrim(tp.email), ''),nullif(btrim(cm.email), ''),nullif(btrim(p.email), '')) is not null;
$$;

revoke all on function public.admin_list_pending_reschedule_email_recipients() from public, anon;
grant execute on function public.admin_list_pending_reschedule_email_recipients() to authenticated;
