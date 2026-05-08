# ADR-001: Fastify-first MVP with Domain Boundaries

**Status**: Accepted  
**Date**: 2025-11-15

## Context

The Entertainment Business Exchange needs a performant, typed API framework that supports multi-tenant operations, plugin-based middleware, and fast request handling. The platform must support 7 bounded contexts (auth, business, booking, ledger, agent, marketplace, rights) with clear domain boundaries.

## Decision

- **Fastify v5** with TypeScript as the HTTP framework
- **Workspace monorepo** (`packages/` + `apps/api/`) for domain isolation
- **Plugin architecture** for middleware: auth, sanitize, rate-limit, logger, metrics, health
- In-memory stores with PostgreSQL write-through/read-through for persistence
- Headers-based tenant context (`X-Tenant-ID`, `X-Actor-ID`) for request scoping
- JWT Bearer token authentication with jose library (HS256)

## Consequences

- **Positive**: Fastify plugin encapsulation ensures middleware isolation; schemas provide runtime type validation
- **Positive**: Workspace structure preserves domain boundaries for future Cloudflare Workers migration
- **Negative**: Fastify v5 encapsulation can trap error handlers in child scopes — all error handlers must be on root
- **Negative**: In-memory stores require hydration on startup; not suitable for horizontal scaling without a shared cache layer
