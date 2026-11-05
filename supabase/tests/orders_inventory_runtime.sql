\set ON_ERROR_STOP on

-- Run only against a disposable local Supabase database after the migration.
-- Every fixture and assertion is rolled back at the end of this file.
begin;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is distinct from true then
    raise exception 'Assertion failed: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.assert_raises(p_statement text, p_message text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_statement;
  exception when others then
    return;
  end;

  raise exception 'Expected statement to fail: %', p_message;
end;
$$;

-- Fictional authenticated identities. The existing auth trigger creates their
-- profiles and linked salon clients.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'orders-admin@example.test', 'not-a-real-password', now()),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'approved-client@example.test', 'not-a-real-password', now()),
  ('10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'other-client@example.test', 'not-a-real-password', now()),
  ('10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'pending-client@example.test', 'not-a-real-password', now());

update public.profiles
set role = 'admin', approval_status = 'approved'
where id = '10000000-0000-0000-0000-000000000001';

update public.profiles
set approval_status = 'approved'
where id in (
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003'
);

update public.salon_clients as salon_client
set
  salon_name = case profile.id
    when '10000000-0000-0000-0000-000000000001'::uuid then 'Runtime Admin Salon'
    when '10000000-0000-0000-0000-000000000002'::uuid then 'Runtime Approved Salon'
    when '10000000-0000-0000-0000-000000000003'::uuid then 'Runtime Other Salon'
    else 'Runtime Pending Salon'
  end,
  contact_name = 'Fictional Contact',
  phone = '+35970000000',
  address = 'Test Street 1'
from public.profiles as profile
where profile.salon_client_id = salon_client.id
  and profile.id in (
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000004'
  );

insert into public.brands (name) values ('Runtime Original Brand');
insert into public.product_categories (name, product_group) values ('Runtime Technical', 'technical');

insert into public.products (
  brand_id, category_id, article_code, series_name, name, size_label,
  shade_number, shade_name, developer_concentration, is_hidden
)
select
  brand.id,
  category.id,
  fixture.article_code,
  fixture.series_name,
  fixture.product_name,
  '250 ml',
  '7.1',
  'Ash',
  '20 VOL',
  true
from (
  values
    ('RT-UNKNOWN', 'Runtime Unknown', 'Runtime Unknown Product'),
    ('RT-PARTIAL', 'Runtime Partial', 'Runtime Partial Product'),
    ('RT-DENY', 'Runtime Denial', 'Runtime Denial Product'),
    ('RT-IDEMPOTENT', 'Runtime Idempotency', 'Runtime Idempotency Product'),
    ('RT-HISTORY', 'Runtime History', 'Runtime Historical Product')
) as fixture(article_code, series_name, product_name)
cross join public.brands as brand
cross join public.product_categories as category
where brand.name = 'Runtime Original Brand'
  and category.name = 'Runtime Technical';

insert into private.product_prices (product_id, retail_price)
select product.id, 10.00
from public.products as product
where product.article_code like 'RT-%';

update public.products
set is_hidden = false
where article_code like 'RT-%';

-- Approved website client: NULL, JSON null, scalar JSON, and empty arrays fail.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_raises(
  $$select public.submit_website_order('20000000-0000-0000-0000-000000000001', null, null, null, null, null, null)$$,
  'SQL NULL p_lines must be rejected'
);
select pg_temp.assert_raises(
  $$select public.submit_website_order('20000000-0000-0000-0000-000000000002', null, null, null, null, null, 'null'::jsonb)$$,
  'JSON null p_lines must be rejected'
);
select pg_temp.assert_raises(
  $$select public.submit_website_order('20000000-0000-0000-0000-000000000003', null, null, null, null, null, '{"product_id": 1}'::jsonb)$$,
  'non-array p_lines must be rejected'
);
select pg_temp.assert_raises(
  $$select public.submit_website_order('20000000-0000-0000-0000-000000000004', null, null, null, null, null, '[]'::jsonb)$$,
  'empty p_lines must be rejected'
);
reset role;

-- A pending profile cannot submit even a valid website order.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_raises(
  $$select public.submit_website_order('20000000-0000-0000-0000-000000000005', null, null, null, null, null, jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where article_code = 'RT-PARTIAL'), 'quantity', 1)))$$,
  'pending client must be denied website ordering'
);
reset role;

-- Create one approved-client order with a partial quantity request.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select public.submit_website_order(
  '20000000-0000-0000-0000-000000000006',
  current_date,
  null,
  null,
  'Fictional delivery note',
  'Fictional client note',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select id from public.products where article_code = 'RT-PARTIAL'),
    'quantity', 5
  ))
);
reset role;

