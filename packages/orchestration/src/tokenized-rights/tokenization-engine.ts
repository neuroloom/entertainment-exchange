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

// ─── Secondary Market Types ──────────────────────────────────────────────────────

export interface TokenListing {
  listingId: string;
  tokenId: string;
  sellerBusinessId: string;
  basisPoints: number;
  askingPriceCents: number;
  listedAt: number;
  expiresAt?: number;
  status: 'active' | 'filled' | 'cancelled' | 'expired';
  minPurchaseBasisPoints?: number;
}

export interface BuyoutOffer {
  offerId: string;
  tokenId: string;
  buyerBusinessId: string;
  basisPoints: number;
  offerPriceCents: number;
  offeredAt: number;
  expiresAt: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'countered';
  counterOfferPriceCents?: number;
  message?: string;
}

export interface VoteTopic {
  topicId: string;
  rightsAssetId: string;
  title: string;
  description: string;
  options: string[];
  closesAt: number;
  status: 'open' | 'closed';
}

export interface VoteBallot {
  ballotId: string;
  topicId: string;
  tokenId: string;
  voterBusinessId: string;
  optionIndex: number;
  basisPoints: number;
  castAt: number;
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

  // ── Secondary Market: List tokens for sale ─────────────────────────────────────

  listForSale(
    tokenId: string,
    sellerBusinessId: string,
    basisPoints: number,
    askingPriceCents: number,
    expiresAt?: number,
  ): TokenListing {
    assertBasisPoints(basisPoints, 'listing basisPoints');
    assertPositiveInteger(askingPriceCents, 'askingPriceCents');

    const token = this.#getActiveToken(tokenId, sellerBusinessId);
    if (basisPoints > token.ownershipBasisPoints) {
      throw new Error(
        `Cannot list ${basisPoints} bp: token only has ${token.ownershipBasisPoints} bp`,
      );
    }

    const listing: TokenListing = {
      listingId: crypto.randomUUID(),
      tokenId,
      sellerBusinessId,
      basisPoints,
      askingPriceCents,
      listedAt: Date.now(),
      expiresAt,
      status: 'active',
    };
    this.#listings().set(listing.listingId, listing);
    return listing;
  }

  cancelListing(listingId: string, businessId: string): TokenListing {
    const listing = this.#getListing(listingId, businessId);
    if (listing.status !== 'active') {
      throw new Error(`Listing ${listingId} is ${listing.status}`);
    }
    listing.status = 'cancelled';
    return listing;
  }

