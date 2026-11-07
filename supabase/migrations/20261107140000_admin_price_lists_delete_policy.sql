-- Allow approved administrators to remove only managed price-list PDFs through
-- the Storage API. This policy does not grant UPDATE or access to other paths.

begin;

create policy "approved admins can delete price lists"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'admin-price-lists'
  and name ~ '^price-lists/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  and (select private.is_current_user_admin())
);

commit;
