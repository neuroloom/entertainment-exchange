// Deal Room Engine — L3 Marketplace
// 13-state FSM governing the acquisition deal lifecycle from creation through closing.
//
// State graph:
//   created ──submitOffer──▶ offer_submitted ──acceptOffer──▶ offer_accepted
//                                 │                                    │
//                       (reject)  │   (expire)                         │
//                           ▼     ▼     ▼                              ▼
//                       rejected  expired                     due_diligence
//                                                                │
//                        cancelled ◀─────────────────────────────┤ (cancel)
//                                                                ▼
//                                                       terms_negotiated
//                                                                │
//                                                                ▼
//                                                        terms_agreed
//                                                                │
//                                                                ▼
//                                                        escrow_funded
//                                                                │
//                                                                ▼
//                                                        legal_review
//                                                                │
//                                                                ▼
//                                                            closing
//                                                                │
//                                                                ▼
//                                                           completed
//
//   Any non-terminal state is allowed to transition to cancelled.

// ─── Deal State ───────────────────────────────────────────────────────────────

export type DealState =
  | 'created'
  | 'offer_submitted'
  | 'offer_accepted'
  | 'due_diligence'
  | 'terms_negotiated'
  | 'terms_agreed'
  | 'escrow_funded'
  | 'legal_review'
  | 'closing'
  | 'completed'
  | 'disputed'
  | 'resolved'
  | 'rejected'
  | 'cancelled'
  | 'expired';

// ─── Deal Record ─────────────────────────────────────────────────────────────

export interface DealRecord {
  id: string;
  listingId: number;
  buyerId: number;
  sellerId: number;
  state: DealState;
  amountCents: number;
  counterAmountCents?: number;
  terms?: string;
  escrowTxHash?: string;
  events: DealEvent[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface DealEvent {
  timestamp: string;
  fromState: DealState;
  toState: DealState;
  action: string;
  metadata?: Record<string, unknown>;
}

// ─── Transition Table ────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<DealState, DealState[]> = {
  created:              ['offer_submitted', 'cancelled'],
  offer_submitted:      ['offer_accepted', 'rejected', 'expired', 'cancelled'],
  offer_accepted:       ['due_diligence', 'cancelled'],
  due_diligence:        ['terms_negotiated', 'disputed', 'cancelled'],
  terms_negotiated:     ['terms_agreed', 'disputed', 'cancelled'],
  terms_agreed:         ['escrow_funded', 'disputed', 'cancelled'],
  escrow_funded:        ['legal_review', 'disputed', 'cancelled'],
  legal_review:         ['closing', 'disputed', 'cancelled'],
  closing:              ['completed', 'disputed', 'cancelled'],
  completed:            [],   // terminal
  disputed:             ['resolved', 'cancelled'],
  resolved:             [],   // terminal
  rejected:             [],   // terminal
  cancelled:            [],   // terminal
  expired:              [],   // terminal
};

// ─── DealRoomEngine ──────────────────────────────────────────────────────────

export class DealRoomEngine {
  private deals = new Map<string, DealRecord>();
  private eventListeners = new Map<string, Array<(deal: DealRecord) => void>>();

  // ── Factory ──────────────────────────────────────────────────────────────

