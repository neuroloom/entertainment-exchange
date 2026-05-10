// AutoNegotiator — Autonomous Multi-Round Deal Negotiation
//
// Two AI agents (buyer and seller) negotiate marketplace deals autonomously.
// Each agent has a BATNA, budget/margin constraints, and a strategic concession model.
// No entertainment platform has autonomous multi-round deal negotiation with
// budget enforcement — this is a 3-year moat.
//
// Architecture:
//   startNegotiation() → NegotiationSession
//   runNegotiationRound() → NegotiationRound  (single round, buyer or seller offer)
//   autoNegotiate() → NegotiationResult      (full autonomous negotiation)
//   calculateBATNA() → BATNA                  (reservation price computation)
//   generateCounterOffer() → DealTerms        (strategic concession engine)

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DealTerms {
  paymentUpfrontPercent: number;    // 0-100
  installmentMonths: number;        // 0-24
  deliveryTimelineDays: number;     // 1-365
  exclusivity: 'exclusive' | 'non_exclusive';
  includesIP: boolean;
  cancellationTerms: 'flexible' | 'moderate' | 'strict';
}

export interface BATNA {
  seller: { minPriceCents: number; reasoning: string[] };
  buyer: { maxPriceCents: number; reasoning: string[] };
  overlap: boolean;
}

export interface NegotiationRound {
  roundNumber: number;
  offer: {
    priceCents: number;
    terms: DealTerms;
    fromParty: 'buyer' | 'seller';
    timestamp: number;
  };
  counterOffer?: {
    priceCents: number;
    terms: DealTerms;
    fromParty: 'buyer' | 'seller';
    concessionPercent: number;
    timestamp: number;
  };
  status: 'pending' | 'countered' | 'accepted' | 'rejected';
}

export interface NegotiationSession {
  sessionId: string;
  listingId: string;
  buyerBusinessId: string;
  sellerBusinessId: string;
  status: 'active' | 'accepted' | 'rejected' | 'expired' | 'max_rounds';
  rounds: NegotiationRound[];
  batna: {
    seller: { minPriceCents: number; reasoning: string[] };
    buyer: { maxPriceCents: number; reasoning: string[] };
    overlap: boolean;
  };
  constraints: {
    buyerDailyBudgetCents: number;
    sellerMinMarginPercent: number;
    maxRounds: number;
  };
  startedAt: number;
  completedAt?: number;
}

export interface NegotiationResult {
  sessionId: string;
  status: 'accepted' | 'rejected' | 'expired';
  finalPriceCents?: number;
  finalTerms?: DealTerms;
  totalRounds: number;
  savingsVsAsking?: number;   // buyer's savings
  premiumVsBATNA?: number;    // seller's premium over minimum
  durationMs: number;
}

export interface NegotiationConstraints {
  buyerDailyBudgetCents?: number;
  sellerMinMarginPercent?: number;
  maxRounds?: number;
  concessionRate?: number;          // 0.0-1.0, how much to yield per round
  listingPriceCents?: number;       // original asking price
  sellerCostCents?: number;         // seller's cost basis for margin calc
  historicalPricesCents?: number[]; // for BATNA computation
}

export interface DealPriceRecord {
  priceCents: number;
  listingId: string;
  category?: string;
  completedAt: number;
}

// ─── Default terms ─────────────────────────────────────────────────────────────

const DEFAULT_TERMS: DealTerms = {
  paymentUpfrontPercent: 100,
  installmentMonths: 0,
  deliveryTimelineDays: 30,
  exclusivity: 'non_exclusive',
  includesIP: false,
  cancellationTerms: 'moderate',
};

// ─── Term utility weights — used to score and compare deal terms ───────────────
//
// Each term dimension contributes to a normalized utility score (0-1).
// Higher scores are better for the buyer (more favorable terms).

const TERM_UTILITY_WEIGHTS: Record<keyof DealTerms, number> = {
  paymentUpfrontPercent: 0.15,   // lower = better (less cash upfront)
  installmentMonths: 0.15,       // higher = better (more time to pay)
  deliveryTimelineDays: 0.10,    // lower = better (faster delivery)
  exclusivity: 0.25,             // non_exclusive = better for buyer
  includesIP: 0.20,              // true = better (rights included)
  cancellationTerms: 0.15,       // flexible > moderate > strict
};

// ─── Audit event type for negotiation trail ────────────────────────────────────

