# Entertainment Business Exchange -- Architecture

## System Overview

The Entertainment Business Exchange is a multi-tenant platform for entertainment industry
transactions: booking talent, negotiating deals in a marketplace, managing intellectual
property rights with verifiable chain-of-title, and tracking every financial event through a
double-entry ledger. It is built on **Fastify v5** with TypeScript and organized as a
workspace monorepo.

At the core is the **OMEGA orchestration pipeline**: a caching, governance, and model-routing
layer that wraps AI agent inference with six-nines coherence guarantees. The platform
targets entertainment professionals who need auditable financial records, verifiable rights
ownership, and AI-assisted deal negotiation.

Tenants (agencies, labels, venues, management firms) operate in complete data isolation.
Every request carries a tenant context, every database row is scoped to a tenant, and
permissions are enforced at the route level via JWT claims.

---

## Architecture Diagram (ASCII)

```
                              ┌─────────────────────────────────────┐
                              │          Nginx / Reverse Proxy       │
                              │         (TLS termination, rate-limit)│
                              └──────────────┬──────────────────────┘
                                             │
                              ┌──────────────▼──────────────────────┐
                              │         Fastify v5 API Server        │
                              │         (Node 20, TypeScript)        │
                              │                                      │
                              │  ┌──────────────────────────────┐   │
                              │  │        Plugin Pipeline         │   │
                              │  │                                │   │
                              │  │  requestContext ─► CORS         │   │
                              │  │      │                         │   │
                              │  │      ▼                         │   │
                              │  │  authPlugin (JWT/jose)         │   │
                              │  │      │                         │   │
                              │  │      ▼                         │   │
                              │  │  sanitizePlugin ─► rateLimit   │   │
                              │  │      │                         │   │
                              │  │      ▼                         │   │
                              │  │  logger ─► metrics ─► health   │   │
                              │  └──────────────────────────────┘   │
                              │                  │                   │
                              └──────────────────┼───────────────────┘
                                                 │
              ┌──────────────────────────────────┼──────────────────────────────────┐
              │                                  │                                   │
              │            Route Domains (7 Bounded Contexts)                        │
              │                                  │                                   │
              │  ┌─────────┐  ┌─────────┐  ┌────▼────┐  ┌──────────┐               │
              │  │  Auth   │  │Business │  │ Booking │  │  Ledger  │               │
              │  │register │  │  CRUD   │  │  CRUD   │  │ accounts │               │
              │  │  login  │  │ metrics │  │ state   │  │ journals │               │
              │  │ refresh │  │  audit  │  │ machine │  │ entries  │               │
              │  │   me    │  │         │  │ reverse │  │ revenue  │               │
              │  └─────────┘  └─────────┘  └─────────┘  └──────────┘               │
              │                                                                      │
              │  ┌──────────┐  ┌────────────┐  ┌─────────┐                          │
              │  │  Agent   │  │ Marketplace│  │ Rights  │                          │
              │  │  CRUD    │  │  listings  │  │ anchors │                          │
              │  │  runs    │  │   deals    │  │ assets  │                          │
              │  │  OMEGA   │  │  escrow    │  │passports│                          │
              │  │  stats   │  │  timeline  │  │chain-of │                          │
              │  └──────────┘  └────────────┘  │ -title  │                          │
              │                                └─────────┘                          │
              └──────────────────────────────────┬──────────────────────────────────┘
                                                 │
              ┌──────────────────────────────────┼──────────────────────────────────┐
              │                                  │                                   │
              │              OMEGA Orchestration Pipeline                           │
              │                                                                      │
              │  ┌──────────────────────────────────────────────────────────────┐   │
              │  │                     OutputMaximizer                           │   │
              │  │  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐    │   │
              │  │  │ L1 Cache │  │ L2 Semantic   │  │  BatchProcessor      │    │   │
              │  │  │  (LRU)   │──│    Cache      │──│  (coalesced writes)  │    │   │
              │  │  │  50ms    │  │   5ms optical │  │  24/batch, 50ms      │    │   │
              │  │  └──────────┘  └──────────────┘  └──────────────────────┘    │   │
              │  └──────────────────────────────────────────────────────────────┘   │
              │                                                                      │
              │  ┌──────────────────────────────────────────────────────────────┐   │
              │  │                      SNP Governance                           │   │
              │  │  Signal extraction ─► Noise filtering ─► Predict verification│   │
              │  │            OMEGA_FLOOR = 0.999999 coherence                   │   │
              │  └──────────────────────────────────────────────────────────────┘   │
              │                                                                      │
              │  ┌──────────────────────────────────────────────────────────────┐   │
              │  │                    AutoRouter (MoE)                            │   │
              │  │  classify goal ─► select skill ─► route to cheapest capable    │   │
              │  │  model (haiku/sonnet/opus) based on autonomy level + budget    │   │
              │  └──────────────────────────────────────────────────────────────┘   │
              │                                                                      │
              │  ┌──────────┐  VGDO = 0.4*Omega + 0.3*DNA + 0.2*S_iso + 0.1*dC    │
              │  │Embeddings│  Grade: S(>=0.95) A(0.85) B(0.75) C(0.60) D(0.40)    │
              │  │ OpenAI / │                                                         │
              │  │ FNV hash │                                                         │
              │  └──────────┘                                                         │
              └──────────────────────────────────┬──────────────────────────────────┘
                                                 │
              ┌──────────────────────────────────┼──────────────────────────────────┐
              │                                  │         10 Moat Modules           │
              │                                                                      │
              │  1. WarpCache (LRU+Semantic)      6. Nano DNA Evolution              │
              │  2. Booking State Machine         7. Autonomous Deal Negotiation      │
              │  3. Proprietary Data Pipeline     8. Predictive Talent Marketplace    │
              │  4. Autonomous Operations         9. Cryptographic Audit Chain        │
              │     (self-healing, pricing)       10. Multi-Protocol Agent Mesh       │
              │  5. Compliance & Audit Automation                                     │
              └──────────────────────────────────┬──────────────────────────────────┘
                                                 │
              ┌──────────────────────────────────▼──────────────────────────────────┐
              │                       PostgreSQL 16                                  │
              │                                                                      │
              │  ┌────────────┐  ┌───────────┐  ┌────────────┐  ┌───────────────┐  │
              │  │  businesses│  │  bookings │  │   ledger_   │  │  audit_events │  │
              │  │            │  │           │  │  journals/  │  │               │  │
              │  │            │  │           │  │   entries   │  │               │  │
              │  └────────────┘  └───────────┘  └────────────┘  └───────────────┘  │
              │                                                                      │
              │  ┌────────────┐  ┌───────────┐  ┌────────────┐                      │
              │  │  rights_    │  │ marketplace│  │  schema_   │                      │
              │  │  assets/    │  │  _listings │  │ migrations │                      │
              │  │  passports  │  │  /deals    │  │            │                      │
              │  └────────────┘  └───────────┘  └────────────┘                      │
              │                                                                      │
              │  Tenant isolation: every table carries `tenant_id` column;           │
              │  all queries scoped by tenant. Row-Level Security ready.             │
              └──────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
Request
  │
  ▼
Nginx (TLS termination, reverse proxy)
  │
  ▼
Fastify Server
  │
  ├─► requestContext hook     -- Injects ctx (traceId, tenantId, businessId, actor)
  ├─► CORS hook               -- Origin validation, OPTIONS preflight
  ├─► authPlugin hook         -- JWT Bearer verification (HS256 via jose)
  │                              Populates ctx.actor from verified payload
  ├─► sanitizePlugin hook     -- Strips bidi chars, blocks XSS in body/query/params
  ├─► rateLimit hook          -- Per-tenant rate limiting
  ├─► logger hook             -- Structured JSON logging (Pino)
  ├─► metrics hook            -- Request counting, latency tracking
  ├─► health routes           -- /health (PG ping + memory status)
  │
  ├─► Route handler
  │     │
  │     ├─► Zod schema validation (body, params, query)
  │     ├─► withAuth(...) preHandler -- Permission check
  │     │
  │     └─► Store Layer (MemoryStore / AuditStore / JournalStore)
  │           │
  │           ├─► In-memory Map (always available, instant reads)
  │           └─► PostgreSQL (when DATABASE_URL is set)
  │                 ├─► Write-through (ON CONFLICT upsert)
  │                 └─► Read-through hydration at startup
  │
  └─► onResponse hook          -- Emit X-Trace-Id header, log slow requests (>1s)
```

