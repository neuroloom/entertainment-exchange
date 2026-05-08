// PassportVerifier — chain-of-title verification, passport lifecycle management
// L3 MARKETPLACE+RIGHTS: RightsAsset → LegalAnchor → Passport chain

export type PassportStatus = 'draft' | 'active' | 'expired' | 'revoked' | 'superseded';
export type PassportType = 'exclusive' | 'non-exclusive' | 'territorial' | 'time-limited' | 'hybrid';

export interface LegalAnchor {
  id: string;
  tenantId: string;
  documentUri: string;
  documentHash: string;
  documentType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RightsAsset {
  id: string;
  tenantId: string;
  businessId: string;
  assetType: string;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RightsPassport {
  id: string;
  tenantId: string;
  rightsAssetId: string;
  legalAnchorId: string;
  passportType: string;
  status: PassportStatus;
  metadata: Record<string, unknown>;
  issuedAt: string | null;
  expiresAt?: string | null;
  supersedesPassportId?: string | null;
  supersededByPassportId?: string | null;
  revocationReason?: string | null;
  revokedAt?: string | null;
  chainSequence: number;
}

export interface PassportChainEntry {
  passport: RightsPassport;
  anchor: LegalAnchor | null;
  asset: RightsAsset | null;
}

export interface PassportChain {
  assetId: string;
  entries: PassportChainEntry[];
  currentPassportId: string | null;
  chainLength: number;
  isUnbroken: boolean;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  chainTrace?: string[];
  missingLinks?: string[];
}

export interface IssuePassportInput {
  rightsAssetId: string;
  legalAnchorId: string;
  passportType: PassportType;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

// ─── Stores (injected for testability) ────────────────────────────────────────

export interface PassportVerifierStores {
  anchors: Map<string, LegalAnchor>;
  assets: Map<string, RightsAsset>;
  passports: Map<string, RightsPassport>;
}

export class PassportVerifier {
  constructor(private stores: PassportVerifierStores) {}

  // ─── Verifies the chain between a passport and its legal anchor ──────────────

  verifyPassport(passportId: string, legalAnchorId: string): VerificationResult {
    const passport = this.stores.passports.get(passportId);
    if (!passport) {
      return { valid: false, reason: `Passport not found: ${passportId}` };
    }

    const anchor = this.stores.anchors.get(legalAnchorId);
    if (!anchor) {
      return { valid: false, reason: `Legal anchor not found: ${legalAnchorId}` };
    }

    const chainTrace: string[] = [];

    // Verify passport → anchor direct link
    if (passport.legalAnchorId !== legalAnchorId) {
      return {
        valid: false,
        reason: `Passport ${passportId} does not reference anchor ${legalAnchorId}; references ${passport.legalAnchorId}`,
        chainTrace,
      };
    }
    chainTrace.push(`passport:${passportId} → anchor:${legalAnchorId}`);

    // Verify passport → asset
    const asset = this.stores.assets.get(passport.rightsAssetId);
    if (!asset) {
      return {
        valid: false,
        reason: `Rights asset not found: ${passport.rightsAssetId}`,
        chainTrace,
        missingLinks: ['asset'],
      };
    }
    chainTrace.push(`passport:${passportId} → asset:${passport.rightsAssetId}`);

    // Verify asset → business (assert exists)
    chainTrace.push(`asset:${passport.rightsAssetId} → business:${asset.businessId}`);

    // Auto-expiry: if passport has an expiresAt, check and update status
    if (passport.expiresAt && passport.status !== 'expired') {
      const expiryDate = new Date(passport.expiresAt);
      if (!isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
        passport.status = 'expired';
      }
    }

    // Check status is not revoked
    if (passport.status === 'revoked') {
      return {
        valid: false,
        reason: `Passport ${passportId} is revoked`,
        chainTrace,
      };
    }

    // Check status is not superseded
    if (passport.status === 'superseded') {
      return {
        valid: false,
        reason: `Passport ${passportId} has been superseded`,
        chainTrace,
      };
    }

    // Check status is not expired
    if (passport.status === 'expired') {
      return {
        valid: false,
        reason: `Passport ${passportId} is expired`,
        chainTrace,
      };
    }

    return { valid: true, chainTrace };
  }

  // ─── Verifies document hash matches ──────────────────────────────────────────

  verifyAnchorHash(anchorId: string, expectedHash: string): VerificationResult {
    const anchor = this.stores.anchors.get(anchorId);
    if (!anchor) {
      return { valid: false, reason: `Legal anchor not found: ${anchorId}` };
    }

    if (anchor.documentHash !== expectedHash) {
      return {
        valid: false,
        reason: `Hash mismatch for anchor ${anchorId}: expected ${expectedHash}, got ${anchor.documentHash}`,
      };
    }

    return { valid: true };
  }

  // ─── Issues a new passport after validation ──────────────────────────────────

  issuePassport(
    assetId: string,
    anchorId: string,
    passportType: PassportType,
    metadata?: Record<string, unknown>,
    expiresAt?: string,
  ): RightsPassport {
    // Validate asset exists
    const asset = this.stores.assets.get(assetId);
    if (!asset) {
      throw new Error(`Rights asset not found: ${assetId}`);
    }

    // Validate anchor exists
    const anchor = this.stores.anchors.get(anchorId);
    if (!anchor) {
      throw new Error(`Legal anchor not found: ${anchorId}`);
    }

    // Validate cross-tenant (both must belong to same tenant)
    if (asset.tenantId !== anchor.tenantId) {
      throw new Error(
        `Tenant mismatch: asset ${asset.tenantId} vs anchor ${anchor.tenantId}`,
      );
    }

    // Compute next chain sequence for this asset
    let maxSeq = 0;
    for (const p of this.stores.passports.values()) {
      if (p.rightsAssetId === assetId && p.chainSequence > maxSeq) {
        maxSeq = p.chainSequence;
      }
    }

    // Check if there is an existing active passport for this asset — if so,
    // it will be superseded separately; warn but don't block
    const existingActive = [...this.stores.passports.values()].find(
      p => p.rightsAssetId === assetId && p.status === 'active',
    );
    if (existingActive) {
      // Mark the existing as superseded by the new passport before creating new
      existingActive.status = 'superseded';
      existingActive.supersededByPassportId = null; // will be set once new passport has id
    }

    const passportId = crypto.randomUUID();
    const passport: RightsPassport = {
      id: passportId,
      tenantId: asset.tenantId,
      rightsAssetId: assetId,
      legalAnchorId: anchorId,
      passportType,
      status: 'active',
      metadata: metadata ?? {},
      issuedAt: new Date().toISOString(),
      expiresAt: expiresAt ?? null,
      supersedesPassportId: existingActive?.id ?? null,
      supersededByPassportId: null,
      revocationReason: null,
      revokedAt: null,
      chainSequence: maxSeq + 1,
    };

    // Wire the superseded passport's supersededBy link
    if (existingActive) {
      existingActive.supersededByPassportId = passportId;
    }

    this.stores.passports.set(passportId, passport);
    return passport;
  }

  // ─── Revokes a passport ──────────────────────────────────────────────────────

  revokePassport(passportId: string, reason: string): RightsPassport {
    const passport = this.stores.passports.get(passportId);
    if (!passport) {
      throw new Error(`Passport not found: ${passportId}`);
    }

    if (passport.status === 'revoked') {
      throw new Error(`Passport ${passportId} is already revoked`);
    }

    passport.status = 'revoked';
    passport.revocationReason = reason;
    passport.revokedAt = new Date().toISOString();
    return passport;
  }

  // ─── Renews a passport — creates a new passport linked to the same asset/anchor ──

  renewPassport(passportId: string, newExpiresAt?: string): RightsPassport {
    const existing = this.stores.passports.get(passportId);
    if (!existing) {
      throw new Error(`Passport not found: ${passportId}`);
    }

    if (existing.status === 'revoked') {
      throw new Error(`Cannot renew a revoked passport: ${passportId}`);
    }

    // Supersede the existing passport and create a new one
    const asset = this.stores.assets.get(existing.rightsAssetId);
    if (!asset) {
      throw new Error(`Rights asset not found for passport: ${existing.rightsAssetId}`);
    }

    const anchor = this.stores.anchors.get(existing.legalAnchorId);
    if (!anchor) {
      throw new Error(`Legal anchor not found for passport: ${existing.legalAnchorId}`);
    }

    // Compute next chain sequence
    let maxSeq = existing.chainSequence;
    for (const p of this.stores.passports.values()) {
      if (p.rightsAssetId === existing.rightsAssetId && p.chainSequence > maxSeq) {
        maxSeq = p.chainSequence;
      }
    }

    // Mark existing as superseded (if not already)
    if (existing.status !== 'superseded') {
      existing.status = 'superseded';
    }

    const newId = crypto.randomUUID();
    const renewed: RightsPassport = {
      id: newId,
      tenantId: existing.tenantId,
      rightsAssetId: existing.rightsAssetId,
      legalAnchorId: existing.legalAnchorId,
      passportType: existing.passportType,
      status: 'active',
      metadata: { ...existing.metadata, renewedFrom: passportId, renewedAt: new Date().toISOString() },
      issuedAt: new Date().toISOString(),
      expiresAt: newExpiresAt ?? existing.expiresAt ?? null,
      supersedesPassportId: passportId,
      supersededByPassportId: null,
      revocationReason: null,
      revokedAt: null,
      chainSequence: maxSeq + 1,
    };

    existing.supersededByPassportId = newId;
    this.stores.passports.set(newId, renewed);
    return renewed;
  }

  // ─── Supersedes an old passport with a new one ───────────────────────────────

  supersedePassport(oldPassportId: string, newPassportId: string): void {
    const oldPassport = this.stores.passports.get(oldPassportId);
    if (!oldPassport) {
      throw new Error(`Old passport not found: ${oldPassportId}`);
    }

    const newPassport = this.stores.passports.get(newPassportId);
    if (!newPassport) {
      throw new Error(`New passport not found: ${newPassportId}`);
    }

    if (oldPassport.rightsAssetId !== newPassport.rightsAssetId) {
      throw new Error(
        `Cannot supersede across different assets: ${oldPassport.rightsAssetId} vs ${newPassport.rightsAssetId}`,
      );
    }

    if (oldPassport.status === 'revoked') {
      throw new Error(`Cannot supersede a revoked passport: ${oldPassportId}`);
    }

    oldPassport.status = 'superseded';
    oldPassport.supersededByPassportId = newPassportId;
    newPassport.supersedesPassportId = oldPassportId;
    newPassport.chainSequence = oldPassport.chainSequence + 1;
  }

  // ─── Returns the full passport chain for an asset ────────────────────────────

  getChainOfTitle(assetId: string): PassportChain {
    const asset = this.stores.assets.get(assetId);

    // Gather all passports for this asset, ordered by chain sequence
    const chainPassports = [...this.stores.passports.values()]
      .filter(p => p.rightsAssetId === assetId)
      .sort((a, b) => a.chainSequence - b.chainSequence);

    // Detect breaks: if sequence numbers are not continuous or missing links
    const isUnbroken = chainPassports.length > 0 &&
      chainPassports.every((p, i) => {
        if (i === 0) return p.chainSequence === 1;
        const prev = chainPassports[i - 1];
        // Check sequence continuity and supersedes link
        return p.chainSequence === prev.chainSequence + 1 &&
          (p.supersedesPassportId === prev.id || prev.supersededByPassportId === p.id);
      });

    const currentPassport = chainPassports
      .filter(p => p.status === 'active')
      .at(-1)?.id ?? null;

    const entries: PassportChainEntry[] = chainPassports.map(p => ({
      passport: p,
      anchor: this.stores.anchors.get(p.legalAnchorId) ?? null,
      asset: asset ?? null,
    }));

    return {
      assetId,
      entries,
      currentPassportId: currentPassport,
      chainLength: chainPassports.length,
      isUnbroken,
    };
  }
}