interface NegotiationAuditEvent {
  id: string;
  tenantId: string;
  businessId: string;
  actorType: 'agent_buyer' | 'agent_seller';
  actorId: string;
  action: string;
  resourceType: 'negotiation';
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// Minimal audit store interface — compatible with the existing AuditStore shape
interface MinimalAuditStore {
  push(event: NegotiationAuditEvent): void;
}

// ─── Seeded PRNG for deterministic "AI" behavior ──────────────────────────────
//
// Uses a simple mulberry32 PRNG so negotiation outcomes are reproducible
// given the same seed, but appear agent-like.

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function nowISO(): string {
  return new Date().toISOString();
}

// ─── AutoNegotiator ────────────────────────────────────────────────────────────

export interface ZOPA {
  buyerFloor: number;        // buyer's BATNA ceiling
  sellerCeiling: number;     // seller's BATNA floor
  spread: number;            // ZOPA width in cents
  exists: boolean;           // true if overlap
  fairPrice: number;         // midpoint of the zone
  confidence: number;        // 0-1, width / buyer max
  comparableCount: number;   // # historical deals in reference set
}

export interface MultiPartyNegotiation {
  sessionId: string;
  listingId: string;
  parties: Array<{
    businessId: string;
    role: 'buyer' | 'seller' | 'agent' | 'broker';
    batna: { minPriceCents: number; maxPriceCents: number };
    approvalThreshold: number; // max auto-approve price
    autoApprove: boolean;
  }>;
  status: 'active' | 'accepted' | 'partial' | 'rejected';
  rounds: NegotiationRound[];
  approvals: Array<{ businessId: string; round: number; approved: boolean; timestamp: number }>;
  startedAt: number;
}

interface ApprovalGate {
  sessionId: string;
  pendingRound: NegotiationRound;
  approvers: string[];
  approved: Set<string>;
  status: 'pending' | 'approved' | 'rejected';
}

export class AutoNegotiator {
  private sessions = new Map<string, NegotiationSession>();
  private multiPartySessions = new Map<string, MultiPartyNegotiation>();
  private approvalGates = new Map<string, ApprovalGate>();
  private auditStore: MinimalAuditStore | null;
  private historicalDeals: DealPriceRecord[] = [];
  private defaultConstraints: Required<Omit<NegotiationConstraints, 'historicalPricesCents'>>;

  constructor(opts?: {
    auditStore?: MinimalAuditStore;
    historicalDeals?: DealPriceRecord[];
    defaultConstraints?: NegotiationConstraints;
  }) {
    this.auditStore = opts?.auditStore ?? null;
    this.historicalDeals = opts?.historicalDeals ?? [];

    this.defaultConstraints = {
      buyerDailyBudgetCents: opts?.defaultConstraints?.buyerDailyBudgetCents ?? 1_000_000_00, // $1M default
      sellerMinMarginPercent: opts?.defaultConstraints?.sellerMinMarginPercent ?? 10,
      maxRounds: opts?.defaultConstraints?.maxRounds ?? 5,
      concessionRate: opts?.defaultConstraints?.concessionRate ?? 0.15,
      listingPriceCents: opts?.defaultConstraints?.listingPriceCents ?? 0,
      sellerCostCents: opts?.defaultConstraints?.sellerCostCents ?? 0,
    };
  }

  // ── Public: start a negotiation session ──────────────────────────────────────

  startNegotiation(
    listingId: string,
    buyerBusinessId: string,
    sellerBusinessId: string,
    constraints?: NegotiationConstraints,
  ): NegotiationSession {
    const sessionId = genId('neg');

    const resolvedConstraints = {
      buyerDailyBudgetCents: constraints?.buyerDailyBudgetCents ?? this.defaultConstraints.buyerDailyBudgetCents,
      sellerMinMarginPercent: constraints?.sellerMinMarginPercent ?? this.defaultConstraints.sellerMinMarginPercent,
      maxRounds: constraints?.maxRounds ?? this.defaultConstraints.maxRounds,
    };

    const batna = this.calculateBATNA(listingId, buyerBusinessId, {
      listingPriceCents: constraints?.listingPriceCents ?? this.defaultConstraints.listingPriceCents,
      sellerCostCents: constraints?.sellerCostCents ?? this.defaultConstraints.sellerCostCents,
      buyerDailyBudgetCents: resolvedConstraints.buyerDailyBudgetCents,
      sellerMinMarginPercent: resolvedConstraints.sellerMinMarginPercent,
    });

    const session: NegotiationSession = {
      sessionId,
      listingId,
      buyerBusinessId,
      sellerBusinessId,
      status: 'active',
      rounds: [],
      batna: {
        seller: { minPriceCents: batna.seller.minPriceCents, reasoning: batna.seller.reasoning },
        buyer: { maxPriceCents: batna.buyer.maxPriceCents, reasoning: batna.buyer.reasoning },
        overlap: batna.overlap,
      },
      constraints: resolvedConstraints,
      startedAt: Date.now(),
    };

    this.sessions.set(sessionId, session);

    this.recordAudit({
      id: genId('aud'),
      tenantId: 'system',
      businessId: buyerBusinessId,
      actorType: 'agent_buyer',
      actorId: 'auto-negotiator',
      action: 'negotiation_started',
      resourceType: 'negotiation',
      resourceId: sessionId,
      metadata: {
        listingId,
        buyerBusinessId,
        sellerBusinessId,
        batna: { sellerMin: batna.seller.minPriceCents, buyerMax: batna.buyer.maxPriceCents, overlap: batna.overlap },
        constraints: resolvedConstraints,
      },
      createdAt: nowISO(),
    });

    return this.cloneSession(session);
  }

