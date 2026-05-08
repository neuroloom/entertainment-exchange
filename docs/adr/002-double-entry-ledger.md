# ADR-002: Double-entry Ledger with Revenue Recognition

**Status**: Accepted  
**Date**: 2025-12-01

## Context

The platform handles financial transactions (booking payments, marketplace escrow, commissions). These must be auditable, GAAP-compliant, and support revenue recognition per ASC 606.

## Decision

- **Double-entry bookkeeping**: every financial event produces a journal with balanced debit/credit entries
- **Chart of accounts** seeded per business: Cash (1000), Deferred Revenue (2000), Payable (2100), Booking Revenue (4000), Commission Revenue (4100), Provider Fees (5000)
- **Revenue recognition recipes**: DEPOSIT (cash → deferred revenue), RECOGNIZE (deferred revenue → booking revenue), COMMISSION (deferred revenue → commission revenue), PAYOUT (payable → cash)
- **Idempotency**: `ON CONFLICT (id) DO NOTHING` on all journal inserts; Stripe webhook signatures prevent replay
- PostgreSQL `ledger_journals` + `ledger_entries` tables with tenant-scoped RLS

## Consequences

- **Positive**: Every cent is traceable; audit trail is complete
- **Positive**: ASC 606 compliance: revenue recognized at performance obligation completion, not payment
- **Negative**: Double-entry adds complexity — every state transition that moves money needs a journal
- **Negative**: Idempotency requires stable IDs from upstream events (Stripe PI IDs, booking IDs)
