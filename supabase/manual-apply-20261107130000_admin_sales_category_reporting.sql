-- MANUAL DASHBOARD APPLICATION ONLY — DO NOT RUN AS A CLI MIGRATION.
-- Source migration: commit bd5948d, supabase/migrations/20261107130000_admin_sales_category_reporting.sql

begin;

-- Stop before any function or privilege change unless the remote history is
-- exactly the eight migrations preceding this one and the new objects are absent.
do $preflight$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 8
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
           ('20261107100000', 'admin_price_lists_storage')
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
           ('20261107100000', 'admin_price_lists_storage')
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
    where version = '20261107130000'
  ) then
    raise exception 'Migration version 20261107130000 already exists; aborting manual apply';
  end if;

  if to_regprocedure('public.get_admin_sales_units_by_category(date,date)') is not null then
    raise exception 'public.get_admin_sales_units_by_category(date,date) already exists; aborting manual apply';
  end if;
end;
$preflight$;

-- Approved-administrator sales-unit breakdown by the product's current category.
-- There is no category snapshot on public.order_lines. Consequently, a product
-- reassigned to another category later will reclassify its historical units; no
-- historical category values are backfilled or inferred by this migration.
-- Prepared locally only; do not apply this file to a hosted project from this workspace.

create or replace function public.get_admin_sales_units_by_category(
  p_start_date date,
  p_end_date date
)
returns table (
  category_id bigint,
  category_name text,
  units_sold bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start_at timestamptz;
  v_end_exclusive timestamptz;
begin
  perform private.require_current_admin();

  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Start and end dates are required and must be in order'
      using errcode = 'check_violation';
  end if;

  v_start_at := p_start_date::timestamp at time zone 'Europe/Sofia';
  v_end_exclusive := (p_end_date + 1)::timestamp at time zone 'Europe/Sofia';

  -- A delivered current line appears once in this CTE. The following joins are
  -- many-to-one, so category totals reconcile exactly with the sales-unit total.
  return query
  with delivered_lines as (
    select
      order_line.product_id,
      order_line.quantity
    from public.orders as orders
    join public.order_lines as order_line on order_line.order_id = orders.id
    where orders.status = 'DONE'
      and orders.delivered_at >= v_start_at
      and orders.delivered_at < v_end_exclusive
      and order_line.is_current
  )
  select
    category.id as category_id,
    coalesce(nullif(pg_catalog.btrim(category.name), ''), 'Без категория') as category_name,
    sum(delivered_line.quantity)::bigint as units_sold
  from delivered_lines as delivered_line
  join public.products as product on product.id = delivered_line.product_id
  left join public.product_categories as category on category.id = product.category_id
  group by category.id, category.name
  order by sum(delivered_line.quantity) desc, category.name, category.id;
end;
$$;

revoke all on function public.get_admin_sales_units_by_category(date, date) from public, anon, authenticated;
grant execute on function public.get_admin_sales_units_by_category(date, date) to authenticated;

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
  '20261107130000',
  array[$migration_source$-- Approved-administrator sales-unit breakdown by the product's current category.
-- There is no category snapshot on public.order_lines. Consequently, a product
-- reassigned to another category later will reclassify its historical units; no
-- historical category values are backfilled or inferred by this migration.
-- Prepared locally only; do not apply this file to a hosted project from this workspace.

begin;

create or replace function public.get_admin_sales_units_by_category(
  p_start_date date,
  p_end_date date
)
returns table (
  category_id bigint,
  category_name text,
  units_sold bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start_at timestamptz;
  v_end_exclusive timestamptz;
begin
  perform private.require_current_admin();

  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Start and end dates are required and must be in order'
      using errcode = 'check_violation';
  end if;

  v_start_at := p_start_date::timestamp at time zone 'Europe/Sofia';
  v_end_exclusive := (p_end_date + 1)::timestamp at time zone 'Europe/Sofia';

  -- A delivered current line appears once in this CTE. The following joins are
  -- many-to-one, so category totals reconcile exactly with the sales-unit total.
  return query
  with delivered_lines as (
    select
      order_line.product_id,
      order_line.quantity
    from public.orders as orders
    join public.order_lines as order_line on order_line.order_id = orders.id
    where orders.status = 'DONE'
      and orders.delivered_at >= v_start_at
      and orders.delivered_at < v_end_exclusive
      and order_line.is_current
  )
  select
    category.id as category_id,
    coalesce(nullif(pg_catalog.btrim(category.name), ''), 'Без категория') as category_name,
    sum(delivered_line.quantity)::bigint as units_sold
  from delivered_lines as delivered_line
  join public.products as product on product.id = delivered_line.product_id
  left join public.product_categories as category on category.id = product.category_id
  group by category.id, category.name
  order by sum(delivered_line.quantity) desc, category.name, category.id;
end;
$$;

revoke all on function public.get_admin_sales_units_by_category(date, date) from public, anon, authenticated;
grant execute on function public.get_admin_sales_units_by_category(date, date) to authenticated;

commit;
$migration_source$]::text[],
  'admin_sales_category_reporting',
  'dashboard-manual-apply',
  'manual-apply:20261107130000_admin_sales_category_reporting',
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
where version = '20261107130000';

select
  procedure.oid::regprocedure as reporting_rpc,
  procedure.prosecdef as security_definer,
  exists (
    select 1
    from unnest(coalesce(procedure.proconfig, array[]::text[])) as config(setting)
    where config.setting = 'search_path='
  ) as has_empty_search_path
from pg_proc as procedure
where procedure.oid = 'public.get_admin_sales_units_by_category(date,date)'::regprocedure;

select
  has_function_privilege(
    'authenticated',
    'public.get_admin_sales_units_by_category(date,date)',
    'execute'
  ) as authenticated_can_execute,
  has_function_privilege(
    'anon',
    'public.get_admin_sales_units_by_category(date,date)',
    'execute'
  ) as anon_can_execute,
  exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as acl
    where procedure.oid = 'public.get_admin_sales_units_by_category(date,date)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as public_can_execute;