  // ── Public: run a single negotiation round ────────────────────────────────────

  runNegotiationRound(
    sessionId: string,
    party: 'buyer' | 'seller',
    offer: { priceCents: number; terms: DealTerms },
  ): NegotiationRound {
    const session = this.mustGet(sessionId);

    if (session.status !== 'active') {
      throw new Error(`Cannot run round on session "${sessionId}" in status "${session.status}"`);
    }

    const roundNumber = session.rounds.length + 1;

    if (roundNumber > session.constraints.maxRounds) {
      session.status = 'max_rounds';
      session.completedAt = Date.now();
      throw new Error(`Maximum rounds (${session.constraints.maxRounds}) exceeded for session "${sessionId}"`);
    }

    // Budget enforcement — buyer cannot exceed daily budget
    if (party === 'buyer') {
      const cumulativeSpend = session.rounds.reduce((sum, r) => {
        return sum + (r.offer.fromParty === 'buyer' ? r.offer.priceCents : 0);
      }, 0);

      if (cumulativeSpend + offer.priceCents > session.constraints.buyerDailyBudgetCents) {
        throw new Error(
          `Budget exceeded: offer of ${offer.priceCents} would bring total to ` +
          `${cumulativeSpend + offer.priceCents}, exceeding daily budget of ` +
          `${session.constraints.buyerDailyBudgetCents}`,
        );
      }
    }

    // Margin enforcement — seller cannot sell below min margin
    if (party === 'seller') {
      // We need listingPrice to be available — derive from BATNA
      const minPrice = session.batna.seller.minPriceCents;
      if (offer.priceCents < minPrice) {
        throw new Error(
          `Margin violation: offer of ${offer.priceCents} is below seller minimum of ${minPrice}`,
        );
      }
    }

    const round: NegotiationRound = {
      roundNumber,
      offer: {
        priceCents: offer.priceCents,
        terms: { ...offer.terms },
        fromParty: party,
        timestamp: Date.now(),
      },
      status: 'pending',
    };

    session.rounds.push(round);

    this.recordAudit({
      id: genId('aud'),
      tenantId: 'system',
      businessId: party === 'buyer' ? session.buyerBusinessId : session.sellerBusinessId,
      actorType: party === 'buyer' ? 'agent_buyer' : 'agent_seller',
      actorId: 'auto-negotiator',
      action: 'offer_submitted',
      resourceType: 'negotiation',
      resourceId: sessionId,
      metadata: { roundNumber, priceCents: offer.priceCents, terms: offer.terms, party },
      createdAt: nowISO(),
    });

    return this.cloneRound(round);
  }

  // ── Public: run full autonomous negotiation ──────────────────────────────────

