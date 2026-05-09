# Contributing to EntEx

## Project Structure

```
entex/
  apps/
    api/                          # Fastify v5 API server
      src/
        plugins/                  # Fastify plugins (auth, error, rate-limit, etc.)
        routes/                   # Domain route handlers (7 bounded contexts)
        services/                 # Agent executor, repo layer, token store
        __tests__/                # Vitest test suites
      package.json
      tsconfig.json
  packages/
    db/                           # PostgreSQL client + migration runner
      src/
        client.ts
        migrate.ts
      migrations/                 # SQL migration files
    orchestration/                # OMEGA pipeline + 10 moat modules
      src/
        booking/                  # State machine, quote calculator
        compliance/               # Audit reports, regulatory engine
        cryptographic-audit/      # Chain verifier, Merkle proofs
        data-pipeline/            # Embedding indexer, fraud detector
        enterprise/               # Orchestrator, team heartbeat
        hooks/                    # OMEGA session hooks
        ledger/                   # Idempotency, revenue recipes
        marketplace/              # Agent marketplace, deal room
        nano/                     # DNA evolution, auto-optimizer
        negotiation/              # Auto-negotiator, BATNA
        operations/               # Self-healer, dynamic pricing
        protocol-mesh/            # Multi-protocol routing
        reputation/               # Reputation engine, fraud detection
        rights/                   # Passport verifier, transferability
        talent-matching/          # Talent engine, demand forecasting
        tokenized-rights/         # Fractional ownership, royalties
    shared/                       # Shared TypeScript types
  docs/
    adr/                          # Architecture Decision Records
    architecture.md               # System architecture documentation
    deployment.md                 # Deployment guide
  docker-compose.yml              # Docker Compose services
  Dockerfile                      # Multi-stage production build
  .env.example                    # Environment variables template
  .github/workflows/ci.yml        # CI pipeline
```

---

## Development Setup

### Prerequisites

- Node.js 20 (use `nvm` or `fnm` to manage versions)
- PostgreSQL 16 (optional for local dev; in-memory stores work without it)
- Docker and Docker Compose (optional, for containerized database)

### Quick Start

```bash
# 1. Clone and install
git clone <repo-url> entex
cd entex
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env: set JWT_SECRET (min 32 chars)

# 3. Start PostgreSQL (optional; skip for in-memory-only dev)
docker-compose up -d db

# 4. With PostgreSQL configured, set the connection string
echo 'DATABASE_URL=postgres://entx:entx_secret@localhost:5432/entertainment_exchange' >> .env

# 5. Start dev server with hot reload
npm run dev
```

The API starts at `http://localhost:3000`. Health check at `/health`.

### Docker Compose (Full Stack)

```bash
docker-compose up -d    # Start API + PostgreSQL (+ Redis if uncommented)
docker-compose ps        # Verify services are healthy
docker-compose logs -f   # Follow logs
```

---

## Available Scripts

Scripts are defined in the root `package.json` and delegate to workspace packages.

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `cd apps/api && npm run dev` | Dev server with tsx watch (hot reload) |
| `npm run build` | `npm run build --workspaces` | Compile TypeScript in all workspaces |
| `npm test` | `npm run test --workspaces` | Run all test suites (Vitest) |
| `npm run typecheck` | `npm run typecheck --workspaces` | TypeScript type checking, no emit |

### API-specific scripts (in `apps/api/`)

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `tsx watch src/server.ts` | Dev server with hot reload |
| `npm run build` | `tsc` | Compile to `dist/` |
| `npm start` | `node dist/server.js` | Production server |
| `npm run typecheck` | `tsc --noEmit` | Type check only |
| `npm test` | `vitest run` | Run 165+ tests across 9 suites |
| `npm run test:coverage` | `vitest run --coverage` | Test with coverage report |
| `npm run seed` | `tsx src/seed.ts` | Seed sample data |

### DB-specific scripts (in `packages/db/`)

| Script | Command | Description |
|--------|---------|-------------|
| `npm run migrate` | `tsx src/migrate.ts` | Run SQL migrations |
| `npm run typecheck` | `tsc --noEmit` | Type check only |

---

## Code Conventions

### TypeScript

- **Strict mode** is enabled in all `tsconfig.json` files
- Use `"type": "module"` in `package.json` for ESM
- Prefer plain functions over classes except where state encapsulation is needed
- Use `const` by default; `let` only when reassignment is necessary; never `var`

### Fastify Patterns

```typescript
// Routes: each domain gets its own file under src/routes/
// Export an async function that registers routes on a FastifyInstance
export async function myDomainRoutes(app: FastifyInstance) {
  app.get('/resource', async (req, reply) => {
    const ctx = (req as any).ctx;  // Typed via RequestContext
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    // ...
  });
}

// Plugins: register on root scope so all children inherit
// (never inside a register() sibling)
export async function myPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => { /* ... */ });
}
```

### Store Layer

```typescript
// In-memory stores with optional PG persistence
const myStore = new MemoryStore('table_name');  // table_name enables PG write-through

// Items must have { id, tenantId } at minimum
myStore.set({ id: uuid(), tenantId: ctx.tenantId, /* ... */ });

// Always filter by tenant
const tenantItems = myStore.all(ctx.tenantId);
```

