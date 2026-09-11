begin;

drop policy if exists licence_documents_admin_select on storage.objects;
create policy licence_documents_admin_select
on storage.objects for select to authenticated
using (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'templates'
  and exists (
    select 1 from public.clubs club
    where club.id::text = (storage.foldername(name))[2]
      and public.has_club_permission(club.id, 'members.manage')
  )
);

commit;
