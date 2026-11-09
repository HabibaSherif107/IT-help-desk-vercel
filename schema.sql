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

-- 14. Assets v2 — safe to re-run
--     Devices are numbered automatically (no asset tag to type in).
create sequence if not exists asset_seq start 1001;
create or replace function next_asset_id() returns text
  language sql volatile as $$ select 'AS-' || nextval('asset_seq')::text $$;
--     "Under warranty" checkbox; the end date only applies when it's ticked.
alter table assets add column if not exists has_warranty boolean not null default false;
update assets set has_warranty = true where warranty_end is not null and has_warranty = false;

-- 15. Stock register and purchase requests — safe to re-run
create table if not exists stock_items (
  id         uuid primary key default gen_random_uuid(),
  category   text not null default 'others',
  name       text not null,
  model      text,
  quantity   int  not null default 0 check (quantity >= 0),
  min_level  int  check (min_level >= 0),          -- at or below this = "Low Stock"
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists stock_movements (       -- every change to a quantity, with who and why
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references stock_items(id) on delete cascade,
  change         int  not null,
  quantity_after int  not null,
  reason         text,
  actor_id       uuid references users(id),
  pr_id          text,
  created_at     timestamptz not null default now()
);
create table if not exists purchase_requests (
  id            text primary key,                  -- e.g. PR-1126 (month + year), PR-1126-2 …
  status        text not null default 'draft' check (status in ('draft','submitted','approved','rejected','ordered','received')),
  notes         text,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  submitted_by  uuid references users(id),
  submitted_at  timestamptz,
  decided_by    uuid references users(id),
  decided_at    timestamptz,
  decision_note text,
  ordered_at    timestamptz,
  received_by   uuid references users(id),
  received_at   timestamptz
);
create table if not exists purchase_request_lines (
  id            uuid primary key default gen_random_uuid(),
  pr_id         text not null references purchase_requests(id) on delete cascade,
  line_no       int  not null,
  item_name     text not null,
  product_link  text,
  quantity      int  not null check (quantity > 0),
  unit_price    numeric(12,2) not null default 0 check (unit_price >= 0),
  stock_item_id uuid references stock_items(id) on delete set null   -- received quantities are added to this item
);
alter table stock_items            enable row level security;
alter table stock_movements        enable row level security;
alter table purchase_requests      enable row level security;
alter table purchase_request_lines enable row level security;
create index if not exists stock_movements_item on stock_movements (item_id);
create index if not exists pr_lines_pr on purchase_request_lines (pr_id);
create index if not exists pr_status on purchase_requests (status);

-- ════════════════════════════════════════════════════════════
-- 16. Laptop specs (upgrade-safe). Only filled in for devices of type "laptop":
--     { cpu, ram, storage, win11: "yes" | "no" | "", lifetime, recommendation }
-- ════════════════════════════════════════════════════════════
alter table assets add column if not exists specs jsonb;

-- ════════════════════════════════════════════════════════════
-- 17. Device location (fixed list of sites) and the date the holder received it (upgrade-safe).
--     assets.location now holds a site key: abis | khorshid | kafr_el_sheikh | beheira.
--     Old free-text values (from before the field was removed) are cleared.
-- ════════════════════════════════════════════════════════════
update assets set location = null where location is not null and location not in ('abis','khorshid','kafr_el_sheikh','beheira');
alter table assets add column if not exists received_on date;

-- ════════════════════════════════════════════════════════════
-- 18. Device allocation history (upgrade-safe): every time a device moves between
--     people (or back to IT), who had it, who got it, when, and who did it.
-- ════════════════════════════════════════════════════════════
create table if not exists asset_events (
  id          uuid primary key default gen_random_uuid(),
  asset_id    text not null references assets(id) on delete cascade,
  from_id     uuid references users(id) on delete set null,
  to_id       uuid references users(id) on delete set null,
  received_on date,
  note        text,
  actor_id    uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table asset_events enable row level security;
create index if not exists asset_events_asset on asset_events (asset_id);

-- ════════════════════════════════════════════════════════════
-- 19. Company sector for each person (upgrade-safe): shell | chipsy | jammy (or empty).
-- ════════════════════════════════════════════════════════════
alter table users add column if not exists sector text;
