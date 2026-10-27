-- Atlas database (Supabase Postgres). Safe to run again: everything is "if not exists".
-- Apply with `npm run db:setup`. Times are epoch milliseconds (bigint).
--
-- Atlas connects as the database owner, which bypasses row-level security. RLS is
-- switched on with no policies so Supabase's public REST API can't read any table.

-- ---- What you write yourself ------------------------------------------------

create table if not exists journal (
  day text primary key,               -- local date, YYYY-MM-DD
  body text not null,
  mood smallint,                      -- 1 (rough) to 5 (great), optional
  updated_at bigint not null
);

create table if not exists habits (
  id text primary key,
  name text not null,
  color text not null,
  days text not null,                 -- weekdays it's due, 0 = Sunday, e.g. '0123456'
  position integer not null,
  created_at bigint not null,
  archived boolean not null default false
);

create table if not exists habit_checks (
  habit_id text not null references habits (id) on delete cascade,
  day text not null,
  primary key (habit_id, day)
);

create table if not exists notes (
  id text primary key,
  title text not null,
  body text not null,
  tag text,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists tasks (
  id text primary key,
  title text not null,
  due_day text,
  done_at bigint,
  source text not null,               -- 'voice', 'manual', 'email', 'repeat'
  created_at bigint not null
);
-- Added with the Tasks page (re-runnable on older databases).
alter table tasks add column if not exists area text;                  -- Bricklaying, Henty Lodge, Trading or Home
alter table tasks add column if not exists priority boolean not null default false;
alter table tasks add column if not exists notes text not null default '';
alter table tasks add column if not exists thread_id text;             -- the email it came from
alter table tasks add column if not exists repeat text;                -- daily, weekly, monthly, quarterly or yearly
alter table tasks add column if not exists next_id text;               -- the repeat made when this one was ticked
alter table tasks add column if not exists deleted_at bigint;          -- deleted, kept briefly so Undo works
create index if not exists tasks_due on tasks (due_day) where done_at is null and deleted_at is null;

-- Tasks Atlas spotted while sorting email, waiting for Approve / Edit / Dismiss.
-- Keyed like triage, so a dismissed suggestion never comes back for that email.
create table if not exists task_suggestions (
  key text primary key,
  thread_id text not null,
  title text not null,
  due_day text,
  area text,
  email_from text not null default '',
  email_headline text not null default '',
  status text not null default 'pending',   -- pending, approved or dismissed
  task_id text,
  created_at bigint not null
);
create index if not exists task_suggestions_thread on task_suggestions (thread_id);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

-- ---- Mail -------------------------------------------------------------------

create table if not exists messages (
  id text primary key,
  thread_id text not null,
  internal_date bigint not null,
  from_name text not null,
  from_email text not null,
  to_json jsonb not null,
  subject text not null,
  snippet text not null,
  body text not null,
  labels text[] not null,
  designed boolean not null
);
create index if not exists messages_thread on messages (thread_id);
create index if not exists messages_date on messages (internal_date);

create table if not exists sync_state (
  key text primary key,
  value text not null
);

-- What Atlas wrote about each thread. Triage and drafts are keyed by
-- '<threadId>:<lastMessageId>' so a new message gets a fresh read.
create table if not exists triage (
  key text primary key,
  thread_id text not null,
  data jsonb not null
);
create table if not exists drafts (
  key text primary key,
  data jsonb not null
);
-- Sorting corrections, keyed by thread so they survive new messages.
create table if not exists overrides (
  thread_id text primary key,
  data jsonb not null
);

-- ---- The Google connection ----------------------------------------------------

-- So scheduled jobs can reach Gmail while every browser is closed. The refresh
-- token is encrypted with SESSION_SECRET before it gets here.
create table if not exists google_account (
  email text primary key,
  refresh_token text not null,
  scopes text[] not null,
  updated_at bigint not null
);

-- ---- Phone notifications ------------------------------------------------------

-- One row per device that said yes to notifications (Web Push).
create table if not exists push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at bigint not null
);

-- ---- Money (bank CSV uploads) -----------------------------------------------

-- One row per bank transaction. The id is a hash of account, day, amount, description
-- and repeat number, so uploading overlapping CSVs never double-counts.
create table if not exists money_transactions (
  id text primary key,
  account text not null,
  day text not null,                  -- local date, YYYY-MM-DD
  amount_cents bigint not null,       -- negative = money out
  description text not null,          -- as the bank wrote it
  merchant_key text not null,         -- description without numbers or noise, for sorting
  category text,                      -- null until sorted
  sorted_by text,                     -- 'atlas', 'rule' or 'me'
  balance_cents bigint,
  import_id text not null,
  created_at bigint not null
);
create index if not exists money_transactions_day on money_transactions (day);
create index if not exists money_transactions_key on money_transactions (merchant_key);

-- Atlas's read of each merchant, so each one only goes to Claude once.
create table if not exists money_merchants (
  key text primary key,
  name text not null,
  category text not null,
  created_at bigint not null
);

-- Sorting rules: a merchant containing `pattern` (and, if set, this exact amount) goes in `category`.
create table if not exists money_rules (
  id text primary key,
  pattern text not null,              -- normalised like merchant_key
  category text not null,
  amount_cents bigint,                -- optional: only this amount, either direction
  created_at bigint not null
);

create table if not exists money_imports (
  id text primary key,
  file_name text not null,
  account text not null,
  rows integer not null default 0,    -- transactions in the file
  added integer not null default 0,   -- new ones (the rest were already in Atlas)
  created_at bigint not null
);

-- ---- Lock the public API out ------------------------------------------------

alter table journal enable row level security;
alter table habits enable row level security;
alter table habit_checks enable row level security;
alter table notes enable row level security;
alter table tasks enable row level security;
alter table settings enable row level security;
alter table messages enable row level security;
alter table sync_state enable row level security;
alter table triage enable row level security;
alter table drafts enable row level security;
alter table overrides enable row level security;
alter table google_account enable row level security;
alter table push_subscriptions enable row level security;
alter table task_suggestions enable row level security;
alter table money_transactions enable row level security;
alter table money_merchants enable row level security;
alter table money_rules enable row level security;
alter table money_imports enable row level security;