---

## Multi-Tenancy Model

Every tenant (agency, label, venue, management firm) operates in complete data isolation.

**Tenant context establishment:**
1. Request arrives with headers: `X-Tenant-Id`, `X-Business-Id` (optional)
2. `requestContext` hook extracts them into `req.ctx.tenantId` and `req.ctx.businessId`
3. JWT verification (if Bearer token present) overrides `tenantId` with the token's claim,
   preventing cross-tenant access via header manipulation alone

**Data isolation guarantees:**
- All `MemoryStore.all()` calls filter by `tenantId`
- All PostgreSQL tables include a `tenant_id` column
- All SQL queries are scoped by tenant (prepared for Row-Level Security)
- Permissions are validated against the JWT payload, not tenant headers
- In test mode, headers (`x-actor-permissions`) can impersonate permissions for integration
  testing; this path is disabled in production (`NODE_ENV !== 'test'`)

**Business-level scoping:**
- Within a tenant, operations can further scope to a `businessId`
- Businesses own their chart of accounts, bookings, and marketplace listings
- Ledger accounts are seeded per-business via `getOrCreateAccounts(businessId, tenantId)`

---

## Authentication Flow

```
Client                           Fastify Server
  │                                    │
  │  POST /api/v1/auth/register        │
  │  { email, password, tenantName }   │
  │ ─────────────────────────────────► │
  │                                    │  PBKDF2 hash password (SHA-256, 100k iters)
  │                                    │  Create user + tenant records
  │  { data: { user, tenant } }       │  Store refresh token (hashed)
  │ ◄───────────────────────────────── │
  │                                    │
  │  POST /api/v1/auth/login           │
  │  { email, password }              │
  │ ─────────────────────────────────► │
  │                                    │  Verify PBKDF2 hash
  │                                    │  Sign JWT (HS256, 15min expiry)
  │                                    │    payload: { sub, tenant, permissions }
  │  { data: { accessToken,           │  Generate refresh token (32 bytes)
  │           refreshToken } }         │
  │ ◄───────────────────────────────── │
  │                                    │
  │  Subsequent requests:              │
  │  Authorization: Bearer <token>    │
  │  X-Tenant-Id: <id>                │
  │ ─────────────────────────────────► │
  │                                    │  authPlugin hook:
  │                                    │    1. Extract Bearer token
  │                                    │    2. jose.jwtVerify (HS256)
  │                                    │    3. Populate ctx.actor:
  │                                    │       { id, userId, permissions }
  │                                    │    4. Override ctx.tenantId from
  │                                    │       verified payload.tenant
  │                                    │
  │                                    │  withAuth('booking:create') preHandler:
  │                                    │    - Check ctx.actor.userId is set
  │                                    │    - Check permissions include 'booking:create'
  │                                    │    - 401 if unauthenticated
  │                                    │    - 403 if missing permission
  │  { data: ... }                    │
  │ ◄───────────────────────────────── │
  │                                    │
  │  POST /api/v1/auth/refresh         │
  │  { refreshToken }                 │
  │ ─────────────────────────────────► │
  │                                    │  Verify hashed refresh token
  │                                    │  Issue new access token + refresh token
  │  { data: { accessToken,           │
  │           refreshToken } }         │
  │ ◄───────────────────────────────── │
```

