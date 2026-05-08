# ADR-004: Rights Passport Chain-of-Title

**Status:** accepted
**Date:** 2026-05-08
**Author:** Entertainment Exchange team

## Context

Entertainment IP rights (performance rights, sync licenses, publishing shares) require verifiable ownership chains that hold up under legal scrutiny. A marketplace listing for talent or IP must prove the seller actually holds transferable rights. Without chain-of-title verification, bad actors could list rights they do not own.

## Decision

**Rights Passport system** built on legal anchors with content-hash verification, chain-of-title traversal, and transferability scoring.

Core architecture:
- **Legal Anchors**: Immutable records of legal documents (contracts, licenses, copyright registrations) stored with content hashes (`documentHash`) and document URIs for off-chain verification
- **Rights Assets**: Business-owned IP assets (tracks, performances, catalogs) linked to legal anchors through passports
- **Passports**: Issued by the `PassportVerifier` to bind a rights asset to a legal anchor with a passport type (performance_rights, sync_license, mechanical_license, publishing_share), expiry date, and status lifecycle (active, expired, revoked)
- **Chain-of-Title**: `getChainOfTitle(assetId)` traverses all passports linked to an asset, verifying each anchor hash and reporting any broken links
- **Transferability Scoring**: `TransferabilityScorer.scoreBreakdown(profile)` produces a 0-1 score from chain integrity, anchor count, dispute history, passport expiry state, and platform tenure

## Consequences

**Positive:**
- Verifiable ownership chains reduce marketplace fraud risk
- Content-hash anchoring prevents document tampering
- Transferability scoring enables risk-based listing tiers (self_reported through acquisition_ready)
- Passport lifecycle (issue, revoke, renew) mirrors real-world rights management

**Negative:**
- Multi-document verification adds latency to passport issuance
- Expiry enforcement requires proactive monitoring (checked on passport read)
- Chain-of-title completeness depends on correct anchor registration by tenants
- Transferability stubs (revenue, marketplace, agent metrics) require cross-service wiring
