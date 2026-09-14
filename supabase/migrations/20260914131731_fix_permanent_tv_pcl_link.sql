update public.club_tv_settings as settings
set public_token = '08008b4d-9825-487d-a156-8e69f7b8aaca'::uuid,
    updated_at = now(),
    updated_by = null
from public.clubs as clubs
where settings.club_id = clubs.id
  and clubs.slug = 'pelotaris-club-lourdais';

revoke execute on function public.admin_rotate_tv_token() from authenticated;
