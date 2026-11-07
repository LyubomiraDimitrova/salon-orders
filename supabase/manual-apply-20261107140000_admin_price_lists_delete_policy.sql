-- MANUAL DASHBOARD APPLICATION ONLY — DO NOT RUN AS A CLI MIGRATION.
-- Source migration: commit 02d64eb, supabase/migrations/20261107140000_admin_price_lists_delete_policy.sql

begin;

-- Stop before adding the DELETE policy unless migration history, the existing
-- private bucket, and the existing SELECT/INSERT policies are exactly expected.
do $preflight$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 9
     or exists (
       (
         select version, name
         from supabase_migrations.schema_migrations
         except
         values
           ('20261103163512', 'catalog_foundation'),
           ('20261103190742', 'auth_profiles_and_approval'),
           ('20261104174602', 'admin_catalog_management'),
           ('20261105170526', 'orders_inventory'),
           ('20261105185529', 'require_website_delivery_date'),
           ('20261106144130', 'admin_sales_reporting'),
           ('20261107073935', 'admin_delete_product'),
           ('20261107100000', 'admin_price_lists_storage'),
           ('20261107130000', 'admin_sales_category_reporting')
       )
       union all
       (
         values
           ('20261103163512', 'catalog_foundation'),
           ('20261103190742', 'auth_profiles_and_approval'),
           ('20261104174602', 'admin_catalog_management'),
           ('20261105170526', 'orders_inventory'),
           ('20261105185529', 'require_website_delivery_date'),
           ('20261106144130', 'admin_sales_reporting'),
           ('20261107073935', 'admin_delete_product'),
           ('20261107100000', 'admin_price_lists_storage'),
           ('20261107130000', 'admin_sales_category_reporting')
         except
         select version, name
         from supabase_migrations.schema_migrations
       )
     ) then
    raise exception 'Unexpected supabase_migrations.schema_migrations history; aborting manual apply';
  end if;

  if exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20261107140000'
  ) then
    raise exception 'Migration version 20261107140000 already exists; aborting manual apply';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'DELETE'
  ) then
    raise exception 'A Storage object DELETE policy already exists; aborting manual apply';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'admin-price-lists'
      and name = 'admin-price-lists'
      and public = false
      and file_size_limit = 10485760
      and allowed_mime_types = array['application/pdf']::text[]
  ) then
    raise exception 'Storage bucket admin-price-lists does not match the expected private PDF configuration; aborting manual apply';
  end if;

  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects') <> 2
     or not exists (
       select 1
       from pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and policyname = 'approved admins can list and download price lists'
         and cmd = 'SELECT'
         and roles = array['authenticated']::name[]
         and qual like '%bucket_id%admin-price-lists%'
         and qual like '%private.is_current_user_admin%'
         and with_check is null
     )
     or not exists (
       select 1
       from pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and policyname = 'approved admins can upload price lists'
         and cmd = 'INSERT'
         and roles = array['authenticated']::name[]
         and qual is null
         and with_check like '%bucket_id%admin-price-lists%'
         and with_check like '%price-lists/%'
         and with_check like '%private.is_current_user_admin%'
     ) then
    raise exception 'Storage object SELECT/INSERT policies do not match the expected price-list configuration; aborting manual apply';
  end if;
end;
$preflight$;

-- Allow approved administrators to remove only managed price-list PDFs through
-- the Storage API. This policy does not grant UPDATE or access to other paths.
create policy "approved admins can delete price lists"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'admin-price-lists'
  and name ~ '^price-lists/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  and (select private.is_current_user_admin())
);

-- Insert history only after the committed migration statements have succeeded.
-- No ON CONFLICT clause is intentional: any unexpected duplicate must abort.
insert into supabase_migrations.schema_migrations (
  version,
  statements,
  name,
  created_by,
  idempotency_key,
  rollback
)
values (
  '20261107140000',
  array[$migration_source$-- Allow approved administrators to remove only managed price-list PDFs through
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
$migration_source$]::text[],
  'admin_price_lists_delete_policy',
  'dashboard-manual-apply',
  'manual-apply:20261107140000_admin_price_lists_delete_policy',
  array[]::text[]
);

commit;

-- Read-only verification queries. Run only after the transaction reports COMMIT.
select
  version,
  name,
  cardinality(statements) as statement_count,
  created_by,
  idempotency_key,
  cardinality(rollback) as rollback_statement_count
from supabase_migrations.schema_migrations
where version = '20261107140000';

select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'admin-price-lists';

select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