  autoNegotiate(sessionId: string, opts?: { seed?: number }): NegotiationResult {
    const session = this.mustGet(sessionId);
    const seed = opts?.seed ?? (Date.now() ^ hashStr(sessionId));
    const rng = mulberry32(seed);
    const startTime = Date.now();

    const buyerMaxPrice = session.batna.buyer.maxPriceCents;
    const sellerMinPrice = session.batna.seller.minPriceCents;

    // If there is no BATNA overlap, negotiation is guaranteed to fail
    if (!session.batna.overlap) {
      session.status = 'rejected';
      session.completedAt = Date.now();

      this.recordAudit({
        id: genId('aud'),
        tenantId: 'system',
        businessId: session.buyerBusinessId,
        actorType: 'agent_buyer',
        actorId: 'auto-negotiator',
        action: 'negotiation_rejected',
        resourceType: 'negotiation',
        resourceId: sessionId,
        metadata: { reason: 'no_batna_overlap', buyerMaxPrice, sellerMinPrice },
        createdAt: nowISO(),
      });

      return {
        sessionId,
        status: 'rejected',
        totalRounds: session.rounds.length,
        durationMs: Date.now() - startTime,
      };
    }

    // Determine the concession rate — how much each side yields per round
    const concessionRate = this.defaultConstraints.concessionRate;
    const maxRounds = session.constraints.maxRounds;

    // The midpoint of the overlap zone is the "fair price"
    const fairPriceCents = Math.round((buyerMaxPrice + sellerMinPrice) / 2);

    // Seller starts with asking price (based on listing + premium)
    // Buyer starts with a lowball offer
    const askingPriceCents = Math.max(
      sellerMinPrice + Math.round((buyerMaxPrice - sellerMinPrice) * 0.3),
      sellerMinPrice + 1,
    );

    // Initialize agent positions
    let sellerPosition = askingPriceCents;
    let buyerPosition = Math.max(
      sellerMinPrice - Math.round((buyerMaxPrice - sellerMinPrice) * 0.2),
      1,
    );

    // Terms negotiation — incremental concessions
    const sellerTerms: DealTerms = { ...DEFAULT_TERMS };
    const buyerTerms: DealTerms = {
      ...DEFAULT_TERMS,
      paymentUpfrontPercent: 50,
      installmentMonths: 6,
      deliveryTimelineDays: 14,
      exclusivity: 'exclusive',
      includesIP: true,
      cancellationTerms: 'flexible',
    };

    for (let roundNum = 1; roundNum <= maxRounds; roundNum++) {
      // Determine who goes first this round (alternate)
      const firstParty: 'buyer' | 'seller' = roundNum % 2 === 1 ? 'seller' : 'buyer';
      const secondParty: 'buyer' | 'seller' = firstParty === 'seller' ? 'buyer' : 'seller';

      // First offer
      const firstPrice = firstParty === 'seller' ? sellerPosition : buyerPosition;
      const firstTerms = firstParty === 'seller'
        ? { ...sellerTerms }
        : { ...buyerTerms };

      const firstRound = this.runNegotiationRound(sessionId, firstParty, {
        priceCents: firstPrice,
        terms: firstTerms,
      });

      // Evaluate: should we accept?
      const overlap = buyerPosition >= sellerPosition;
      const nearAgreement = Math.abs(buyerPosition - sellerPosition) <=
        Math.round((buyerMaxPrice - sellerMinPrice) * 0.05);

      if (overlap || nearAgreement) {
        const finalPrice = Math.round((buyerPosition + sellerPosition) / 2);
        const finalTerms = this.mergeTerms(buyerTerms, sellerTerms, rng);

        firstRound.status = 'accepted';
        firstRound.counterOffer = {
          priceCents: finalPrice,
          terms: finalTerms,
          fromParty: secondParty,
          concessionPercent: 0,
          timestamp: Date.now(),
        };

        session.status = 'accepted';
        session.completedAt = Date.now();

        const savingsVsAsking = askingPriceCents - finalPrice;
        const premiumVsBATNA = finalPrice - sellerMinPrice;

        this.recordAudit({
          id: genId('aud'),
          tenantId: 'system',
          businessId: session.buyerBusinessId,
          actorType: 'agent_buyer',
          actorId: 'auto-negotiator',
          action: 'negotiation_accepted',
          resourceType: 'negotiation',
          resourceId: sessionId,
          metadata: {
            finalPriceCents: finalPrice,
            finalTerms,
            totalRounds: roundNum,
            savingsVsAsking,
            premiumVsBATNA,
          },
          createdAt: nowISO(),
        });

        return {
          sessionId,
          status: 'accepted',
          finalPriceCents: finalPrice,
          finalTerms,
          totalRounds: roundNum,
          savingsVsAsking,
          premiumVsBATNA,
          durationMs: Date.now() - startTime,
        };
      }

      // Counter-offer: each party concedes toward the fair price
      if (secondParty === 'buyer') {
        // Buyer concedes upward
        const buyerStep = Math.round((fairPriceCents - buyerPosition) * concessionRate);
        buyerPosition = clamp(
          buyerPosition + Math.max(buyerStep, 1),
          0,
          buyerMaxPrice,
        );
        // Concede on terms too
        buyerTerms.paymentUpfrontPercent = clamp(
          buyerTerms.paymentUpfrontPercent + Math.round(10 * concessionRate),
          0,
          100,
        );
        buyerTerms.installmentMonths = clamp(
          buyerTerms.installmentMonths - Math.round(2 * concessionRate),
          0,
          24,
        );
      } else {
        // Seller concedes downward
        const sellerStep = Math.round((sellerPosition - fairPriceCents) * concessionRate);
        sellerPosition = clamp(
          sellerPosition - Math.max(sellerStep, 1),
          sellerMinPrice,
          askingPriceCents,
        );
        // Concede on terms too
        sellerTerms.paymentUpfrontPercent = clamp(
          sellerTerms.paymentUpfrontPercent - Math.round(5 * concessionRate),
          0,
          100,
        );
        sellerTerms.deliveryTimelineDays = clamp(
          sellerTerms.deliveryTimelineDays + Math.round(3 * concessionRate),
          1,
          365,
        );
      }

      // Record counter-offer
      const counterPrice = secondParty === 'buyer' ? buyerPosition : sellerPosition;
      const counterTerms = secondParty === 'buyer'
        ? { ...buyerTerms }
        : { ...sellerTerms };

      const priceDelta = Math.abs(secondParty === 'buyer'
        ? buyerPosition - firstPrice
        : sellerPosition - firstPrice);

      const concessionPct = askingPriceCents > sellerMinPrice
        ? priceDelta / (askingPriceCents - sellerMinPrice)
        : 0;

      firstRound.status = 'countered';
      firstRound.counterOffer = {
        priceCents: counterPrice,
        terms: counterTerms,
        fromParty: secondParty,
        concessionPercent: Math.round(concessionPct * 10000) / 100,
        timestamp: Date.now(),
      };

      this.recordAudit({
        id: genId('aud'),
        tenantId: 'system',
        businessId: secondParty === 'buyer' ? session.buyerBusinessId : session.sellerBusinessId,
        actorType: secondParty === 'buyer' ? 'agent_buyer' : 'agent_seller',
        actorId: 'auto-negotiator',
        action: 'counter_offer',
        resourceType: 'negotiation',
        resourceId: sessionId,
        metadata: {
          roundNumber: roundNum,
          priceCents: counterPrice,
          terms: counterTerms,
          party: secondParty,
          concessionPercent: firstRound.counterOffer.concessionPercent,
        },
        createdAt: nowISO(),
      });
    }

    // Exhausted max rounds — negotiation fails
    session.status = 'max_rounds';
    session.completedAt = Date.now();

    this.recordAudit({
      id: genId('aud'),
      tenantId: 'system',
      businessId: session.buyerBusinessId,
      actorType: 'agent_buyer',
      actorId: 'auto-negotiator',
      action: 'negotiation_max_rounds',
      resourceType: 'negotiation',
      resourceId: sessionId,
      metadata: { totalRounds: maxRounds, finalBuyerPosition: buyerPosition, finalSellerPosition: sellerPosition },
      createdAt: nowISO(),
    });

    return {
      sessionId,
      status: 'rejected',
      totalRounds: maxRounds,
      durationMs: Date.now() - startTime,
    };
  }

