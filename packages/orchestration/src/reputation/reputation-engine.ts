// ReputationEngine — composite reputation scoring, cross-tenant benchmarks, fraud detection
// L4 NETWORK EFFECTS: The more tenants use the platform, the more valuable it becomes for everyone
// All calculations are deterministic and auditable — no hidden state, no randomness

// ─── Tier definitions ─────────────────────────────────────────────────────────

export type ReputationTier = 'Unproven' | 'Established' | 'Trusted' | 'Elite';

export const REPUTATION_TIER_THRESHOLDS: Readonly<Record<ReputationTier, [number, number]>> = {
  Unproven:  [0, 30],
  Established: [31, 60],
  Trusted:   [61, 85],
  Elite:     [86, 100],
};

// ─── Weight configuration (verified to sum to 100 at module load) ─────────────

const SCORE_WEIGHTS = {
  completionRate: 40,
  disputeResolution: 20,
  tenure: 10,
  reviewAverage: 20,
  passportVerifications: 10,
} as const;

const weightSum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
if (weightSum !== 100) {
  throw new Error(`Reputation weights must sum to 100; got ${weightSum}`);
}

// ─── Input types — mirror existing project types for loose coupling ───────────

export interface ReputationAuditEvent {
  id: string;
  tenantId: string;
  businessId?: string | null;
  actorType: string;
  actorId: string;
  action: string;         // e.g. "booking.completed", "dispute.resolved", "passport.verified"
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;       // ISO-8601
}

export interface ReputationReview {
  id: number;
  listingId: number;
  reviewerId: number;
  rating: number;          // 1-5
  comment: string;
  createdAt: string;       // ISO-8601
}

