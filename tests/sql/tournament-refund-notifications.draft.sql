-- Draft: deliver financial notices only to the account that submitted the registration.
-- The existing club communications pipeline handles notification delivery.
create table public.tournament_refund_notification_events (
  refund_id uuid primary key references public.tournament_payment_refunds(id) on delete restrict,
  communication_id uuid references public.club_communications(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.tournament_refund_notification_events enable row level security;
revoke all on public.tournament_refund_notification_events from public,anon,authenticated;

create or replace function public.notify_tournament_refund_confirmed()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  recipient uuid;
  recipient_email text;
  tournament_name text;
  message_id uuid;
begin
  if new.status<>'succeeded' then return new; end if;
  if tg_op='UPDATE' then
    if old.status='succeeded' then return new; end if;
  end if;
  -- Never send financial information to a partner matched merely by name or email.
  select profile.id,nullif(btrim(profile.email),''),tr.name
    into recipient,recipient_email,tournament_name
  from public.tournament_teams t
  join public.tournaments tr on tr.id=t.tournament_id
  join public.profiles profile on profile.id=t.submitted_by
  where t.id=new.team_id and tr.id=new.tournament_id and tr.club_id=new.club_id;
  if recipient is null then return new; end if;

  insert into public.tournament_refund_notification_events(refund_id)
    values(new.id) on conflict(refund_id) do nothing;
  if not found then return new; end if;

  insert into public.club_communications(
    club_id,title,body,priority,status,show_on_home,expires_at,created_by,updated_by
  ) values(
    new.club_id,'Remboursement confirmé : '||tournament_name,
    'Un remboursement a été confirmé pour votre inscription. Retrouvez le détail dans votre espace tournoi.',
    'important','draft',false,now()+interval '30 days',new.requested_by,new.requested_by
  ) returning id into message_id;

  insert into public.communication_deliveries(
    communication_id,club_id,club_member_id,profile_id_at_publication,email_snapshot,email_status
  ) values(
    message_id,new.club_id,public.profile_club_member_id(recipient,new.club_id),recipient,recipient_email,
    case when recipient_email is null then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status end
  );

  update public.tournament_refund_notification_events set communication_id=message_id where refund_id=new.id;
  insert into public.communication_audit_log(club_id,communication_id,action,actor_id,new_data)
    values(new.club_id,message_id,'created',new.requested_by,
      jsonb_build_object('source','tournament_refund','refund_id',new.id));
  update public.club_communications set status='published',published_at=now(),updated_at=now()
    where id=message_id;
  insert into public.communication_audit_log(club_id,communication_id,action,actor_id,new_data)
    values(new.club_id,message_id,'published',new.requested_by,
      jsonb_build_object('source','tournament_refund','refund_id',new.id,'recipient_count',1));
  return new;
exception when others then
  -- A notification outage must not roll back a confirmed financial operation.
  raise warning 'Refund notification could not be published for % (SQLSTATE %)',new.id,sqlstate;
  return new;
end;
$$;
revoke all on function public.notify_tournament_refund_confirmed() from public,anon,authenticated;
create trigger tournament_refund_confirmed_notify
after insert or update of status on public.tournament_payment_refunds
for each row execute function public.notify_tournament_refund_confirmed();
