# Orders and inventory runtime tests

These tests target a disposable **local** Supabase/Postgres stack after all
migrations, including `20261105160958_orders_inventory.sql`, have been applied.
They use only fictional UUIDs, email addresses, salons, products, and prices.

## Serial suite

Run the local database reset using the team's existing Supabase environment,
then execute `orders_inventory_runtime.sql` with `psql` as the local database
owner. The file encloses all fixtures and assertions in `BEGIN`/`ROLLBACK`, so
it leaves no test data behind. It covers line validation, approval and
ownership RLS, stock states and reservations, denial and terminal statuses,
idempotency, price/history snapshots, and private/admin-only access.

The runner must expose Supabase's normal `authenticated` and `anon` roles and
allow the database owner to set `request.jwt.claim.sub`; this is how a local
Supabase stack simulates browser JWT requests.

## Concurrency suite

Concurrency cannot be tested inside the serial file's rollback transaction:
two independent sessions are necessary for row locks to contend.

1. Run `orders_inventory_concurrency_setup.sql` once. It commits only its
   disposable fixtures.
2. In terminal A, run `orders_inventory_concurrency_a.sql`.
3. While A is sleeping with the stock-level lock held, run
   `orders_inventory_concurrency_b.sql` in terminal B.
4. Run `orders_inventory_concurrency_verify.sql`; it asserts that the two
   approved orders reserve at most the one available unit.
5. Remove the disposable local database with the normal local reset command.

The setup and the concurrent sessions deliberately use independent committed
transactions. Do not run these scripts against a linked or hosted project.
