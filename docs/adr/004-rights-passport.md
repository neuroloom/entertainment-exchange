# ADR-004: Rights Passport Chain-of-Title

**Status**: Accepted  
**Date**: 2026-02-10

## Context

Entertainment IP rights (music catalogs, film libraries, talent contracts) require verifiable ownership chains. A buyer must be able to trace ownership from originator through all transfers to the current holder, with cryptographic assurance that no documents have been tampered with.

## Decision

- **Legal Anchors**: hashed document references (documentUri + documentHash) stored immutably
- **Rights Passports**: issued against a rights asset + legal anchor pair, with passport type and expiry
- **Chain-of-Title**: ordered sequence of passport issuances, each referencing the prior, forming an unbroken chain
- **Transferability Scoring**: multi-factor model (chain integrity, anchor freshness, dispute count, passport currency, platform tenure) producing grade S/A/B/C/D/F
- **Evidence tiers**: self_reported → document_supported → platform_verified → acquisition_ready
- **Passport renewal**: creates new passport superseding old, maintaining chain sequence

## Consequences

- **Positive**: Cryptographic verification of ownership via content-hash comparison
- **Positive**: Transferability scoring provides instant buyer confidence signal
- **Negative**: Requires valid document hashes at issuance time — garbage-in/garbage-out if hashes are fabricated
- **Negative**: Chain-of-title is only as strong as the weakest anchor in the chain
