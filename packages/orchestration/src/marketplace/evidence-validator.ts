// Evidence Validator — L3 Marketplace tier
// Validates evidence documents against verification tiers for deal-room readiness.
// Each tier gates progressively stricter requirements:
//   self_reported → document_supported → platform_verified → acquisition_ready

// ─── Evidence Tier ────────────────────────────────────────────────────────────

export type EvidenceTier =
  | 'self_reported'
  | 'document_supported'
  | 'platform_verified'
  | 'acquisition_ready';

// ─── Validation Result ────────────────────────────────────────────────────────

export interface EvidenceValidationResult {
  valid: boolean;
  missingDocuments: string[];
  reasons: string[];
}

// ─── Tier Requirements ────────────────────────────────────────────────────────

interface TierRequirement {
  minDocuments: number;
  requireHashVerification: boolean;
  requireExpiryCheck: boolean;
  requireLegalAnchor: boolean;
}

const TIER_REQUIREMENTS: Record<EvidenceTier, TierRequirement> = {
  self_reported: {
    minDocuments: 1,
    requireHashVerification: false,
    requireExpiryCheck: false,
    requireLegalAnchor: false,
  },
  document_supported: {
    minDocuments: 2,
    requireHashVerification: true,
    requireExpiryCheck: false,
    requireLegalAnchor: false,
  },
  platform_verified: {
    minDocuments: 3,
    requireHashVerification: true,
    requireExpiryCheck: true,
    requireLegalAnchor: false,
  },
  acquisition_ready: {
    minDocuments: 3,
    requireHashVerification: true,
    requireExpiryCheck: true,
    requireLegalAnchor: true,
  },
};

// ─── EvidenceValidator ────────────────────────────────────────────────────────

export class EvidenceValidator {
  /**
   * Validate that a set of document references meets the requirements
   * for the given evidence tier.
   *
   * @param tier - The verification tier to validate against
   * @param documents - Array of document identifiers (paths, URIs, or hashes)
   * @returns Validation result with validity flag and diagnostic details
   */
  validate(tier: EvidenceTier, documents: string[]): EvidenceValidationResult {
    const req = TIER_REQUIREMENTS[tier];
    const reasons: string[] = [];
    const missingDocuments: string[] = [];

    // 1. Document count check
    if (documents.length < req.minDocuments) {
      const needed = req.minDocuments - documents.length;
      reasons.push(
        `Insufficient documents: ${documents.length} provided, ${req.minDocuments} required (${needed} missing)`,
      );
      // Synthesise placeholder missing-document labels for the shortfall
      for (let i = 0; i < needed; i++) {
        missingDocuments.push(`required_document_${documents.length + i + 1}`);
      }
    }

    // 2. Hash verification (document_supported and above)
    if (req.requireHashVerification) {
      const hashFailures = this.verifyFileHashes(documents);
      if (hashFailures.length > 0) {
        reasons.push(
          `Hash verification failed for ${hashFailures.length} document(s): ${hashFailures.join(', ')}`,
        );
        for (const doc of hashFailures) {
          if (!missingDocuments.includes(doc)) {
            missingDocuments.push(doc);
          }
        }
      }
    }

    // 3. Expiry check (platform_verified and above)
    if (req.requireExpiryCheck) {
      const expiredDocs = this.checkExpiry(documents);
      if (expiredDocs.length > 0) {
        reasons.push(
          `Expired document(s) detected: ${expiredDocs.join(', ')}`,
        );
        for (const doc of expiredDocs) {
          if (!missingDocuments.includes(doc)) {
            missingDocuments.push(doc);
          }
        }
      }
    }

    // 4. Legal anchor verification (acquisition_ready only)
    if (req.requireLegalAnchor) {
      const anchorResult = this.verifyLegalAnchor(documents);
      if (!anchorResult.valid) {
        reasons.push(anchorResult.reason);
        for (const doc of anchorResult.missingAnchors) {
          if (!missingDocuments.includes(doc)) {
            missingDocuments.push(doc);
          }
        }
      }
    }

    return {
      valid: reasons.length === 0,
      missingDocuments,
      reasons,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Simulates file-hash verification.
   * Documents whose identifier contains "invalid" or "corrupt" are flagged.
   */
  private verifyFileHashes(documents: string[]): string[] {
    return documents.filter(
      (d) => d.toLowerCase().includes('invalid') || d.toLowerCase().includes('corrupt'),
    );
  }

  /**
   * Simulates expiry checking.
   * Documents whose identifier contains "expired" are flagged.
   */
  private checkExpiry(documents: string[]): string[] {
    return documents.filter((d) => d.toLowerCase().includes('expired'));
  }

  /**
   * Simulates legal-anchor verification.
   * Requires at least one document whose identifier contains "legal" or "title".
   */
  private verifyLegalAnchor(documents: string[]): {
    valid: boolean;
    reason: string;
    missingAnchors: string[];
  } {
    const hasAnchor = documents.some(
      (d) => d.toLowerCase().includes('legal') || d.toLowerCase().includes('title'),
    );
    if (!hasAnchor) {
      return {
        valid: false,
        reason: 'Legal anchor missing: at least one document must be a legal instrument (title, deed, or contract)',
        missingAnchors: ['legal_anchor_document'],
      };
    }
    return { valid: true, reason: '', missingAnchors: [] };
  }
}
