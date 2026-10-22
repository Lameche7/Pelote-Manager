-- Self-service device management: only the signed-in owner can list or deactivate their endpoints.
create or replace function public.list_my_push_devices()
returns table(id uuid, endpoint text, user_agent text, platform text, created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select s.id,s.endpoint,s.user_agent,s.platform,s.created_at
 from public.push_subscriptions s
 where s.profile_id=auth.uid() and s.is_active and auth.uid() is not null
 order by s.created_at desc
$$;
revoke all on function public.list_my_push_devices() from public,anon;
grant execute on function public.list_my_push_devices() to authenticated;

create or replace function public.deactivate_my_push_device(target_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501'; end if;
 update public.push_subscriptions set is_active=false,updated_at=now()
 where id=target_id and profile_id=auth.uid();
end $$;
revoke all on function public.deactivate_my_push_device(uuid) from public,anon;
grant execute on function public.deactivate_my_push_device(uuid) to authenticated;
