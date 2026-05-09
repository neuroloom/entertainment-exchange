// EmbeddingIndexer — Proprietary data pipeline for semantic indexing of domain entities
// Moat 3: Data network effects — the more transactions, the better the AI predictions
// Indexes booking descriptions, listing titles, rights asset metadata into SemanticCache
// Builds similarity graphs from usage patterns, not just text

import { SemanticCache } from '../warp-cache.js';
import { cosineSimilarity } from '../omega-governance.js';
import { getEmbeddingProvider } from '../embeddings.js';
import { TransferabilityScorer } from '../rights/transferability-scorer.js';
import type { BusinessProfile } from '../rights/transferability-scorer.js';
import type { EmbeddingProvider } from '../embeddings.js';

// ─── Domain Embedding ──────────────────────────────────────────────────────────

export interface DomainEmbedding {
  id: string;
  type: 'booking' | 'listing' | 'rights_asset' | 'agent';
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

// ─── Similarity Edge ───────────────────────────────────────────────────────────

export interface SimilarityEdge {
  sourceId: string;
  targetId: string;
  similarity: number;   // cosine similarity 0-1
  edgeType: 'semantic' | 'transactional' | 'co_occurrence';
  weight: number;
}

// ─── Internal Index Entry ──────────────────────────────────────────────────────

interface IndexEntry {
  id: string;
  type: DomainEmbedding['type'];
  embedding: number[];
  tenantId: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

// ─── Co-occurrence tracker ─────────────────────────────────────────────────────

interface CoOccurrenceCount {
  pair: [string, string]; // sorted IDs
  count: number;
  lastSeen: number;
}

// ─── Main Class ────────────────────────────────────────────────────────────────

export class EmbeddingIndexer {
  private cache: SemanticCache;
  private provider: EmbeddingProvider | null = null;
  private index: IndexEntry[] = [];
  private tenantIndices = new Map<string, IndexEntry[]>();
  private coOccurrence = new Map<string, CoOccurrenceCount>();
  private coOccurrenceKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }

  // Transaction-count-based weight scaling for transferability scoring
  private transactionCounts = new Map<string, number>();
  private totalTransactions = 0;

  constructor(
    private scorer = new TransferabilityScorer(),
    cacheSize = 50_000,
    similarityThreshold = 0.75,
  ) {
    this.cache = new SemanticCache(cacheSize, similarityThreshold);
    // Lazy-init the embedding provider so we don't require OPENAI_API_KEY at import time
  }

  // ─── Embedding Provider ─────────────────────────────────────────────────────

  private async getProvider(): Promise<EmbeddingProvider | null> {
    if (this.provider !== null) return this.provider;
    try {
      this.provider = getEmbeddingProvider();
      return this.provider;
    } catch {
      return null;
    }
  }

  // ─── Index a Domain Entity ──────────────────────────────────────────────────

  /**
   * Embeds a domain entity's text, stores it in the SemanticCache, and adds it
   * to the local similarity index for graph construction.
   */
  async indexDomainEntity(entity: {
    id: string;
    type: DomainEmbedding['type'];
    tenantId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const provider = await this.getProvider();
    const embedding = provider
      ? await provider.embed(entity.text)
      : vectorFallbackDeterministic(entity.text);

    // Store in SemanticCache for retrieval-time semantic matching
    this.cache.put(entity.id, entity.text, entity.text, embedding);

    // Store in local index for graph construction
    const entry: IndexEntry = {
      id: entity.id,
      type: entity.type,
      embedding,
      tenantId: entity.tenantId,
      metadata: entity.metadata ?? {},
      createdAt: Date.now(),
    };

    this.index.push(entry);

    // Tenant-scoped index
    const tenantEntries = this.tenantIndices.get(entity.tenantId) ?? [];
    tenantEntries.push(entry);
    this.tenantIndices.set(entity.tenantId, tenantEntries);
  }

  // ─── Index Multiple Entities (batch) ────────────────────────────────────────

  async indexBatch(entities: Array<{
    id: string;
    type: DomainEmbedding['type'];
    tenantId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }>): Promise<void> {
    const provider = await this.getProvider();
    const texts = entities.map(e => e.text);
    const embeddings = provider
      ? await provider.embedBatch(texts)
      : texts.map(t => vectorFallbackDeterministic(t));

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const embedding = embeddings[i];

      this.cache.put(entity.id, entity.text, entity.text, embedding);

      const entry: IndexEntry = {
        id: entity.id,
        type: entity.type,
        embedding,
        tenantId: entity.tenantId,
        metadata: entity.metadata ?? {},
        createdAt: Date.now(),
      };
      this.index.push(entry);

      const tenantEntries = this.tenantIndices.get(entity.tenantId) ?? [];
      tenantEntries.push(entry);
      this.tenantIndices.set(entity.tenantId, tenantEntries);
    }
  }

