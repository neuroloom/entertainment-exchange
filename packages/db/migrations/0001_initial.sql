-- EntEx — Initial Schema
-- Task 003: Full MVP schema with RLS
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Identity
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  email TEXT UNIQUE NOT NULL, password_hash TEXT,
  first_name TEXT, last_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  business_id UUID,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id, business_id, role)
);

-- Core
CREATE TABLE business_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL, vertical TEXT NOT NULL DEFAULT 'entertainment',
  legal_name TEXT, status TEXT NOT NULL DEFAULT 'active',
  currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Entertainment
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID NOT NULL REFERENCES business_entities(id),
  email TEXT, phone TEXT, first_name TEXT, last_name TEXT, company_name TEXT,
  source TEXT, metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE artist_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID NOT NULL REFERENCES business_entities(id),
  user_id UUID REFERENCES users(id),
  stage_name TEXT NOT NULL, genres TEXT[] DEFAULT '{}',
  hourly_rate_cents BIGINT, travel_radius_miles INT,
  status TEXT NOT NULL DEFAULT 'active', metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID NOT NULL REFERENCES business_entities(id),
  name TEXT NOT NULL, venue_type TEXT, city TEXT, state TEXT, capacity INT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID NOT NULL REFERENCES business_entities(id),
  client_id UUID REFERENCES clients(id),
  artist_id UUID REFERENCES artist_profiles(id),
  venue_id UUID REFERENCES venues(id),
  status TEXT NOT NULL DEFAULT 'inquiry',
  event_type TEXT NOT NULL, event_name TEXT,
  event_date DATE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL, end_time TIMESTAMPTZ NOT NULL,
  quoted_amount_cents BIGINT, total_amount_cents BIGINT, deposit_amount_cents BIGINT,
  source TEXT, metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agents
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID REFERENCES business_entities(id),
  name TEXT NOT NULL, role TEXT NOT NULL,
  autonomy_level INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active', budget_daily_cents BIGINT DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID REFERENCES business_entities(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'created',
  goal TEXT NOT NULL, cost_cents BIGINT NOT NULL DEFAULT 0,
  output JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT now(), ended_at TIMESTAMPTZ
);

-- Ledger
CREATE TABLE ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID REFERENCES business_entities(id),
  code TEXT NOT NULL, name TEXT NOT NULL, account_type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  UNIQUE(tenant_id, business_id, code)
);

CREATE TABLE ledger_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID REFERENCES business_entities(id),
  memo TEXT, reference_type TEXT, reference_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  journal_id UUID NOT NULL REFERENCES ledger_journals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES ledger_accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0)
);

CREATE TABLE revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID NOT NULL REFERENCES business_entities(id),
  event_type TEXT NOT NULL, amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD', recognition_date DATE,
  reference_type TEXT, reference_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marketplace
CREATE TABLE marketplace_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  seller_business_id UUID REFERENCES business_entities(id),
  listing_type TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  asking_price_cents BIGINT,
  evidence_tier TEXT NOT NULL DEFAULT 'self_reported',
  metadata JSONB NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deal_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  listing_id UUID NOT NULL REFERENCES marketplace_listings(id),
  buyer_user_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'created',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rights
CREATE TABLE legal_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  document_uri TEXT NOT NULL, document_hash TEXT NOT NULL,
  document_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rights_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  business_id UUID REFERENCES business_entities(id),
  asset_type TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rights_passports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rights_asset_id UUID NOT NULL REFERENCES rights_assets(id),
  legal_anchor_id UUID NOT NULL REFERENCES legal_anchors(id),
  passport_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  metadata JSONB NOT NULL DEFAULT '{}',
  issued_at TIMESTAMPTZ
);

-- Audit
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID, business_id UUID,
  actor_type TEXT NOT NULL, actor_id UUID,
  action TEXT NOT NULL, resource_type TEXT, resource_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on all tenant-scoped tables
ALTER TABLE business_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE rights_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rights_passports ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_businesses_tenant ON business_entities(tenant_id);
CREATE INDEX idx_bookings_tenant ON bookings(tenant_id, event_date);
CREATE INDEX idx_bookings_artist ON bookings(tenant_id, artist_id, start_time, end_time);
CREATE INDEX idx_ledger_journals_tenant ON ledger_journals(tenant_id, business_id, occurred_at DESC);
CREATE INDEX idx_ledger_entries_journal ON ledger_entries(journal_id);
CREATE INDEX idx_audit_tenant ON audit_events(tenant_id, created_at DESC);
CREATE INDEX idx_agents_tenant ON agents(tenant_id, status);
CREATE INDEX idx_listings_tenant ON marketplace_listings(tenant_id, listing_type, status);
CREATE INDEX idx_agent_runs_agent ON agent_runs(tenant_id, agent_id, started_at DESC);

-- RLS Policies — tenant isolation via app.current_tenant_id
-- RLS is enabled on all tenant-scoped tables above. Without policies,
-- PostgreSQL's default-deny behavior returns zero rows for all queries.
CREATE POLICY tenant_isolation ON business_entities FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON clients FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON artist_profiles FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON venues FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON bookings FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON agents FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON agent_runs FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON ledger_accounts FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON ledger_journals FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON ledger_entries FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON revenue_events FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON marketplace_listings FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON deal_rooms FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON legal_anchors FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON rights_assets FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON rights_passports FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON audit_events FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Also enable RLS + policies on users and memberships (they have tenant_id too)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation ON memberships FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
