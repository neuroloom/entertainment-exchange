# ADR-002: Double-entry Ledger with Revenue Recognition

**Status:** accepted
**Date:** 2026-05-08
**Author:** EntEx team

## Context

Entertainment transactions (booking deposits, commission splits, royalty distributions) must be auditable, GAAP-compliant, and able to survive system failures without duplicate postings. The platform handles multi-party payments where a single booking event triggers cascading journal entries across multiple business entities.

## Decision

**PostgreSQL-backed double-entry ledger** with immutable journal entries (debit/credit pairs) and ASC 606 revenue recognition recipes.

Key implementation details:
- Every transaction posts as a journal with >=2 entries where total debits === total credits
- Idempotency via `ON CONFLICT DO NOTHING` based on an idempotency key (sent as `x-idempotency-key` header)
- Revenue events trigger recipe-based journal generation: `getRecipeForEvent(eventType)` produces debit/credit entry arrays referencing account codes (1000-Cash, 2000-Deferred Revenue, 2100-Vendor Payable, 4000-Booking Revenue, 4100-Commission Revenue, 5000-Provider Fees)
- Revenue recognition follows ASC 606: deposits recognized on event date, fulfillments at booking completion
- `RevenueSchedule` tracks scheduled recognition events for future-dated deposits

## Consequences

**Positive:**
- Complete audit trail: every journal is immutable, traceable to a business, tenant, and actor
- Idempotency eliminates duplicate postings from network retries
- Recipe-based journal generation prevents manual entry errors
- GAAP-compliant revenue recognition supports external audit requirements

**Negative:**
- Strict consistency (debits === credits) means all journal validation must pass atomically
- Requires careful transaction isolation when PostgreSQL migration completes
- Recipe system requires updating account codes whenever chart of accounts changes
