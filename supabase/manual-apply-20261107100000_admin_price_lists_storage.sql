-- MANUAL DASHBOARD APPLICATION ONLY — DO NOT RUN AS A CLI MIGRATION.
-- Source migration: commit 21bf9d6, supabase/migrations/20261107100000_admin_price_lists_storage.sql

-- Private PDF price lists for approved administrators only.
-- Storage object metadata retains the original filename atomically with upload.

begin;

-- Stop before any bucket, function, or policy change unless the remote history
-- is exactly the seven migrations preceding this one and all feature objects
-- from this migration are absent.
do $preflight$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 7
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
           ('20261107073935', 'admin_delete_product')
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
           ('20261107073935', 'admin_delete_product')
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
    where version = '20261107100000'
  ) then
    raise exception 'Migration version 20261107100000 already exists; aborting manual apply';
  end if;

  if exists (
    select 1
    from storage.buckets
    where id = 'admin-price-lists'
  ) then
    raise exception 'Storage bucket admin-price-lists already exists; aborting manual apply';
  end if;

  if to_regprocedure('public.list_admin_price_lists(integer,integer,text)') is not null then
    raise exception 'public.list_admin_price_lists(integer,integer,text) already exists; aborting manual apply';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
  ) then
    raise exception 'Storage object policies already exist; aborting manual apply';
  end if;
end;
$preflight$;

-- Storage policies execute as the requesting authenticated role. Confirm that
-- the existing approved-admin helper remains callable from those policies.
do $$
begin
  if not has_schema_privilege('authenticated', 'private', 'usage')
     or not has_function_privilege(
       'authenticated',
       'private.is_current_user_admin()',
       'execute'
     ) then
    raise exception 'Approved-admin helper is not usable by Storage policies';
  end if;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'admin-price-lists',
  'admin-price-lists',
  false,
  10485760,
  array['application/pdf']::text[]
);

create or replace function public.list_admin_price_lists(
  p_limit integer default 50,
  p_offset integer default 0,
  p_object_path text default null
)
returns table (
  object_path text,
  original_filename text,
  created_at timestamptz,
  size bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_admin();

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Price-list limit must be between 1 and 100'
      using errcode = 'check_violation';
  end if;

  if p_offset is null or p_offset < 0 then
    raise exception 'Price-list offset must be non-negative'
      using errcode = 'check_violation';
  end if;

  if p_object_path is not null
     and p_object_path !~ '^price-lists/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$' then
    raise exception 'Invalid price-list object path'
      using errcode = 'check_violation';
  end if;

  -- storage.objects is read-only here. Uploading and downloading stay on the
  -- Storage API so Storage keeps object bytes and metadata consistent.
  return query
  select
    stored_object.name as object_path,
    coalesce(
      nullif(stored_object.user_metadata ->> 'originalFilename', ''),
      stored_object.name
    ) as original_filename,
    stored_object.created_at,
    case
      when (stored_object.metadata ->> 'size') ~ '^[0-9]+$'
        then (stored_object.metadata ->> 'size')::bigint
      else null
    end as size
  from storage.objects as stored_object
  where stored_object.bucket_id = 'admin-price-lists'
    and stored_object.name ~ '^price-lists/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    and (p_object_path is null or stored_object.name = p_object_path)
  order by stored_object.created_at desc, stored_object.name desc
  offset p_offset
  limit p_limit;
end;
$$;

revoke all on function public.list_admin_price_lists(integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.list_admin_price_lists(integer, integer, text)
  to authenticated;

create policy "approved admins can list and download price lists"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'admin-price-lists'
  and (select private.is_current_user_admin())
);

create policy "approved admins can upload price lists"
on storage.objects
for insert
to authenticated
with check (
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
  '20261107100000',
  array[$migration_source$-- Private PDF price lists for approved administrators only.
-- Storage object metadata retains the original filename atomically with upload.

begin;

-- Storage policies execute as the requesting authenticated role. Confirm that
-- the existing approved-admin helper remains callable from those policies.
do $$
begin
  if not has_schema_privilege('authenticated', 'private', 'usage')
     or not has_function_privilege(
       'authenticated',
       'private.is_current_user_admin()',
       'execute'
     ) then
    raise exception 'Approved-admin helper is not usable by Storage policies';
  end if;
end;
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'admin-price-lists',
  'admin-price-lists',
  false,
  10485760,
  array['application/pdf']::text[]
);

create or replace function public.list_admin_price_lists(
  p_limit integer default 50,
  p_offset integer default 0,
  p_object_path text default null
)
returns table (
  object_path text,
  original_filename text,
  created_at timestamptz,
  size bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_admin();

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Price-list limit must be between 1 and 100'
      using errcode = 'check_violation';
  end if;

  if p_offset is null or p_offset < 0 then
    raise exception 'Price-list offset must be non-negative'
      using errcode = 'check_violation';
  end if;

  if p_object_path is not null
     and p_object_path !~ '^price-lists/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$' then
    raise exception 'Invalid price-list object path'
      using errcode = 'check_violation';
  end if;

  -- storage.objects is read-only here. Uploading and downloading stay on the
  -- Storage API so Storage keeps object bytes and metadata consistent.
  return query
  select
    stored_object.name as object_path,
    coalesce(
      nullif(stored_object.user_metadata ->> 'originalFilename', ''),
      stored_object.name
    ) as original_filename,
    stored_object.created_at,
    case
      when (stored_object.metadata ->> 'size') ~ '^[0-9]+$'
        then (stored_object.metadata ->> 'size')::bigint
      else null
    end as size
  from storage.objects as stored_object
  where stored_object.bucket_id = 'admin-price-lists'
    and stored_object.name ~ '^price-lists/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    and (p_object_path is null or stored_object.name = p_object_path)
  order by stored_object.created_at desc, stored_object.name desc
  offset p_offset
  limit p_limit;
end;
$$;

revoke all on function public.list_admin_price_lists(integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.list_admin_price_lists(integer, integer, text)
  to authenticated;

create policy "approved admins can list and download price lists"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'admin-price-lists'
  and (select private.is_current_user_admin())
);

create policy "approved admins can upload price lists"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'admin-price-lists'
  and name ~ '^price-lists/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  and (select private.is_current_user_admin())
);

commit;
$migration_source$]::text[],
  'admin_price_lists_storage',
  'dashboard-manual-apply',
  'manual-apply:20261107100000_admin_price_lists_storage',
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
where version = '20261107100000';

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

select
  to_regprocedure('public.list_admin_price_lists(integer,integer,text)') as listing_rpc,
  has_function_privilege(
    'authenticated',
    'public.list_admin_price_lists(integer,integer,text)',
    'execute'
  ) as authenticated_can_execute,
  has_function_privilege(
    'anon',
    'public.list_admin_price_lists(integer,integer,text)',
    'execute'
  ) as anon_can_execute,
  exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as acl
    where procedure.oid = 'public.list_admin_price_lists(integer,integer,text)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as public_can_execute;
