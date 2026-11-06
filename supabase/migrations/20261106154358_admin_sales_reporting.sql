-- Approved-administrator sales-unit reporting over immutable order-line snapshots.
-- Prepared locally only; do not apply this file to a hosted project from this workspace.

begin;

-- The reporting filter fixes status before applying the delivered-at range.
-- The partial index keeps the common date-range scan narrow as delivered orders grow.
create index orders_done_delivered_at_idx
  on public.orders (delivered_at)
  where status = 'DONE';

create or replace function public.get_admin_sales_units_summary(
  p_start_date date,
  p_end_date date
)
returns table (
  total_units_sold bigint
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

  return query
  select coalesce(sum(order_line.quantity), 0)::bigint
  from public.orders as orders
  join public.order_lines as order_line on order_line.order_id = orders.id
  where orders.status = 'DONE'
    and orders.delivered_at >= v_start_at
    and orders.delivered_at < v_end_exclusive
    and order_line.is_current;
end;
$$;

create or replace function public.get_admin_sales_units_by_product(
  p_start_date date,
  p_end_date date
)
returns table (
  product_id bigint,
  product_name_snapshot text,
  product_size_snapshot text,
  product_article_code_snapshot text,
  product_shade_number_snapshot text,
  product_shade_name_snapshot text,
  product_developer_concentration_snapshot text,
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

  return query
  with delivered_lines as (
    select
      order_line.id,
      order_line.product_id,
      order_line.product_name_snapshot,
      order_line.product_size_snapshot,
      order_line.product_article_code_snapshot,
      order_line.product_shade_number_snapshot,
      order_line.product_shade_name_snapshot,
      order_line.product_developer_concentration_snapshot,
      order_line.quantity,
      orders.delivered_at,
      order_line.created_at
    from public.orders as orders
    join public.order_lines as order_line on order_line.order_id = orders.id
    where orders.status = 'DONE'
      and orders.delivered_at >= v_start_at
      and orders.delivered_at < v_end_exclusive
      and order_line.is_current
  ), product_totals as (
    select
      delivered_line.product_id,
      sum(delivered_line.quantity)::bigint as units_sold
    from delivered_lines as delivered_line
    group by delivered_line.product_id
  ), latest_snapshots as (
    select
      delivered_line.*,
      row_number() over (
        partition by delivered_line.product_id
        order by
          delivered_line.delivered_at desc,
          delivered_line.created_at desc,
          delivered_line.id desc
      ) as snapshot_rank
    from delivered_lines as delivered_line
  )
  select
    product_total.product_id,
    latest_snapshot.product_name_snapshot,
    latest_snapshot.product_size_snapshot,
    latest_snapshot.product_article_code_snapshot,
    latest_snapshot.product_shade_number_snapshot,
    latest_snapshot.product_shade_name_snapshot,
    latest_snapshot.product_developer_concentration_snapshot,
    product_total.units_sold
  from product_totals as product_total
  join latest_snapshots as latest_snapshot
    on latest_snapshot.product_id = product_total.product_id
   and latest_snapshot.snapshot_rank = 1
  order by product_total.units_sold desc, product_total.product_id;
end;
$$;

revoke all on function public.get_admin_sales_units_summary(date, date) from public, anon, authenticated;
revoke all on function public.get_admin_sales_units_by_product(date, date) from public, anon, authenticated;

grant execute on function public.get_admin_sales_units_summary(date, date) to authenticated;
grant execute on function public.get_admin_sales_units_by_product(date, date) to authenticated;

commit;
