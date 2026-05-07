// TransferabilityScorer — 9-factor weighted scoring for business transferability
// L3 MARKETPLACE+RIGHTS: Scores 0-100 with graded output

export type TransferabilityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface TransferabilityScore {
  total: number;
  breakdown: Record<string, number>;
  grade: TransferabilityGrade;
}

export interface BusinessProfile {
  id: string;
  chainOfTitleUnbroken: boolean;
  verifiedAnchorCount: number;
  verifiedAnchorRequired: number;
  hasDisputes: boolean;
  disputeCount: number;
  passportExpired: boolean;
  passportExpiresInDays: number | null;
  revenueHistoryMonths: number;
  monthlyRevenueAvg: number;
  marketplaceListings: number;
  marketplaceSales: number;
  agentAutomationLevel: number; // 0-100
  bookingCompletionRate: number; // 0.0 - 1.0
  platformTenureDays: number;
}

// ─── Weight configuration ─────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: Record<string, number> = {
  chainOfTitle: 20,
  verifiedAnchors: 15,
  noDisputes: 15,
  passportCurrency: 10,
  revenueHistory: 10,
  marketplaceActivity: 10,
  agentAutomation: 8,
  bookingCompletion: 7,
  platformTenure: 5,
};

// Ensure weights sum to 100 (verified at module load)
const weightSum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
if (weightSum !== 100) {
  throw new Error(`Transferability weights must sum to 100; got ${weightSum}`);
}

export class TransferabilityScorer {
  private weights: Record<string, number>;

  constructor(weights?: Partial<Record<string, number>>) {
    if (weights) {
      this.weights = { ...DEFAULT_WEIGHTS };
      for (const [key, val] of Object.entries(weights)) {
        if (typeof val === 'number') this.weights[key] = val;
      }
    } else {
      this.weights = { ...DEFAULT_WEIGHTS };
    }
  }

  // ─── Scores a business's transferability ────────────────────────────────────

  score(profile: BusinessProfile): TransferabilityScore {
    const breakdown: Record<string, number> = {
      chainOfTitle: this.scoreChainOfTitle(profile.chainOfTitleUnbroken),
      verifiedAnchors: this.scoreVerifiedAnchors(
        profile.verifiedAnchorCount,
        profile.verifiedAnchorRequired,
      ),
      noDisputes: this.scoreNoDisputes(profile.hasDisputes, profile.disputeCount),
      passportCurrency: this.scorePassportCurrency(
        profile.passportExpired,
        profile.passportExpiresInDays,
      ),
      revenueHistory: this.scoreRevenueHistory(
        profile.revenueHistoryMonths,
        profile.monthlyRevenueAvg,
      ),
      marketplaceActivity: this.scoreMarketplaceActivity(
        profile.marketplaceListings,
        profile.marketplaceSales,
      ),
      agentAutomation: this.scoreAgentAutomation(profile.agentAutomationLevel),
      bookingCompletion: this.scoreBookingCompletion(profile.bookingCompletionRate),
      platformTenure: this.scorePlatformTenure(profile.platformTenureDays),
    };

    const total = Object.entries(breakdown).reduce((sum, [key, raw]) => {
      const weight = this.weights[key] ?? 0;
      return sum + (raw / 100) * weight;
    }, 0);

    // Clamp to 0-100 range
    const clamped = Math.min(100, Math.max(0, Math.round(total * 100) / 100));

    return {
      total: clamped,
      breakdown,
      grade: this.deriveGrade(clamped),
    };
  }

  // ─── Individual factor scorers (each returns 0-100) ─────────────────────────

  // 20% — Clean chain of title
  private scoreChainOfTitle(unbroken: boolean): number {
    return unbroken ? 100 : 0;
  }

  // 15% — Verified legal anchors
  private scoreVerifiedAnchors(verified: number, required: number): number {
    if (required === 0) return 100;
    const ratio = Math.min(verified / required, 1);
    return Math.round(ratio * 100);
  }

  // 15% — No disputes
  private scoreNoDisputes(hasDisputes: boolean, count: number): number {
    if (!hasDisputes || count === 0) return 100;
    if (count === 1) return 50;
    if (count === 2) return 25;
    return 0;
  }

  // 10% — Passport currency (not expired)
  private scorePassportCurrency(expired: boolean, expiresInDays: number | null): number {
    if (expired) return 0;
    if (expiresInDays === null) return 100; // no expiry set — perpetual
    if (expiresInDays > 365) return 100;
    if (expiresInDays > 180) return 85;
    if (expiresInDays > 90) return 70;
    if (expiresInDays > 30) return 50;
    return 25; // under 30 days — urgency penalty
  }

  // 10% — Revenue history
  private scoreRevenueHistory(months: number, monthlyAvg: number): number {
    if (months === 0) return 0;
    let score = 0;

    // Duration scoring (max 60 points)
    if (months >= 24) score += 60;
    else if (months >= 12) score += 50;
    else if (months >= 6) score += 35;
    else if (months >= 3) score += 20;
    else score += 10;

    // Revenue magnitude scoring (max 40 points)
    if (monthlyAvg >= 100_000) score += 40;
    else if (monthlyAvg >= 50_000) score += 35;
    else if (monthlyAvg >= 10_000) score += 25;
    else if (monthlyAvg >= 1_000) score += 15;
    else if (monthlyAvg > 0) score += 5;

    return Math.min(100, score);
  }

  // 10% — Marketplace activity
  private scoreMarketplaceActivity(listings: number, sales: number): number {
    if (listings === 0) return 0;
    let score = 0;

    // Listings presence (max 40 points)
    if (listings >= 10) score += 40;
    else if (listings >= 5) score += 30;
    else if (listings >= 2) score += 20;
    else score += 10;

    // Sales velocity (max 40 points)
    if (sales >= 20) score += 40;
    else if (sales >= 10) score += 30;
    else if (sales >= 5) score += 20;
    else if (sales >= 1) score += 10;

    // Conversion bonus (max 20 points)
    if (listings > 0 && sales > 0) {
      const conversionRate = sales / listings;
      if (conversionRate >= 0.8) score += 20;
      else if (conversionRate >= 0.5) score += 15;
      else if (conversionRate >= 0.3) score += 10;
      else if (conversionRate > 0) score += 5;
    }

    return Math.min(100, score);
  }

  // 8% — Agent automation
  private scoreAgentAutomation(level: number): number {
    return Math.min(100, Math.max(0, Math.round(level)));
  }

  // 7% — Booking completion rate
  private scoreBookingCompletion(rate: number): number {
    return Math.min(100, Math.max(0, Math.round(rate * 100)));
  }

  // 5% — Platform tenure
  private scorePlatformTenure(days: number): number {
    if (days >= 730) return 100;      // 2+ years
    if (days >= 365) return 80;       // 1 year
    if (days >= 180) return 60;       // 6 months
    if (days >= 90) return 40;        // 3 months
    if (days >= 30) return 20;        // 1 month
    return 10;
  }

  // ─── Grade derivation ──────────────────────────────────────────────────────

  private deriveGrade(total: number): TransferabilityGrade {
    if (total >= 90) return 'A';
    if (total >= 75) return 'B';
    if (total >= 50) return 'C';
    if (total >= 30) return 'D';
    return 'F';
  }
}
