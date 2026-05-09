// L3 Marketplace Tests: EvidenceValidator + DealRoomEngine
import { describe, it, expect } from 'vitest';
import { EvidenceValidator, DealRoomEngine } from './index.js';

// ═════════════════════════════════════════════════════════════════════════════
// Evidence Validator
// ═════════════════════════════════════════════════════════════════════════════

describe('EvidenceValidator', () => {
  const validator = new EvidenceValidator();

  // ── self_reported ─────────────────────────────────────────────────────

  it('self_reported: passes with 1 document', () => {
    const result = validator.validate('self_reported', ['id_doc.pdf']);
    expect(result.valid).toBe(true);
    expect(result.missingDocuments).toEqual([]);
    expect(result.reasons).toEqual([]);
  });

  it('self_reported: passes with 2+ documents', () => {
    const result = validator.validate('self_reported', ['id_doc.pdf', 'business_license.pdf']);
    expect(result.valid).toBe(true);
  });

  it('self_reported: fails with 0 documents', () => {
    const result = validator.validate('self_reported', []);
    expect(result.valid).toBe(false);
    expect(result.missingDocuments.length).toBeGreaterThanOrEqual(1);
    expect(result.reasons.some((r) => r.includes('Insufficient documents'))).toBe(true);
  });

  // ── document_supported ─────────────────────────────────────────────────

  it('document_supported: passes with 2 clean documents', () => {
    const result = validator.validate('document_supported', ['id_doc.pdf', 'business_license.pdf']);
    expect(result.valid).toBe(true);
  });

  it('document_supported: fails with 1 document', () => {
    const result = validator.validate('document_supported', ['id_doc.pdf']);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('Insufficient documents'))).toBe(true);
    expect(result.missingDocuments.length).toBe(1);
  });

  it('document_supported: fails on hash verification with invalid doc', () => {
    const result = validator.validate('document_supported', ['id_doc.pdf', 'invalid_hash_doc.pdf']);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('Hash verification failed'))).toBe(true);
    expect(result.missingDocuments.includes('invalid_hash_doc.pdf')).toBe(true);
  });

  it('document_supported: fails on corrupt doc', () => {
    const result = validator.validate('document_supported', ['id_doc.pdf', 'corrupt_file.pdf']);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('Hash verification failed'))).toBe(true);
    expect(result.missingDocuments.includes('corrupt_file.pdf')).toBe(true);
  });

  it('document_supported: fails on both insufficient and hash', () => {
    const result = validator.validate('document_supported', ['CORRUPT_doc.pdf']);
    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBe(2);
  });

  // ── platform_verified ──────────────────────────────────────────────────

  it('platform_verified: passes with 3+ clean docs', () => {
    const result = validator.validate('platform_verified', [
      'id_doc.pdf',
      'business_license.pdf',
      'tax_certificate.pdf',
    ]);
    expect(result.valid).toBe(true);
  });

  it('platform_verified: fails on expired doc', () => {
    const result = validator.validate('platform_verified', [
      'id_doc.pdf',
      'business_license.pdf',
      'EXPIRED_insurance.pdf',
    ]);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('Expired'))).toBe(true);
    expect(result.missingDocuments.includes('EXPIRED_insurance.pdf')).toBe(true);
  });

  it('platform_verified: fails on insufficient + hash + expiry', () => {
    const result = validator.validate('platform_verified', [
      'INVALID_expired_doc.pdf',
    ]);
    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBe(3);
  });

  // ── acquisition_ready ──────────────────────────────────────────────────

  it('acquisition_ready: passes with legal anchor doc present', () => {
    const result = validator.validate('acquisition_ready', [
      'id_doc.pdf',
      'financials.pdf',
      'legal_contract.pdf',
    ]);
    expect(result.valid).toBe(true);
  });

  it('acquisition_ready: passes with title document', () => {
    const result = validator.validate('acquisition_ready', [
      'id_doc.pdf',
      'financials.pdf',
      'title_deed.pdf',
    ]);
    expect(result.valid).toBe(true);
  });

  it('acquisition_ready: fails without legal anchor', () => {
    const result = validator.validate('acquisition_ready', [
      'id_doc.pdf',
      'financials.pdf',
      'tax_cert.pdf',
    ]);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes('Legal anchor'))).toBe(true);
    expect(result.missingDocuments.includes('legal_anchor_document')).toBe(true);
  });

  it('acquisition_ready: fails all checks — insufficient, invalid, expired, no anchor', () => {
    const result = validator.validate('acquisition_ready', [
      'invalid_id.pdf',
    ]);
    expect(result.valid).toBe(false);
    // insufficient (1 of 3), hash failure, expiry (count >= 3 passes since 1 < 3), legal anchor
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Deal Room Engine — 13 State Transitions
// ═════════════════════════════════════════════════════════════════════════════

describe('DealRoomEngine', () => {

  function mk() {
    const engine = new DealRoomEngine();
    const deal = engine.createDeal(1, 100, 200, 250000, 'Standard terms');
    return { engine, deal };
  }

  // ── Creation ────────────────────────────────────────────────────────────

  it('creates a deal in "created" state', () => {
    const engine = new DealRoomEngine();
    const deal = engine.createDeal(1, 100, 200, 500000, 'Terms');
    expect(deal.state).toBe('created');
    expect(deal.amountCents).toBe(500000);
    expect(deal.events.length).toBe(1);
    expect(deal.events[0].action).toBe('deal_created');
  });

  // ── Transition 1: created → offer_submitted ────────────────────────────

  it('created → offer_submitted via submitOffer', () => {
    const { engine, deal } = mk();
    const updated = engine.submitOffer(deal.id, 300000, 'Updated terms');
    expect(updated.state).toBe('offer_submitted');
    expect(updated.amountCents).toBe(300000);
    expect(updated.terms).toBe('Updated terms');
    expect(updated.events.length).toBe(2);
  });

  // ── Transition 2: offer_submitted → offer_accepted ─────────────────────

  it('offer_submitted → offer_accepted via acceptOffer', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    const accepted = engine.acceptOffer(deal.id);
    expect(accepted.state).toBe('offer_accepted');
  });

  // ── Transition 3: offer_accepted → due_diligence ───────────────────────

  it('offer_accepted → due_diligence', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    const dd = engine.advanceDueDiligence(deal.id);
    expect(dd.state).toBe('due_diligence');
  });

  // ── Transition 4: due_diligence → terms_negotiated ─────────────────────

  it('due_diligence → terms_negotiated', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    const tn = engine.advanceTermsNegotiated(deal.id);
    expect(tn.state).toBe('terms_negotiated');
  });

  // ── Transition 5: terms_negotiated → terms_agreed ──────────────────────

  it('terms_negotiated → terms_agreed', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    engine.advanceTermsNegotiated(deal.id);
    const ta = engine.advanceTermsAgreed(deal.id);
    expect(ta.state).toBe('terms_agreed');
  });

  // ── Transition 6: terms_agreed → escrow_funded ────────────────────────

  it('terms_agreed → escrow_funded via fundEscrow', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    engine.advanceTermsNegotiated(deal.id);
    engine.advanceTermsAgreed(deal.id);
    const funded = engine.fundEscrow(deal.id, '0xabc123');
    expect(funded.state).toBe('escrow_funded');
    expect(funded.escrowTxHash).toBe('0xabc123');
  });

  // ── Transition 7: escrow_funded → legal_review ─────────────────────────

  it('escrow_funded → legal_review', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    engine.advanceTermsNegotiated(deal.id);
    engine.advanceTermsAgreed(deal.id);
    engine.fundEscrow(deal.id, '0xabc123');
    const lr = engine.advanceLegalReview(deal.id);
    expect(lr.state).toBe('legal_review');
  });

  // ── Transition 8: legal_review → closing ───────────────────────────────

  it('legal_review → closing', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    engine.advanceTermsNegotiated(deal.id);
    engine.advanceTermsAgreed(deal.id);
    engine.fundEscrow(deal.id, '0xabc123');
    engine.advanceLegalReview(deal.id);
    const closing = engine.advanceClosing(deal.id);
    expect(closing.state).toBe('closing');
  });

  // ── Transition 9: closing → completed via closeDeal ────────────────────

  it('closing → completed via closeDeal', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    engine.advanceTermsNegotiated(deal.id);
    engine.advanceTermsAgreed(deal.id);
    engine.fundEscrow(deal.id, '0xabc123');
    engine.advanceLegalReview(deal.id);
    engine.advanceClosing(deal.id);
    const completed = engine.closeDeal(deal.id);
    expect(completed.state).toBe('completed');
    expect(completed.completedAt).toBeTruthy();
    // completed is terminal — no further transitions
    expect(() => engine.closeDeal(deal.id)).toThrow();
  });

  // ── Transition 10: offer_submitted → rejected ──────────────────────────

  it('offer_submitted → rejected', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    const rejected = engine.rejectDeal(deal.id);
    expect(rejected.state).toBe('rejected');
    // terminal
    expect(() => engine.acceptOffer(deal.id)).toThrow();
  });

  // ── Transition 11: any pre-terminal → cancelled ────────────────────────

  it('due_diligence → cancelled', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    const cancelled = engine.cancelDeal(deal.id);
    expect(cancelled.state).toBe('cancelled');
    // terminal
    expect(() => engine.advanceTermsNegotiated(deal.id)).toThrow();
  });

  it('escrow_funded → cancelled', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    engine.advanceTermsNegotiated(deal.id);
    engine.advanceTermsAgreed(deal.id);
    engine.fundEscrow(deal.id, '0xabc123');
    const cancelled = engine.cancelDeal(deal.id);
    expect(cancelled.state).toBe('cancelled');
  });

  // ── Transition 12: offer_submitted → expired ───────────────────────────

  it('offer_submitted → expired', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    const expired = engine.expireDeal(deal.id);
    expect(expired.state).toBe('expired');
    // terminal — cannot accept after expiry
    expect(() => engine.acceptOffer(deal.id)).toThrow();
  });

  // ── counterOffer ───────────────────────────────────────────────────────

  it('counterOffer: stays in offer_submitted, updates counter amount', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    const countered = engine.counterOffer(deal.id, 275000);
    expect(countered.state).toBe('offer_submitted');
    expect(countered.counterAmountCents).toBe(275000);
    // Still can accept after counter
    const accepted = engine.acceptOffer(deal.id);
    expect(accepted.state).toBe('offer_accepted');
  });

  it('counterOffer: throws from non-offer_submitted', () => {
    const { engine, deal } = mk();
    expect(() => engine.counterOffer(deal.id, 300000)).toThrow();
  });

  // ── Invalid transitions ────────────────────────────────────────────────

  it('throws on invalid transition', () => {
    const { engine, deal } = mk();
    // cannot accept offer before submitting one
    expect(() => engine.acceptOffer(deal.id)).toThrow();
  });

  it('throws on skip-ahead transition', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    // cannot jump from offer_submitted → escrow_funded
    expect(() => engine.fundEscrow(deal.id, '0xabc')).toThrow();
  });

  it('throws on non-existent deal', () => {
    const engine = new DealRoomEngine();
    expect(() => engine.submitOffer('nonexistent', 100000)).toThrow();
  });

  // ── Event system ───────────────────────────────────────────────────────

  it('emits state_change and state: events', () => {
    const engine = new DealRoomEngine();
    let stateChanges = 0;
    let offerSubmittedEvent = 0;

    engine.on('state_change', () => { stateChanges++; });
    engine.on('state:offer_submitted', () => { offerSubmittedEvent++; });

    const deal = engine.createDeal(1, 100, 200, 250000, 'Standard terms');
    // createDeal emits no events, so counters should be 0 before submit
    expect(stateChanges).toBe(0);
    engine.submitOffer(deal.id, 250000);

    expect(stateChanges).toBe(1);
    expect(offerSubmittedEvent).toBe(1);
  });

  // ── Full happy-path walkthrough ────────────────────────────────────────

  it('full 9-step happy path: created → completed', () => {
    const { engine, deal } = mk();

    // 1: create (already done)
    expect(deal.state).toBe('created');

    // 2: submitOffer
    engine.submitOffer(deal.id, 250000, 'Standard acquisition');
    expect(engine.getDeal(deal.id)?.state).toBe('offer_submitted');

    // 3: acceptOffer
    engine.acceptOffer(deal.id);
    expect(engine.getDeal(deal.id)?.state).toBe('offer_accepted');

    // 4: due diligence
    engine.advanceDueDiligence(deal.id);
    expect(engine.getDeal(deal.id)?.state).toBe('due_diligence');

    // 5: terms
    engine.advanceTermsNegotiated(deal.id);
    expect(engine.getDeal(deal.id)?.state).toBe('terms_negotiated');

    // 6: agreed
    engine.advanceTermsAgreed(deal.id);
    expect(engine.getDeal(deal.id)?.state).toBe('terms_agreed');

    // 7: escrow
    engine.fundEscrow(deal.id, '0xdeadbeef');
    expect(engine.getDeal(deal.id)?.state).toBe('escrow_funded');

    // 8: legal
    engine.advanceLegalReview(deal.id);
    expect(engine.getDeal(deal.id)?.state).toBe('legal_review');

    // 9: closing
    engine.advanceClosing(deal.id);
    expect(engine.getDeal(deal.id)?.state).toBe('closing');

    // 10: complete
    const completed = engine.closeDeal(deal.id);
    expect(completed.state).toBe('completed');
    expect(completed.completedAt).toBeTruthy();

    const fetched = engine.getDeal(deal.id)!;
    expect(fetched.events.length).toBe(10); // 1 creation + 9 actions
  });

  // ── getDeal returns undefined for bad ID ───────────────────────────────

  it('getDeal returns undefined for unknown id', () => {
    const engine = new DealRoomEngine();
    expect(engine.getDeal('nonexistent')).toBeUndefined();
  });
});