  // ── Public: compute BATNA for a buyer and listing ────────────────────────────

  calculateBATNA(
    listingId: string,
    buyerBusinessId: string,
    opts?: {
      listingPriceCents?: number;
      sellerCostCents?: number;
      buyerDailyBudgetCents?: number;
      sellerMinMarginPercent?: number;
    },
  ): BATNA {
    const listingPriceCents = opts?.listingPriceCents ?? 100_000_00;
    const sellerCostCents = opts?.sellerCostCents ?? Math.round(listingPriceCents * 0.7);
    const buyerDailyBudgetCents = opts?.buyerDailyBudgetCents ?? 1_000_000_00;
    const sellerMinMarginPercent = opts?.sellerMinMarginPercent ?? 10;

    // ── Seller BATNA: lowest acceptable price ───────────────────────────────
    //
    // Compute the seller's reservation price from their cost basis + min margin.
    // Also factor in historical deals for similar listings as a floor reference.

    const sellerMinFromMargin = sellerCostCents + Math.round(sellerCostCents * (sellerMinMarginPercent / 100));

    const similarDeals = this.historicalDeals.filter(d => {
      // Same listing or same category is "similar"
      return d.listingId === listingId || d.category === 'media';
    });

    const historicalMin = similarDeals.length > 0
      ? Math.min(...similarDeals.map(d => d.priceCents))
      : sellerMinFromMargin;

    const sellerMinPriceCents = Math.max(sellerMinFromMargin, historicalMin);

    const sellerReasoning: string[] = [
      `Cost basis: ${sellerCostCents} cents`,
      `Minimum margin of ${sellerMinMarginPercent}% requires at least ${sellerMinFromMargin} cents`,
      similarDeals.length > 0
        ? `Historical deals for similar listings had a minimum of ${historicalMin} cents across ${similarDeals.length} deals`
        : `No historical deals found for listing ${listingId} — using cost + margin floor`,
      `Final reservation price: ${sellerMinPriceCents} cents`,
    ];

    // ── Buyer BATNA: highest acceptable price ───────────────────────────────
    //
    // Buyer determines their ceiling based on daily budget and alternative deals.
    // The ceiling is the lesser of (budget * buffer_factor) or (listing * 1.2).

    const budgetCeiling = Math.round(buyerDailyBudgetCents * 0.85); // 85% of daily budget
    const marketCeiling = Math.round(listingPriceCents * 1.1);       // 10% above list
    const historicalMax = similarDeals.length > 0
      ? Math.max(...similarDeals.map(d => d.priceCents))
      : marketCeiling;

    const buyerMaxPriceCents = clamp(
      Math.min(budgetCeiling, marketCeiling, historicalMax),
      1,
      buyerDailyBudgetCents,
    );

    const buyerReasoning: string[] = [
      `Daily budget: ${buyerDailyBudgetCents} cents → 85% ceiling = ${budgetCeiling} cents`,
      `Listing price: ${listingPriceCents} cents → 10% premium ceiling = ${marketCeiling} cents`,
      similarDeals.length > 0
        ? `Historical deals for similar listings max at ${historicalMax} cents`
        : `No historical deals — using budget + market ceiling`,
      `Final reservation price: ${buyerMaxPriceCents} cents`,
    ];

    return {
      seller: { minPriceCents: sellerMinPriceCents, reasoning: sellerReasoning },
      buyer: { maxPriceCents: buyerMaxPriceCents, reasoning: buyerReasoning },
      overlap: sellerMinPriceCents <= buyerMaxPriceCents,
    };
  }

