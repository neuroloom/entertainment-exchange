// FraudDetector — Anomaly detection, confidence scoring, and cross-tenant scanning
// Moat 3: Data network effects — detection thresholds tighten as more data flows
// Scans booking values, document hashes, listing velocity, and metadata clones

// ─── Fraud Indicator ──────────────────────────────────────────────────────────

export interface FraudIndicator {
  indicatorId: string;
  type: 'duplicate_document' | 'rapid_listing' | 'value_anomaly' | 'metadata_clone';
  confidence: number;       // 0-1
  entities: string[];       // affected entity IDs
  evidence: Record<string, unknown>;
  detectedAt: number;
}

// ─── Stores Interface (injected for testability) ──────────────────────────────

export interface FraudDetectorStores {
  /** Generic in-memory store with id-keyed entries. Must support values() iterator. */
  bookings: { values(): IterableIterator<Record<string, unknown>> };
  listings: { values(): IterableIterator<Record<string, unknown>> };
  rightsAssets: { values(): IterableIterator<Record<string, unknown>> };
  auditEvents: { all(tenantId?: string): Array<Record<string, unknown>> };
}

// ─── Internal Statistics ──────────────────────────────────────────────────────

interface TenantStats {
  tenantId: string;
  bookingValues: number[];
  listingCreateTimes: number[];
  listingDeleteTimes: number[];
  documentHashes: Map<string, string[]>;   // hash -> entity IDs
  rightAssetMetadata: Map<string, string[]>; // metadata fingerprint -> asset IDs
}

// ─── Risk History ─────────────────────────────────────────────────────────────

interface RiskHistoryEntry {
  businessId: string;
  riskScore: number;
  indicatorIds: string[];
  calculatedAt: number;
}

// ─── Z-Score computation ──────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function zScore(value: number, avg: number, sd: number): number {
  if (sd === 0) return 0;
  return Math.abs((value - avg) / sd);
}

// ─── Simple hash for metadata fingerprinting ───────────────────────────────────

