\set ON_ERROR_STOP on
begin;
do $$
declare
  v_physical integer;
  v_reserved integer;
  v_active integer;
begin
  select stock_level.physical_quantity, stock_level.reserved_quantity
  into v_physical, v_reserved
  from public.stock_levels as stock_level
  join public.products as product on product.id = stock_level.product_id
  where product.article_code = 'CONC-ONE';

  select coalesce(sum(reservation.quantity), 0)::integer
  into v_active
  from public.stock_reservations as reservation
  join public.order_lines as line on line.id = reservation.order_line_id
  join public.products as product on product.id = line.product_id
  where product.article_code = 'CONC-ONE'
    and reservation.status = 'active';

  if v_physical <> 1 or v_reserved <> 1 or v_active <> 1 then
    raise exception 'Concurrent approval over-reserved stock: physical %, reserved %, active %',
      v_physical, v_reserved, v_active;
  end if;
end;
$$;
rollback;