### Permissions

```typescript
// Protect routes with withAuth()
app.get('/secure', { preHandler: withAuth('resource:read') }, async (req, reply) => {
  // Only authenticated users with 'resource:read' permission reach here
});

// Selectors for preHandler arrays work as plain functions
// withAuth checks: 1) is authenticated, 2) has ALL required permissions
```

### Error Handling

```typescript
// Use AppError helpers for consistent error responses
throw AppError.notFound('Business');
throw AppError.unauthenticated('Authentication required');
throw AppError.forbidden('Missing permission: booking:create');
throw AppError.invalid('Invalid state transition');
throw AppError.tenantRequired();
```

### Testing

```typescript
// Tests use Vitest. Import buildServer() and call inject() for HTTP tests.
import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from '../server.js';

describe('my domain', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    app = await buildServer();
  });

  it('returns 201 on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resource',
      headers: {
        'x-tenant-id': 't1',
        'x-actor-id': 'user-1',
        'x-actor-permissions': 'resource:create',
      },
      payload: { name: 'test' },
    });
    expect(res.statusCode).toBe(201);
  });
});
```

---

## Testing Guide

### Running Tests

```bash
# All tests (from root)
npm test

# API tests only
cd apps/api && npm test

# With coverage
cd apps/api && npm run test:coverage

# Single test file
cd apps/api && npx vitest run src/__tests__/booking.test.ts

# Watch mode (re-run on changes)
cd apps/api && npx vitest
```

### Test Structure

Tests live in `apps/api/src/__tests__/` and `packages/orchestration/src/__tests__/`:

| Test File | Covers |
|-----------|--------|
| `auth.test.ts` | Registration, login, refresh, token verification |
| `business.test.ts` | Business CRUD, metrics, audit events |
| `booking.test.ts` | Booking CRUD, state machine transitions, cancellations |
| `ledger.test.ts` | Accounts, journals, entries, revenue recognition |
| `agent.test.ts` | Agent CRUD, runs, pipeline stats |
| `marketplace.test.ts` | Listings, deals, transitions, timeline |
| `rights.test.ts` | Anchors, assets, passports, chain-of-title |
| `plugins.test.ts` | Plugin pipeline, error responses, CORS, health |
| `e2e-golden-path.test.ts` | End-to-end: register -> create business -> book -> ledger |
| `repo.test.ts` | MemoryStore, AuditStore, JournalStore persistence |

### Adding New Tests

1. Create `src/__tests__/your-domain.test.ts`
2. Import `buildServer` from `../server.js`
3. Use `beforeEach` to create a fresh server instance
4. Inject requests with tenant/actor headers for multi-tenant isolation
5. Assert on status codes, response bodies, and audit side effects

### Test Headers Convention

```
x-tenant-id        -- Required for all requests
x-actor-id         -- Identifies the calling user (or 'anonymous')
x-actor-type       -- 'user', 'system', 'agent'
x-actor-permissions -- Comma-separated permissions (only in NODE_ENV=test)
```

**Important:** Header-based auth (`x-actor-permissions`) only works in `NODE_ENV=test`.
Production uses JWT Bearer tokens exclusively.

---

## PR Workflow

1. **Fork** the repository and create a feature branch from `main`
2. **Implement** your changes following the code conventions above
3. **Add tests** that cover the new functionality
4. **Run all tests** to verify nothing is broken: `npm test`
5. **Run type checking**: `npm run typecheck`
6. **Commit** with a descriptive message (conventional commits preferred):
   ```
   feat(ledger): add revenue schedule projection endpoint
   fix(booking): validate transition from confirmed to completed
   test(rights): add chain-of-title verification tests
   ```
7. **Push** and open a Pull Request
8. **CI** runs typecheck, tests, and Docker build automatically (see `.github/workflows/ci.yml`)
9. A maintainer will review. Address feedback and iterate.
10. Once approved and CI is green, your PR is merged.

### CI Pipeline

The CI pipeline (`.github/workflows/ci.yml`) runs on every push to `main` and on PRs:
1. **Type Check** -- `tsc --noEmit` across all workspaces
2. **Tests** -- Vitest runs all test suites
3. **Docker Build** -- Verifies the multi-stage Docker build succeeds

---

## Architecture Decision Records

Architectural decisions are documented as ADRs in `docs/adr/`. When proposing a significant
change (new pattern, technology choice, API redesign), create an ADR following the template:

```markdown
# ADR-00N: Title

**Status:** proposed | accepted | deprecated | superseded
**Date:** YYYY-MM-DD
**Author:** Your Name

## Context
What problem are we solving? What constraints exist?

## Decision
What are we doing and how?

## Consequences
**Positive:** Benefits
**Negative:** Trade-offs and risks
```

Existing ADRs:
- [ADR-001](docs/adr/ADR-001-fastify-first-mvp.md) -- Fastify-first MVP with domain boundaries
- [ADR-002](docs/adr/ADR-002-double-entry-ledger.md) -- Double-entry ledger with revenue recognition
- [ADR-003](docs/adr/ADR-003-omega-governance-pipeline.md) -- OMEGA governance pipeline
- [ADR-004](docs/adr/ADR-004-rights-passport-chain-of-title.md) -- Rights passport chain-of-title
