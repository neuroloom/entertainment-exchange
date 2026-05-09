// FraudDetector — Anomaly detection, confidence scoring, and cross-tenant scanning
// Moat 3: Data network effects — detection thresholds tighten as more data flows
// Scans booking values, document hashes, listing velocity, and metadata clones

export interface FraudDetectorIndicator {
  indicatorId: string;
  type: 'duplicate_document' | 'rapid_listing' | 'value_anomaly' | 'metadata_clone';
  confidence: number;
  entities: string[];
  evidence: Record<string, unknown>;
  detectedAt: number;
}

export interface FraudDetectorStores {
  bookings: { values(): IterableIterator<Record<string, unknown>> };
  listings: { values(): IterableIterator<Record<string, unknown>> };
  rightsAssets: { values(): IterableIterator<Record<string, unknown>> };
  auditEvents: { all(tenantId?: string): Array<Record<string, unknown>> };
}

interface TenantStats {
  tenantId: string;
  bookingValues: number[];
  listingCreateTimes: number[];
  listingDeleteTimes: number[];
  documentHashes: Map<string, string[]>;
  rightAssetMetadata: Map<string, string[]>;
}

interface RiskHistoryEntry {
  businessId: string;
  riskScore: number;
  indicatorIds: string[];
  calculatedAt: number;
}

// ─── Stat helpers ──────────────────────────────────────────────────────────────

function mean(v: number[]): number { return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; }
function stdDev(v: number[], avg: number): number {
  if (v.length < 2) return 0;
  return Math.sqrt(v.reduce((s, x) => s + (x - avg) ** 2, 0) / (v.length - 1));
}
function zScore(value: number, avg: number, sd: number): number { return sd === 0 ? 0 : Math.abs((value - avg) / sd); }

function fingerprintMetadata(metadata: unknown): string {
  const normalized = JSON.stringify(metadata, Object.keys(metadata as object ?? {}).sort());
  let h = 2166136261;
  for (let i = 0; i < normalized.length; i++) { h ^= normalized.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return c === 'x' ? r.toString(16) : ((r & 0x3) | 0x8).toString(16);
  });
}

// ─── Cross-tenant helper types ─────────────────────────────────────────────────

interface CrossTenantEntry { hash: string; fingerprint: string; tenantId: string;
  entityId?: string; assetId?: string; }

function buildGlobalDocHashes(
  tenantIds: Set<string>, buildTenantStats: (tid: string) => TenantStats,
): Map<string, CrossTenantEntry[]> {
  const global = new Map<string, CrossTenantEntry[]>();
  for (const tid of tenantIds) {
    const stats = buildTenantStats(tid);
    for (const [hash, entityIds] of stats.documentHashes) {
      const existing = global.get(hash) ?? [];
      for (const eid of entityIds) existing.push({ hash, fingerprint: '', tenantId: tid, entityId: eid });
      global.set(hash, existing);
    }
  }
  return global;
}

function buildGlobalMetaFingerprints(
  tenantIds: Set<string>, buildTenantStats: (tid: string) => TenantStats,
): Map<string, CrossTenantEntry[]> {
  const global = new Map<string, CrossTenantEntry[]>();
  for (const tid of tenantIds) {
    const stats = buildTenantStats(tid);
    for (const [fp, assetIds] of stats.rightAssetMetadata) {
      const existing = global.get(fp) ?? [];
      for (const aid of assetIds) existing.push({ hash: '', fingerprint: fp, tenantId: tid, assetId: aid });
      global.set(fp, existing);
    }
  }
  return global;
}

function crossTenantFlags(
  global: Map<string, CrossTenantEntry[]>, keyField: string, indicatorType: FraudDetectorIndicator['type'],
  baseConfidence: number, perTenant: number, entityExtractor: (e: CrossTenantEntry) => string,
): FraudDetectorIndicator[] {
  const out: FraudDetectorIndicator[] = [];
  for (const [key, entries] of global) {
    const tenantSet = new Set(entries.map(e => e.tenantId));
    if (tenantSet.size > 1) {
      out.push({
        indicatorId: generateId(), type: indicatorType,
        confidence: Math.min(1.0, baseConfidence + (tenantSet.size - 2) * perTenant),
        entities: entries.map(entityExtractor),
        evidence: { [keyField]: key, tenantCount: tenantSet.size, tenants: [...tenantSet],
          entryCount: entries.length },
        detectedAt: Date.now(),
      });
    }
  }
  return out;
}

// ─── Cluster detector: flags any map where multiple IDs share the same key ─────

function detectClusters<K>(
  map: Map<K, string[]>, type: FraudIndicator['type'],
  baseConfidence: number, perExtra: number, extraEvidence: Record<string, unknown>,
): FraudIndicator[] {
  const out: FraudIndicator[] = [];
  for (const [key, ids] of map) {
    if (ids.length > 1) {
      out.push({
        indicatorId: generateId(), type,
        confidence: Math.min(1.0, baseConfidence + (ids.length - 2) * perExtra),
        entities: ids,
        evidence: { key: String(key), duplicateCount: ids.length, ...extraEvidence },
        detectedAt: Date.now(),
      });
    }
  }
  return out;
}

