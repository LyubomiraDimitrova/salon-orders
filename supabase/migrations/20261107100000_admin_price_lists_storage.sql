-- Private PDF price lists for approved administrators only.
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
