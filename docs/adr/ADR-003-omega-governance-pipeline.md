# ADR-003: OMEGA Governance Pipeline

**Status:** accepted
**Date:** 2026-05-08
**Author:** EntEx team

## Context

The platform uses AI agents for pricing optimization, booking recommendations, and marketplace deal matching. Agent operations must be deterministic, verifiable, and cost-efficient. Without governance, agent runs could produce non-deterministic results, exceed budget, or fail silently.

## Decision

**OMEGA coherence scoring** with a dual-layer cache and SNP (Signal-Noise-Predict) pattern governance.

Core architecture:
- **VGDO scoring**: `VGDO = 0.4Ω + 0.3DNA + 0.2S_iso + 0.1ΔC` — ranks model choices by quality-per-cent, dynamically routing to the cheapest model meeting a quality threshold
- **Dual-layer cache**: L1 in-memory (50ms) for hot results, L2 Redis/SemanticCache (5ms optical) for semantic similarity matches across different but equivalent agent goals
- **SNP pattern governance**: Signal extraction reduces prompt noise, Noise filtering eliminates redundant context, Predict verification validates outputs against expected schemas
- **AutoRouter**: Batches concurrent agent runs, merges overlapping goals, routes to optimal model tier based on autonomy level and budget

## Consequences

**Positive:**
- Six-nines coherence floor (0.999999) for agent output consistency
- 326µs latency target for cache-hit VGDO scoring decisions
- Semantic cache deduplication reduces LLM costs by reusing similar prior results
- Per-agent budget enforcement prevents runaway spend

**Negative:**
- SNP filtering may discard context needed for edge cases; requires periodic tuning
- VGDO scoring weights must be recalibrated as model pricing changes
- Cache freshness invalidation complexity grows with semantic similarity matching