  // ── Public: generate a strategic counter-offer ───────────────────────────────

  generateCounterOffer(
    session: NegotiationSession,
    currentOffer: { priceCents: number; terms: DealTerms; fromParty: 'buyer' | 'seller' },
  ): { priceCents: number; terms: DealTerms; concessionPercent: number } {
    const concessionRate = this.defaultConstraints.concessionRate;
    const batna = session.batna;

    // Determine the fair zone midpoint
    const fairPriceCents = Math.round((batna.buyer.maxPriceCents + batna.seller.minPriceCents) / 2);

    let newPrice: number;
    let newTerms: DealTerms;

    if (currentOffer.fromParty === 'seller') {
      // Counter a seller offer — buyer offers LESS
      const gap = currentOffer.priceCents - fairPriceCents;
      const reduction = Math.max(Math.round(gap * concessionRate), 1);
      newPrice = currentOffer.priceCents - reduction;

      newTerms = {
        ...currentOffer.terms,
        paymentUpfrontPercent: clamp(currentOffer.terms.paymentUpfrontPercent - Math.round(10 * concessionRate), 0, 100),
        installmentMonths: clamp(currentOffer.terms.installmentMonths + Math.round(2 * concessionRate), 0, 24),
        deliveryTimelineDays: clamp(currentOffer.terms.deliveryTimelineDays - Math.round(3 * concessionRate), 1, 365),
        exclusivity: concessionRate > 0.3 ? 'non_exclusive' : currentOffer.terms.exclusivity,
      };
    } else {
      // Counter a buyer offer — seller offers MORE
      const gap = fairPriceCents - currentOffer.priceCents;
      const increase = Math.max(Math.round(gap * concessionRate), 1);
      newPrice = currentOffer.priceCents + increase;

      newTerms = {
        ...currentOffer.terms,
        paymentUpfrontPercent: clamp(currentOffer.terms.paymentUpfrontPercent + Math.round(5 * concessionRate), 0, 100),
        deliveryTimelineDays: clamp(currentOffer.terms.deliveryTimelineDays + Math.round(3 * concessionRate), 1, 365),
      };
    }

    const maxSpread = batna.buyer.maxPriceCents - batna.seller.minPriceCents;
    const concessionPercent = maxSpread > 0
      ? Math.round((Math.abs(newPrice - currentOffer.priceCents) / maxSpread) * 10000) / 100
      : 0;

    return { priceCents: newPrice, terms: newTerms, concessionPercent };
  }

  // ── Public: get session ──────────────────────────────────────────────────────

  getSession(sessionId: string): NegotiationSession | undefined {
    const s = this.sessions.get(sessionId);
    return s ? this.cloneSession(s) : undefined;
  }

  // ── Public: accept current offer manually ────────────────────────────────────

  acceptOffer(sessionId: string): NegotiationResult {
    const session = this.mustGet(sessionId);
    const lastRound = session.rounds[session.rounds.length - 1];
    if (!lastRound) {
      throw new Error(`No rounds to accept in session "${sessionId}"`);
    }

    lastRound.status = 'accepted';
    session.status = 'accepted';
    session.completedAt = Date.now();

    const finalPrice = lastRound.counterOffer?.priceCents ?? lastRound.offer.priceCents;
    const finalTerms = lastRound.counterOffer?.terms ?? lastRound.offer.terms;
    const listingPriceCents = this.defaultConstraints.listingPriceCents;
    const savingsVsAsking = listingPriceCents > 0 ? listingPriceCents - finalPrice : undefined;
    const premiumVsBATNA = finalPrice - session.batna.seller.minPriceCents;

    return {
      sessionId,
      status: 'accepted',
      finalPriceCents: finalPrice,
      finalTerms,
      totalRounds: session.rounds.length,
      savingsVsAsking,
      premiumVsBATNA,
      durationMs: Date.now() - session.startedAt,
    };
  }

  // ── Public: reject negotiation manually ──────────────────────────────────────

  rejectOffer(sessionId: string): NegotiationResult {
    const session = this.mustGet(sessionId);
    const lastRound = session.rounds[session.rounds.length - 1];
    if (lastRound) {
      lastRound.status = 'rejected';
    }

    session.status = 'rejected';
    session.completedAt = Date.now();

    return {
      sessionId,
      status: 'rejected',
      totalRounds: session.rounds.length,
      durationMs: Date.now() - session.startedAt,
    };
  }

  // ── Public: expire a session ─────────────────────────────────────────────────

  expireSession(sessionId: string): NegotiationResult {
    const session = this.mustGet(sessionId);
    session.status = 'expired';
    session.completedAt = Date.now();

    return {
      sessionId,
      status: 'expired',
      totalRounds: session.rounds.length,
      durationMs: Date.now() - session.startedAt,
    };
  }