-- A different approved client has no order-history access and cannot read prices.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true(
  (select count(*) = 0 from public.orders where placed_by_profile_id = '10000000-0000-0000-0000-000000000002'),
  'other client must not see the approved client order'
);
select pg_temp.assert_raises(
  $$select * from private.product_prices$$,
  'client must not read private prices'
);
select pg_temp.assert_raises(
  $$select * from public.get_admin_order_price_snapshots(1)$$,
  'client must not call admin price snapshot RPC'
);
select pg_temp.assert_raises(
  $$select * from public.initialize_stock_level('20000000-0000-0000-0000-000000000007', 1, 0, 'not allowed')$$,
  'client must not initialize stock'
);
reset role;

-- Anonymous requests cannot query private prices or invoke protected RPCs.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.assert_raises($$select * from private.order_line_price_snapshots$$, 'anon private-price denial');
select pg_temp.assert_raises($$select * from public.get_admin_order_price_snapshots(1)$$, 'anon admin RPC denial');
reset role;

-- Admin initializes confirmed zero for one product. A missing stock_levels row is unknown.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.assert_true(
  not exists (select 1 from public.stock_levels where product_id = (select id from public.products where article_code = 'RT-UNKNOWN')),
  'missing stock_levels row means unknown stock'
);
select public.create_admin_order(
  '20000000-0000-0000-0000-000000000008',
  (select salon_client_id from public.profiles where id = '10000000-0000-0000-0000-000000000001'),
  'phone', 'APPROVED', null, null, null, null, null, null, null, null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where article_code = 'RT-UNKNOWN'), 'quantity', 1))
);
select pg_temp.assert_raises(
  $$select * from public.allocate_waiting_order_line('20000000-0000-0000-0000-000000000009', (select line.id from public.order_lines as line join public.products as product on product.id = line.product_id where product.article_code = 'RT-UNKNOWN' and line.is_current), 1)$$,
  'unknown stock must not be allocatable'
);
select public.initialize_stock_level(
  '20000000-0000-0000-0000-000000000010',
  (select id from public.products where article_code = 'RT-UNKNOWN'),
  0,
  'Fictional confirmed zero count'
);
select pg_temp.assert_true(
  (select physical_quantity = 0 and reserved_quantity = 0 from public.stock_levels where product_id = (select id from public.products where article_code = 'RT-UNKNOWN')),
  'initialized zero must remain distinguishable from unknown stock'
);
select pg_temp.assert_true(
  not exists (select 1 from public.stock_reservations as reservation join public.order_lines as line on line.id = reservation.order_line_id join public.products as product on product.id = line.product_id where product.article_code = 'RT-UNKNOWN'),
  'initialization must not allocate waiting quantities'
);

-- Partial reservation; a receipt changes physical stock only until explicit allocation.
select public.initialize_stock_level(
  '20000000-0000-0000-0000-000000000011',
  (select id from public.products where article_code = 'RT-PARTIAL'), 3, 'Fictional opening count'
);
select public.approve_order(
  '20000000-0000-0000-0000-000000000012',
  (select id from public.orders where placed_by_profile_id = '10000000-0000-0000-0000-000000000002'),
  current_date, null, null, null
);
select pg_temp.assert_true(
  (select physical_quantity = 3 and reserved_quantity = 3 from public.stock_levels where product_id = (select id from public.products where article_code = 'RT-PARTIAL')),
  'approval reserves only available stock'
);
select public.start_order_delivery(
  '20000000-0000-0000-0000-000000000013',
  (select id from public.orders where placed_by_profile_id = '10000000-0000-0000-0000-000000000002')
);
select pg_temp.assert_raises(
  $$select * from public.deliver_order('20000000-0000-0000-0000-000000000014', (select id from public.orders where placed_by_profile_id = '10000000-0000-0000-0000-000000000002'), '2026-11-05T12:00:00Z')$$,
  'delivery must fail while any line is short'
);
select public.record_stock_receipt(
  '20000000-0000-0000-0000-000000000015',
  (select id from public.products where article_code = 'RT-PARTIAL'), 2, 'Fictional receipt'
);
select pg_temp.assert_true(
  (select physical_quantity = 5 and reserved_quantity = 3 from public.stock_levels where product_id = (select id from public.products where article_code = 'RT-PARTIAL')),
  'receipt must not automatically allocate waiting units'
);
select public.allocate_waiting_order_line(
  '20000000-0000-0000-0000-000000000016',
  (select line.id from public.order_lines as line join public.products as product on product.id = line.product_id where product.article_code = 'RT-PARTIAL' and line.is_current),
  2
);
select public.deliver_order(
  '20000000-0000-0000-0000-000000000017',
  (select id from public.orders where placed_by_profile_id = '10000000-0000-0000-0000-000000000002'),
  '2026-11-05T12:00:00Z'
);
select pg_temp.assert_true(
  (select physical_quantity = 0 and reserved_quantity = 0 from public.stock_levels where product_id = (select id from public.products where article_code = 'RT-PARTIAL')),
  'delivery consumes physical and reserved stock exactly once'
);
select pg_temp.assert_raises(
  $$select * from public.deny_order('20000000-0000-0000-0000-000000000018', (select id from public.orders where placed_by_profile_id = '10000000-0000-0000-0000-000000000002'), 'terminal')$$,
  'DONE must be terminal'
);

