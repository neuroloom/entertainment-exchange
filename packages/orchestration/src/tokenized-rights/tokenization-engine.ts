// TokenizationEngine — convert rights passports into divisible tradeable tokens
// with fractional ownership, transfer restrictions, and automated royalty distribution.
// L4 TOKENIZED RIGHTS: RightsPassport → RightsToken → RoyaltyDistribution
//
// This is the financial primitive for entertainment IP fractionalization —
// converts chain-of-title rights passports into basis-point-denominated digital
// assets with proportional voting, transfer controls, and automated payouts.

import type { RightsAsset, RightsPassport } from '../rights/passport-verifier.js';

// ─── Domain Types ────────────────────────────────────────────────────────────────

export interface RightsToken {
  tokenId: string;
  rightsAssetId: string;
  passportId: string;
  ownerBusinessId: string;
  ownershipBasisPoints: number; // 1-10000 (0.01% to 100%)
  acquiredAt: number; // unix ms
  acquisitionPriceCents: number;
  transferRestrictions: {
    lockupUntil?: number; // unix ms — cannot transfer before this timestamp
    rightOfFirstRefusal: boolean;
    minHoldingPeriodDays: number;
  };
  status: 'active' | 'locked' | 'transferred' | 'redeemed';
}

export interface RoyaltyDistributionItem {
  tokenId: string;
  holderBusinessId: string;
  amountCents: number;
  basisPoints: number;
}

export interface RoyaltyDistribution {
  distributionId: string;
  rightsAssetId: string;
  revenueEventId: string;
  totalAmountCents: number;
  distributions: RoyaltyDistributionItem[];
  journalId: string;
  timestamp: number;
}

export interface OwnershipSnapshot {
  rightsAssetId: string;
  totalTokensIssued: number;
  totalBasisPoints: number; // must equal 10000
  holders: Array<{
    businessId: string;
    basisPoints: number;
    percentage: number;
    acquiredAt: number;
  }>;
}

export interface HolderHistoryEntry {
  tokenId: string;
  distributions: number[]; // distribution amounts in cents, chronologically
}

// ─── Chain-of-Title Transfer Record ──────────────────────────────────────────────

export interface TokenTransfer {
  transferId: string;
  tokenId: string;
  fromBusinessId: string;
  toBusinessId: string;
  basisPoints: number;
  priceCents: number;
  timestamp: number;
  newTokenId?: string; // set when a new token is minted for the transferee
}

// ─── Stores (injected for testability) ───────────────────────────────────────────

export interface TokenizationStores {
  tokens: Map<string, RightsToken>;
  distributions: Map<string, RoyaltyDistribution>;
  transfers: Map<string, TokenTransfer[]>; // keyed by tokenId
  passports: Map<string, RightsPassport>;
  assets: Map<string, RightsAsset>;
}

// ─── Validation Helpers ──────────────────────────────────────────────────────────

const BASIS_POINTS_TOTAL = 10_000;

