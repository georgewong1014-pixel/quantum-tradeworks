-- Quantum Tradeworks: the enquiry store.
--
-- Run once in the Supabase project's SQL editor. It can be run again on a
-- live table: nothing here deletes or truncates.
--
-- What it makes: one table that only the server's secret key can reach, and
-- one view for the person who tracks enquiries. No file bucket: the site
-- accepts no files with an enquiry.
--
-- It holds no secret. The project's address and key are set as deployment
-- variables by the owner (docs/enquiry-submission.md) and are never written
-- in this repository.

create table if not exists public.qt_enquiries (
  submission_id uuid        not null unique,   -- made in the visitor's browser; the only key
  reference     text        not null,          -- QTE-YYMMDD-XXXX, made by the site; a label, not a key
  kind          text        not null default 'enquiry',
  created_at    timestamptz not null default now(),
  topic         text,
  name          text,
  email         text,
  phone         text,
  reply_by      text check (reply_by in ('email', 'phone')),
  main_need     text,                          -- the first line of what was asked, for the list
  "values"      jsonb       not null default '{}'::jsonb,   -- everything the visitor sent
  notify_status text        not null default 'pending' check (notify_status in ('pending', 'sent', 'failed', 'not-configured')),

  -- Written by a person, never by the site.
  logged_at     timestamptz,                   -- when a person opened and logged it
  logged_by     text,
  owner         text,                          -- who owns the next action
  status        text        not null default 'New enquiry' check (status in ('New enquiry', 'Fit checked', 'Discovery completed', 'Offer prepared', 'Awaiting decision', 'Won / onboarding', 'In delivery', 'Completed / support', 'Closed / paused')),
  outcome       text check (outcome in ('Proceed', 'Clarify', 'Alternative / referral', 'Not suitable now')),
  next_action   text,
  due_date      date,
  related_ref   text,                          -- a quotation or project reference, once there is one
  staff_note    text
);

alter table public.qt_enquiries add column if not exists outcome text check (outcome in ('Proceed', 'Clarify', 'Alternative / referral', 'Not suitable now'));
alter table public.qt_enquiries add column if not exists staff_note text;

create index if not exists qt_enquiries_created_at on public.qt_enquiries (created_at desc);

-- Row-level security on, and no policy: nothing but the service role can
-- read or write. The public roles hold no privilege at all.
alter table public.qt_enquiries enable row level security;
revoke all on public.qt_enquiries from anon, authenticated;
grant select, insert, update on public.qt_enquiries to service_role;   -- no delete: a row is deleted only by a person, in the dashboard

-- What the person tracking enquiries looks at, oldest unlogged first.
drop view if exists public.qt_enquiries_open;
create or replace view public.qt_enquiries_open with (security_invoker = true) as
  select reference, created_at as received, topic, main_need, name, reply_by, owner, status, outcome, next_action, due_date, related_ref, notify_status, logged_at, logged_by, submission_id
    from public.qt_enquiries
   where status <> 'Closed / paused'
   order by (logged_at is null) desc, created_at asc;
revoke all on public.qt_enquiries_open from anon, authenticated;
grant select on public.qt_enquiries_open to service_role;
