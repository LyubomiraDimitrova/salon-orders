-- Fictional catalog data for local development and demonstrations only.
-- This is intentionally separate from schema migrations.
-- It creates no stock records and references no external images.

begin;

insert into public.brands (name, sort_order)
values
  ('DEMO Aurora Botanics', 10),
  ('DEMO Nova Color Lab', 20)
on conflict (name) do nothing;

insert into public.product_categories (name, product_group, sort_order)
values
  ('DEMO Shampoo', 'hair_care', 10),
  ('DEMO Mask', 'hair_care', 20),
  ('DEMO Hair Dye', 'dye', 30),
  ('DEMO Developer', 'developer', 40)
on conflict (product_group, name) do nothing;

-- Products are inserted as hidden drafts first. The publication update below
-- runs only after their fictional retail prices exist in private.product_prices.
with product_seed (
  brand_name,
  category_name,
  product_group,
  article_code,
  series_name,
  name,
  description,
  size_label,
  shade_number,
  shade_name,
  shade_color,
  developer_concentration,
  is_recommended
) as (
  values
    (
      'DEMO Aurora Botanics', 'DEMO Shampoo', 'hair_care', 'DEMO-AB-SHAM-250',
      'DEMO Aura Balance', 'DEMO Aura Balance Shampoo',
      'Fictional daily shampoo for the demo catalog.', '250 ml',
      null, null, null, null, true
    ),
    (
      'DEMO Aurora Botanics', 'DEMO Shampoo', 'hair_care', 'DEMO-AB-SHAM-075',
      'DEMO Aura Balance', 'DEMO Aura Balance Travel Shampoo',
      'Fictional travel-size shampoo for the demo catalog.', '75 ml',
      null, null, null, null, false
    ),
    (
      'DEMO Aurora Botanics', 'DEMO Mask', 'hair_care', 'DEMO-AB-MASK-200',
      'DEMO Silk Restore', 'DEMO Silk Restore Mask',
      'Fictional restorative mask for the demo catalog.', '200 ml',
      null, null, null, null, false
    ),
    (
      'DEMO Aurora Botanics', 'DEMO Mask', 'hair_care', 'DEMO-AB-MASK-500',
      'DEMO Silk Restore', 'DEMO Silk Restore Salon Mask',
      'Fictional salon-size mask for the demo catalog.', '500 ml',
      null, null, null, null, false
    ),
    (
      'DEMO Nova Color Lab', 'DEMO Hair Dye', 'dye', 'DEMO-NC-DYE-074',
      'DEMO Prism Tone', 'DEMO Prism Tone Hair Dye',
      'Fictional hair dye for the demo catalog.', '60 ml',
      '7.4', 'Меден рус', '#C96A3E', null, true
    ),
    (
      'DEMO Nova Color Lab', 'DEMO Developer', 'developer', 'DEMO-NC-DEV-20V',
      'DEMO Prism Tone', 'DEMO Prism Tone Developer',
      'Fictional developer for the demo catalog.', '1000 ml',
      null, null, null, '20 VOL', false
    ),
    (
      'DEMO Nova Color Lab', 'DEMO Hair Dye', 'dye', 'DEMO-NC-DYE-HIDDEN',
      'DEMO Prism Tone', 'DEMO Prism Tone Hidden Draft',
      'Fictional hidden draft for the demo catalog.', '60 ml',
      '9.1', 'Пепеляв рус', '#B7B1AA', null, false
    )
),
resolved_products as (
  select
    brands.id as brand_id,
    categories.id as category_id,
    product_seed.*
  from product_seed
  join public.brands as brands on brands.name = product_seed.brand_name
  join public.product_categories as categories
    on categories.name = product_seed.category_name
    and categories.product_group = product_seed.product_group
)
insert into public.products (
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
)
select
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
  null,
  true,
  is_recommended
from resolved_products
on conflict do nothing;

-- All prices below are fictional EUR values including VAT.
with price_seed (article_code, retail_price) as (
  values
    ('DEMO-AB-SHAM-250', 12.90::numeric),
    ('DEMO-AB-SHAM-075', 6.50::numeric),
    ('DEMO-AB-MASK-200', 18.90::numeric),
    ('DEMO-AB-MASK-500', 34.90::numeric),
    ('DEMO-NC-DYE-074', 9.90::numeric),
    ('DEMO-NC-DEV-20V', 11.90::numeric),
    ('DEMO-NC-DYE-HIDDEN', 10.90::numeric)
)
insert into private.product_prices (product_id, retail_price)
select products.id, price_seed.retail_price
from price_seed
join public.products on products.article_code = price_seed.article_code
on conflict (product_id) do nothing;

-- Publish only the six intended demo products. The additional DEMO hidden draft
-- remains hidden, and the trigger verifies publication prerequisites.
update public.products
set is_hidden = false
where article_code in (
  'DEMO-AB-SHAM-250',
  'DEMO-AB-SHAM-075',
  'DEMO-AB-MASK-200',
  'DEMO-AB-MASK-500',
  'DEMO-NC-DYE-074',
  'DEMO-NC-DEV-20V'
)
and is_hidden = true;

commit;
