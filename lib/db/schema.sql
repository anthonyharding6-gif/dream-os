-- dream-os: complete schema
-- Target: Neon (serverless Postgres)
-- Run: psql $DATABASE_URL -f lib/db/schema.sql

-- ── Extensions ────────────────────────────────────────────
create extension if not exists pgcrypto;

-- ── Shared trigger ────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Helper macro ──────────────────────────────────────────
-- (call after each mutable table)

-- ═══════════════════════════════════════════════════════════
-- INTERNAL TEAM
-- ═══════════════════════════════════════════════════════════

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  role          text not null default 'concierge' check (role in ('admin','concierge')),
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_users_email on users(email);

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- Refresh token store
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_sessions_user_id    on sessions(user_id);
create index if not exists idx_sessions_expires_at on sessions(expires_at);

-- ═══════════════════════════════════════════════════════════
-- A-LIST CLIENTS
-- ═══════════════════════════════════════════════════════════

create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text unique,
  phone           text,
  category        text check (category in ('athlete','celeb','dj','corporate','media','other')),
  concierge_id    uuid references users(id) on delete set null,
  preferences     jsonb not null default '{}',
  internal_notes  text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_clients_category     on clients(category);
create index if not exists idx_clients_concierge_id on clients(concierge_id);

drop trigger if exists trg_clients_updated_at on clients;
create trigger trg_clients_updated_at
  before update on clients
  for each row execute function set_updated_at();

-- Live / away presence (like Slack status)
create table if not exists client_presence (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade unique,
  status      text not null default 'unknown' check (status in ('live','away','unknown')),
  city        text,
  note        text,
  updated_by  uuid references users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create index if not exists idx_client_presence_status on client_presence(status);

-- ═══════════════════════════════════════════════════════════
-- VENUE CATALOG  (carried over from dream-booking)
-- ═══════════════════════════════════════════════════════════

create table if not exists venues_catalog (
  id            text primary key,
  name          text not null,
  type          text,
  capacity      int not null default 0,
  neighborhood  text,
  best_for      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_venues_catalog_type         on venues_catalog(type);
create index if not exists idx_venues_catalog_neighborhood on venues_catalog(neighborhood);

drop trigger if exists trg_venues_catalog_updated_at on venues_catalog;
create trigger trg_venues_catalog_updated_at
  before update on venues_catalog
  for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════
-- PACKAGES (bookable inventory)
-- ═══════════════════════════════════════════════════════════

create table if not exists packages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  tier          text not null default 'public' check (tier in ('public','vip','private')),
  price_cents   int not null default 0,
  venue_id      text references venues_catalog(id) on delete set null,
  match_date    date,
  capacity      int,
  available     int,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_packages_tier       on packages(tier);
create index if not exists idx_packages_match_date on packages(match_date);
create index if not exists idx_packages_active     on packages(active);

drop trigger if exists trg_packages_updated_at on packages;
create trigger trg_packages_updated_at
  before update on packages
  for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════
-- BOOKINGS
-- ═══════════════════════════════════════════════════════════

create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid references packages(id) on delete set null,
  client_id     uuid references clients(id) on delete set null,
  -- for public (non-client) bookings
  guest_name    text,
  guest_email   text,
  guest_phone   text,
  party_size    int not null default 1,
  status        text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  tier          text not null default 'public' check (tier in ('public','vip','concierge')),
  notes         text,
  concierge_id  uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_bookings_status      on bookings(status);
create index if not exists idx_bookings_client_id   on bookings(client_id);
create index if not exists idx_bookings_package_id  on bookings(package_id);
create index if not exists idx_bookings_created_at  on bookings(created_at desc);

drop trigger if exists trg_bookings_updated_at on bookings;
create trigger trg_bookings_updated_at
  before update on bookings
  for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════
-- VIP LEADS  (carried over from dream-booking)
-- ═══════════════════════════════════════════════════════════

create table if not exists vip_leads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  phone       text,
  details     text,
  source      text default 'landing',
  group_size  text,
  category    text,
  dates       text[],
  created_at  timestamptz not null default now()
);

create index if not exists idx_vip_leads_email      on vip_leads(email);
create index if not exists idx_vip_leads_created_at on vip_leads(created_at desc);

-- ═══════════════════════════════════════════════════════════
-- ARTIST PIPELINE  (carried over from dream-booking)
-- ═══════════════════════════════════════════════════════════

create table if not exists artists_catalog (
  id            text primary key,
  name          text not null,
  genre         text,
  match_night   text,
  venue         text,
  slot          text,
  tier          int not null default 3,
  fee_min_k     int not null default 0,
  fee_max_k     int not null default 0,
  status        text not null default 'New',
  agent         text,
  agent_email   text,
  agent_phone   text,
  why           text,
  notes         text default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_artists_catalog_match_night on artists_catalog(match_night);
create index if not exists idx_artists_catalog_status      on artists_catalog(status);

drop trigger if exists trg_artists_catalog_updated_at on artists_catalog;
create trigger trg_artists_catalog_updated_at
  before update on artists_catalog
  for each row execute function set_updated_at();

create table if not exists artist_pipeline (
  id          uuid primary key default gen_random_uuid(),
  artist_id   text not null unique,
  status      text not null,
  notes       text default '',
  updated_by  text default 'admin',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_artist_pipeline_status     on artist_pipeline(status);
create index if not exists idx_artist_pipeline_updated_at on artist_pipeline(updated_at desc);

drop trigger if exists trg_artist_pipeline_updated_at on artist_pipeline;
create trigger trg_artist_pipeline_updated_at
  before update on artist_pipeline
  for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════
-- CONCIERGE NOTES & ACTIVITY
-- ═══════════════════════════════════════════════════════════

create table if not exists concierge_notes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  body        text not null,
  author_id   uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_concierge_notes_client_id  on concierge_notes(client_id);
create index if not exists idx_concierge_notes_created_at on concierge_notes(created_at desc);

create table if not exists outreach_messages (
  id          uuid primary key default gen_random_uuid(),
  contact_id  text,
  artist_id   text,
  channel     text not null default 'email',
  subject     text,
  body        text,
  status      text not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_outreach_messages_status     on outreach_messages(status);
create index if not exists idx_outreach_messages_created_at on outreach_messages(created_at desc);

drop trigger if exists trg_outreach_messages_updated_at on outreach_messages;
create trigger trg_outreach_messages_updated_at
  before update on outreach_messages
  for each row execute function set_updated_at();

create table if not exists activity_events (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  actor        text default 'system',
  entity_type  text,
  entity_id    text,
  payload      jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_activity_events_event_type on activity_events(event_type);
create index if not exists idx_activity_events_entity     on activity_events(entity_type, entity_id);
create index if not exists idx_activity_events_created_at on activity_events(created_at desc);