  getActiveListings(rightsAssetId?: string): TokenListing[] {
    const all = [...this.#listings().values()].filter(l => l.status === 'active');
    if (!rightsAssetId) return all;
    return all.filter(l => {
      const token = this.stores.tokens.get(l.tokenId);
      return token?.rightsAssetId === rightsAssetId;
    });
  }

  // ── Buyout Offers ────────────────────────────────────────────────────────────

  makeOffer(
    tokenId: string,
    buyerBusinessId: string,
    basisPoints: number,
    offerPriceCents: number,
    expiresAt: number,
    message?: string,
  ): BuyoutOffer {
    assertBasisPoints(basisPoints, 'offer basisPoints');
    assertPositiveInteger(offerPriceCents, 'offerPriceCents');

    const token = this.stores.tokens.get(tokenId);
    if (!token) throw new Error(`Token not found: ${tokenId}`);
    if (token.status !== 'active') throw new Error(`Token ${tokenId} is not active`);
    if (token.ownerBusinessId === buyerBusinessId) {
      throw new Error('Cannot make offer on your own token');
    }
    if (basisPoints > token.ownershipBasisPoints) {
      throw new Error(`Offer bp ${basisPoints} exceeds token bp ${token.ownershipBasisPoints}`);
    }

    const offer: BuyoutOffer = {
      offerId: crypto.randomUUID(),
      tokenId,
      buyerBusinessId,
      basisPoints,
      offerPriceCents,
      offeredAt: Date.now(),
      expiresAt,
      status: 'pending',
      message,
    };
    this.#offers().set(offer.offerId, offer);
    return offer;
  }

  respondToOffer(
    offerId: string,
    responderBusinessId: string,
    action: 'accept' | 'reject' | 'counter',
    counterPriceCents?: number,
  ): BuyoutOffer {
    const offer = this.#offers().get(offerId);
    if (!offer) throw new Error(`Offer not found: ${offerId}`);
    if (offer.status !== 'pending') throw new Error(`Offer ${offerId} is ${offer.status}`);

    const token = this.stores.tokens.get(offer.tokenId);
    if (!token || token.ownerBusinessId !== responderBusinessId) {
      throw new Error('Only the token owner can respond to offers');
    }

    if (action === 'accept') {
      offer.status = 'accepted';
      this.transferTokens(offer.tokenId, responderBusinessId, offer.buyerBusinessId, offer.basisPoints, offer.offerPriceCents);
    } else if (action === 'counter') {
      if (!counterPriceCents) throw new Error('counterPriceCents required for counter-offer');
      offer.status = 'countered';
      offer.counterOfferPriceCents = counterPriceCents;
    } else {
      offer.status = 'rejected';
    }
    return offer;
  }

  // ── Token Merge: Consolidate small tokens ─────────────────────────────────────

  mergeTokens(tokenIds: string[], ownerBusinessId: string): RightsToken {
    if (tokenIds.length < 2) throw new Error('Need at least 2 tokens to merge');

    const tokens = tokenIds.map(id => this.#getActiveToken(id, ownerBusinessId));
    const assetId = tokens[0].rightsAssetId;
    const passportId = tokens[0].passportId;

    if (tokens.some(t => t.rightsAssetId !== assetId)) {
      throw new Error('All tokens must be for the same rights asset');
    }

    const totalBp = tokens.reduce((s, t) => s + t.ownershipBasisPoints, 0);
    const earliestAcquired = Math.min(...tokens.map(t => t.acquiredAt));

    // Redeem source tokens
    tokens.forEach(t => { t.status = 'redeemed'; t.ownershipBasisPoints = 0; });

    // Mint merged token
    const merged: RightsToken = {
      tokenId: crypto.randomUUID(),
      rightsAssetId: assetId,
      passportId,
      ownerBusinessId,
      ownershipBasisPoints: totalBp,
      acquiredAt: earliestAcquired,
      acquisitionPriceCents: tokens.reduce((s, t) => s + t.acquisitionPriceCents, 0),
      transferRestrictions: { rightOfFirstRefusal: false, minHoldingPeriodDays: 0 },
      status: 'active',
    };

    this.stores.tokens.set(merged.tokenId, merged);
    return merged;
  }

  // ── Voting Rights: Proportional governance by basis points ────────────────────

  createVote(topic: Omit<VoteTopic, 'topicId' | 'status'>): VoteTopic {
    const vt: VoteTopic = { ...topic, topicId: crypto.randomUUID(), status: 'open' };
    this.#voteTopics().set(vt.topicId, vt);
    return vt;
  }

  castVote(topicId: string, tokenId: string, voterBusinessId: string, optionIndex: number): VoteBallot {
    const topic = this.#voteTopics().get(topicId);
    if (!topic) throw new Error(`Vote topic not found: ${topicId}`);
    if (topic.status !== 'open') throw new Error('Voting is closed');
    if (optionIndex < 0 || optionIndex >= topic.options.length) {
      throw new Error(`Invalid option index: ${optionIndex}`);
    }

    const token = this.#getActiveToken(tokenId, voterBusinessId);
    if (token.rightsAssetId !== topic.rightsAssetId) {
      throw new Error('Token does not belong to this rights asset');
    }

    // One vote per token per topic
    const existing = [...this.#ballots().values()].find(b => b.topicId === topicId && b.tokenId === tokenId);
    if (existing) throw new Error('Token has already voted on this topic');

    const ballot: VoteBallot = {
      ballotId: crypto.randomUUID(),
      topicId, tokenId, voterBusinessId, optionIndex,
      basisPoints: token.ownershipBasisPoints,
      castAt: Date.now(),
    };
    this.#ballots().set(ballot.ballotId, ballot);
    return ballot;
  }

  tallyVotes(topicId: string): Array<{ option: string; votes: number; basisPoints: number }> {
    const topic = this.#voteTopics().get(topicId);
    if (!topic) throw new Error(`Vote topic not found: ${topicId}`);

    const ballots = [...this.#ballots().values()].filter(b => b.topicId === topicId);
    return topic.options.map((opt, i) => ({
      option: opt,
      votes: ballots.filter(b => b.optionIndex === i).length,
      basisPoints: ballots.filter(b => b.optionIndex === i).reduce((s, b) => s + b.basisPoints, 0),
    }));
  }

  closeVote(topicId: string): { topic: VoteTopic; results: Array<{ option: string; votes: number; basisPoints: number }> } {
    const topic = this.#voteTopics().get(topicId);
    if (!topic) throw new Error(`Vote topic not found: ${topicId}`);
    topic.status = 'closed';
    return { topic, results: this.tallyVotes(topicId) };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────────

  #getActiveToken(tokenId: string, ownerBusinessId: string): RightsToken {
    const token = this.stores.tokens.get(tokenId);
    if (!token) throw new Error(`Token not found: ${tokenId}`);
    if (token.status !== 'active') throw new Error(`Token ${tokenId} is not active`);
    if (token.ownerBusinessId !== ownerBusinessId) {
      throw new Error(`Token ${tokenId} owned by ${token.ownerBusinessId}, not ${ownerBusinessId}`);
    }
    return token;
  }

  #getListing(listingId: string, businessId: string): TokenListing {
    const listing = this.#listings().get(listingId);
    if (!listing) throw new Error(`Listing not found: ${listingId}`);
    if (listing.sellerBusinessId !== businessId) {
      throw new Error(`Listing ${listingId} belongs to ${listing.sellerBusinessId}`);
    }
    return listing;
  }

  #listings(): Map<string, TokenListing> {
    return this.#lazyMap('__listings');
  }

  #offers(): Map<string, BuyoutOffer> {
    return this.#lazyMap('__offers');
  }

  #voteTopics(): Map<string, VoteTopic> {
    return this.#lazyMap('__vote_topics');
  }

  #ballots(): Map<string, VoteBallot> {
    return this.#lazyMap('__ballots');
  }

  #lazyMap<T>(key: string): Map<string, T> {
    const stores = this.stores as unknown as Record<string, unknown>;
    const existing = stores[key] as Map<string, T> | undefined;
    if (existing) return existing;
    const m = new Map<string, T>();
    stores[key] = m;
    return m;
  }
}