// ─── Main Class ────────────────────────────────────────────────────────────────

export class FraudDetector {
  private scanHistory = new Map<string, FraudIndicator[]>();
  private riskHistory = new Map<string, RiskHistoryEntry[]>();
  private zScoreThreshold = 3.0;
  private rapidWindowMs = 60_000;
  private rapidCountThreshold = 5;
  private totalScans = 0;
  private totalIndicators = 0;

  constructor(private stores: FraudDetectorStores) {}

  scanTenant(tenantId: string): FraudIndicator[] {
    this.totalScans++;
    const stats = this.buildTenantStats(tenantId);
    const indicators: FraudIndicator[] = [
      ...detectClusters(stats.documentHashes, 'duplicate_document', 0.5, 0.2, { tenantId }),
      ...this.detectRapidListings(stats, tenantId),
      ...this.detectValueAnomalies(stats, tenantId),
      ...detectClusters(stats.rightAssetMetadata, 'metadata_clone', 0.5, 0.25, { tenantId }),
    ];
    this.scanHistory.set(tenantId, indicators);
    this.totalIndicators += indicators.length;
    this.adaptThresholds();
    return indicators;
  }

  scanCrossTenant(): FraudIndicator[] {
    this.totalScans++;
    const tenantIds = new Set<string>();
    for (const it of [this.stores.bookings, this.stores.listings, this.stores.rightsAssets])
      for (const e of it.values()) { const tid = e.tenantId as string; if (tid) tenantIds.add(tid); }

    const indicators: FraudIndicator[] = [
      ...crossTenantFlags(
        buildGlobalDocHashes(tenantIds, (tid) => this.buildTenantStats(tid)),
        'hash', 'duplicate_document', 0.7, 0.1, (e) => e.entityId ?? '',
      ),
      ...crossTenantFlags(
        buildGlobalMetaFingerprints(tenantIds, (tid) => this.buildTenantStats(tid)),
        'fingerprint', 'metadata_clone', 0.6, 0.15, (e) => e.assetId ?? '',
      ),
    ];
    this.totalIndicators += indicators.length;
    this.adaptThresholds();
    return indicators;
  }

  getRiskScore(businessId: string): number {
    const all = new Map<string, FraudIndicator>();
    for (const indicators of this.scanHistory.values()) {
      for (const ind of indicators) {
        if (ind.entities.includes(businessId) || (ind.evidence as any).tenantId === businessId || (ind.evidence as any).businessId === businessId)
          all.set(ind.indicatorId, ind);
      }
    }
    if (all.size === 0) return 0;
    const weights: Record<string, number> = { duplicate_document: 25, rapid_listing: 20, value_anomaly: 18, metadata_clone: 22 };
    let raw = 0, tw = 0;
    for (const ind of all.values()) { const w = weights[ind.type]; raw += ind.confidence * w; tw += w; }
    const score = Math.min(100, Math.max(0, Math.round((tw ? (raw / tw) * 100 : 0) * 100) / 100));
    const hist = this.riskHistory.get(businessId) ?? [];
    hist.push({ businessId, riskScore: score, indicatorIds: [...all.keys()], calculatedAt: Date.now() });
    this.riskHistory.set(businessId, hist);
    return score;
  }

  getRiskTrend(businessId: string): RiskHistoryEntry[] { return this.riskHistory.get(businessId) ?? []; }

  // ─── Stats builder ───────────────────────────────────────────────────────────

  private buildTenantStats(tenantId: string): TenantStats {
    const stats: TenantStats = { tenantId, bookingValues: [], listingCreateTimes: [],
      listingDeleteTimes: [], documentHashes: new Map(), rightAssetMetadata: new Map() };

    for (const b of this.stores.bookings.values()) {
      if ((b.tenantId as string) !== tenantId) continue;
      const amount = b.quotedAmountCents as number;
      if (typeof amount === 'number') stats.bookingValues.push(amount);
    }

    for (const l of this.stores.listings.values()) {
      if ((l.tenantId as string) !== tenantId) continue;
      const ca = l.createdAt ?? l.created_at;
      if (typeof ca === 'string') stats.listingCreateTimes.push(new Date(ca).getTime());
      const da = l.deletedAt ?? l.deleted_at;
      if (typeof da === 'string') stats.listingDeleteTimes.push(new Date(da).getTime());
      const dh = l.documentHash ?? l.document_hash;
      if (typeof dh === 'string') { const ex = stats.documentHashes.get(dh) ?? [];
        ex.push((l.id ?? l.entityId) as string); stats.documentHashes.set(dh, ex); }
    }

    for (const a of this.stores.rightsAssets.values()) {
      if ((a.tenantId as string) !== tenantId) continue;
      const fp = fingerprintMetadata(a.metadata ?? {});
      const ex = stats.rightAssetMetadata.get(fp) ?? [];
      ex.push((a.id ?? a.entityId) as string); stats.rightAssetMetadata.set(fp, ex);
    }

    for (const evt of this.stores.auditEvents.all(tenantId)) {
      const e = evt as Record<string, unknown>;
      const meta = e.metadata as Record<string, unknown> | undefined;
      const dh = e.documentHash ?? e.document_hash ?? meta?.documentHash;
      if (typeof dh === 'string') { const ex = stats.documentHashes.get(dh) ?? [];
        ex.push((e.resourceId ?? e.id) as string); stats.documentHashes.set(dh, ex); }
    }

    return stats;
  }

