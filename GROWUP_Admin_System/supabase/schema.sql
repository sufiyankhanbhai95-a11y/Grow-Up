-- GROWUP secure consultation lead database (run in Supabase SQL Editor)
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  company text not null,
  designation text,
  email text not null,
  phone text not null,
  industry text not null,
  services_required text[] not null default '{}',
  details text not null,
  method text not null,
  preferred_consultation_date date,
  preferred_time text,
  consent boolean not null default false,
  consent_at timestamptz,
  source text,
  status text not null default 'New' check (status in ('New','Contacted','Qualified','Consultation Scheduled','Proposal Sent','Negotiation','Converted','Not Converted')),
  notes text not null default '',
  follow_up_date date,
  updated_at timestamptz not null default now(),
  notification_status text not null default 'pending' check (notification_status in ('pending','sent','failed')),
  notification_attempts integer not null default 0 check (notification_attempts >= 0),
  notification_last_error text,
  notification_updated_at timestamptz
);

-- Safe to re-run on an existing project.
alter table public.leads add column if not exists preferred_consultation_date date;
alter table public.leads add column if not exists consent_at timestamptz;
-- Normalize an older text-based preferred date column when upgrading an existing installation.
alter table public.leads alter column preferred_consultation_date type date using case when preferred_consultation_date::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then preferred_consultation_date::text::date else null end;
alter table public.leads add column if not exists notification_status text not null default 'pending';
alter table public.leads add column if not exists notification_attempts integer not null default 0;
alter table public.leads add column if not exists notification_last_error text;
alter table public.leads add column if not exists notification_updated_at timestamptz;
alter table public.leads drop constraint if exists leads_notification_status_check;
alter table public.leads add constraint leads_notification_status_check check (notification_status in ('pending','sent','failed'));
alter table public.leads drop constraint if exists leads_notification_attempts_check;
alter table public.leads add constraint leads_notification_attempts_check check (notification_attempts >= 0);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_industry_idx on public.leads (industry);

alter table public.admin_users enable row level security;
alter table public.leads enable row level security;

create or replace function public.is_growup_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

revoke all on function public.is_growup_admin() from public;
grant execute on function public.is_growup_admin() to authenticated;

-- Admin can see their own allowlist membership; no client-side writes to the allowlist.
drop policy if exists "Admins can read own membership" on public.admin_users;
create policy "Admins can read own membership" on public.admin_users
for select to authenticated using (user_id = auth.uid());

drop policy if exists "Admins can read leads" on public.leads;
create policy "Admins can read leads" on public.leads
for select to authenticated using (public.is_growup_admin());

drop policy if exists "Admins can update leads" on public.leads;
create policy "Admins can update leads" on public.leads
for update to authenticated using (public.is_growup_admin()) with check (public.is_growup_admin());

-- Intentionally no anon/authenticated INSERT policy on leads. Only the server-side
-- Edge Function, using SUPABASE_SERVICE_ROLE_KEY, inserts public form submissions.
-- Never expose the service-role key in index.html or admin.html.
