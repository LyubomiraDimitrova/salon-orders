# Netlify deployment checklist

## Prepared repository configuration

`netlify.toml` configures this Vite multi-page application to run:

- build command: `npm run build`
- publish directory: `dist`
- build Node.js version: `24`

No redirect rule is configured. The application publishes individual HTML files such as `catalog.html`, `cart.html`, and `admin-orders.html`; a single-page-app catch-all rewrite would interfere with those URLs.

## Netlify environment variables

Before the first production build, add these exact variable names in the Netlify project environment settings for the production deploy context:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Do not commit values to `netlify.toml`, source files, or documentation. Vite embeds `VITE_` variables in the browser bundle, so the value for `VITE_SUPABASE_PUBLISHABLE_KEY` must be the Supabase publishable client key, never a service-role key or database password. RLS remains responsible for backend authorization.

## Supabase Auth after the live URL is known

The current application uses password login and calls `signUp` without an `emailRedirectTo` option. If email confirmation is enabled, Supabase uses the configured Auth Site URL for the confirmation destination.

After Netlify assigns the production URL, update Supabase Auth URL Configuration manually:

1. Set **Site URL** to the exact production Netlify origin, for example `https://your-site.netlify.app`.
2. Add the production origin to **Redirect URLs**. Use the exact URL or an intentionally scoped path pattern supported by Supabase, such as `https://your-site.netlify.app/**` when appropriate for the project.
3. Keep local development URLs allowed only when needed, for example `http://localhost:5173/**`.
4. If a future email-confirmation, password-reset, or magic-link flow adds `emailRedirectTo`, add that exact callback URL to the allowlist first. This project currently has no dedicated callback page and does not set `emailRedirectTo`.

Do not make these Supabase changes until the real Netlify URL is known and authorized. Deploy preview URLs should be allowlisted only if those auth-link flows are intentionally tested there.

## Next deployment step

Create or link the Netlify site in the Netlify UI, set the two production environment variables, and confirm the generated production URL. Then update the Supabase Auth Site URL and redirect allowlist before publishing the first production deploy. No site has been created or published by this preparation.