  // ─── Detection methods ──────────────────────────────────────────────────────

  private detectRapidListings(stats: TenantStats, tenantId: string): FraudIndicator[] {
    const out: FraudIndicator[] = [];
    const creates = [...stats.listingCreateTimes].sort((a, b) => a - b);
    const deletes = [...stats.listingDeleteTimes].sort((a, b) => a - b);

    if (creates.length >= this.rapidCountThreshold) {
      for (let i = 0; i <= creates.length - this.rapidCountThreshold; i++) {
        const dur = creates[i + this.rapidCountThreshold - 1] - creates[i];
        if (dur < this.rapidWindowMs) {
          out.push({ indicatorId: generateId(), type: 'rapid_listing',
            confidence: Math.min(1.0, 0.6 + (1 - dur / this.rapidWindowMs) * 0.4),
            entities: [],
            evidence: { count: this.rapidCountThreshold, windowMs: dur, thresholdMs: this.rapidWindowMs, tenantId },
            detectedAt: Date.now() });
          break;
        }
      }
    }

    if (creates.length > 0 && deletes.length > 0) {
      let rdc = 0;
      for (const ct of creates) for (const dt of deletes) if (dt > ct && (dt - ct) < this.rapidWindowMs * 5) rdc++;
      if (rdc >= 3) out.push({ indicatorId: generateId(), type: 'rapid_listing',
        confidence: Math.min(1.0, 0.4 + rdc * 0.1), entities: [],
        evidence: { pattern: 'create_delete_cycle', rapidDeleteCount: rdc, tenantId }, detectedAt: Date.now() });
    }
    return out;
  }

  private detectValueAnomalies(stats: TenantStats, tenantId: string): FraudIndicator[] {
    if (stats.bookingValues.length < 3) return [];
    const avg = mean(stats.bookingValues);
    const sd = stdDev(stats.bookingValues, avg);
    if (sd === 0) return [];

    const outlierIds: string[] = [], outlierValues: number[] = [];
    let maxZ = 0;
    for (const b of this.stores.bookings.values()) {
      if ((b.tenantId as string) !== tenantId) continue;
      const amount = b.quotedAmountCents as number;
      if (typeof amount !== 'number') continue;
      const z = zScore(amount, avg, sd);
      if (z > this.zScoreThreshold) { outlierIds.push((b.id ?? b.entityId) as string); outlierValues.push(amount); if (z > maxZ) maxZ = z; }
    }
    if (outlierIds.length === 0) return [];
    return [{
      indicatorId: generateId(), type: 'value_anomaly',
      confidence: Math.min(1.0, 0.5 + (maxZ - this.zScoreThreshold) * 0.2),
      entities: outlierIds,
      evidence: { mean: avg, stdDev: sd, threshold: this.zScoreThreshold, outlierCount: outlierIds.length, maxZScore: maxZ, tenantId },
      detectedAt: Date.now(),
    }];
  }

  // ─── Learning adaptation ─────────────────────────────────────────────────────

  private adaptThresholds(): void {
    if (this.totalScans > 100 && this.zScoreThreshold > 2.0) this.zScoreThreshold = Math.max(2.0, this.zScoreThreshold - 0.05);
    if (this.totalScans > 500 && this.zScoreThreshold > 1.8) this.zScoreThreshold = Math.max(1.8, this.zScoreThreshold - 0.1);
    if (this.totalScans > 2000 && this.zScoreThreshold > 1.5) this.zScoreThreshold = Math.max(1.5, this.zScoreThreshold - 0.15);
    if (this.totalScans > 200 && this.rapidWindowMs > 30_000) this.rapidWindowMs = Math.max(30_000, this.rapidWindowMs - 5_000);
    if (this.totalScans > 500 && this.rapidWindowMs > 15_000) this.rapidWindowMs = Math.max(15_000, this.rapidWindowMs - 5_000);
    if (this.totalScans > 300 && this.rapidCountThreshold > 3) this.rapidCountThreshold = Math.max(3, this.rapidCountThreshold - 1);
  }

  // ─── Configuration ──────────────────────────────────────────────────────────

  setZScoreThreshold(threshold: number): void { this.zScoreThreshold = Math.max(0.5, threshold); }
  setRapidWindow(windowMs: number): void { this.rapidWindowMs = Math.max(5_000, windowMs); }
  setRapidCountThreshold(count: number): void { this.rapidCountThreshold = Math.max(2, count); }

  get currentThresholds() {
    return { zScore: this.zScoreThreshold, rapidWindowMs: this.rapidWindowMs,
      rapidCount: this.rapidCountThreshold, totalScans: this.totalScans, totalIndicators: this.totalIndicators };
  }
}
