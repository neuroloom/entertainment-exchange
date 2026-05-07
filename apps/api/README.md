# Entertainment Business Exchange -- API

Fastify v5 API server for the Entertainment Business Exchange platform. Multi-tenant entertainment booking, marketplace, and rights management powered by OMEGA orchestration pipeline.

## Quick Start

```bash
npm install
npm run dev
```

The API starts on `http://localhost:3000`. Health check available at `/health`.

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `tsx watch src/server.ts` | Start dev server with hot reload |
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `start` | `node dist/server.js` | Run compiled production server |
| `typecheck` | `tsc --noEmit` | Verify types without emitting files |
| `test` | `vitest run` | Run test suite |
| `seed` | `tsx src/seed.ts` | Seed the database with sample data |

## API Overview

All routes are prefixed under `/api/v1`. Request context is injected via headers (`x-tenant-id`, `x-actor-id`, `x-actor-type`, `x-actor-permissions`, `x-trace-id`).

### Route Groups

#### Auth (`/api/v1/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register a new user and tenant |
| POST | `/auth/login` | Login with email and password |
| GET | `/auth/me` | Get current authenticated user |

**Example: Register**
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123","firstName":"Jane","tenantName":"Acme Productions"}'
```

#### Businesses (`/api/v1`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/businesses` | Create a business with default chart of accounts |
| GET | `/businesses` | List businesses for the current tenant |
| GET | `/businesses/:id` | Get a single business |
| GET | `/businesses/:id/metrics` | Get business financial metrics |

**Example: Create Business**
```bash
curl -X POST http://localhost:3000/api/v1/businesses \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenant-id>" \
  -H "x-actor-id: <user-id>" \
  -H "x-actor-permissions: business:create" \
  -d '{"name":"Acme Entertainment","vertical":"music","legalName":"Acme Entertainment LLC"}'
```

#### Bookings (`/api/v1`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/bookings` | Create a new booking |
| GET | `/bookings` | List bookings for the tenant |
| GET | `/bookings/:id` | Get a single booking |
| PATCH | `/bookings/:id/status` | Update booking status |

**Example: Create Booking**
```bash
curl -X POST http://localhost:3000/api/v1/bookings \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenant-id>" \
  -H "x-actor-id: <user-id>" \
  -H "x-actor-permissions: booking:create" \
  -d '{"eventType":"concert","eventName":"Summer Fest","eventDate":"2026-07-15","startTime":"19:00","endTime":"22:00","artistId":"<artist-id>","venueId":"<venue-id>","quotedAmountCents":500000}'
```

#### Ledger (`/api/v1/ledger`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/ledger/accounts?businessId=` | List chart of accounts (auto-seeded) |
| POST | `/ledger/journal` | Post double-entry journal |
| GET | `/ledger/journals?businessId=` | List journal entries |
| GET | `/ledger/journals/:id` | Get a single journal with entries |
| GET | `/ledger/revenue?businessId=` | List revenue events |
| POST | `/ledger/revenue` | Record a revenue event |

**Example: Post Journal**
```bash
curl -X POST http://localhost:3000/api/v1/ledger/journal \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenant-id>" \
  -H "x-actor-id: <user-id>" \
  -H "x-actor-permissions: payment:create" \
  -d '{"businessId":"<business-id>","memo":"Booking deposit for Summer Fest","entries":[{"accountId":"<cash-account-id>","direction":"debit","amountCents":50000},{"accountId":"<deferred-account-id>","direction":"credit","amountCents":50000}]}'
```

#### Agents (`/api/v1/agents`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/` | Create an AI agent |
| GET | `/agents/` | List agents for the tenant |
| GET | `/agents/:id` | Get a single agent |
| POST | `/agents/:id/runs` | Execute an agent run (OMEGA pipeline) |
| GET | `/agents/:id/runs` | List runs for an agent |
| GET | `/agents/:id/runs/:runId` | Get a single agent run |
| GET | `/agents/pipeline/stats` | OMEGA pipeline cache/routing stats |
| GET | `/agents/pipeline/vgdo` | VGDO scoring summary |