  // ── Public: compute utility score for deal terms ─────────────────────────────

  computeTermUtility(terms: DealTerms): number {
    let score = 0;

    // paymentUpfrontPercent: lower is better (0-100 → invert)
    score += (1 - terms.paymentUpfrontPercent / 100) * TERM_UTILITY_WEIGHTS.paymentUpfrontPercent;

    // installmentMonths: higher is better (0-24 → normalize)
    score += (terms.installmentMonths / 24) * TERM_UTILITY_WEIGHTS.installmentMonths;

    // deliveryTimelineDays: lower is better (1-365 → invert)
    score += (1 - (terms.deliveryTimelineDays - 1) / 364) * TERM_UTILITY_WEIGHTS.deliveryTimelineDays;

    // exclusivity: non_exclusive = 1, exclusive = 0
    score += (terms.exclusivity === 'non_exclusive' ? 1 : 0) * TERM_UTILITY_WEIGHTS.exclusivity;

    // includesIP: true = 1, false = 0
    score += (terms.includesIP ? 1 : 0) * TERM_UTILITY_WEIGHTS.includesIP;

    // cancellationTerms: flexible=1, moderate=0.5, strict=0
    const cancellationScore =
      terms.cancellationTerms === 'flexible' ? 1 :
      terms.cancellationTerms === 'moderate' ? 0.5 : 0;
    score += cancellationScore * TERM_UTILITY_WEIGHTS.cancellationTerms;

    return Math.round(score * 10000) / 10000;
  }

  // ── Public: compute the Zone of Possible Agreement (ZOPA) ─────────────────────

  computeZOPA(
    listingId: string,
    buyerBusinessId: string,
    opts?: NegotiationConstraints,
  ): ZOPA {
    const batna = this.calculateBATNA(listingId, buyerBusinessId, opts);
    const spread = batna.buyer.maxPriceCents - batna.seller.minPriceCents;

    return {
      buyerFloor: batna.buyer.maxPriceCents,
      sellerCeiling: batna.seller.minPriceCents,
      spread,
      exists: spread >= 0,
      fairPrice: Math.round((batna.buyer.maxPriceCents + batna.seller.minPriceCents) / 2),
      confidence: batna.buyer.maxPriceCents > 0 ? clamp(spread / batna.buyer.maxPriceCents, 0, 1) : 0,
      comparableCount: this.historicalDeals.filter(
        d => d.listingId === listingId || d.category === 'media',
      ).length,
    };
  }

  // ── Public: multi-party negotiation ────────────────────────────────────────────

  startMultiPartyNegotiation(
    listingId: string,
    parties: Array<{
      businessId: string;
      role: 'buyer' | 'seller' | 'agent' | 'broker';
      batnaOptions?: {
        listingPriceCents?: number;
        sellerCostCents?: number;
        buyerDailyBudgetCents?: number;
        sellerMinMarginPercent?: number;
      };
      approvalThreshold?: number;
      autoApprove?: boolean;
    }>,
  ): MultiPartyNegotiation {
    const sessionId = genId('mpn');
    const startedAt = Date.now();

    const resolvedParties = parties.map(p => {
      let batna: { minPriceCents: number; maxPriceCents: number };
      if (p.role === 'buyer' || p.role === 'agent') {
        const b = this.calculateBATNA(listingId, p.businessId, p.batnaOptions);
        batna = { minPriceCents: b.buyer.maxPriceCents, maxPriceCents: b.buyer.maxPriceCents };
      } else {
        const b = this.calculateBATNA(listingId, p.businessId, p.batnaOptions);
        batna = { minPriceCents: b.seller.minPriceCents, maxPriceCents: b.seller.minPriceCents };
      }

      return {
        businessId: p.businessId,
        role: p.role,
        batna,
        approvalThreshold: p.approvalThreshold ?? batna.maxPriceCents,
        autoApprove: p.autoApprove ?? false,
      };
    });

    const session: MultiPartyNegotiation = {
      sessionId,
      listingId,
      parties: resolvedParties,
      status: 'active',
      rounds: [],
      approvals: [],
      startedAt,
    };

    this.multiPartySessions.set(sessionId, session);
    return JSON.parse(JSON.stringify(session));
  }