function fingerprintMetadata(metadata: unknown): string {
  const normalized = JSON.stringify(metadata, Object.keys(metadata as object ?? {}).sort());
  let h = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

// ─── UUID v4 generation (no dependency) ────────────────────────────────────────

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Main Class ────────────────────────────────────────────────────────────────

export class FraudDetector {
  private scanHistory = new Map<string, FraudIndicator[]>();
  private riskHistory = new Map<string, RiskHistoryEntry[]>();
  private zScoreThreshold = 3.0;
  private rapidWindowMs = 60_000; // 1 minute for rapid-fire detection
  private rapidCountThreshold = 5;

  // Learning: thresholds tighten as more data flows through the system
  private totalScans = 0;
  private totalIndicators = 0;

  constructor(
    private stores: FraudDetectorStores,
  ) {}

  // ─── Scan Single Tenant ─────────────────────────────────────────────────────

  scanTenant(tenantId: string): FraudIndicator[] {
    this.totalScans++;
    const indicators: FraudIndicator[] = [];

    const stats = this.buildTenantStats(tenantId);

    // 1. Duplicate document hashes within tenant
    indicators.push(...this.detectDuplicateDocuments(stats, tenantId));

    // 2. Rapid-fire listing creation/deletion
    indicators.push(...this.detectRapidListings(stats, tenantId));

    // 3. Value anomalies (z-score > threshold)
    indicators.push(...this.detectValueAnomalies(stats, tenantId));

    // 4. Metadata clones
    indicators.push(...this.detectMetadataClones(stats, tenantId));

    // Record scan results
    this.scanHistory.set(tenantId, indicators);
    this.totalIndicators += indicators.length;

    // Tighten thresholds with more data (learning effect)
    this.adaptThresholds();

    return indicators;
  }

  // ─── Cross-Tenant Scan (Network Effect) ─────────────────────────────────────

  scanCrossTenant(): FraudIndicator[] {
    this.totalScans++;
    const indicators: FraudIndicator[] = [];

    // Collect all tenants from available store data
    const tenantIds = new Set<string>();
    for (const booking of this.stores.bookings.values()) {
      const tid = booking.tenantId as string;
      if (tid) tenantIds.add(tid);
    }
    for (const listing of this.stores.listings.values()) {
      const tid = listing.tenantId as string;
      if (tid) tenantIds.add(tid);
    }
    for (const asset of this.stores.rightsAssets.values()) {
      const tid = asset.tenantId as string;
      if (tid) tenantIds.add(tid);
    }

    // Cross-tenant duplicate document detection
    const globalDocHashes = new Map<string, Array<{ hash: string; tenantId: string; entityId: string }>>();

    for (const tenantId of tenantIds) {
      const stats = this.buildTenantStats(tenantId);
      for (const [hash, entityIds] of stats.documentHashes) {
        const existing = globalDocHashes.get(hash) ?? [];
        for (const eid of entityIds) {
          existing.push({ hash, tenantId, entityId: eid });
        }
        globalDocHashes.set(hash, existing);
      }
    }

    // Flag hashes appearing in multiple tenants
    for (const [hash, entries] of globalDocHashes) {
      const tenantSet = new Set(entries.map(e => e.tenantId));
      if (tenantSet.size > 1) {
        indicators.push({
          indicatorId: generateId(),
          type: 'duplicate_document',
          confidence: Math.min(1.0, 0.7 + (tenantSet.size - 2) * 0.1),
          entities: entries.map(e => e.entityId),
          evidence: {
            hash,
            tenantCount: tenantSet.size,
            tenants: [...tenantSet],
            details: entries,
          },
          detectedAt: Date.now(),
        });
      }
    }

    // Cross-tenant metadata clones
    const globalMetaFingerprints = new Map<string, Array<{ fingerprint: string; tenantId: string; assetId: string }>>();

    for (const tenantId of tenantIds) {
      const stats = this.buildTenantStats(tenantId);
      for (const [fp, assetIds] of stats.rightAssetMetadata) {
        const existing = globalMetaFingerprints.get(fp) ?? [];
        for (const aid of assetIds) {
          existing.push({ fingerprint: fp, tenantId, assetId: aid });
        }
        globalMetaFingerprints.set(fp, existing);
      }
    }

    for (const [fp, entries] of globalMetaFingerprints) {
      const tenantSet = new Set(entries.map(e => e.tenantId));
      if (tenantSet.size > 1) {
        indicators.push({
          indicatorId: generateId(),
          type: 'metadata_clone',
          confidence: Math.min(1.0, 0.6 + (tenantSet.size - 2) * 0.15),
          entities: entries.map(e => e.assetId),
          evidence: {
            fingerprint: fp,
            tenantCount: tenantSet.size,
            tenants: [...tenantSet],
            assetCount: entries.length,
          },
          detectedAt: Date.now(),
        });
      }
    }

    this.totalIndicators += indicators.length;
    this.adaptThresholds();

    return indicators;
  }

  // ─── Aggregate Risk Score for a Business ────────────────────────────────────

  getRiskScore(businessId: string): number {
    const allIndicators: FraudIndicator[] = [];
    for (const indicators of this.scanHistory.values()) {
      for (const ind of indicators) {
        if (ind.entities.includes(businessId) || this.indicatorMentionsBusiness(ind, businessId)) {
          allIndicators.push(ind);
        }
      }
    }

    if (allIndicators.length === 0) {
      return 0;
    }

    // Weight by type severity and confidence
    const typeWeights: Record<FraudIndicator['type'], number> = {
      duplicate_document: 25,
      rapid_listing: 20,
      value_anomaly: 18,
      metadata_clone: 22,
    };

    let rawScore = 0;
    let totalWeight = 0;

    for (const ind of allIndicators) {
      const weight = typeWeights[ind.type];
      rawScore += ind.confidence * weight;
      totalWeight += weight;
    }

    // Normalize to 0-100
    const normalized = totalWeight > 0 ? (rawScore / totalWeight) * 100 : 0;

    // Cap at 100 and ensure minimum of 0
    const score = Math.min(100, Math.max(0, Math.round(normalized * 100) / 100));

    // Historical tracking
    const history = this.riskHistory.get(businessId) ?? [];
    history.push({
      businessId,
      riskScore: score,
      indicatorIds: allIndicators.map(i => i.indicatorId),
      calculatedAt: Date.now(),
    });
    this.riskHistory.set(businessId, history);

    return score;
  }

  // ─── Get Risk Trend ─────────────────────────────────────────────────────────

  getRiskTrend(businessId: string): RiskHistoryEntry[] {
    return this.riskHistory.get(businessId) ?? [];
  }

  // ─── Private: Build Statistics for a Tenant ─────────────────────────────────

  private buildTenantStats(tenantId: string): TenantStats {
    const stats: TenantStats = {
      tenantId,
      bookingValues: [],
      listingCreateTimes: [],
      listingDeleteTimes: [],
      documentHashes: new Map(),
      rightAssetMetadata: new Map(),
    };

    // Collect booking values
    for (const booking of this.stores.bookings.values()) {
      if ((booking.tenantId as string) === tenantId) {
        const amount = booking.quotedAmountCents as number;
        if (typeof amount === 'number') {
          stats.bookingValues.push(amount);
        }
      }
    }

    // Collect listing data
    for (const listing of this.stores.listings.values()) {
      if ((listing.tenantId as string) === tenantId) {
        const createdAt = listing.createdAt ?? listing.created_at;
        if (typeof createdAt === 'string') {
          stats.listingCreateTimes.push(new Date(createdAt).getTime());
        }
        const deletedAt = listing.deletedAt ?? listing.deleted_at;
        if (typeof deletedAt === 'string') {
          stats.listingDeleteTimes.push(new Date(deletedAt).getTime());
        }

        // Document hash
        const docHash = listing.documentHash ?? listing.document_hash;
        if (typeof docHash === 'string') {
          const existing = stats.documentHashes.get(docHash) ?? [];
          existing.push((listing.id ?? listing.entityId) as string);
          stats.documentHashes.set(docHash, existing);
        }
      }
    }

    // Collect rights asset metadata fingerprints
    for (const asset of this.stores.rightsAssets.values()) {
      if ((asset.tenantId as string) === tenantId) {
        const metadata = asset.metadata ?? {};
        const fp = fingerprintMetadata(metadata);
        const existing = stats.rightAssetMetadata.get(fp) ?? [];
        existing.push((asset.id ?? asset.entityId) as string);
        stats.rightAssetMetadata.set(fp, existing);
      }
    }

    // Collect document hashes from audit events for documents
    for (const evt of this.stores.auditEvents.all(tenantId)) {
      const docHash = evt.documentHash ?? evt.document_hash ?? evt.metadata?.documentHash;
      if (typeof docHash === 'string') {
        const existing = stats.documentHashes.get(docHash) ?? [];
        existing.push((evt.resourceId ?? evt.id) as string);
        stats.documentHashes.set(docHash, existing);
      }
    }

    return stats;
  }

  // ─── Private: Detection Methods ─────────────────────────────────────────────

  private detectDuplicateDocuments(stats: TenantStats, tenantId: string): FraudIndicator[] {
    const indicators: FraudIndicator[] = [];

    for (const [hash, entityIds] of stats.documentHashes) {
      if (entityIds.length > 1) {
        const confidence = Math.min(1.0, 0.5 + (entityIds.length - 2) * 0.2);
        indicators.push({
          indicatorId: generateId(),
          type: 'duplicate_document',
          confidence,
          entities: entityIds,
          evidence: { hash, duplicateCount: entityIds.length, tenantId },
          detectedAt: Date.now(),
        });
      }
    }

    return indicators;
  }

  private detectRapidListings(stats: TenantStats, tenantId: string): FraudIndicator[] {
    const indicators: FraudIndicator[] = [];

    // Sort create times
    const creates = [...stats.listingCreateTimes].sort((a, b) => a - b);
    const deletes = [...stats.listingDeleteTimes].sort((a, b) => a - b);

    // Detect bursts of creation within rapidWindowMs
    if (creates.length >= this.rapidCountThreshold) {
      for (let i = 0; i <= creates.length - this.rapidCountThreshold; i++) {
        const window = creates.slice(i, i + this.rapidCountThreshold);
        const windowDuration = window[window.length - 1] - window[0];
        if (windowDuration < this.rapidWindowMs) {
          const confidence = Math.min(1.0, 0.6 + (1 - windowDuration / this.rapidWindowMs) * 0.4);
          indicators.push({
            indicatorId: generateId(),
            type: 'rapid_listing',
            confidence,
            entities: [], // generic, not tied to specific entity IDs from timestamps alone
            evidence: {
              count: this.rapidCountThreshold,
              windowMs: windowDuration,
              thresholdMs: this.rapidWindowMs,
              tenantId,
            },
            detectedAt: Date.now(),
          });
          break; // one burst flag per scan
        }
      }
    }

    // Detect rapid create-then-delete cycles
    if (creates.length > 0 && deletes.length > 0) {
      let rapidDeleteCount = 0;
      for (const createTime of creates) {
        for (const deleteTime of deletes) {
          if (deleteTime > createTime && (deleteTime - createTime) < this.rapidWindowMs * 5) {
            rapidDeleteCount++;
          }
        }
      }
      if (rapidDeleteCount >= 3) {
        indicators.push({
          indicatorId: generateId(),
          type: 'rapid_listing',
          confidence: Math.min(1.0, 0.4 + rapidDeleteCount * 0.1),
          entities: [],
          evidence: {
            pattern: 'create_delete_cycle',
            rapidDeleteCount,
            tenantId,
          },
          detectedAt: Date.now(),
        });
      }
    }

    return indicators;
  }

  private detectValueAnomalies(stats: TenantStats, tenantId: string): FraudIndicator[] {
    const indicators: FraudIndicator[] = [];

    if (stats.bookingValues.length < 3) return indicators;

    const avg = mean(stats.bookingValues);
    const sd = stdDev(stats.bookingValues, avg);

    if (sd === 0) return indicators;

    const outlierIds: string[] = [];
    const outlierValues: number[] = [];
    let maxZ = 0;

    for (const booking of this.stores.bookings.values()) {
      if ((booking.tenantId as string) !== tenantId) continue;
      const amount = booking.quotedAmountCents as number;
      if (typeof amount !== 'number') continue;

      const z = zScore(amount, avg, sd);
      if (z > this.zScoreThreshold) {
        outlierIds.push((booking.id ?? booking.entityId) as string);
        outlierValues.push(amount);
        if (z > maxZ) maxZ = z;
      }
    }

    if (outlierIds.length > 0) {
      const confidence = Math.min(1.0, 0.5 + (maxZ - this.zScoreThreshold) * 0.2);
      indicators.push({
        indicatorId: generateId(),
        type: 'value_anomaly',
        confidence,
        entities: outlierIds,
        evidence: {
          mean: avg,
          stdDev: sd,
          threshold: this.zScoreThreshold,
          outlierCount: outlierIds.length,
          maxZScore: maxZ,
          tenantId,
        },
        detectedAt: Date.now(),
      });
    }

    return indicators;
  }

  private detectMetadataClones(stats: TenantStats, tenantId: string): FraudIndicator[] {
    const indicators: FraudIndicator[] = [];

    for (const [fp, assetIds] of stats.rightAssetMetadata) {
      if (assetIds.length > 1) {
        const confidence = Math.min(1.0, 0.5 + (assetIds.length - 2) * 0.25);
        indicators.push({
          indicatorId: generateId(),
          type: 'metadata_clone',
          confidence,
          entities: assetIds,
          evidence: {
            fingerprint: fp,
            cloneCount: assetIds.length,
            tenantId,
          },
          detectedAt: Date.now(),
        });
      }
    }

    return indicators;
  }

  // ─── Private: Learning Adaptation ──────────────────────────────────────────

  /**
   * As more data flows through the system, detection thresholds tighten.
   * This is the core "data network effect" — the moat widens with every scan.
   */
  private adaptThresholds(): void {
    // After 100 scans, tighten z-score by 5%
    if (this.totalScans > 100 && this.zScoreThreshold > 2.0) {
      this.zScoreThreshold = Math.max(2.0, this.zScoreThreshold - 0.05);
    }
    // After 500 scans, tighten by another 10%
    if (this.totalScans > 500 && this.zScoreThreshold > 1.8) {
      this.zScoreThreshold = Math.max(1.8, this.zScoreThreshold - 0.1);
    }
    // After 2000 scans, go down to 1.5 (very sensitive)
    if (this.totalScans > 2000 && this.zScoreThreshold > 1.5) {
      this.zScoreThreshold = Math.max(1.5, this.zScoreThreshold - 0.15);
    }

    // Tighten rapid listing window with more data
    if (this.totalScans > 200 && this.rapidWindowMs > 30_000) {
      this.rapidWindowMs = Math.max(30_000, this.rapidWindowMs - 5_000);
    }
    if (this.totalScans > 500 && this.rapidWindowMs > 15_000) {
      this.rapidWindowMs = Math.max(15_000, this.rapidWindowMs - 5_000);
    }

    // Tighten rapid count threshold
    if (this.totalScans > 300 && this.rapidCountThreshold > 3) {
      this.rapidCountThreshold = Math.max(3, this.rapidCountThreshold - 1);
    }
  }

  // ─── Private: Helper ────────────────────────────────────────────────────────

  private indicatorMentionsBusiness(indicator: FraudIndicator, businessId: string): boolean {
    const evidence = indicator.evidence;
    if (evidence.businessId === businessId) return true;
    if (evidence.tenantId === businessId) return true;
    return false;
  }

  // ─── Configuration ──────────────────────────────────────────────────────────

  setZScoreThreshold(threshold: number): void {
    this.zScoreThreshold = Math.max(0.5, threshold);
  }

  setRapidWindow(windowMs: number): void {
    this.rapidWindowMs = Math.max(5_000, windowMs);
  }

  setRapidCountThreshold(count: number): void {
    this.rapidCountThreshold = Math.max(2, count);
  }

  get currentThresholds() {
    return {
      zScore: this.zScoreThreshold,
      rapidWindowMs: this.rapidWindowMs,
      rapidCount: this.rapidCountThreshold,
      totalScans: this.totalScans,
      totalIndicators: this.totalIndicators,
    };
  }
}
