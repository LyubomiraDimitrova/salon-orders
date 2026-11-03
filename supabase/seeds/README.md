# Demo catalog seed

`demo-catalog.sql` contains only fictional, clearly labelled `DEMO` brands,
categories, products, and prices. It is not a migration and does not create
stock records, users, or external image references.

## Run it deliberately

Run this seed only against a disposable local, development, or demonstration
database after the catalog foundation migration has been applied. Do not run it
against production data.

1. Open the target project's Supabase Dashboard and choose **SQL Editor**.
2. Open `supabase/seeds/demo-catalog.sql`, copy its complete contents, and run
   it as a database administrator.
3. Review the transaction result. The script commits only if all seed rows,
   prices, and publication checks succeed.

The repository intentionally does not configure this file as an automatic CLI
seed path. It therefore will not run during a database reset unless a future,
explicit local-development configuration adds it.

## Re-running

The script uses stable `DEMO` brand names, category pairs, article codes, and
price product IDs with `ON CONFLICT DO NOTHING`. Re-running it adds only
missing demo rows; it does not duplicate records or overwrite unrelated data.
