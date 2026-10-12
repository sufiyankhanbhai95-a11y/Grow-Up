# GROWUP Consultation & Lead Management System

This package preserves the supplied GROWUP public website as a single `index.html` file and adds a separate `admin.html` dashboard. It is a deployable source package, **not a live connected deployment**. No Supabase, Resend, Netlify, domain, or Google account credentials were available in this workspace, so live database/email/deployment verification has not been possible.

## Included

- `index.html` — public GROWUP website, costing assessment, existing sections and consultation form.
- `admin.html` — Supabase Auth login, admin allowlist check, private lead dashboard, summary cards, search, status/industry/service/date filters, sorting, pagination, detail view, status/notes/follow-up updates and filtered CSV export.
- `supabase/schema.sql` — lead schema, notification tracking fields, indexes and RLS policies.
- `supabase/functions/growup-intake/index.ts` — server-side validated intake endpoint; inserts with the service-role key and sends a Resend email notification after saving.
- `supabase/config.toml` — public function configuration.
- `netlify.toml` — static publishing and baseline security headers.
- `.env.example` — placeholders only; never paste secrets into public HTML.
- `.gitignore` — excludes secrets and local dependencies.

## 1. Create and configure Supabase

1. Create a project at <https://supabase.com>.
2. In **Project Settings → API**, copy the project URL and publishable/anon key.
3. Open **SQL Editor** and run all of `supabase/schema.sql`.
4. In **Authentication → Users**, create the first administrator using a unique strong password. Disable public sign-ups in Auth settings if you do not want visitors creating accounts.
5. Copy the administrator's Auth user UUID. Run this SQL after replacing the placeholder:

   ```sql
   insert into public.admin_users (user_id)
   values ('PASTE_AUTH_USER_UUID_HERE');
   ```

   Do not give client/browser access to insert or update `admin_users`. Only trusted user UUIDs should be added.
6. In both `index.html` and `admin.html`, replace the public placeholders with the actual project URL and publishable/anon key. The publishable/anon key is designed for browser use; **never use a service-role key in either HTML file**.
7. Configure the Auth site's allowed redirect URLs to include your final site origin and admin page. Enable MFA for the administrator where available. Password recovery requires a configured Supabase email/SMTP delivery setup.

## 2. Configure and deploy the intake function

Install the Supabase CLI, open a terminal in this folder, then run:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set RESEND_API_KEY=re_your_real_key
supabase secrets set 'FROM_EMAIL=GROWUP Notifications <notifications@your-verified-domain.com>'
supabase secrets set NOTIFICATION_EMAIL=growupcosting@gmail.com
supabase secrets set ALLOWED_ORIGIN=https://your-production-domain.example
supabase secrets set ADMIN_DASHBOARD_URL=https://your-production-domain.example/admin.html
supabase functions deploy growup-intake --no-verify-jwt
```

The function needs the standard Supabase Edge Function environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase provides to deployed functions. Never copy `SUPABASE_SERVICE_ROLE_KEY` to the browser. `FROM_EMAIL` must use a sender/domain verified with Resend. The notification recipient defaults to `growupcosting@gmail.com`.

The endpoint URL is:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/growup-intake`

The current function includes server-side field validation, a honeypot, best-effort per-isolate rate limiting, short-window duplicate detection, and notification status tracking. For a public production launch, add Cloudflare Turnstile verification and a shared/distributed rate limiter. The in-memory rate limit is not a substitute for a shared production rate-limit service. Set `ALLOWED_ORIGIN` to the exact deployed origin before launch.

### Email delivery behavior

The lead is inserted first. If Resend is unavailable, the lead remains in Supabase and the endpoint reports that notification delivery failed while returning the confirmed reference. Notification status/error metadata is stored on the lead for operational visibility. Automatic scheduled retry processing is not configured in this package; retrying failed messages requires a follow-up Edge Function/job or manual resend workflow.

## 3. Host the website

### Netlify

1. Create a private Git repository containing the package, or upload the files through Netlify's authorized deploy workflow.
2. Deploy the folder with `netlify.toml` at its root. Publish directory is `.`.
3. Configure the custom domain if you own one, then update `ALLOWED_ORIGIN` and `ADMIN_DASHBOARD_URL` to the final HTTPS origin.
4. Verify that the public URL and `/admin.html` both load over HTTPS.

No hosting account was available to deploy from this workspace, so no public URL is claimed here.

## 4. Verify the full workflow before launch

1. Submit a test consultation with valid fields, at least one service, and consent.
2. Confirm the public form displays the returned reference number.
3. Confirm the lead appears in Supabase → Table Editor → `leads`.
4. Confirm `notification_status` becomes `sent` or `failed` and inspect the provider dashboard/email inbox.
5. Sign in at `/admin.html` with the authorized account; verify the new lead is visible.
6. Try an Auth account not listed in `admin_users`; it must not be able to read leads.
7. Update status, notes and follow-up date; refresh and verify changes persist.
8. Test all filters, search, pagination and CSV export. Check that CSV cells beginning with `=`, `+`, `-` or `@` are escaped.
9. Test missing/invalid fields, empty service selection, missing consent, a filled honeypot, repeated submissions, and a simulated email-provider failure.
10. Check mobile layout and browser console on both pages. Remove any test records before launch.

## 5. Optional Google Sheets integration

Google Sheets sync is **not enabled in this package**. The database remains authoritative. To add Sheets safely, implement a server-side append operation (for example, an authenticated Apps Script web app or Google API service account) called only after the Supabase insert. Include the lead UUID as the idempotency key, and have the destination sheet reject duplicate UUIDs. Store all Google credentials/URLs in server-side secrets, not HTML. Configure a retry job and log sync status separately before treating the integration as production-ready.

## Security and operational notes

- RLS is enabled on `leads` and `admin_users`; anonymous table inserts and public reads are intentionally not permitted. The public form writes only through the Edge Function.
- A publicly accessible `/admin.html` URL is fine; access depends on Supabase Auth, the admin allowlist and RLS, not obscurity.
- Use HTTPS only. Keep secrets out of source control. `.env.example` contains placeholders only.
- The rate limiter is best-effort and isolate-local. Add Turnstile plus shared rate limiting before advertising the form broadly.
- The website has no configured Supabase URL/key in the distributed HTML, so the form intentionally refuses to claim success until configured and a real successful response is received.
- Existing browser-only/localStorage demo leads, if any, are not migrated automatically.
- Database backups/PITR depend on the selected Supabase plan. Configure and periodically test backups/restore according to your data retention requirements.
