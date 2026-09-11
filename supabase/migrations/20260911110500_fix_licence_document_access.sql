begin;

grant select on table public.licence_requests to authenticated;

drop policy if exists licence_requests_select_own_or_admin on public.licence_requests;
create policy licence_requests_select_own_or_admin
on public.licence_requests
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or public.has_club_permission(club_id, 'members.manage')
);

drop policy if exists licence_documents_player_select on storage.objects;
create policy licence_documents_player_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'licence-documents'
  and (
    (
      (storage.foldername(name))[1] = 'requests'
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and exists (
        select 1
        from public.licence_requests request
        where request.id::text = (storage.foldername(storage.objects.name))[3]
          and request.profile_id = (select auth.uid())
      )
    )
    or (storage.foldername(name))[1] = 'templates'
  )
);

drop policy if exists licence_documents_admin_select on storage.objects;
create policy licence_documents_admin_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'licence-documents'
  and (
    (
      (storage.foldername(name))[1] = 'requests'
      and exists (
        select 1
        from public.licence_requests request
        where request.document_path = storage.objects.name
          and public.has_club_permission(request.club_id, 'members.manage')
      )
    )
    or (
      (storage.foldername(name))[1] = 'templates'
      and case
        when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then public.has_club_permission(((storage.foldername(name))[2])::uuid, 'members.manage')
        else false
      end
    )
  )
);

drop policy if exists licence_documents_admin_insert on storage.objects;
create policy licence_documents_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'templates'
  and case
    when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_club_permission(((storage.foldername(name))[2])::uuid, 'members.manage')
    else false
  end
);

drop policy if exists licence_documents_admin_update on storage.objects;
create policy licence_documents_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'templates'
  and case
    when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_club_permission(((storage.foldername(name))[2])::uuid, 'members.manage')
    else false
  end
)
with check (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'templates'
  and case
    when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_club_permission(((storage.foldername(name))[2])::uuid, 'members.manage')
    else false
  end
);

drop policy if exists licence_documents_admin_delete on storage.objects;
create policy licence_documents_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'templates'
  and case
    when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.has_club_permission(((storage.foldername(name))[2])::uuid, 'members.manage')
    else false
  end
);

drop function if exists public.admin_create_next_licence_season();

commit;
