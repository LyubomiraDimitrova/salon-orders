-- Approved-administrator catalogue management.
-- This migration keeps the public catalogue policies unchanged and does not grant
-- browser roles direct access to private.product_prices.

begin;

-- Recreate the catalogue publication helpers with a safe, empty search path.
-- They are trigger-only helpers and are not callable by browser roles.
create or replace function private.assert_product_publishable(p_product_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_hidden boolean;
  v_brand_id bigint;
  v_category_id bigint;
  v_size_label text;
begin
  select product.is_hidden, product.brand_id, product.category_id, product.size_label
  into v_is_hidden, v_brand_id, v_category_id, v_size_label
  from public.products as product
  where product.id = p_product_id
  for update;

  if not found or v_is_hidden then
    return;
  end if;

  if v_brand_id is null
    or v_category_id is null
    or v_size_label is null
    or pg_catalog.char_length(pg_catalog.btrim(v_size_label)) < 2 then
    raise exception 'Published products require a brand, category, and meaningful size or pack description'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from private.product_prices as product_price
    where product_price.product_id = p_product_id
      and product_price.retail_price > 0
  ) then
    raise exception 'Published products require a positive retail price in EUR including VAT'
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function private.enforce_product_publication_requirements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_schema = 'private' and tg_table_name = 'product_prices' then
    if tg_op = 'DELETE' then
      perform private.assert_product_publishable(old.product_id);
      return old;
    end if;

    perform private.assert_product_publishable(new.product_id);
    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  perform private.assert_product_publishable(new.id);
  return new;
end;
$$;

-- Approved administrators can manage catalogue metadata, including incomplete
-- hidden drafts. Publication is still guarded by the existing trigger above.
grant usage on sequence public.brands_id_seq, public.product_categories_id_seq,
  public.products_id_seq to authenticated;

grant insert (name, is_hidden, sort_order), update (name, is_hidden, sort_order)
  on public.brands to authenticated;
grant insert (name, product_group, sort_order), update (name, product_group, sort_order)
  on public.product_categories to authenticated;
grant insert (
  brand_id,
  category_id,
  article_code,
  series_name,
  name,
  description,
  size_label,
  shade_number,
  shade_name,
  shade_color,
  developer_concentration,
  image_path,
  is_hidden,
  is_recommended
) on public.products to authenticated;
grant update (
  brand_id,
  category_id,
  article_code,
  series_name,
  name,
  description,
  size_label,
  shade_number,
  shade_name,
  shade_color,
  developer_concentration,
  image_path,
  is_hidden,
  is_recommended
) on public.products to authenticated;

create policy "approved admins can read all brands"
on public.brands
for select
to authenticated
using ((select private.is_current_user_admin()));

create policy "approved admins can create brands"
on public.brands
for insert
to authenticated
with check ((select private.is_current_user_admin()));

create policy "approved admins can edit brands"
on public.brands
for update
to authenticated
using ((select private.is_current_user_admin()))
with check ((select private.is_current_user_admin()));

create policy "approved admins can read all product categories"
on public.product_categories
for select
to authenticated
using ((select private.is_current_user_admin()));

create policy "approved admins can create product categories"
on public.product_categories
for insert
to authenticated
with check ((select private.is_current_user_admin()));

create policy "approved admins can edit product categories"
on public.product_categories
for update
to authenticated
using ((select private.is_current_user_admin()))
with check ((select private.is_current_user_admin()));

create policy "approved admins can read all products"
on public.products
for select
to authenticated
using ((select private.is_current_user_admin()));

create policy "approved admins can create products"
on public.products
for insert
to authenticated
with check ((select private.is_current_user_admin()));

create policy "approved admins can edit products"
on public.products
for update
to authenticated
using ((select private.is_current_user_admin()))
with check ((select private.is_current_user_admin()));

-- Price data stays private. The two public RPCs below are the only browser
-- access path and each verifies the caller before using definer privileges.
alter table private.product_prices enable row level security;
revoke all on table private.product_prices from PUBLIC, anon, authenticated;

create or replace function public.get_admin_product_prices()
returns table (
  product_id bigint,
  retail_price numeric,
  salon_sale_price numeric,
  reference_purchase_price numeric,
  currency char(3),
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.is_current_user_admin()) then
    raise exception 'Administrator access is required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    product_price.product_id,
    product_price.retail_price,
    product_price.salon_sale_price,
    product_price.reference_purchase_price,
    product_price.currency,
    product_price.updated_at
  from private.product_prices as product_price
  order by product_price.product_id;
end;
$$;

create or replace function public.set_admin_product_retail_price(
  p_product_id bigint,
  p_retail_price numeric(12, 2)
)
returns table (
  product_id bigint,
  retail_price numeric,
  salon_sale_price numeric,
  reference_purchase_price numeric,
  currency char(3),
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.is_current_user_admin()) then
    raise exception 'Administrator access is required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_product_id is null then
    raise exception 'A product is required'
      using errcode = 'not_null_violation';
  end if;

  if p_retail_price is null
    or p_retail_price in (
      'NaN'::numeric,
      'Infinity'::numeric,
      '-Infinity'::numeric
    )
    or p_retail_price <= 0 then
    raise exception 'Retail price must be finite and positive'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.products as product
    where product.id = p_product_id
  ) then
    raise exception 'Product % does not exist', p_product_id
      using errcode = 'foreign_key_violation';
  end if;

  return query
  insert into private.product_prices as product_price (
    product_id,
    retail_price,
    updated_by
  )
  values (
    p_product_id,
    p_retail_price,
    (select auth.uid())
  )
  on conflict on constraint product_prices_pkey do update
  set
    retail_price = excluded.retail_price,
    updated_by = (select auth.uid())
  returning
    product_price.product_id,
    product_price.retail_price,
    product_price.salon_sale_price,
    product_price.reference_purchase_price,
    product_price.currency,
    product_price.updated_at;
end;
$$;

-- Explicit function privileges prevent direct invocation of private helpers.
revoke all on function private.set_updated_at() from PUBLIC, anon, authenticated;
revoke all on function private.prevent_product_price_reassignment() from PUBLIC, anon, authenticated;
revoke all on function private.assert_product_publishable(bigint) from PUBLIC, anon, authenticated;
revoke all on function private.enforce_product_publication_requirements() from PUBLIC, anon, authenticated;
revoke all on function private.handle_new_user() from PUBLIC, anon, authenticated;
revoke all on function private.is_current_user_admin() from PUBLIC, anon, authenticated;
grant execute on function private.is_current_user_admin() to authenticated;

revoke all on function public.get_admin_product_prices() from PUBLIC, anon, authenticated;
revoke all on function public.set_admin_product_retail_price(bigint, numeric) from PUBLIC, anon, authenticated;
grant execute on function public.get_admin_product_prices() to authenticated;
grant execute on function public.set_admin_product_retail_price(bigint, numeric) to authenticated;

commit;
