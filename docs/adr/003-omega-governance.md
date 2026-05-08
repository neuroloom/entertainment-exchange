# ADR-003: OMEGA Governance Pipeline

**Status**: Accepted  
**Date**: 2026-01-20

## Context

Agent operations (tool calls, marketplace decisions, booking approvals) require deterministic, verifiable coordination. The system must detect low-quality outputs, pattern-drift, and security issues in real time.

## Decision

- **OMEGA coherence scoring**: VGDO = 0.4·Ω + 0.3·DNA_fitness + 0.2·S_iso + 0.1·ΔC
  - Ω: coherence floor target 0.999999 (six-nines)
  - DNA_fitness: parameter optimization via NanoMutationEngine
  - S_iso: semantic isomorphism (cache hit quality)
  - ΔC: change in confidence
- **RED_LOOM threshold = 0.90**: responses below this are rejected
- **SNP Governance**: pattern validation and acceptance pipeline for federated sync
- **Dual-layer cache**: LRU (exact match, O(1)) + SemanticCache (cosine similarity with embeddings)
- **Request coalescing**: in-flight deduplication for bursty identical prompts
- **Shared NgramEmbedder** (256-dim) with OpenAI embedding provider fallback

## Consequences

- **Positive**: Deterministic quality gate prevents bad agent outputs from propagating
- **Positive**: Dual cache achieves 99.95% hit rate target at 326µs latency
- **Negative**: Coherence floor is aspirational — mock/fallback responses undercut real measurement
- **Negative**: Embedding provider requires API key; degrades gracefully to FNV hash vectors
