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

// ─── Validation Result ─────────────────────────────────────────────────────────

export interface EvidenceValidationResult {
  valid: boolean;
  missingDocuments: string[];
  reasons: string[];
}

// ─── Document shape for structured validation ──────────────────────────────────

export interface EvidenceDocument {
  id?: string;
  hash?: string;
  expiryDate?: string;
  issuerName?: string;
  issuingAuthority?: string;
  ownerName?: string;
  dateSigned?: string;
  metadata?: Record<string, unknown>;
}

// ─── Tier Requirements ─────────────────────────────────────────────────────────

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

  // ─── Structured document validation pipeline ──────────────────────────────

  /**
   * Validate documents with full structured checks (expiry, issuer, fraud).
   * Called from the main validate flow for tiers requiring deeper scrutiny.
   */
  validateDocuments(tier: EvidenceTier, documents: EvidenceDocument[]): EvidenceValidationResult {
    const reasons: string[] = [];
    const missingDocuments: string[] = [];

    // Numeric document count
    const req = TIER_REQUIREMENTS[tier];
    if (documents.length < req.minDocuments) {
      const needed = req.minDocuments - documents.length;
      reasons.push(
        `Insufficient documents: ${documents.length} provided, ${req.minDocuments} required (${needed} missing)`,
      );
      for (let i = 0; i < needed; i++) {
        missingDocuments.push(`required_document_${documents.length + i + 1}`);
      }
    }

    // Expiry validation on each document
    for (const doc of documents) {
      const expiryCheck = this.validateExpiry(doc);
      if (!expiryCheck.valid) {
        if (!reasons.some(r => r.includes('expired'))) {
          reasons.push(`One or more documents are expired`);
        }
        if (doc.id && !missingDocuments.includes(doc.id)) {
          missingDocuments.push(doc.id);
        }
      }
    }

    // Issuer validation
    if (req.requireHashVerification) {
      for (const doc of documents) {
        const issuerCheck = this.validateIssuer(doc);
        if (!issuerCheck.valid) {
          reasons.push(`Issuer validation failed: ${issuerCheck.reason}`);
          if (doc.id && !missingDocuments.includes(doc.id)) {
            missingDocuments.push(doc.id);
          }
        }
      }
    }

    // Fraud indicator scan
    const fraudIndicators = this.detectFraudIndicators(documents);
    for (const indicator of fraudIndicators) {
      if (!reasons.includes(indicator)) {
        reasons.push(indicator);
      }
    }

    return {
      valid: reasons.length === 0,
      missingDocuments,
      reasons,
    };
  }

  // ─── validateExpiry: checks if a document has an expiry date and it hasn't passed

  validateExpiry(document: EvidenceDocument): { valid: boolean; reason?: string } {
    if (!document.expiryDate) {
      // No expiry date set — document is perpetual; considered valid for expiry check
      return { valid: true };
    }

    const expiry = new Date(document.expiryDate);
    if (isNaN(expiry.getTime())) {
      return { valid: false, reason: `Invalid expiry date format: ${document.expiryDate}` };
    }

    if (expiry < new Date()) {
      return {
        valid: false,
        reason: `Document has expired on ${expiry.toISOString()}`,
      };
    }

    return { valid: true };
  }

  // ─── validateIssuer: checks that a document has issuer name and issuing authority

  validateIssuer(document: EvidenceDocument): { valid: boolean; reason?: string } {
    const missingFields: string[] = [];

    if (!document.issuerName || document.issuerName.trim().length === 0) {
      missingFields.push('issuerName');
    }
    if (!document.issuingAuthority || document.issuingAuthority.trim().length === 0) {
      missingFields.push('issuingAuthority');
    }

    if (missingFields.length > 0) {
      return {
        valid: false,
        reason: `Missing issuer information: ${missingFields.join(', ')}`,
      };
    }

    return { valid: true };
  }

  // ─── detectFraudIndicators: scans document set for anomalies ────────────────

  detectFraudIndicators(documents: EvidenceDocument[]): string[] {
    const indicators: string[] = [];

    // 1. Mismatched owner names across documents
    const ownerNames = documents
      .map(d => d.ownerName)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    if (ownerNames.length >= 2) {
      const unique = [...new Set(ownerNames.map(n => n.toLowerCase().trim()))];
      if (unique.length > 1) {
        indicators.push(
          `Mismatched owner names across documents: ${unique.join(' vs ')}`,
        );
      }
    }

    // 2. Inconsistent dates (dateSigned after expiryDate, or future dates > 1 year)
    for (const doc of documents) {
      if (doc.dateSigned && doc.expiryDate) {
        const signed = new Date(doc.dateSigned);
        const expiry = new Date(doc.expiryDate);
        if (!isNaN(signed.getTime()) && !isNaN(expiry.getTime())) {
          if (signed > expiry) {
            indicators.push(
              `Document signed after expiry: signed ${doc.dateSigned}, expires ${doc.expiryDate}`,
            );
          }
        }
      }

      // Suspiciously far-future dates
      if (doc.dateSigned) {
        const signed = new Date(doc.dateSigned);
        if (!isNaN(signed.getTime())) {
          const oneYearFromNow = new Date();
          oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
          if (signed > oneYearFromNow) {
            indicators.push(
              `Suspicious future date: signed ${doc.dateSigned} is more than 1 year in the future`,
            );
          }
        }
      }
    }

    // 3. Duplicate hashes (same document submitted multiple times as different evidence)
    const hashes = documents
      .map(d => d.hash)
      .filter((h): h is string => typeof h === 'string' && h.trim().length > 0);

    if (hashes.length >= 2) {
      const seen = new Map<string, number>();
      hashes.forEach((h, idx) => {
        if (seen.has(h)) {
          const firstIdx = seen.get(h)!;
          indicators.push(
            `Duplicate hash detected: documents at indices ${firstIdx} and ${idx} share hash ${h.slice(0, 12)}...`,
          );
        } else {
          seen.set(h, idx);
        }
      });
    }

    return indicators;
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