-- Denial releases reservations and becomes terminal.
select public.initialize_stock_level('20000000-0000-0000-0000-000000000019', (select id from public.products where article_code = 'RT-DENY'), 2, 'Fictional count');
select public.create_admin_order(
  '20000000-0000-0000-0000-000000000020',
  (select salon_client_id from public.profiles where id = '10000000-0000-0000-0000-000000000001'),
  'viber', 'APPROVED', null, null, null, null, null, null, null, null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where article_code = 'RT-DENY'), 'quantity', 2))
);
select public.deny_order(
  '20000000-0000-0000-0000-000000000021',
  (select line.order_id from public.order_lines as line join public.products as product on product.id = line.product_id where product.article_code = 'RT-DENY' and line.is_current),
  'Fictional denial reason'
);
select pg_temp.assert_true(
  (select reserved_quantity = 0 from public.stock_levels where product_id = (select id from public.products where article_code = 'RT-DENY')),
  'denial must release reservations'
);
select pg_temp.assert_raises(
  $$select * from public.start_order_delivery('20000000-0000-0000-0000-000000000022', (select line.order_id from public.order_lines as line join public.products as product on product.id = line.product_id where product.article_code = 'RT-DENY' and line.is_current))$$,
  'DENIED must be terminal'
);

-- Exact request retries are harmless; changed payloads with the same ID fail.
select public.initialize_stock_level('20000000-0000-0000-0000-000000000023', (select id from public.products where article_code = 'RT-IDEMPOTENT'), 0, 'Fictional count');
select public.record_stock_receipt('20000000-0000-0000-0000-000000000024', (select id from public.products where article_code = 'RT-IDEMPOTENT'), 1, 'Same retry');
select public.record_stock_receipt('20000000-0000-0000-0000-000000000024', (select id from public.products where article_code = 'RT-IDEMPOTENT'), 1, 'Same retry');
select pg_temp.assert_true(
  (select physical_quantity = 1 from public.stock_levels where product_id = (select id from public.products where article_code = 'RT-IDEMPOTENT')),
  'identical receipt retry must not repeat the movement'
);
select pg_temp.assert_raises(
  $$select * from public.record_stock_receipt('20000000-0000-0000-0000-000000000024', (select id from public.products where article_code = 'RT-IDEMPOTENT'), 2, 'Changed quantity')$$,
  'same request ID with changed payload must fail'
);

-- Revised quantity keeps original price/catalog snapshots and writes immutable audit history.
select public.initialize_stock_level('20000000-0000-0000-0000-000000000025', (select id from public.products where article_code = 'RT-HISTORY'), 5, 'Fictional count');
select public.create_admin_order(
  '20000000-0000-0000-0000-000000000026',
  (select salon_client_id from public.profiles where id = '10000000-0000-0000-0000-000000000001'),
  'phone', 'APPROVED', null, null, null, null, null, null, null, null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where article_code = 'RT-HISTORY'), 'quantity', 2))
);
reset role;
update private.product_prices set retail_price = 99.00 where product_id = (select id from public.products where article_code = 'RT-HISTORY');
update public.products
set article_code = 'RT-HISTORY-CHANGED', series_name = 'Changed Series', name = 'Changed Product', size_label = '999 ml', shade_number = '0.0', shade_name = 'Changed', developer_concentration = '60 VOL'
where article_code = 'RT-HISTORY';
update public.brands set name = 'Runtime Changed Brand' where name = 'Runtime Original Brand';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.replace_approved_order_lines(
  '20000000-0000-0000-0000-000000000027',
  (select line.order_id from public.order_lines as line join public.products as product on product.id = line.product_id where product.article_code = 'RT-HISTORY-CHANGED' and line.is_current),
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where article_code = 'RT-HISTORY-CHANGED'), 'quantity', 3))
);
reset role;
select pg_temp.assert_true(
  exists (
    select 1 from public.order_line_quantity_changes as change
    join public.order_lines as line on line.id = change.order_line_id
    where line.is_current and change.previous_quantity = 2 and change.new_quantity = 3
  ),
  'quantity edit must write immutable prior-quantity audit'
);
select pg_temp.assert_true(
  exists (
    select 1
    from public.order_lines as line
    join private.order_line_price_snapshots as price_snapshot on price_snapshot.order_line_id = line.id
    where line.is_current
      and line.product_name_snapshot = 'Runtime Historical Product'
      and line.product_article_code_snapshot = 'RT-HISTORY'
      and line.brand_name_snapshot = 'Runtime Original Brand'
      and line.product_series_name_snapshot = 'Runtime History'
      and line.product_shade_number_snapshot = '7.1'
      and line.product_shade_name_snapshot = 'Ash'
      and line.product_developer_concentration_snapshot = '20 VOL'
      and line.product_size_snapshot = '250 ml'
      and price_snapshot.retail_price = 10.00
  ),
  'catalog and price changes must not rewrite existing line snapshots'
);

rollback;