function assertBasisPoints(bp: number, label: string): void {
  if (!Number.isInteger(bp) || bp < 1 || bp > BASIS_POINTS_TOTAL) {
    throw new Error(`${label}: basis points must be an integer between 1 and ${BASIS_POINTS_TOTAL}, got ${bp}`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label}: must be a positive integer, got ${value}`);
  }
}

function sumBasisPointsForAsset(
  tokens: Map<string, RightsToken>,
  rightsAssetId: string,
): number {
  let total = 0;
  for (const t of tokens.values()) {
    if (t.rightsAssetId === rightsAssetId && t.status === 'active') {
      total += t.ownershipBasisPoints;
    }
  }
  return total;
}

// ─── TokenizationEngine ──────────────────────────────────────────────────────────

export class TokenizationEngine {
  constructor(private stores: TokenizationStores) {}

  // ─── Tokenize a rights passport into divisible tokens ──────────────────────────

  /**
   * Convert a rights passport into `totalTokens` fungible tokens, each
   * representing basis-point granularity of the underlying rights.
   *
   * The passport must be active and its asset must exist. Ownership is
   * initially assigned to the asset's `businessId`. Basis points are
   * distributed evenly; any remainder goes to the last token so the
   * invariant `sum(token.bp) === 10000` always holds.
   */
  tokenize(
    passportId: string,
    totalTokens: number,
    basePriceCents: number,
  ): RightsToken[] {
    assertPositiveInteger(totalTokens, 'totalTokens');
    assertPositiveInteger(basePriceCents, 'basePriceCents');

    const passport = this.stores.passports.get(passportId);
    if (!passport) {
      throw new Error(`Passport not found: ${passportId}`);
    }
    if (passport.status !== 'active') {
      throw new Error(
        `Passport ${passportId} is not active (status: ${passport.status}). ` +
        `Only active passports can be tokenized.`,
      );
    }

    const asset = this.stores.assets.get(passport.rightsAssetId);
    if (!asset) {
      throw new Error(`Rights asset not found: ${passport.rightsAssetId}`);
    }

    // Guard: do not double-tokenize the same asset
    const existing = [...this.stores.tokens.values()].filter(
      t => t.rightsAssetId === passport.rightsAssetId && t.status === 'active',
    );
    if (existing.length > 0) {
      throw new Error(
        `Asset ${passport.rightsAssetId} is already tokenized with ${existing.length} active tokens. ` +
        `Redeem or transfer existing tokens before re-tokenizing.`,
      );
    }

    const now = Date.now();
    const bpEach = Math.floor(BASIS_POINTS_TOTAL / totalTokens);
    const remainder = BASIS_POINTS_TOTAL - bpEach * totalTokens;

    const tokens: RightsToken[] = [];

    for (let i = 0; i < totalTokens; i++) {
      const bp = i === totalTokens - 1 ? bpEach + remainder : bpEach;
      const token: RightsToken = {
        tokenId: crypto.randomUUID(),
        rightsAssetId: passport.rightsAssetId,
        passportId,
        ownerBusinessId: asset.businessId,
        ownershipBasisPoints: bp,
        acquiredAt: now,
        acquisitionPriceCents: bpEach > 0
          ? Math.round((bp / BASIS_POINTS_TOTAL) * basePriceCents)
          : 0,
        transferRestrictions: {
          rightOfFirstRefusal: false,
          minHoldingPeriodDays: 0,
        },
        status: 'active',
      };
      this.stores.tokens.set(token.tokenId, token);
      tokens.push(token);
    }

    return tokens;
  }

  // ─── Transfer token ownership (full or partial) ────────────────────────────────

  /**
   * Transfer `basisPoints` of ownership from `fromBusinessId` to `toBusinessId`.
   *
   * For a partial transfer the source token's basis points are reduced and a
   * new token is minted for the recipient. For a full transfer the source token
   * is marked `transferred` and a new token carries the full amount.
   *
   * Returns the newly created token for the recipient.
   */
  transferTokens(
    tokenId: string,
    fromBusinessId: string,
    toBusinessId: string,
    basisPoints: number,
    priceCents: number,
  ): RightsToken {
    assertBasisPoints(basisPoints, 'transfer basisPoints');
    if (fromBusinessId === toBusinessId) {
      throw new Error('Cannot transfer tokens to the same business');
    }

    const sourceToken = this.stores.tokens.get(tokenId);
    if (!sourceToken) {
      throw new Error(`Token not found: ${tokenId}`);
    }
    if (sourceToken.status !== 'active') {
      throw new Error(
        `Token ${tokenId} is not active (status: ${sourceToken.status})`,
      );
    }
    if (sourceToken.ownerBusinessId !== fromBusinessId) {
      throw new Error(
        `Token ${tokenId} is owned by ${sourceToken.ownerBusinessId}, not ${fromBusinessId}`,
      );
    }
    if (basisPoints > sourceToken.ownershipBasisPoints) {
      throw new Error(
        `Insufficient basis points: requested ${basisPoints}, available ${sourceToken.ownershipBasisPoints}`,
      );
    }

    // Enforce transfer restrictions
    const now = Date.now();
    const { lockupUntil, minHoldingPeriodDays } = sourceToken.transferRestrictions;

    if (lockupUntil && now < lockupUntil) {
      const lockDate = new Date(lockupUntil).toISOString();
      throw new Error(
        `Token ${tokenId} is locked until ${lockDate}`,
      );
    }

    if (minHoldingPeriodDays > 0) {
      const heldMs = now - sourceToken.acquiredAt;
      const minMs = minHoldingPeriodDays * 86_400_000;
      if (heldMs < minMs) {
        const heldDays = Math.floor(heldMs / 86_400_000);
        throw new Error(
          `Token ${tokenId} has not met minimum holding period: ` +
          `${heldDays} days held, ${minHoldingPeriodDays} required`,
        );
      }
    }

    // Execute transfer
    const isFullTransfer = basisPoints === sourceToken.ownershipBasisPoints;

    if (isFullTransfer) {
      sourceToken.status = 'transferred';
      sourceToken.ownershipBasisPoints = 0;
    } else {
      sourceToken.ownershipBasisPoints -= basisPoints;
    }

    // Mint new token for recipient
    const newToken: RightsToken = {
      tokenId: crypto.randomUUID(),
      rightsAssetId: sourceToken.rightsAssetId,
      passportId: sourceToken.passportId,
      ownerBusinessId: toBusinessId,
      ownershipBasisPoints: basisPoints,
      acquiredAt: now,
      acquisitionPriceCents: priceCents,
      transferRestrictions: {
        ...sourceToken.transferRestrictions,
        // Reset lockup on the new token — recipient's min holding starts now
        lockupUntil: undefined,
        minHoldingPeriodDays: sourceToken.transferRestrictions.minHoldingPeriodDays,
      },
      status: 'active',
    };

    this.stores.tokens.set(newToken.tokenId, newToken);

    // Record chain-of-title transfer
    const transfer: TokenTransfer = {
      transferId: crypto.randomUUID(),
      tokenId,
      fromBusinessId,
      toBusinessId,
      basisPoints,
      priceCents,
      timestamp: now,
      newTokenId: newToken.tokenId,
    };

    const existingTransfers = this.stores.transfers.get(tokenId) ?? [];
    existingTransfers.push(transfer);
    this.stores.transfers.set(tokenId, existingTransfers);

    // Also create a transfer record for the new token's lineage
    this.stores.transfers.set(newToken.tokenId, [{
      transferId: crypto.randomUUID(),
      tokenId: newToken.tokenId,
      fromBusinessId,
      toBusinessId,
      basisPoints,
      priceCents,
      timestamp: now,
      newTokenId: undefined,
    }]);

    return newToken;
  }

  // ─── Get current ownership snapshot for a rights asset ─────────────────────────

  /**
   * Aggregate all active tokens for a rights asset into an ownership snapshot.
   * Verifies the invariant that total basis points equals 10000.
   */
  getOwnership(rightsAssetId: string): OwnershipSnapshot {
    const assetTokens: RightsToken[] = [];
    for (const t of this.stores.tokens.values()) {
      if (t.rightsAssetId === rightsAssetId && t.status === 'active') {
        assetTokens.push(t);
      }
    }

    // Aggregate by businessId
    const holderMap = new Map<string, {
      businessId: string;
      basisPoints: number;
      earliestAcquiredAt: number;
    }>();

    for (const token of assetTokens) {
      const existing = holderMap.get(token.ownerBusinessId);
      if (existing) {
        existing.basisPoints += token.ownershipBasisPoints;
        if (token.acquiredAt < existing.earliestAcquiredAt) {
          existing.earliestAcquiredAt = token.acquiredAt;
        }
      } else {
        holderMap.set(token.ownerBusinessId, {
          businessId: token.ownerBusinessId,
          basisPoints: token.ownershipBasisPoints,
          earliestAcquiredAt: token.acquiredAt,
        });
      }
    }

    const totalBasisPoints = [...holderMap.values()].reduce(
      (sum, h) => sum + h.basisPoints, 0,
    );

    const holders = [...holderMap.values()]
      .map(h => ({
        businessId: h.businessId,
        basisPoints: h.basisPoints,
        percentage: Math.round((h.basisPoints / BASIS_POINTS_TOTAL) * 10000) / 100,
        acquiredAt: h.earliestAcquiredAt,
      }))
      .sort((a, b) => b.basisPoints - a.basisPoints);

    return {
      rightsAssetId,
      totalTokensIssued: assetTokens.length,
      totalBasisPoints,
      holders,
    };
  }

  // ─── Distribute royalties proportionally to all token holders ──────────────────

  /**
   * When revenue is recognized for a rights asset, distribute it proportionally
   * to all token holders based on their basis-point ownership.
   *
   * Uses integer arithmetic — any remainder from division is distributed
   * one cent at a time to the largest holders (Largest Remainder Method).
   */
  distributeRoyalties(
    rightsAssetId: string,
    revenueEventId: string,
    amountCents: number,
  ): RoyaltyDistribution {
    assertPositiveInteger(amountCents, 'amountCents');

    const snapshot = this.getOwnership(rightsAssetId);

    if (snapshot.holders.length === 0) {
      throw new Error(
        `No active token holders for rights asset: ${rightsAssetId}`,
      );
    }

    if (snapshot.totalBasisPoints !== BASIS_POINTS_TOTAL) {
      throw new Error(
        `Ownership invariant violation: total basis points = ${snapshot.totalBasisPoints}, ` +
        `expected ${BASIS_POINTS_TOTAL}. Some tokens may not be fully allocated.`,
      );
    }

    // Calculate each holder's share — exactCents = (bp / 10000) * amountCents
    // Use integer arithmetic: baseShare = floor(bp * amountCents / 10000)
    // Track remainders for LRM allocation of leftover cents
    interface Allocation {
      holderBusinessId: string;
      basisPoints: number;
      tokenId: string; // primary token for this holder
      baseCents: number;
      remainder: number;
    }

    const allocations: Allocation[] = [];

    for (const holder of snapshot.holders) {
      // Find the largest active token for this holder to attribute the distribution
      let bestTokenId = '';
      let bestBp = 0;
      for (const t of this.stores.tokens.values()) {
        if (
          t.rightsAssetId === rightsAssetId &&
          t.ownerBusinessId === holder.businessId &&
          t.status === 'active' &&
          t.ownershipBasisPoints > bestBp
        ) {
          bestBp = t.ownershipBasisPoints;
          bestTokenId = t.tokenId;
        }
      }

      const exact = (holder.basisPoints * amountCents) / BASIS_POINTS_TOTAL;
      const baseCents = Math.floor(exact);

      allocations.push({
        holderBusinessId: holder.businessId,
        basisPoints: holder.basisPoints,
        tokenId: bestTokenId,
        baseCents,
        remainder: exact - baseCents,
      });
    }

    // Total base cents distributed
    const totalBaseCents = allocations.reduce((s, a) => s + a.baseCents, 0);
    let leftoverCents = amountCents - totalBaseCents;

    // Distribute leftovers via Largest Remainder Method — sort by remainder desc
    allocations.sort((a, b) => b.remainder - a.remainder);

    for (let i = 0; i < leftoverCents && i < allocations.length; i++) {
      allocations[i].baseCents += 1;
    }

    // Build distribution items
    const now = Date.now();
    const distributionId = crypto.randomUUID();
    const journalId = crypto.randomUUID();

    const distributionItems: RoyaltyDistributionItem[] = allocations
      .filter(a => a.baseCents > 0)
      .map(a => ({
        tokenId: a.tokenId,
        holderBusinessId: a.holderBusinessId,
        amountCents: a.baseCents,
        basisPoints: a.basisPoints,
      }));

    const royaltyDistribution: RoyaltyDistribution = {
      distributionId,
      rightsAssetId,
      revenueEventId,
      totalAmountCents: amountCents,
      distributions: distributionItems,
      journalId,
      timestamp: now,
    };

    this.stores.distributions.set(distributionId, royaltyDistribution);

    return royaltyDistribution;
  }

  // ─── Get holder distribution history (for tax reporting and statements) ────────

  /**
   * Returns every token owned by a business (active) along with the
   * chronological list of distribution amounts received by that token.
   */
  getHolderHistory(businessId: string): Array<{
    tokenId: string;
    distributions: number[];
  }> {
    // Collect all active tokens owned by this business
    const ownedTokens = [...this.stores.tokens.values()].filter(
      t => t.ownerBusinessId === businessId && t.status === 'active',
    );

    const result: Array<{ tokenId: string; distributions: number[] }> = [];

    for (const token of ownedTokens) {
      const distAmounts: number[] = [];

      for (const dist of this.stores.distributions.values()) {
        if (dist.rightsAssetId !== token.rightsAssetId) continue;
        for (const item of dist.distributions) {
          if (item.tokenId === token.tokenId) {
            distAmounts.push(item.amountCents);
          }
        }
      }

      result.push({
        tokenId: token.tokenId,
        distributions: distAmounts,
      });
    }

    return result;
  }

  // ─── Redeem a token (retire ownership position) ────────────────────────────────

  /**
   * Redeem a token, retiring the ownership position. The underlying basis
   * points are returned to the original rights holder (the asset's businessId).
   */
  redeemToken(tokenId: string): RightsToken {
    const token = this.stores.tokens.get(tokenId);
    if (!token) {
      throw new Error(`Token not found: ${tokenId}`);
    }
    if (token.status !== 'active') {
      throw new Error(
        `Token ${tokenId} is not active (status: ${token.status})`,
      );
    }

    token.status = 'redeemed';
    return token;
  }

  // ─── Apply transfer restriction (lockup, ROFR, holding period) ─────────────────

  /**
   * Update transfer restrictions on a token. Only callable by the current
   * rights asset business (the original rights holder) and only before
   * the token has been transferred to a third party.
   */
  applyRestrictions(
    tokenId: string,
    restrictions: Partial<RightsToken['transferRestrictions']>,
  ): RightsToken {
    const token = this.stores.tokens.get(tokenId);
    if (!token) {
      throw new Error(`Token not found: ${tokenId}`);
    }
    if (token.status !== 'active') {
      throw new Error(
        `Token ${tokenId} is not active (status: ${token.status})`,
      );
    }

    if (restrictions.lockupUntil !== undefined) {
      if (!Number.isInteger(restrictions.lockupUntil) || restrictions.lockupUntil < 0) {
        throw new Error(
          `lockupUntil must be a non-negative integer (unix ms), got ${restrictions.lockupUntil}`,
        );
      }
      token.transferRestrictions.lockupUntil = restrictions.lockupUntil;
    }

    if (restrictions.rightOfFirstRefusal !== undefined) {
      token.transferRestrictions.rightOfFirstRefusal = restrictions.rightOfFirstRefusal;
    }

    if (restrictions.minHoldingPeriodDays !== undefined) {
      if (
        !Number.isInteger(restrictions.minHoldingPeriodDays) ||
        restrictions.minHoldingPeriodDays < 0
      ) {
        throw new Error(
          `minHoldingPeriodDays must be a non-negative integer, got ${restrictions.minHoldingPeriodDays}`,
        );
      }
      token.transferRestrictions.minHoldingPeriodDays = restrictions.minHoldingPeriodDays;
    }

    return token;
  }

  // ─── Get chain-of-title for a token ────────────────────────────────────────────

  /**
   * Returns the full transfer history for a token, ordered by timestamp.
   */
  getTokenChain(tokenId: string): TokenTransfer[] {
    return this.stores.transfers.get(tokenId) ?? [];
  }

  // ─── Verify ownership invariant across all assets ──────────────────────────────

  /**
   * Verify that every tokenized asset sums to exactly 10000 basis points.
   * Returns a list of violation messages (empty if all valid).
   */
  verifyAllAssets(): string[] {
    const assetIds = new Set<string>();
    for (const t of this.stores.tokens.values()) {
      if (t.status === 'active') {
        assetIds.add(t.rightsAssetId);
      }
    }

    const violations: string[] = [];

    for (const assetId of assetIds) {
      const total = sumBasisPointsForAsset(this.stores.tokens, assetId);
      if (total !== BASIS_POINTS_TOTAL) {
        violations.push(
          `Asset ${assetId}: total active basis points = ${total}, expected ${BASIS_POINTS_TOTAL} ` +
          `(gap of ${BASIS_POINTS_TOTAL - total} bp)`,
        );
      }
    }

    return violations;
  }
}
