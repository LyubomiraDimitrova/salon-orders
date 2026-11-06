# Migration History

## 20261103163512 — Catalog foundation

The remote Supabase migration history records `catalog_foundation` at version
`20261103163512`. It was applied from the SQL originally committed locally as
`20261103161122_catalog_foundation.sql`.

On 2026-11-03, the stored remote statement was verified as byte-equivalent to
the committed SQL (SHA-256
`7929fc22963e104358d80215c64f46b47e3989ec0e7b2146e369b591205a8f84`). The
local migration was therefore renamed to
`supabase/migrations/20261103163512_catalog_foundation.sql` to match the
remote version. The remote migration history was not altered and the migration
was not reapplied.

## 20261103190742 — Auth profiles and approval

The remote Supabase migration history records `auth_profiles_and_approval` at
version `20261103190742`. It was applied from the SQL committed locally as
`20261103185550_auth_profiles_and_approval.sql`.

On 2026-11-03, the stored remote statement was verified as equivalent to the
committed SQL after the migration tool's trailing-newline normalization: both
were 5,596 characters with MD5 `7962fc78917c2d26c14b7bb338d0f3c6`. The local
migration was therefore renamed to
`supabase/migrations/20261103190742_auth_profiles_and_approval.sql` to match
the remote version. The remote migration history was not altered and the
migration was not reapplied.

## 20261104174602 - Admin catalog management

The remote Supabase migration history records `admin_catalog_management` at
version `20261104174602`. The migration mechanism assigned that version when
the SQL committed in `dc4ac13` was applied on 2026-11-04; the pending local
filename had used version `20261104120000`.

The SQL was verified as byte-equivalent to the committed migration (Git blob
`5cd746ecb15bdbfbffa002fd1a58c7fddabf5e5a`) and was not modified. The local
migration was renamed to
`supabase/migrations/20261104174602_admin_catalog_management.sql` to match
the remote version. The remote migration history was not altered after
application, and the migration was not reapplied.

## 20261105170526 - Orders and inventory

The remote Supabase migration service assigned version `20261105170526` when
the reviewed `orders_inventory` SQL was applied on 2026-11-05. The committed
local filename had used version `20261105160958`.

The remote stored statement was verified as equivalent to the local SQL after
the migration service's final-CRLF normalization: both were 71,903 UTF-8 bytes
with MD5 `68c8a026bdc23d4a34e03b206b84fcf0`. The local migration was therefore
renamed to `supabase/migrations/20261105170526_orders_inventory.sql` to match
the remote history. The remote migration was not reapplied.

## 20261105185529 - Require website delivery date

The remote Supabase migration service assigned version `20261105185529` to
`require_website_delivery_date` when it applied the SQL committed in
`ca4501d`. The committed local filename had used version `20261105193131`.

The stored remote `submit_website_order` definition was verified against the
committed function body after the service's leading-and-trailing-newline
normalization: both are 2,624 UTF-8 bytes with MD5
`796e4a4aec04313965b958766cfa0096`. The `authenticated` execute grant is
present, and `anon` and `public` do not have execute access. The local
migration was therefore renamed to
`supabase/migrations/20261105185529_require_website_delivery_date.sql` to
match the remote history. The remote migration history and SQL were not
altered, and the migration was not reapplied.

## 20261106144130 - Admin sales reporting

The remote Supabase migration service assigned version `20261106144130` to
`admin_sales_reporting` when it applied the SQL committed in `308bb0d`. The
committed local filename originally used version `20261106154358`.

On 2026-11-06, the remote migration record was inspected and its one stored
statement was verified as identical to the committed reporting SQL (Git blob
`94ba7c5b55f4f159a08164026dc453e8691f5eba`). The remote function definitions,
explicit grants, and partial index were also verified. The local migration was
therefore renamed to
`supabase/migrations/20261106144130_admin_sales_reporting.sql` to match the
remote history. The SQL was not changed, and the remote migration was not
reapplied.
