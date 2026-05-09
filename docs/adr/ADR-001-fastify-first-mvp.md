# ADR-001: Fastify-first MVP

**Status:** accepted
**Date:** 2026-05-08
**Author:** EntEx team

## Context

The EntEx platform requires a performant, type-safe API framework that supports a multi-tenant architecture, plugin composition, and fast cold-start times. The platform spans 8 bounded domains (auth, business, booking, ledger, agent orchestration, marketplace, rights, passport chain-of-title) and must remain extractable into service boundaries in the future.

## Decision

**Fastify v5 with TypeScript**, organized as a workspace monorepo with `packages/` (shared logic, DB, orchestration) and `apps/` (API server, future workers).

Key choices:
- Fastify v5 plugin encapsulation for route domains (each route file registers via `fp()` or inline `async (app) => { ... }`)
- TypeScript strict mode with Zod for runtime validation
- Plugin pipeline: requestContext, errorHandler, auth, rate-limit, sanitize, paginate, metrics, health, logger
- JWT auth via `jose` (zero-dependency)
- In-memory stores for MVP development; PostgreSQL planned via `packages/db`

## Consequences

**Positive:**
- Plugin encapsulation per route domain enables future extraction to Cloudflare Workers or standalone microservices
- Zod schemas provide compile-time type inference and runtime validation
- Fastify's serializer/parser hooks reduce serialization overhead
- 21 v1 endpoints operational with 0 TypeScript errors

**Negative:**
- Fastify v5 encapsulation rules require error handlers and hooks on the root scope, not inside `register()` siblings
- Deferred PostgreSQL migration means current in-memory stores lose data on restart
- ESM/CJS interop requires `"type": "module"` in `package.json` when using `tsx`
