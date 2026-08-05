-- À exécuter uniquement dans le projet Supabase CENTRAL de Pelote Manager,
-- après la création manuelle du compte Auth du propriétaire de la plateforme.

do $$
declare
  platform_admin_email constant text := 'A_REMPLACER_PAR_EMAIL_SUPER_ADMIN';
  platform_admin_user_id uuid;
begin
  if platform_admin_email = 'A_REMPLACER_PAR_EMAIL_SUPER_ADMIN' then
    raise exception 'Remplacez platform_admin_email avant exécution';
  end if;

  select users.id
  into platform_admin_user_id
  from auth.users as users
  where lower(users.email) = lower(platform_admin_email)
  order by users.created_at
  limit 1;

  if platform_admin_user_id is null then
    raise exception 'Compte Auth introuvable pour %', platform_admin_email;
  end if;

  insert into public.platform_admins (
    user_id,
    is_active,
    created_by
  ) values (
    platform_admin_user_id,
    true,
    platform_admin_user_id
  )
  on conflict (user_id) do update
  set is_active = true;
end;
$$;