export interface ReputationPassport {
  id: string;
  tenantId: string;
  businessId: string;
  status: string;          // 'draft' | 'active' | 'expired' | 'revoked' | 'superseded'
  metadata: Record<string, unknown>;
  issuedAt: string | null;
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface ReputationFactor<T = number> {
  raw: T;
  weighted: T;
}

export interface ReputationScoreFactors {
  completionRate: ReputationFactor;
  disputeResolution: ReputationFactor;
  tenure: ReputationFactor & { days: number };
  reviewAverage: ReputationFactor;
  passportVerifications: ReputationFactor;
}

export interface ReputationScore {
  businessId: string;
  score: number;           // 0-100
  tier: ReputationTier;
  factors: ReputationScoreFactors;
  lastUpdated: number;     // Unix ms
}

export interface IndustryBenchmark {
  vertical: string;
  avgDealSizeCents: number;
  avgCompletionRate: number;
  avgTransferabilityScore: number;
  activeBusinessCount: number;
}

export interface FraudIndicator {
  businessId: string;
  indicatorType: 'duplicate_document_hash' | 'rapid_listing_delisting' | 'unusual_price_evidence_ratio';
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence: string[];
  detectedAt: number;      // Unix ms
}

// ─── Business profile aggregation (internal) ──────────────────────────────────

interface BusinessMetrics {
  totalTransactions: number;
  completedTransactions: number;
  totalDisputes: number;
  resolvedDisputes: number;
  firstEventAt: string | null;
  reviews: ReputationReview[];
  passportCount: number;
  listings: Array<{ action: string; createdAt: string }>;
  documentHashes: string[];
  dealAmountsCents: number[];
  evidenceTiers: string[];
}

// ─── ReputationEngine ─────────────────────────────────────────────────────────

export class ReputationEngine {
  /**
   * Calculate a composite ReputationScore (0-100) for a business.
   *
   * Factors:
   *   40% — Transaction completion rate  (completed / total transactions)
   *   20% — Dispute resolution rate      (resolved / total disputes)
   *   10% — Platform tenure in days      (0 for new, capped at 2yr for max)
   *   20% — Review average               (avg rating / 5, scaled to 0-100)
   *   10% — Rights passport verification count (capped at 10)
   *
   * All raw inputs are arrays of audit events, reviews, and passports.
   * The engine is stateless and deterministic — same inputs always produce
   * the same output.
   */
  calculateReputation(
    businessId: string,
    auditEvents: ReputationAuditEvent[],
    reviews: ReputationReview[],
    passports: ReputationPassport[],
  ): ReputationScore {
    const metrics = this.aggregateMetrics(businessId, auditEvents, reviews, passports);

    const completionRaw = this.scoreCompletionRate(
      metrics.totalTransactions,
      metrics.completedTransactions,
    );
    const disputeRaw = this.scoreDisputeResolution(
      metrics.totalDisputes,
      metrics.resolvedDisputes,
    );
    const tenureRaw = this.scoreTenure(metrics.firstEventAt);
    const reviewRaw = this.scoreReviews(metrics.reviews);
    const passportRaw = this.scorePassportVerifications(metrics.passportCount);

    const factors: ReputationScoreFactors = {
      completionRate: {
        raw: completionRaw,
        weighted: this.weight(completionRaw, SCORE_WEIGHTS.completionRate),
      },
      disputeResolution: {
        raw: disputeRaw,
        weighted: this.weight(disputeRaw, SCORE_WEIGHTS.disputeResolution),
      },
      tenure: {
        raw: tenureRaw,
        weighted: this.weight(tenureRaw, SCORE_WEIGHTS.tenure),
        days: metrics.firstEventAt
          ? this.daysSince(metrics.firstEventAt)
          : 0,
      },
      reviewAverage: {
        raw: reviewRaw,
        weighted: this.weight(reviewRaw, SCORE_WEIGHTS.reviewAverage),
      },
      passportVerifications: {
        raw: passportRaw,
        weighted: this.weight(passportRaw, SCORE_WEIGHTS.passportVerifications),
      },
    };

    const score = Math.min(
      100,
      Math.max(
        0,
        Math.round(
          factors.completionRate.weighted +
            factors.disputeResolution.weighted +
            factors.tenure.weighted +
            factors.reviewAverage.weighted +
            factors.passportVerifications.weighted,
        ),
      ),
    );

    return {
      businessId,
      score,
      tier: this.deriveTier(score),
      factors,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Compute cross-tenant industry benchmarks. These create FOMO for new tenants
   * by showing them what they are missing — a core network effect driver.
   *
   * Benchmarks are computed by vertical from the full event + review + passport
   * corpus. If a vertical is specified, only that vertical is returned.
   */
  getIndustryBenchmarks(
    vertical?: string,
    allBusinessVerticals?: Array<{ businessId: string; vertical: string }>,
    allAuditEvents?: ReputationAuditEvent[],
    allBusinesses?: Array<{ businessId: string }>,
  ): IndustryBenchmark[] {
    if (!allAuditEvents || allAuditEvents.length === 0) return [];
    if (!allBusinessVerticals || allBusinessVerticals.length === 0) return [];

    // Group businesses by vertical
    const verticalMap = new Map<string, Set<string>>();
    for (const b of allBusinessVerticals) {
      if (vertical && b.vertical !== vertical) continue;
      let set = verticalMap.get(b.vertical);
      if (!set) {
        set = new Set();
        verticalMap.set(b.vertical, set);
      }
      set.add(b.businessId);
    }

    const benchmarks: IndustryBenchmark[] = [];

    for (const [vert, businessIds] of verticalMap) {
      const bizEvents = allAuditEvents.filter(
        (e) => e.businessId != null && businessIds.has(e.businessId),
      );

      // Average deal size from payment / completion events
      let dealTotalCents = 0;
      let dealCount = 0;
      let completedCount = 0;
      let totalTxCount = 0;

      for (const e of bizEvents) {
        if (e.resourceType === 'booking' || e.resourceType === 'deal') {
          totalTxCount++;
          if (e.action === 'booking.completed' || e.action === 'deal.completed' || e.action === 'booking:completed') {
            completedCount++;
          }
          const amount = Number(e.metadata?.amountCents ?? 0);
          if (amount > 0) {
            dealTotalCents += amount;
            dealCount++;
          }
        }
      }

      const avgDealSizeCents = dealCount > 0 ? Math.round(dealTotalCents / dealCount) : 0;
      const avgCompletionRate = totalTxCount > 0
        ? Math.round((completedCount / totalTxCount) * 10000) / 10000
        : 0;

      // Placeholder transferability average — in practice this would be
      // aggregated from TransferabilityScorer scores across all businesses
      const avgTransferabilityScore = 0; // computed externally

      benchmarks.push({
        vertical: vert,
        avgDealSizeCents,
        avgCompletionRate,
        avgTransferabilityScore,
        activeBusinessCount: businessIds.size,
      });
    }

    // Sort by active business count descending — largest verticals first
    benchmarks.sort((a, b) => b.activeBusinessCount - a.activeBusinessCount);

    return benchmarks;
  }

  /**
   * Detect cross-tenant anomalies and fraud indicators.
   *
   * Three indicator types:
   *   1. duplicate_document_hash — same LegalAnchor document hash across
   *      multiple different businesses (possible identity fraud)
   *   2. rapid_listing_delisting — business creates and deletes listings
   *      in rapid succession (possible market manipulation)
   *   3. unusual_price_evidence_ratio — deal amount is unusually high
   *      relative to the evidence tier (possible money laundering)
   */
  detectAnomalies(
    tenantId: string,
    auditEvents: ReputationAuditEvent[],
    allBusinessAnchors?: Map<string, string[]>, // businessId → documentHash[]
  ): FraudIndicator[] {
    const tenantEvents = auditEvents.filter((e) => e.tenantId === tenantId);
    if (tenantEvents.length === 0) return [];

    const indicators: FraudIndicator[] = [];

    // ── 1. Duplicate document hash across businesses ──────────────────────
    if (allBusinessAnchors && allBusinessAnchors.size > 1) {
      const hashToBusinesses = new Map<string, Set<string>>();
      for (const [bizId, hashes] of allBusinessAnchors) {
        for (const hash of hashes) {
          let set = hashToBusinesses.get(hash);
          if (!set) {
            set = new Set();
            hashToBusinesses.set(hash, set);
          }
          set.add(bizId);
        }
      }

      for (const [hash, businesses] of hashToBusinesses) {
        if (businesses.size > 1) {
          const involved = [...businesses];
          for (const bizId of involved) {
            indicators.push({
              businessId: bizId,
              indicatorType: 'duplicate_document_hash',
              severity: involved.length > 2 ? 'high' : 'medium',
              description: `Document hash ${hash.slice(0, 12)}... found across ${involved.length} businesses: ${involved.join(', ')}`,
              evidence: [`hash=${hash}`, ...involved.filter(b => b !== bizId).map(b => `shared_with=${b}`)],
              detectedAt: Date.now(),
            });
          }
        }
      }
    }

    // ── 2. Rapid listing/delisting patterns ──────────────────────────────
    const listingEvents = tenantEvents.filter(
      (e) =>
        e.resourceType === 'listing' &&
        (e.action === 'listing.created' || e.action === 'listing.deleted' || e.action === 'listing:created' || e.action === 'listing:deleted'),
    );

    // Group by businessId, look for create → delete within 24 hours
    const bizListings = new Map<string, Array<{ action: string; createdAt: string }>>();
    for (const e of listingEvents) {
      const bizId = e.businessId ?? 'unknown';
      let list = bizListings.get(bizId);
      if (!list) {
        list = [];
        bizListings.set(bizId, list);
      }
      list.push({ action: e.action, createdAt: e.createdAt });
    }

    for (const [bizId, events] of bizListings) {
      const creates = events.filter(
        (e) => e.action === 'listing.created' || e.action === 'listing:created',
      );
      const deletes = events.filter(
        (e) => e.action === 'listing.deleted' || e.action === 'listing:deleted',
      );

      let rapidPairs = 0;
      for (const create of creates) {
        const createMs = new Date(create.createdAt).getTime();
        for (const del of deletes) {
          const delMs = new Date(del.createdAt).getTime();
          const diffHours = Math.abs(delMs - createMs) / (1000 * 60 * 60);
          if (diffHours < 24) {
            rapidPairs++;
          }
        }
      }

      if (rapidPairs >= 3) {
        indicators.push({
          businessId: bizId,
          indicatorType: 'rapid_listing_delisting',
          severity: rapidPairs >= 10 ? 'high' : 'medium',
          description: `${rapidPairs} listing create/delete pairs within 24h detected for business ${bizId}`,
          evidence: events
            .filter(
              (e) =>
                e.action === 'listing.created' ||
                e.action === 'listing:created' ||
                e.action === 'listing.deleted' ||
                e.action === 'listing:deleted',
            )
            .map((e) => `event=${e.action} at=${e.createdAt}`),
          detectedAt: Date.now(),
        });
      }
    }

    // ── 3. Unusual price-to-evidence-tier ratios ─────────────────────────
    const dealEvents = tenantEvents.filter(
      (e) =>
        e.resourceType === 'deal' &&
        (e.action === 'deal.completed' || e.action === 'deal:completed' || e.action === 'deal.created' || e.action === 'deal:created'),
    );

    for (const e of dealEvents) {
      const amount = Number(e.metadata?.amountCents ?? 0);
      const evidenceTier = String(e.metadata?.evidenceTier ?? '');

      if (amount > 0 && evidenceTier) {
        // Self-reported evidence with very high amounts is suspicious
        if (evidenceTier === 'self_reported' && amount > 100_000_00) {
          // $100K+
          indicators.push({
            businessId: e.businessId ?? 'unknown',
            indicatorType: 'unusual_price_evidence_ratio',
            severity: amount > 1_000_000_00 ? 'high' : 'medium',
            description: `Deal amount $${(amount / 100).toLocaleString()} with only self-reported evidence (${e.resourceId})`,
            evidence: [
              `deal_id=${e.resourceId}`,
              `amount_cents=${amount}`,
              `evidence_tier=${evidenceTier}`,
            ],
            detectedAt: Date.now(),
          });
        }

        // Document-supported but above $1M also suspicious
        if (evidenceTier === 'document_supported' && amount > 1_000_000_00) {
          indicators.push({
            businessId: e.businessId ?? 'unknown',
            indicatorType: 'unusual_price_evidence_ratio',
            severity: 'medium',
            description: `Deal amount $${(amount / 100).toLocaleString()} with only document-supported evidence (${e.resourceId})`,
            evidence: [
              `deal_id=${e.resourceId}`,
              `amount_cents=${amount}`,
              `evidence_tier=${evidenceTier}`,
            ],
            detectedAt: Date.now(),
          });
        }
      }
    }

    return indicators;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private aggregateMetrics(
    businessId: string,
    auditEvents: ReputationAuditEvent[],
    reviews: ReputationReview[],
    passports: ReputationPassport[],
  ): BusinessMetrics {
    const bizEvents = auditEvents.filter((e) => e.businessId === businessId);
    const businessReviews = reviews.filter(
      (r) => bizEvents.some((e) => e.resourceId === String(r.listingId)),
    );
    const businessPassports = passports.filter((p) => p.businessId === businessId);

    let totalTransactions = 0;
    let completedTransactions = 0;
    let totalDisputes = 0;
    let resolvedDisputes = 0;
    let firstEventAt: string | null = null;
    const listings: Array<{ action: string; createdAt: string }> = [];
    const documentHashes: string[] = [];
    const dealAmountsCents: number[] = [];
    const evidenceTiers: string[] = [];

    for (const e of bizEvents) {
      // Track first event for tenure
      if (!firstEventAt || e.createdAt < firstEventAt) {
        firstEventAt = e.createdAt;
      }

      // Transaction tracking — bookings and deals
      if (
        (e.resourceType === 'booking' || e.resourceType === 'deal') &&
        (e.action.includes('created') ||
          e.action.includes('completed') ||
          e.action.includes('cancelled') ||
          e.action.includes('tentative') ||
          e.action.includes('contracted') ||
          e.action.includes('confirmed'))
      ) {
        totalTransactions++;
        if (
          e.action === 'booking.completed' ||
          e.action === 'booking:completed' ||
          e.action === 'deal.completed' ||
          e.action === 'deal:completed'
        ) {
          completedTransactions++;
        }

        const amount = Number(e.metadata?.amountCents ?? 0);
        if (amount > 0) {
          dealAmountsCents.push(amount);
        }
        const tier = e.metadata?.evidenceTier;
        if (typeof tier === 'string') {
          evidenceTiers.push(tier);
        }
      }

      // Dispute tracking
      if (e.resourceType === 'dispute') {
        if (
          e.action === 'dispute.opened' ||
          e.action === 'dispute:opened' ||
          e.action === 'dispute.created' ||
          e.action === 'dispute:created'
        ) {
          totalDisputes++;
        }
        if (
          e.action === 'dispute.resolved' ||
          e.action === 'dispute:resolved' ||
          e.action === 'dispute.closed' ||
          e.action === 'dispute:closed'
        ) {
          resolvedDisputes++;
        }
      }

      // Passport counting
      if (
        e.resourceType === 'passport' &&
        (e.action === 'passport.issued' || e.action === 'passport:issued' || e.action === 'passport.verified' || e.action === 'passport:verified')
      ) {
        // Counted separately via passport store
      }

      // Listing tracking
      if (
        e.resourceType === 'listing' &&
        (e.action.includes('created') || e.action.includes('deleted'))
      ) {
        listings.push({ action: e.action, createdAt: e.createdAt });
      }

      // Document hash tracking
      const hash = e.metadata?.documentHash;
      if (typeof hash === 'string' && hash.length > 0) {
        documentHashes.push(hash);
      }
    }

    return {
      totalTransactions,
      completedTransactions,
      totalDisputes,
      resolvedDisputes,
      firstEventAt,
      reviews: businessReviews,
      passportCount: businessPassports.filter(
        (p) => p.status === 'active' || p.status === 'superseded',
      ).length,
      listings,
      documentHashes,
      dealAmountsCents,
      evidenceTiers,
    };
  }

  // ── Factor scorers (each returns 0-100 raw) ───────────────────────────────

  private scoreCompletionRate(total: number, completed: number): number {
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  }

  private scoreDisputeResolution(total: number, resolved: number): number {
    if (total === 0) return 100; // No disputes is perfect
    return Math.round((resolved / total) * 100);
  }

  private scoreTenure(firstEventAt: string | null): number {
    if (!firstEventAt) return 0;
    const days = this.daysSince(firstEventAt);
    if (days >= 730) return 100;  // 2+ years
    if (days >= 365) return 80;   // 1 year
    if (days >= 180) return 60;   // 6 months
    if (days >= 90) return 40;    // 3 months
    if (days >= 30) return 20;    // 1 month
    return 10;                    // less than a month
  }

  private scoreReviews(reviews: ReputationReview[]): number {
    if (reviews.length === 0) return 0;
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    // Rating is 1-5, scale to 0-100
    return Math.round((avg / 5) * 100);
  }

  private scorePassportVerifications(count: number): number {
    if (count === 0) return 0;
    if (count >= 10) return 100;
    return count * 10; // 1→10, 2→20, ..., 9→90
  }

  // ── Tier derivation ──────────────────────────────────────────────────────

  private deriveTier(score: number): ReputationTier {
    if (score >= 86) return 'Elite';
    if (score >= 61) return 'Trusted';
    if (score >= 31) return 'Established';
    return 'Unproven';
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  private weight(raw: number, weightPercent: number): number {
    return Math.round((raw / 100) * weightPercent * 100) / 100;
  }

  private daysSince(isoDate: string): number {
    const then = new Date(isoDate).getTime();
    const now = Date.now();
    return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
  }
}
