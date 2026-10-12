# GROWUP test report

Run date: 2026-10-12

## Passed locally

- Both HTML files contain one HTML root and one closing HTML tag.
- Inline JavaScript in `index.html` and `admin.html` passes `node --check` syntax validation.
- Frontend HTML contains no Supabase service-role key or Resend API key.
- Required schema, Edge Function, setup guide, environment example and Netlify config are present.
- Schema contains lead read RLS policy and notification tracking fields.
- Dashboard contains all requested lead status summary cards and status/industry/service/date filtering controls.
- `tests/smoke_check.py` passes.

## Not tested / blocked by missing external setup

- Supabase SQL execution and RLS behavior against a real project.
- Edge Function deployment/runtime in Deno.
- Actual form submission, database persistence and duplicate handling against Supabase.
- Actual Resend delivery to `growupcosting@gmail.com`.
- Auth login, password recovery email and unauthorized-user denial in a live project.
- Browser-based responsive/console testing and production end-to-end submission.
- Hosting deployment and custom-domain verification.
- Google Sheets sync (not implemented/enabled in this package).

These are not reported as passed. Complete the provider setup in `README-SETUP.md` and rerun the end-to-end checklist before public launch.
