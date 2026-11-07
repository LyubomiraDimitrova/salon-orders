-- Approved-administrator sales-unit breakdown by the product's current category.
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
