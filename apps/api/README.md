# Entertainment Business Exchange — API

Fastify v5 API server for the Entertainment Business Exchange platform. Multi-tenant entertainment booking, marketplace, and rights management powered by the OMEGA orchestration pipeline.

**v1.0.0** — 50+ endpoints, 165 tests, 7 bounded contexts, 4 ADRs.

## Quick Start

```bash
# Local dev (in-memory stores)
npm install
npm run dev

# With PostgreSQL (recommended for production)
docker-compose up -d db
DATABASE_URL=postgres://entx:entx_secret@localhost:5432/entertainment_exchange npm run dev

# Docker Compose (full stack)
docker-compose up -d
```

The API starts on `http://localhost:3000`. Health check at `/health`.

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `tsx watch src/server.ts` | Dev server with hot reload |
| `build` | `tsc` | Compile to `dist/` |
| `start` | `node dist/server.js` | Production server |
| `typecheck` | `tsc --noEmit` | Type check only |
| `test` | `vitest run` | 165 tests across 9 suites |
| `seed` | `tsx src/seed.ts` | Seed sample data |

## Authentication

The API supports two authentication modes:

1. **Header-based** (testing/internal): `x-actor-id`, `x-actor-type`, `x-actor-permissions`
2. **JWT Bearer** (production): `Authorization: Bearer <token>`

```
POST /api/v1/auth/register  →  Create user + tenant
POST /api/v1/auth/login      →  Get access token + refresh token
POST /api/v1/auth/refresh    →  Rotate refresh token
GET  /api/v1/auth/me         →  Current user profile
```

Passwords are hashed with PBKDF2 (SHA-256, 100K iterations). Common passwords are rejected.

## API Overview

All routes under `/api/v1`. Responses use `{ data }` envelope. Errors use `{ error: { code, message, requestId } }`.

### Route Groups (50+ endpoints)

| Domain | Prefix | Endpoints | Key Operations |
|--------|--------|-----------|----------------|
| **Auth** | `/auth` | 4 | register, login, refresh, me |
| **Business** | `/` | 4 | CRUD + metrics |
| **Booking** | `/` | 5 | CRUD + status transitions + cancel (with reversal journal) |
| **Ledger** | `/ledger` | 9 | accounts, journals, entries, revenue recognition |
| **Agent** | `/agents` | 9 | CRUD + runs + OMEGA pipeline stats |
| **Marketplace** | `/marketplace` | 10 | listings, deals, transitions, timeline |
| **Rights** | `/rights` | 14 | anchors, assets, passports, chain-of-title, transferability, renewal |
| **Health** | `/` | 1 | PG + memory status |

### Pagination

All list endpoints accept `?limit=&offset=` query params and return:
```json
{ "data": [...], "total": 142, "limit": 50, "offset": 0 }
```

### State Machines

**Booking**: inquiry → quoted → confirmed → contracted → completed | cancelled → refunded
**Deal**: created → negotiating → agreed → escrow_funded → completed (disputed/resolved as side states)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | Runtime environment |
| `DATABASE_URL` | — | PostgreSQL connection string (enables persistence) |
| `JWT_SECRET` | — | Required for JWT signing (min 32 chars) |
| `LOG_LEVEL` | `info` | Pino log level |
| `CORS_ORIGINS` | — | Comma-separated allowed origins |
| `OPENAI_API_KEY` | — | Enables real embeddings (semantic cache) |
| `EMBEDDING_PROVIDER` | `openai` | Embedding backend (`openai` or model name) |

## Architecture

```
Request → requestContext → CORS → authPlugin → sanitizePlugin
       → rateLimit → logger → metrics → routeHandler → errorHandler
```

### Plugin Pipeline

1. **requestContext** — Injects `ctx` (tenantId, actor, permissions, traceId) from headers
2. **CORS** — Configurable origin allowlist, OPTIONS preflight
3. **authPlugin** — JWT Bearer verification (HS256 via jose), `withAuth()` preHandler
4. **sanitizePlugin** — 9-pattern injection detection (regex + optional LLM classifier)
5. **rateLimit** — Per-tenant rate limiting
6. **logger** — Structured JSON logging via Pino
7. **metrics** — Request counting, latency tracking
8. **health** — `/health` with PG ping and memory status
9. **errorHandler** — Unified `AppError` → typed error responses

### OMEGA Pipeline

The orchestration stack (`@entertainment-exchange/orchestration`):

- **OutputMaximizer**: dual-layer cache (LRU + SemanticCache), request coalescing, batch processing
- **SNP Governance**: pattern validation, FED_SYNC receiver
- **AutoRouter**: skill-based intent routing (marketplace-list, marketplace-buy, agent-thread, etc.)
- **Embeddings**: OpenAI text-embedding-3-small with FNV hash fallback
- **NanoMutationEngine**: DNA parameter evolution for agent optimization
- **VGDO Scoring**: 0.4·Ω + 0.3·DNA + 0.2·S_iso + 0.1·ΔC

## Database

In-memory stores with optional PostgreSQL write-through/read-through. When `DATABASE_URL` is set:

1. Migrations run automatically on startup (`packages/db/migrations/`)
2. Stores hydrate from PG on startup (survives restart)
3. Writes persist to PG in real time (snake_case column mapping)
4. Health endpoint includes PG connectivity status

## Architecture Decision Records

- [ADR-001](docs/adr/001-fastify-mvp.md) — Fastify-first MVP with domain boundaries
- [ADR-002](docs/adr/002-double-entry-ledger.md) — Double-entry ledger with revenue recognition
- [ADR-003](docs/adr/003-omega-governance.md) — OMEGA governance pipeline
- [ADR-004](docs/adr/004-rights-passport.md) — Rights passport chain-of-title

## API Reference

Full OpenAPI 3.0 spec at [openapi.json](openapi.json). All 50+ endpoints documented with request/response schemas.
