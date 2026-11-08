# Salon Orders

Salon Orders is a Bulgarian-language, mobile-first application for a hair-product distributor that works with salons. It supports a public catalogue, approved-client ordering, and administration of catalogue data, salon clients, inventory, orders, price lists, and delivered-sales unit reports. It is a SoftUni AI course project.

## Technology

- HTML, CSS, plain JavaScript, Bootstrap, and Vite
- Supabase Auth, Postgres, Storage, and Row Level Security (RLS)
- Local Fontsource Manrope files with Cyrillic subsets

The application is a Vite multi-page site; it does not use TypeScript, React, or Vue.

## Access and capabilities

| Visitor | Registered pending client | Approved client | Approved administrator |
| --- | --- | --- | --- |
| Browse the public catalogue. | Browse the catalogue and update linked salon/contact data while awaiting approval. | Browse the catalogue; manage a per-account cart; submit website orders; view own orders; update own profile. | Manage salon clients and approvals, products, prices, price-list files, inventory, phone/Viber orders, reservations, delivery, denials, and sales-unit reports. |

Only approved clients can place website orders or see their own order history. Prices and order-price snapshots are protected administrator data; access is enforced by Supabase policies and narrowly scoped database operations, not by hiding UI alone.

## Local setup on Windows

Requirements:

- Node.js 20 or later
- npm; use `npm.cmd` in this Windows workspace

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Create a local-only `.env.local` from `.env.example` and set only these variable names with your project values:

   ```dotenv
   VITE_SUPABASE_URL=
   VITE_SUPABASE_PUBLISHABLE_KEY=
   ```

   Do not put a Supabase service-role key, database password, or personal credential in a Vite variable or repository file.

3. Run the application:

   ```powershell
   npm.cmd run dev
   ```

Useful commands:

```powershell
npm.cmd run dev
npm.cmd run build
npm.cmd run preview
```

`build` writes the production bundle to `dist`; `preview` serves that bundle locally after a build.

## Pages and key folders

| Area | Location |
| --- | --- |
| Home and public/client navigation | `index.html`, `src/pages/homePage.js` |
| Catalogue | `catalog.html`, `src/catalog/` |
| Authentication and profiles | `login.html`, `register.html`, `profile.html`, `src/auth/` |
| Client cart and order history | `cart.html`, `orders.html`, `src/orders/` |
| Administrator clients, catalogue, orders, inventory, and reports | `admin.html`, `admin-products.html`, `admin-orders.html`, `inventory.html`, `reports.html` and their matching `src/` folders |
| Shared UI and application styles | `src/components/`, `src/styles/` |
| Supabase migrations, Dashboard scripts, seeds, and SQL test scripts | `supabase/` |
| Project notes, migration history, and schema diagram | `docs/` |

The current database relationships are documented in [docs/database-relationships.md](docs/database-relationships.md).

## Database migration workflow

The committed files in `supabase/migrations/` are the source-controlled schema history. Do not edit an applied migration and do not rerun it against hosted data.

When a reviewed migration must be applied through the Supabase Dashboard:

1. Review the versioned SQL in `supabase/migrations/` and the matching `supabase/manual-apply-<version>_<name>.sql` script when one is provided.
2. Apply the reviewed Dashboard script manually in the intended project; do not substitute an ad-hoc rewrite.
3. Verify the result with the approved read-only checks for that change.
4. Record the application and any verification limits in [docs/migration-history.md](docs/migration-history.md).

Manual Dashboard scripts are included for the product-deletion, price-list storage, category-reporting, and price-list-deletion-policy changes. They are application aids, not a request to apply SQL automatically from this repository.

## Current limitations and deferred work

- Deployment URL: **pending**.
- Demo-account setup: **pending**. No personal accounts or credentials are documented here.
- Email notification delivery has audit-table support, but no worker or delivery integration is implemented.
- Reports currently focus on delivered sales units and product/category breakdowns; revenue, purchase-price, brand, and salon-client reporting remain deferred.
- Product variants, online payments, and automated order-status changes are outside the current implementation.
- Historical delivery time values remain stored for compatibility. Current client order cards do not display a requested time interval, and new admin actual-delivery operations use a date-only Europe/Sofia noon timestamp convention.

## Validation status

Completed local checks:

- `npm.cmd run build` completes successfully.
- `git diff --check` completes without whitespace errors.
- Source inspection confirms UTF-8 HTML entry points with `lang="bg"`, bundled Cyrillic Manrope weights used by the interface, and system font fallbacks.

User-reported manual validation:

- The user reports that the completed manual tests are OK. This is user-reported functional validation, not an automated test result.

Not performed or not claimed as passed:

- Automated browser/end-to-end tests.
- Independent security or full RLS authorization testing.
- Network-failure, retry, concurrency, and session-loss test scenarios beyond the user-reported manual checks.

See [docs/migration-history.md](docs/migration-history.md) for the narrower user-reported tests recorded with individual manually applied migrations.