**Example: Create and Run Agent**
```bash
curl -X POST http://localhost:3000/api/v1/agents \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenant-id>" \
  -H "x-actor-id: <user-id>" \
  -H "x-actor-permissions: agent:run" \
  -d '{"name":"Pricing Bot","role":"pricing-optimizer","autonomyLevel":2,"budgetDailyCents":1000}'
```

#### Marketplace (`/api/v1/marketplace`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/marketplace/listings` | Create a business listing |
| GET | `/marketplace/listings` | List listings for the tenant |
| GET | `/marketplace/listings/:id` | Get a single listing |
| PATCH | `/marketplace/listings/:id/publish` | Publish a listing |
| POST | `/marketplace/deals` | Create a deal on a listing |
| GET | `/marketplace/deals` | List all deals |
| GET | `/marketplace/deals/:id` | Get a single deal |

**Example: Create Listing**
```bash
curl -X POST http://localhost:3000/api/v1/marketplace/listings \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenant-id>" \
  -H "x-actor-id: <user-id>" \
  -H "x-actor-permissions: listing:publish" \
  -d '{"sellerBusinessId":"<business-id>","listingType":"talent_catalog","title":"Premium DJ Package","askingPriceCents":250000,"evidenceTier":"platform_verified"}'
```

#### Rights (`/api/v1/rights`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/rights/anchors` | Create a legal anchor |
| GET | `/rights/anchors` | List legal anchors |
| GET | `/rights/anchors/:id` | Get a single anchor |
| POST | `/rights/assets` | Create a rights asset |
| GET | `/rights/assets` | List rights assets |
| GET | `/rights/assets/:id` | Get a single asset |
| POST | `/rights/passports` | Issue a rights passport |
| GET | `/rights/passports` | List passports |
| GET | `/rights/passports/:id` | Get a single passport |

**Example: Issue Passport**
```bash
curl -X POST http://localhost:3000/api/v1/rights/passports \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: <tenant-id>" \
  -H "x-actor-id: <user-id>" \
  -H "x-actor-permissions: rights:issue" \
  -d '{"rightsAssetId":"<asset-id>","legalAnchorId":"<anchor-id>","passportType":"performance_rights"}'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port for the server |
| `NODE_ENV` | `development` | Runtime environment |
| `DATABASE_URL` | -- | PostgreSQL connection string |
| `LOG_LEVEL` | `info` | Pino logger level (trace/debug/info/warn/error) |

## Architecture

### Fastify v5 + OMEGA Orchestration + PostgreSQL

The API server is built on **Fastify v5**, chosen per ADR-001 for its performance and plugin ecosystem. Domain boundaries are preserved through separate route registrations, enabling future extraction to Cloudflare Workers per service boundary.

**Plugin pipeline:**
1. `requestContext` -- Injects typed request context (`tenantId`, `actor`, `permissions`, `traceId`) from headers
2. `errorHandler` -- Unified error handling with `AppError` classes
3. `auth.plugin` -- JWT verification via jose
4. `rate-limit.plugin` -- Per-tenant rate limiting
5. `sanitize.plugin` -- Input sanitization
6. `paginate.plugin` -- Cursor-based pagination support
7. `metrics.plugin` -- Prometheus-style metrics collection
8. `health.plugin` -- Health endpoint under `/health`
9. `logger.plugin` -- Structured logging via Pino

### OMEGA Pipeline

Agent runs are processed through the OMEGA orchestration pipeline (`services/agent-executor.ts`):

- **Cache Tiers**: L1 (in-memory, 50ms), L2 (Redis, 5ms optical), L3 (disk, batch pre-fetch). Caches similar goals to avoid redundant LLM calls and reduce costs.
- **VGDO Scoring**: Value-Gated Decision Optimization ranks model choices by quality-per-cent, dynamically routing to the cheapest model that meets a quality threshold.
- **AutoRouter**: Batches concurrent agent runs, merges overlapping goals, and routes to the optimal model tier based on autonomy level and budget.
- **Pipeline Stats**: Available at `GET /api/v1/agents/pipeline/stats` (hit ratios, cost savings, latency breakdown) and `GET /api/v1/agents/pipeline/vgdo` (per-model quality scores).

## Database

Currently using in-memory stores for MVP development. PostgreSQL migration is planned -- the `DATABASE_URL` env var and `db` package (`@entertainment-exchange/db`) are wired for the migration. Run `npm run seed` to populate sample data.