  runMultiPartyRound(
    sessionId: string,
    partyIndex: number,
    offer: { priceCents: number; terms: DealTerms },
  ): { round: NegotiationRound; needsApproval: boolean } {
    const session = this.multiPartySessions.get(sessionId);
    if (!session) throw new Error(`Multi-party session not found: ${sessionId}`);
    if (session.status !== 'active') throw new Error(`Session ${sessionId} is ${session.status}`);
    if (partyIndex < 0 || partyIndex >= session.parties.length) {
      throw new Error(`Invalid party index: ${partyIndex}`);
    }

    const party = session.parties[partyIndex];
    const roundNumber = session.rounds.length + 1;

    // Check if approval is needed for this party
    const needsApproval = !party.autoApprove || offer.priceCents > party.approvalThreshold;

    const round: NegotiationRound = {
      roundNumber,
      offer: {
        priceCents: offer.priceCents,
        terms: { ...offer.terms },
        fromParty: party.role === 'buyer' || party.role === 'agent' ? 'buyer' : 'seller',
        timestamp: Date.now(),
      },
      status: needsApproval ? 'pending' : 'countered',
    };

    session.rounds.push(round);

    // If approval is needed, create an approval gate
    if (needsApproval) {
      const otherParties = session.parties
        .filter((_, i) => i !== partyIndex)
        .map(p => p.businessId);

      this.approvalGates.set(`${sessionId}:${roundNumber}`, {
        sessionId,
        pendingRound: round,
        approvers: otherParties,
        approved: new Set(),
        status: 'pending',
      });
    }

    return { round, needsApproval };
  }

  castApproval(
    sessionId: string,
    roundNumber: number,
    approverBusinessId: string,
    approved: boolean,
  ): { round: NegotiationRound; allApproved: boolean; remaining: string[] } {
    const gateKey = `${sessionId}:${roundNumber}`;
    const gate = this.approvalGates.get(gateKey);
    if (!gate) throw new Error(`Approval gate not found: ${gateKey}`);
    if (gate.status !== 'pending') throw new Error(`Approval already ${gate.status}`);

    const session = this.multiPartySessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Record the approval
    session.approvals.push({
      businessId: approverBusinessId,
      round: roundNumber,
      approved,
      timestamp: Date.now(),
    });

    if (!approved) {
      gate.status = 'rejected';
      gate.pendingRound.status = 'rejected';
      session.status = 'rejected';
      return { round: gate.pendingRound, allApproved: false, remaining: [] };
    }

    gate.approved.add(approverBusinessId);
    const remaining = gate.approvers.filter(a => !gate.approved.has(a));

    if (remaining.length === 0) {
      gate.status = 'approved';
      gate.pendingRound.status = 'countered';
      return { round: gate.pendingRound, allApproved: true, remaining: [] };
    }

    return { round: gate.pendingRound, allApproved: false, remaining };
  }

  getMultiPartySession(sessionId: string): MultiPartyNegotiation | undefined {
    const s = this.multiPartySessions.get(sessionId);
    return s ? JSON.parse(JSON.stringify(s)) : undefined;
  }

  // ── Private: merge terms between buyer and seller preferences ────────────────

  private mergeTerms(buyerTerms: DealTerms, sellerTerms: DealTerms, rng: () => number): DealTerms {
    // Terms with higher buyer utility are favored when the buyer has more leverage
    // (determined by how close the agreed price is to their BATNA)
    const buyerUtility = this.computeTermUtility(buyerTerms);
    const sellerUtility = this.computeTermUtility(sellerTerms);

    // Weighted blend: buyer gets stronger terms when their utility is higher
    const buyerWeight = clamp(buyerUtility / (buyerUtility + sellerUtility + 0.001), 0.3, 0.7);

    return {
      paymentUpfrontPercent: clamp(
        Math.round(buyerTerms.paymentUpfrontPercent * buyerWeight + sellerTerms.paymentUpfrontPercent * (1 - buyerWeight)),
        0, 100,
      ),
      installmentMonths: clamp(
        Math.round(buyerTerms.installmentMonths * buyerWeight + sellerTerms.installmentMonths * (1 - buyerWeight)),
        0, 24,
      ),
      deliveryTimelineDays: clamp(
        Math.round(buyerTerms.deliveryTimelineDays * buyerWeight + sellerTerms.deliveryTimelineDays * (1 - buyerWeight)),
        1, 365,
      ),
      exclusivity: buyerWeight > 0.5 ? buyerTerms.exclusivity : sellerTerms.exclusivity,
      includesIP: rng() > 0.5 ? buyerTerms.includesIP : sellerTerms.includesIP,
      cancellationTerms: buyerWeight > 0.5 ? buyerTerms.cancellationTerms : sellerTerms.cancellationTerms,
    };
  }

  // ── Private: audit trail ─────────────────────────────────────────────────────

  private recordAudit(event: NegotiationAuditEvent): void {
    if (this.auditStore) {
      try {
        this.auditStore.push(event);
      } catch {
        // Audit failure must not block negotiation
      }
    }
  }

  // ── Private: session access and deep cloning ─────────────────────────────────

  private mustGet(sessionId: string): NegotiationSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Negotiation session not found: "${sessionId}"`);
    return session;
  }

  private cloneSession(s: NegotiationSession): NegotiationSession {
    return structuredClone(s);
  }

  private cloneRound(r: NegotiationRound): NegotiationRound {
    return JSON.parse(JSON.stringify(r));
  }
}

// ── Helper: simple string hash for deterministic seeding ──────────────────────

function hashStr(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash);
}