  createDeal(
    listingId: number,
    buyerId: number,
    sellerId: number,
    amountCents: number,
    terms?: string,
  ): DealRecord {
    const id = `deal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const deal: DealRecord = {
      id,
      listingId,
      buyerId,
      sellerId,
      state: 'created',
      amountCents,
      terms,
      events: [{
        timestamp: now,
        fromState: 'created' as DealState,  // initial event; from == to
        toState: 'created',
        action: 'deal_created',
        metadata: { listingId, buyerId, sellerId, amountCents },
      }],
      createdAt: now,
      updatedAt: now,
    };
    this.deals.set(id, deal);
    return { ...deal };
  }

  // ── Accessor ─────────────────────────────────────────────────────────────

  getDeal(dealId: string): DealRecord | undefined {
    const d = this.deals.get(dealId);
    return d ? { ...d } : undefined;
  }

  // ── submitOffer ──────────────────────────────────────────────────────────

  submitOffer(dealId: string, amount: number, terms?: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'offer_submitted');

    const from = deal.state;
    deal.state = 'offer_submitted';
    deal.amountCents = amount;
    if (terms) deal.terms = terms;
    this.recordEvent(deal, from, 'submit_offer', { amount, terms });
    return { ...deal };
  }

  // ── acceptOffer ──────────────────────────────────────────────────────────

  acceptOffer(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'offer_accepted');

    const from = deal.state;
    deal.state = 'offer_accepted';
    this.recordEvent(deal, from, 'accept_offer', { buyerId: deal.buyerId });
    return { ...deal };
  }

  // ── counterOffer ─────────────────────────────────────────────────────────

  counterOffer(dealId: string, newAmount: number): DealRecord {
    const deal = this.mustGet(dealId);
    // Counter-offer is only valid from offer_submitted
    if (deal.state !== 'offer_submitted') {
      throw new Error(
        `Counter-offer invalid: deal "${dealId}" is in state "${deal.state}". ` +
        `Counter-offers are only valid from "offer_submitted".`,
      );
    }
    // Counter-offer stays in offer_submitted — it is a negotiation within that state
    deal.counterAmountCents = newAmount;
    deal.updatedAt = new Date().toISOString();
    deal.events.push({
      timestamp: deal.updatedAt,
      fromState: deal.state,
      toState: deal.state,       // no state change — just a counter
      action: 'counter_offer',
      metadata: { previousAmount: deal.amountCents, newAmount },
    });
    return { ...deal };
  }

  // ── fundEscrow ───────────────────────────────────────────────────────────

  fundEscrow(dealId: string, txHash: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'escrow_funded');

    const from = deal.state;
    deal.state = 'escrow_funded';
    deal.escrowTxHash = txHash;
    this.recordEvent(deal, from, 'fund_escrow', { txHash });
    return { ...deal };
  }

  // ── closeDeal ────────────────────────────────────────────────────────────

  closeDeal(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'completed');

    const from = deal.state;
    deal.state = 'completed';
    deal.completedAt = new Date().toISOString();
    this.recordEvent(deal, from, 'close_deal', { completedAt: deal.completedAt });
    return { ...deal };
  }

  // ── Progress helpers (advance one step on the happy path) ────────────────

  advanceDueDiligence(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'due_diligence');
    return this.doTransition(deal, 'due_diligence', 'advance_due_diligence');
  }

  advanceTermsNegotiated(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'terms_negotiated');
    return this.doTransition(deal, 'terms_negotiated', 'advance_terms_negotiated');
  }

  advanceTermsAgreed(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'terms_agreed');
    return this.doTransition(deal, 'terms_agreed', 'advance_terms_agreed');
  }

  advanceLegalReview(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'legal_review');
    return this.doTransition(deal, 'legal_review', 'advance_legal_review');
  }

  advanceClosing(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'closing');
    return this.doTransition(deal, 'closing', 'advance_closing');
  }

  // ── transitionDeal: generic state transition with guard validation ────────

  transitionDeal(dealId: string, newStatus: DealState, metadata?: Record<string, unknown>): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, newStatus);
    const from = deal.state;
    deal.state = newStatus;
    this.recordEvent(deal, from, `transition:${newStatus}`, metadata);
    return { ...deal };
  }

  // ── disputeDeal: transition to disputed side state ────────────────────────

  disputeDeal(dealId: string, reason?: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'disputed');
    const from = deal.state;
    deal.state = 'disputed';
    this.recordEvent(deal, from, 'dispute_deal', { reason });
    return { ...deal };
  }

  // ── resolveDeal: resolve a disputed deal ──────────────────────────────────

  resolveDeal(dealId: string, resolution?: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'resolved');
    const from = deal.state;
    deal.state = 'resolved';
    this.recordEvent(deal, from, 'resolve_deal', { resolution });
    return { ...deal };
  }

  rejectDeal(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'rejected');
    return this.doTransition(deal, 'rejected', 'reject_deal');
  }

  cancelDeal(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'cancelled');
    return this.doTransition(deal, 'cancelled', 'cancel_deal');
  }

  expireDeal(dealId: string): DealRecord {
    const deal = this.mustGet(dealId);
    this.assertDealTransition(deal, 'expired');
    return this.doTransition(deal, 'expired', 'expire_deal');
  }

  // ── Event system ─────────────────────────────────────────────────────────

  on(eventName: string, listener: (deal: DealRecord) => void): void {
    const list = this.eventListeners.get(eventName) ?? [];
    list.push(listener);
    this.eventListeners.set(eventName, list);
  }

  private emit(eventName: string, deal: DealRecord): void {
    for (const fn of this.eventListeners.get(eventName) ?? []) {
      try { fn({ ...deal }); } catch { /* listener failures must not corrupt state */ }
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private doTransition(deal: DealRecord, to: DealState, action: string): DealRecord {
    const from = deal.state;
    deal.state = to;
    this.recordEvent(deal, from, action);
    return { ...deal };
  }

  private recordEvent(
    deal: DealRecord,
    from: DealState,
    action: string,
    metadata?: Record<string, unknown>,
  ): void {
    const now = new Date().toISOString();
    deal.updatedAt = now;
    deal.events.push({ timestamp: now, fromState: from, toState: deal.state, action, metadata });
    this.emit('state_change', deal);
    this.emit(`state:${deal.state}`, deal);
  }

  /**
   * Guard: throws if the transition `from -> to` is not in the valid-transition table.
   * Mirrors the BookingPipeline's state-machine pattern.
   */
  private assertDealTransition(deal: DealRecord, to: DealState): void {
    const allowed = VALID_TRANSITIONS[deal.state];
    if (!allowed || allowed.length === 0) {
      throw new Error(
        `Transition blocked: deal "${deal.id}" is in terminal state "${deal.state}". ` +
        `No further transitions allowed.`,
      );
    }
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid transition: cannot move deal "${deal.id}" from "${deal.state}" to "${to}". ` +
        `Valid next states: [${allowed.join(', ')}].`,
      );
    }
  }

  private mustGet(dealId: string): DealRecord {
    const deal = this.deals.get(dealId);
    if (!deal) throw new Error(`Deal not found: "${dealId}"`);
    return deal;
  }
}
