\set ON_ERROR_STOP on

-- Disposable local fixtures for the two independent concurrent sessions.
begin;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('30000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'concurrency-admin@example.test', 'not-a-real-password', now()),
  ('30000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'concurrency-a@example.test', 'not-a-real-password', now()),
  ('30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'concurrency-b@example.test', 'not-a-real-password', now());

update public.profiles set role = 'admin', approval_status = 'approved'
where id = '30000000-0000-0000-0000-000000000001';
update public.profiles set approval_status = 'approved'
where id in ('30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003');

insert into public.brands (name) values ('Concurrency Brand');
insert into public.product_categories (name, product_group) values ('Concurrency Technical', 'technical');
insert into public.products (brand_id, category_id, article_code, name, size_label, is_hidden)
select brand.id, category.id, 'CONC-ONE', 'Concurrency Product', '1 unit', true
from public.brands as brand cross join public.product_categories as category
where brand.name = 'Concurrency Brand' and category.name = 'Concurrency Technical';
insert into private.product_prices (product_id, retail_price)
select id, 10.00 from public.products where article_code = 'CONC-ONE';
update public.products set is_hidden = false where article_code = 'CONC-ONE';

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select public.initialize_stock_level(
  '31000000-0000-0000-0000-000000000001',
  (select id from public.products where article_code = 'CONC-ONE'),
  1,
  'One fictional unit for concurrent approval'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
select public.submit_website_order(
  '31000000-0000-0000-0000-000000000002', null, null, null, null, null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where article_code = 'CONC-ONE'), 'quantity', 1))
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
select public.submit_website_order(
  '31000000-0000-0000-0000-000000000003', null, null, null, null, null,
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where article_code = 'CONC-ONE'), 'quantity', 1))
);
reset role;

commit;