---

## Key Design Decisions

### Fastify v5 (ADR-001)
- Plugin encapsulation enables route domains to be extracted into independent services later
- TypeScript strict mode with Zod for compile-time + runtime validation
- Plugin pipeline is ordered: requestContext, CORS, auth, sanitize, rate-limit, logger, metrics, health
- Critical rule: error handlers and hooks must be on the root scope, not inside `register()` siblings

### Double-Entry Ledger (ADR-002)
- Every transaction posts as a journal with matching debits and credits
- Idempotency via `ON CONFLICT DO NOTHING` with `x-idempotency-key` header
- Revenue recognition follows ASC 606 with recipe-based journal generation
- Account codes: 1000-Cash, 2000-DeferredRev, 2100-VendorPayable, 4000-BookingRev, 4100-CommissionRev, 5000-ProviderFees

### OMEGA Governance Pipeline (ADR-003)
- VGDO formula: `0.4*Omega + 0.3*DNA_fitness + 0.2*S_iso + 0.1*dC`
- Six-nines coherence floor (0.999999) for agent output consistency
- Dual-layer cache: L1 LRU (in-memory) + L2 SemanticCache (embedding similarity)
- SNP governance: Signal extraction, Noise filtering, Predict verification
- AutoRouter selects cheapest capable model based on autonomy level

### Rights Passport Chain-of-Title (ADR-004)
- Legal Anchors store content-hashed legal documents
- Rights Assets link to anchors through Passports
- Chain-of-title traversal verifies complete ownership history
- Transferability scoring (0-1) from chain integrity, anchor count, dispute history, expiry state

### In-Memory Stores with PG Write-Through
- MVP uses in-memory `Map` for instant reads
- PostgreSQL write-through when `DATABASE_URL` is set
- Read-through hydration at startup ensures durability across restarts
- Routes are decoupled from storage -- same code works with or without PG
- Progressively migrate to PG-only as tenant scale demands it

### Workspace Monorepo
- `packages/shared` -- shared TypeScript types and utilities
- `packages/db` -- migration runner, PG client, SQL migration files
- `packages/orchestration` -- OMEGA pipeline, moat modules, booking state machine
- `apps/api` -- Fastify API server, routes, plugins, services

---

## OMEGA Moat Modules (10)

| # | Module | Description |
|---|--------|-------------|
| 1 | WarpCache | Dual-layer (LRU + Semantic) cache with 99.95% target hit rate |
| 2 | Booking State Machine | inquiry -> quoted -> confirmed -> contracted -> completed |
| 3 | Data Pipeline | Embedding indexer, fraud detector -- proprietary network effects |
| 4 | Autonomous Operations | Self-healing, dynamic pricing engine |
| 5 | Compliance & Audit Automation | Audit report generation, regulatory rule engine |
| 6 | Nano DNA Evolution | Gradient-free parameter optimization for agents |
| 7 | Autonomous Deal Negotiation | BATNA analysis, multi-round negotiation engine |
| 8 | Predictive Talent Marketplace | Talent matching, demand forecasting, career trajectory |
| 9 | Cryptographic Audit Chain | Merkle proofs, hash-chain verification |
| 10 | Multi-Protocol Agent Mesh | Protocol-agnostic payment routing |
