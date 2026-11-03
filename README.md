# salon-orders

`salon-orders` is a Bulgarian-language application for managing hair-product catalogs, salon clients, inventory, orders, and sales reports. It is a SoftUni AI course project.

The planned functionality and open product decisions are documented in [docs/project-spec.md](docs/project-spec.md).

## Requirements

- Node.js 20 or later
- npm (use `npm.cmd` on this Windows setup)

## Install and start locally

```powershell
npm.cmd install
npm.cmd run dev
```

Vite will print a local address, usually `http://localhost:5173`.

## Supabase local configuration

1. Copy `.env.example` to a new local-only file named `.env.local`.
2. In the Supabase Dashboard, open the project and select **Connect**. Copy the
   **Project URL** and the **publishable key** shown for JavaScript clients.
   The same values are also available in **Project Settings > API Keys**.
3. Set the following values in `.env.local`, then restart Vite:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

`.env.local` is ignored by Git. The publishable key is intended for browser
clients and remains constrained by Supabase Row Level Security. Never place a
secret/service-role key or a database password in a Vite environment variable
or frontend source file.

If these variables are absent or the URL is invalid, the home page still loads
and shows a configuration notice. No authentication or data access is started
until a later feature uses the shared client.

## Available commands

- `npm.cmd run dev` — starts the development server.
- `npm.cmd run build` — creates an optimized production build in `dist`.
- `npm.cmd run preview` — serves the production build locally after building it.

## Project structure

- `src/components/` — shared interface components.
- `src/pages/` — individual page modules.
- `src/styles/` — application styles.