  // ─── Record a Transaction (Co-occurrence Edge) ──────────────────────────────

  /**
   * Records that two entities appeared in the same transaction (booking, deal, etc.).
   * This builds transactional & co-occurrence edges in the similarity graph —
   * the network effect where more deals = better recommendations.
   */
  recordTransaction(entityIds: string[], tenantId: string): void {
    this.totalTransactions++;

    for (const id of entityIds) {
      const current = this.transactionCounts.get(id) ?? 0;
      this.transactionCounts.set(id, current + 1);
    }

    // Build co-occurrence pairs
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        const key = this.coOccurrenceKey(entityIds[i], entityIds[j]);
        const existing = this.coOccurrence.get(key);
        if (existing) {
          existing.count++;
          existing.lastSeen = Date.now();
        } else {
          this.coOccurrence.set(key, {
            pair: [entityIds[i], entityIds[j]],
            count: 1,
            lastSeen: Date.now(),
          });
        }
      }
    }
  }

  // ─── Find Similar Entities ──────────────────────────────────────────────────

  /**
   * Finds the nearest neighbors for a given entity, using semantic similarity
   * plus transactional/co-occurrence edges.
   */
  findSimilar(entityId: string, type?: DomainEmbedding['type'], limit = 10): SimilarityEdge[] {
    const source = this.index.find(e => e.id === entityId);
    if (!source) return [];

    const candidates = this.index.filter(e => {
      if (e.id === entityId) return false;
      if (type && e.type !== type) return false;
      return true;
    });

    const edges: SimilarityEdge[] = [];

    // Semantic similarity edges
    for (const candidate of candidates) {
      const similarity = cosineSimilarity(source.embedding, candidate.embedding);
      if (similarity > 0.5) {
        edges.push({
          sourceId: entityId,
          targetId: candidate.id,
          similarity,
          edgeType: 'semantic',
          weight: similarity,
        });
      }
    }

    // Transactional co-occurrence edges
    for (const candidate of candidates) {
      const key = this.coOccurrenceKey(entityId, candidate.id);
      const cooc = this.coOccurrence.get(key);
      if (cooc) {
        // Weight is based on co-occurrence frequency normalized by total transactions
        const weight = Math.min(1.0, cooc.count / Math.max(1, this.totalTransactions) * 50);
        edges.push({
          sourceId: entityId,
          targetId: candidate.id,
          similarity: weight,
          edgeType: 'co_occurrence',
          weight,
        });
      }
    }

    // Sort by weight descending, deduplicate by targetId (prefer higher weight)
    const seen = new Set<string>();
    const deduped: SimilarityEdge[] = [];
    for (const edge of edges.sort((a, b) => b.weight - a.weight)) {
      if (!seen.has(edge.targetId)) {
        seen.add(edge.targetId);
        deduped.push(edge);
      }
    }

    return deduped.slice(0, limit);
  }

  // ─── Build Full Similarity Graph for a Tenant ───────────────────────────────

  /**
   * Builds the complete similarity graph for all entities within a tenant,
   * combining semantic, transactional, and co-occurrence edges.
   */
  buildSimilarityGraph(tenantId: string): SimilarityEdge[] {
    const entries = this.tenantIndices.get(tenantId) ?? [];
    if (entries.length < 2) return [];

    const edges: SimilarityEdge[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const source = entries[i];
        const target = entries[j];

        // Semantic edge
        const semanticSim = cosineSimilarity(source.embedding, target.embedding);
        if (semanticSim > 0.5) {
          edges.push({
            sourceId: source.id,
            targetId: target.id,
            similarity: semanticSim,
            edgeType: 'semantic',
            weight: semanticSim,
          });
        }

        // Transactional edge (if both appear in transactions)
        const sourceTxCount = this.transactionCounts.get(source.id) ?? 0;
        const targetTxCount = this.transactionCounts.get(target.id) ?? 0;
        if (sourceTxCount > 0 && targetTxCount > 0) {
          const txWeight = Math.min(1.0,
            (sourceTxCount + targetTxCount) / (2 * Math.max(1, this.totalTransactions)) * 100);
          if (txWeight > 0.1) {
            edges.push({
              sourceId: source.id,
              targetId: target.id,
              similarity: txWeight,
              edgeType: 'transactional',
              weight: txWeight,
            });
          }
        }

        // Co-occurrence edge
        const coKey = this.coOccurrenceKey(source.id, target.id);
        const cooc = this.coOccurrence.get(coKey);
        if (cooc && cooc.count > 0) {
          const coWeight = Math.min(1.0, cooc.count / Math.max(1, this.totalTransactions) * 50);
          edges.push({
            sourceId: source.id,
            targetId: target.id,
            similarity: coWeight,
            edgeType: 'co_occurrence',
            weight: coWeight,
          });
        }
      }
    }

    // Deduplicate: for each ID pair, keep the highest-weight edge
    const best = new Map<string, SimilarityEdge>();
    for (const edge of edges) {
      const pairKey = this.coOccurrenceKey(edge.sourceId, edge.targetId);
      const existing = best.get(pairKey);
      if (!existing || edge.weight > existing.weight) {
        best.set(pairKey, edge);
      }
    }

    return [...best.values()].sort((a, b) => b.weight - a.weight);
  }

  // ─── Improve Transferability Score ──────────────────────────────────────────

  /**
   * Recalculates the transferability score for a business, incorporating
   * graph-based signals from the similarity graph. More transactions = more
   * accurate scoring through network effects.
   */
  improveTransferabilityScore(businessId: string): number {
    const entries = this.index.filter(e =>
      e.metadata?.businessId === businessId);
    if (entries.length === 0) return 0;

    // Count marketplace-related signals from the index
    const listingCount = entries.filter(e => e.type === 'listing').length;
    const bookingCount = entries.filter(e => e.type === 'booking').length;
    const rightsCount = entries.filter(e => e.type === 'rights_asset').length;

    // Graph-based signal: how many edges does this business's entities have?
    let totalEdgeWeight = 0;
    let edgeCount = 0;
    for (const entry of entries) {
      const similars = this.findSimilar(entry.id, undefined, 5);
      for (const edge of similars) {
        totalEdgeWeight += edge.weight;
        edgeCount++;
      }
    }
    const avgEdgeWeight = edgeCount > 0 ? totalEdgeWeight / edgeCount : 0;

    // Transaction-based signal
    let totalTxCount = 0;
    for (const entry of entries) {
      totalTxCount += this.transactionCounts.get(entry.id) ?? 0;
    }

    const profile: BusinessProfile = {
      id: businessId,
      chainOfTitleUnbroken: rightsCount > 0,
      verifiedAnchorCount: rightsCount,
      verifiedAnchorRequired: Math.max(1, rightsCount),
      hasDisputes: false,
      disputeCount: 0,
      passportExpired: false,
      passportExpiresInDays: null,
      revenueHistoryMonths: Math.min(24, bookingCount),
      monthlyRevenueAvg: totalTxCount * 1000,
      marketplaceListings: listingCount,
      marketplaceSales: bookingCount,
      agentAutomationLevel: Math.round(avgEdgeWeight * 100),
      bookingCompletionRate: bookingCount > 0 ? 0.85 : 0,
      platformTenureDays: entries.length > 0
        ? Math.floor((Date.now() - Math.min(...entries.map(e => e.createdAt))) / 86400_000)
        : 0,
    };

    const score = this.scorer.score(profile);
    return score.total;
  }

  // ─── Getters ─────────────────────────────────────────────────────────────────

  get entityCount(): number { return this.index.length; }
  get transactionCount(): number { return this.totalTransactions; }
  get tenantCount(): number { return this.tenantIndices.size; }
  get coOccurrenceCount(): number { return this.coOccurrence.size; }
  get indices(): ReadonlyMap<string, IndexEntry[]> { return this.tenantIndices; }

  /** Returns all indexed entries across all tenants. */
  getAllEntries(): ReadonlyArray<IndexEntry> {
    return this.index;
  }

  /** Returns indexed entries for a specific tenant. */
  getTenantEntries(tenantId: string): ReadonlyArray<IndexEntry> {
    return this.tenantIndices.get(tenantId) ?? [];
  }
}

// ─── Deterministic Fallback Vector ─────────────────────────────────────────────

function hashFNV(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function vectorFallbackDeterministic(text: string, dimensions = 1536): number[] {
  const vec = new Array(dimensions).fill(0);
  const seed = hashFNV(text);
  for (let i = 0; i < dimensions; i++) {
    const h = hashFNV(`${text}:${i}:${seed}`);
    vec[i] = (h / 0xFFFFFFFF) * 2 - 1;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return mag > 0 ? vec.map(v => v / mag) : vec;
}
