-- MANUAL DASHBOARD APPLICATION ONLY — DO NOT RUN AS A CLI MIGRATION.
-- Source migration: commit 824cc02, supabase/migrations/20261107073935_admin_delete_product.sql
-- This keeps the committed migration statements unchanged and records the same
-- source text in Dashboard migration history after all guarded changes succeed.

-- Permanent product deletion is deliberately limited to unused catalogue records.
-- Historical order and stock data are never deleted or cascaded from this operation.

begin;

-- Stop before any schema or privilege change unless the remote history is exactly
-- the six migrations that precede this one, and this migration/RPC is absent.
do $preflight$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 6
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
           ('20261106144130', 'admin_sales_reporting')
       )
       union all
       (
         values
           ('20261103163512', 'catalog_foundation'),
           ('20261103190742', 'auth_profiles_and_approval'),
           ('20261104174602', 'admin_catalog_management'),
           ('20261105170526', 'orders_inventory'),
           ('20261105185529', 'require_website_delivery_date'),
           ('20261106144130', 'admin_sales_reporting')
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
    where version = '20261107073935'
  ) then
    raise exception 'Migration version 20261107073935 already exists; aborting manual apply';
  end if;

  if to_regprocedure('public.delete_admin_product(bigint,text)') is not null then
    raise exception 'public.delete_admin_product(bigint,text) already exists; aborting manual apply';
  end if;
end;
$preflight$;

create or replace function public.delete_admin_product(
  p_product_id bigint,
  p_confirmed_product_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id bigint;
  v_product_name text;
  v_blockers text[] := array[]::text[];
begin
  perform private.require_current_admin();

  if p_product_id is null then
    raise exception 'A product is required'
      using errcode = 'not_null_violation';
  end if;

  -- This lock serializes the eligibility checks with every foreign-key insert
  -- that can reference the product. A concurrent reference either becomes
  -- visible before the checks or waits and then fails its FK after deletion.
  select product.id, product.name
  into v_product_id, v_product_name
  from public.products as product
  where product.id = p_product_id
  for update;

  if not found then
    raise exception 'Product % does not exist', p_product_id
      using errcode = 'foreign_key_violation';
  end if;

  if p_confirmed_product_name is distinct from v_product_name then
    raise exception 'Product confirmation does not match the current product name'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.order_lines as order_line
    where order_line.product_id = v_product_id
  ) then
    v_blockers := array_append(v_blockers, 'order lines');
  end if;

  if exists (
    select 1
    from public.stock_levels as stock_level
    where stock_level.product_id = v_product_id
  ) then
    v_blockers := array_append(v_blockers, 'stock levels');
  end if;

  if exists (
    select 1
    from public.stock_movements as stock_movement
    where stock_movement.product_id = v_product_id
  ) then
    v_blockers := array_append(v_blockers, 'stock movements');
  end if;

  if exists (
    select 1
    from public.stock_reservations as stock_reservation
    where stock_reservation.product_id = v_product_id
  ) then
    v_blockers := array_append(v_blockers, 'stock reservations');
  end if;

  if cardinality(v_blockers) > 0 then
    raise exception 'Product cannot be permanently deleted because it has references in %. Hide the product instead.',
      array_to_string(v_blockers, ', ')
      using errcode = 'foreign_key_violation';
  end if;

  -- The price trigger protects published products. Hiding inside this same
  -- transaction permits removal of the private price row without exposing an
  -- observable hidden state, then the product is deleted immediately after.
  update public.products as product
  set is_hidden = true
  where product.id = v_product_id
    and not product.is_hidden;

  delete from private.product_prices as product_price
  where product_price.product_id = v_product_id;

  delete from public.products as product
  where product.id = v_product_id;
end;
$$;

-- Browser roles retain no direct DELETE path; only this authorized RPC can
-- remove an eligible product and its private current-price row.
revoke delete on table public.products from public, anon, authenticated;
revoke all on function public.delete_admin_product(bigint, text) from public, anon, authenticated;
grant execute on function public.delete_admin_product(bigint, text) to authenticated;

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
  '20261107073935',
  array[$migration_source$
-- Permanent product deletion is deliberately limited to unused catalogue records.
-- Historical order and stock data are never deleted or cascaded from this operation.

begin;

create or replace function public.delete_admin_product(
  p_product_id bigint,
  p_confirmed_product_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id bigint;
  v_product_name text;
  v_blockers text[] := array[]::text[];
begin
  perform private.require_current_admin();

  if p_product_id is null then
    raise exception 'A product is required'
      using errcode = 'not_null_violation';
  end if;

  -- This lock serializes the eligibility checks with every foreign-key insert
  -- that can reference the product. A concurrent reference either becomes
  -- visible before the checks or waits and then fails its FK after deletion.
  select product.id, product.name
  into v_product_id, v_product_name
  from public.products as product
  where product.id = p_product_id
  for update;

  if not found then
    raise exception 'Product % does not exist', p_product_id
      using errcode = 'foreign_key_violation';
  end if;

  if p_confirmed_product_name is distinct from v_product_name then
    raise exception 'Product confirmation does not match the current product name'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.order_lines as order_line
    where order_line.product_id = v_product_id
  ) then
    v_blockers := array_append(v_blockers, 'order lines');
  end if;

  if exists (
    select 1
    from public.stock_levels as stock_level
    where stock_level.product_id = v_product_id
  ) then
    v_blockers := array_append(v_blockers, 'stock levels');
  end if;

  if exists (
    select 1
    from public.stock_movements as stock_movement
    where stock_movement.product_id = v_product_id
  ) then
    v_blockers := array_append(v_blockers, 'stock movements');
  end if;

  if exists (
    select 1
    from public.stock_reservations as stock_reservation
    where stock_reservation.product_id = v_product_id
  ) then
    v_blockers := array_append(v_blockers, 'stock reservations');
  end if;

  if cardinality(v_blockers) > 0 then
    raise exception 'Product cannot be permanently deleted because it has references in %. Hide the product instead.',
      array_to_string(v_blockers, ', ')
      using errcode = 'foreign_key_violation';
  end if;

  -- The price trigger protects published products. Hiding inside this same
  -- transaction permits removal of the private price row without exposing an
  -- observable hidden state, then the product is deleted immediately after.
  update public.products as product
  set is_hidden = true
  where product.id = v_product_id
    and not product.is_hidden;

  delete from private.product_prices as product_price
  where product_price.product_id = v_product_id;

  delete from public.products as product
  where product.id = v_product_id;
end;
$$;

-- Browser roles retain no direct DELETE path; only this authorized RPC can
-- remove an eligible product and its private current-price row.
revoke delete on table public.products from public, anon, authenticated;
revoke all on function public.delete_admin_product(bigint, text) from public, anon, authenticated;
grant execute on function public.delete_admin_product(bigint, text) to authenticated;

commit;
$migration_source$]::text[],
  'admin_delete_product',
  'dashboard-manual-apply',
  'manual-apply:20261107073935_admin_delete_product',
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
where version = '20261107073935';

select to_regprocedure('public.delete_admin_product(bigint,text)') as deletion_rpc;

select grantee, privilege_type
from information_schema.role_routine_grants
where specific_schema = 'public'
  and routine_name = 'delete_admin_product'
order by grantee, privilege_type;
