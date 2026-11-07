-- ─────────────────────────────────────────────────────────────
-- IT Help Desk — database schema (run once in the Supabase SQL Editor
-- of the IT Help Desk's OWN Supabase project). Safe to run again.
--
-- Categories, canned replies and help articles are filled with defaults
-- automatically the first time someone opens the app.
-- ─────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- 1. Departments (managed in the Admin Console; names in English and Arabic)
create table if not exists departments (
  id    text primary key,
  name  jsonb not null,                 -- {"en": "...", "ar": "..."}
  icon  text not null default '🏢',
  sort  int not null default 0
);

-- 2. Users. Anyone on an allowed email domain is added automatically on first
--    sign-in as an employee; admins set departments, managers and roles.
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text not null,
  dept_id       text references departments(id) on delete set null,
  manager_id    uuid references users(id) on delete set null,   -- approves this person's requests
  role          text not null default 'requester' check (role in ('requester','agent','manager','admin')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists users_email_unique on users (lower(email));

-- 3. Sign-in sessions (cookie "ithd_session")
create table if not exists sessions (
  token      text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_expires on sessions (expires_at);

-- 4. Settings edited in the Admin Console (key → JSON value)
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

-- 5. Help categories and their form questions
create table if not exists categories (
  id             text primary key,
  icon           text,
  name           jsonb not null,
  description    jsonb,
  type           text not null default 'incident' check (type in ('incident','request')),
  owner_id       uuid references users(id) on delete set null,   -- auto-assign target
  needs_approval boolean not null default false,
  fields         jsonb not null default '[]',
  sort           int not null default 0,
  active         boolean not null default true
);

-- 6. Canned replies and help articles
create table if not exists canned_replies (
  id    uuid primary key default gen_random_uuid(),
  title jsonb not null,
  body  jsonb not null,
  sort  int not null default 0
);
create table if not exists kb_articles (
  id          text primary key,
  category_id text references categories(id) on delete set null,
  title       jsonb not null,
  steps       jsonb not null default '{"en":[],"ar":[]}',
  views       int not null default 0,
  updated_at  timestamptz default now()
);

-- 7. Tickets: IT-1001, IT-1002 …
create sequence if not exists ticket_seq start 1001;
create or replace function next_ticket_id() returns text
  language sql volatile as $$ select 'IT-' || nextval('ticket_seq')::text $$;

create table if not exists tickets (
  id                  text primary key,
  category_id         text not null references categories(id),
  title               text not null,
  description         text not null,
  requester_id        uuid not null references users(id),
  dept_id             text references departments(id) on delete set null,
  impact              int not null default 1 check (impact between 1 and 3),
  urgency             int not null default 2 check (urgency between 1 and 3),
  priority            text not null default 'P3' check (priority in ('P1','P2','P3','P4')),
  status              text not null default 'New' check (status in
                        ('New','Pending Approval','Assigned','In Progress','Waiting on User','Resolved','Closed','Rejected')),
  assignee_id         uuid references users(id),
  fields              jsonb not null default '{}',
  attachment_url      text,
  is_major            boolean not null default false,
  csat                int check (csat between 1 and 5),
  approval_state      text check (approval_state in ('pending','approved','rejected')),
  approver_id         uuid references users(id),
  approval_reason     text,
  approval_decided_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  closed_at           timestamptz
);

create table if not exists ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  text not null references tickets(id) on delete cascade,
  author_id  uuid references users(id),
  body       text not null,
  internal   boolean not null default false,   -- internal notes are never shown to employees
  created_at timestamptz not null default now()
);

create table if not exists ticket_events (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  text not null references tickets(id) on delete cascade,
  actor_id   uuid references users(id),
  type       text not null,
  detail     text,
  created_at timestamptz not null default now()
);

-- 8. Email log (audit: e.g. proof that support received every new ticket)
create table if not exists email_log (
  id        uuid primary key default gen_random_uuid(),
  recipient text not null,
  kind      text not null,
  ticket_id text,
  subject   text,
  ok        boolean not null default true,
  sent_at   timestamptz not null default now()
);

-- 9. Indexes
create index if not exists tickets_requester on tickets (requester_id);
create index if not exists tickets_assignee  on tickets (assignee_id);
create index if not exists tickets_approver  on tickets (approver_id);
create index if not exists tickets_status    on tickets (status);
create index if not exists messages_ticket   on ticket_messages (ticket_id);
create index if not exists events_ticket     on ticket_events (ticket_id);
create index if not exists email_log_ticket  on email_log (ticket_id);

-- 10. Row Level Security: the browser never talks to the database. All access goes
--     through the server with the service key, which bypasses RLS. With RLS on and
--     no policies, the public "anon" key can read or write nothing.
do $$ declare tbl text; begin
  foreach tbl in array array['departments','users','sessions','settings','categories','canned_replies',
                             'kb_articles','tickets','ticket_messages','ticket_events','email_log'] loop
    execute format('alter table %I enable row level security', tbl);
  end loop;
end $$;

-- 11. Starter departments (rename or add more in the Admin Console)
insert into departments (id, name, icon, sort) values
  ('it',    '{"en":"IT","ar":"تقنية المعلومات"}',          '🖥️', 0),
  ('fin',   '{"en":"Finance","ar":"المالية"}',             '💰', 1),
  ('hr',    '{"en":"HR","ar":"الموارد البشرية"}',          '🧑‍🤝‍🧑', 2),
  ('sales', '{"en":"Sales","ar":"المبيعات"}',              '📈', 3),
  ('ops',   '{"en":"Operations","ar":"العمليات"}',         '🏭', 4)
on conflict (id) do nothing;

-- 12. Upgrades — safe to re-run on a database created by an earlier version of this file
--     Per-category choice: email the support mailbox for new tickets in this category?
alter table categories add column if not exists notify_support boolean not null default true;
--     Escalation: a technician hands a ticket to the IT manager, with a reason.
alter table tickets add column if not exists escalated_at      timestamptz;
alter table tickets add column if not exists escalated_by      uuid references users(id);
alter table tickets add column if not exists escalated_from    uuid references users(id);
alter table tickets add column if not exists escalation_reason text;

-- 13. Assets (device inventory) — safe to re-run
create table if not exists assets (
  id           text primary key,                 -- asset tag, e.g. LT-0142
  type         text not null default 'laptop',
  model        text not null default '',
  serial       text,
  owner_id     uuid references users(id) on delete set null,   -- who has it
  location     text,                             -- where it is, if not with a person
  status       text not null default 'in_stock' check (status in ('in_use','in_stock','repair','retired')),
  purchased_on date,
  warranty_end date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table assets enable row level security;
create index if not exists assets_owner on assets (owner_id);
--     A ticket can be linked to the device it is about.
alter table tickets add column if not exists asset_id text references assets(id) on delete set null;
create index if not exists tickets_asset on tickets (asset_id);
