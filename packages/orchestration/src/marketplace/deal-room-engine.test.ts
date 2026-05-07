// L3 Marketplace Tests: EvidenceValidator + DealRoomEngine
import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { EvidenceValidator, DealRoomEngine } from './index.js';
import type { EvidenceTier } from './index.js';

// ═════════════════════════════════════════════════════════════════════════════
// Evidence Validator
// ═════════════════════════════════════════════════════════════════════════════

describe('EvidenceValidator', () => {
  const validator = new EvidenceValidator();

  // ── self_reported ─────────────────────────────────────────────────────

  it('self_reported: passes with 1 document', () => {
    const result = validator.validate('self_reported', ['id_doc.pdf']);
    assert.equal(result.valid, true);
    assert.deepEqual(result.missingDocuments, []);
    assert.deepEqual(result.reasons, []);
  });

  it('self_reported: passes with 2+ documents', () => {
    const result = validator.validate('self_reported', ['id_doc.pdf', 'business_license.pdf']);
    assert.equal(result.valid, true);
  });

  it('self_reported: fails with 0 documents', () => {
    const result = validator.validate('self_reported', []);
    assert.equal(result.valid, false);
    assert.ok(result.missingDocuments.length >= 1);
    assert.ok(result.reasons.some((r) => r.includes('Insufficient documents')));
  });

  // ── document_supported ─────────────────────────────────────────────────

  it('document_supported: passes with 2 clean documents', () => {
    const result = validator.validate('document_supported', ['id_doc.pdf', 'business_license.pdf']);
    assert.equal(result.valid, true);
  });

  it('document_supported: fails with 1 document', () => {
    const result = validator.validate('document_supported', ['id_doc.pdf']);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes('Insufficient documents')));
    assert.equal(result.missingDocuments.length, 1);
  });

  it('document_supported: fails on hash verification with invalid doc', () => {
    const result = validator.validate('document_supported', ['id_doc.pdf', 'invalid_hash_doc.pdf']);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes('Hash verification failed')));
    assert.ok(result.missingDocuments.includes('invalid_hash_doc.pdf'));
  });

  it('document_supported: fails on corrupt doc', () => {
    const result = validator.validate('document_supported', ['id_doc.pdf', 'corrupt_file.pdf']);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes('Hash verification failed')));
    assert.ok(result.missingDocuments.includes('corrupt_file.pdf'));
  });

  it('document_supported: fails on both insufficient and hash', () => {
    const result = validator.validate('document_supported', ['CORRUPT_doc.pdf']);
    assert.equal(result.valid, false);
    assert.equal(result.reasons.length, 2);
  });

  // ── platform_verified ──────────────────────────────────────────────────

  it('platform_verified: passes with 3+ clean docs', () => {
    const result = validator.validate('platform_verified', [
      'id_doc.pdf',
      'business_license.pdf',
      'tax_certificate.pdf',
    ]);
    assert.equal(result.valid, true);
  });

  it('platform_verified: fails on expired doc', () => {
    const result = validator.validate('platform_verified', [
      'id_doc.pdf',
      'business_license.pdf',
      'EXPIRED_insurance.pdf',
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes('Expired')));
    assert.ok(result.missingDocuments.includes('EXPIRED_insurance.pdf'));
  });

  it('platform_verified: fails on insufficient + hash + expiry', () => {
    const result = validator.validate('platform_verified', [
      'INVALID_expired_doc.pdf',
    ]);
    assert.equal(result.valid, false);
    assert.equal(result.reasons.length, 3);
  });

  // ── acquisition_ready ──────────────────────────────────────────────────

  it('acquisition_ready: passes with legal anchor doc present', () => {
    const result = validator.validate('acquisition_ready', [
      'id_doc.pdf',
      'financials.pdf',
      'legal_contract.pdf',
    ]);
    assert.equal(result.valid, true);
  });

  it('acquisition_ready: passes with title document', () => {
    const result = validator.validate('acquisition_ready', [
      'id_doc.pdf',
      'financials.pdf',
      'title_deed.pdf',
    ]);
    assert.equal(result.valid, true);
  });

  it('acquisition_ready: fails without legal anchor', () => {
    const result = validator.validate('acquisition_ready', [
      'id_doc.pdf',
      'financials.pdf',
      'tax_cert.pdf',
    ]);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes('Legal anchor')));
    assert.ok(result.missingDocuments.includes('legal_anchor_document'));
  });

  it('acquisition_ready: fails all checks — insufficient, invalid, expired, no anchor', () => {
    const result = validator.validate('acquisition_ready', [
      'invalid_id.pdf',
    ]);
    assert.equal(result.valid, false);
    // insufficient (1 of 3), hash failure, expiry (count >= 3 passes since 1 < 3), legal anchor
    assert.ok(result.reasons.length >= 3);
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
    assert.equal(deal.state, 'created');
    assert.equal(deal.amountCents, 500000);
    assert.equal(deal.events.length, 1);
    assert.equal(deal.events[0].action, 'deal_created');
  });

  // ── Transition 1: created → offer_submitted ────────────────────────────

  it('created → offer_submitted via submitOffer', () => {
    const { engine, deal } = mk();
    const updated = engine.submitOffer(deal.id, 300000, 'Updated terms');
    assert.equal(updated.state, 'offer_submitted');
    assert.equal(updated.amountCents, 300000);
    assert.equal(updated.terms, 'Updated terms');
    assert.equal(updated.events.length, 2);
  });

  // ── Transition 2: offer_submitted → offer_accepted ─────────────────────

  it('offer_submitted → offer_accepted via acceptOffer', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    const accepted = engine.acceptOffer(deal.id);
    assert.equal(accepted.state, 'offer_accepted');
  });

  // ── Transition 3: offer_accepted → due_diligence ───────────────────────

  it('offer_accepted → due_diligence', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    const dd = engine.advanceDueDiligence(deal.id);
    assert.equal(dd.state, 'due_diligence');
  });

  // ── Transition 4: due_diligence → terms_negotiated ─────────────────────

  it('due_diligence → terms_negotiated', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    const tn = engine.advanceTermsNegotiated(deal.id);
    assert.equal(tn.state, 'terms_negotiated');
  });

  // ── Transition 5: terms_negotiated → terms_agreed ──────────────────────

  it('terms_negotiated → terms_agreed', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    engine.advanceTermsNegotiated(deal.id);
    const ta = engine.advanceTermsAgreed(deal.id);
    assert.equal(ta.state, 'terms_agreed');
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
    assert.equal(funded.state, 'escrow_funded');
    assert.equal(funded.escrowTxHash, '0xabc123');
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
    assert.equal(lr.state, 'legal_review');
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
    assert.equal(closing.state, 'closing');
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
    assert.equal(completed.state, 'completed');
    assert.ok(completed.completedAt);
    // completed is terminal — no further transitions
    assert.throws(() => engine.closeDeal(deal.id));
  });

  // ── Transition 10: offer_submitted → rejected ──────────────────────────

  it('offer_submitted → rejected', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    const rejected = engine.rejectDeal(deal.id);
    assert.equal(rejected.state, 'rejected');
    // terminal
    assert.throws(() => engine.acceptOffer(deal.id));
  });

  // ── Transition 11: any pre-terminal → cancelled ────────────────────────

  it('due_diligence → cancelled', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    engine.acceptOffer(deal.id);
    engine.advanceDueDiligence(deal.id);
    const cancelled = engine.cancelDeal(deal.id);
    assert.equal(cancelled.state, 'cancelled');
    // terminal
    assert.throws(() => engine.advanceTermsNegotiated(deal.id));
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
    assert.equal(cancelled.state, 'cancelled');
  });

  // ── Transition 12: offer_submitted → expired ───────────────────────────

  it('offer_submitted → expired', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    const expired = engine.expireDeal(deal.id);
    assert.equal(expired.state, 'expired');
    // terminal — cannot accept after expiry
    assert.throws(() => engine.acceptOffer(deal.id));
  });

  // ── counterOffer ───────────────────────────────────────────────────────

  it('counterOffer: stays in offer_submitted, updates counter amount', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    const countered = engine.counterOffer(deal.id, 275000);
    assert.equal(countered.state, 'offer_submitted');
    assert.equal(countered.counterAmountCents, 275000);
    // Still can accept after counter
    const accepted = engine.acceptOffer(deal.id);
    assert.equal(accepted.state, 'offer_accepted');
  });

  it('counterOffer: throws from non-offer_submitted', () => {
    const { engine, deal } = mk();
    assert.throws(() => engine.counterOffer(deal.id, 300000));
  });

  // ── Invalid transitions ────────────────────────────────────────────────

  it('throws on invalid transition', () => {
    const { engine, deal } = mk();
    // cannot accept offer before submitting one
    assert.throws(() => engine.acceptOffer(deal.id));
  });

  it('throws on skip-ahead transition', () => {
    const { engine, deal } = mk();
    engine.submitOffer(deal.id, 250000);
    // cannot jump from offer_submitted → escrow_funded
    assert.throws(() => engine.fundEscrow(deal.id, '0xabc'));
  });

  it('throws on non-existent deal', () => {
    const engine = new DealRoomEngine();
    assert.throws(() => engine.submitOffer('nonexistent', 100000));
  });

  // ── Event system ───────────────────────────────────────────────────────

  it('emits state_change and state: events', { concurrency: false }, () => {
    const engine = new DealRoomEngine();
    let stateChanges = 0;
    let offerSubmittedEvent = 0;

    engine.on('state_change', () => { stateChanges++; });
    engine.on('state:offer_submitted', () => { offerSubmittedEvent++; });

    const deal = engine.createDeal(1, 100, 200, 250000, 'Standard terms');
    // createDeal emits no events, so counters should be 0 before submit
    assert.equal(stateChanges, 0);
    engine.submitOffer(deal.id, 250000);

    assert.equal(stateChanges, 1);
    assert.equal(offerSubmittedEvent, 1);
  });

  // ── Full happy-path walkthrough ────────────────────────────────────────

  it('full 9-step happy path: created → completed', () => {
    const { engine, deal } = mk();

    // 1: create (already done)
    assert.equal(deal.state, 'created');

    // 2: submitOffer
    engine.submitOffer(deal.id, 250000, 'Standard acquisition');
    assert.equal(engine.getDeal(deal.id)?.state, 'offer_submitted');

    // 3: acceptOffer
    engine.acceptOffer(deal.id);
    assert.equal(engine.getDeal(deal.id)?.state, 'offer_accepted');

    // 4: due diligence
    engine.advanceDueDiligence(deal.id);
    assert.equal(engine.getDeal(deal.id)?.state, 'due_diligence');

    // 5: terms
    engine.advanceTermsNegotiated(deal.id);
    assert.equal(engine.getDeal(deal.id)?.state, 'terms_negotiated');

    // 6: agreed
    engine.advanceTermsAgreed(deal.id);
    assert.equal(engine.getDeal(deal.id)?.state, 'terms_agreed');

    // 7: escrow
    engine.fundEscrow(deal.id, '0xdeadbeef');
    assert.equal(engine.getDeal(deal.id)?.state, 'escrow_funded');

    // 8: legal
    engine.advanceLegalReview(deal.id);
    assert.equal(engine.getDeal(deal.id)?.state, 'legal_review');

    // 9: closing
    engine.advanceClosing(deal.id);
    assert.equal(engine.getDeal(deal.id)?.state, 'closing');

    // 10: complete
    const completed = engine.closeDeal(deal.id);
    assert.equal(completed.state, 'completed');
    assert.ok(completed.completedAt);

    const fetched = engine.getDeal(deal.id)!;
    assert.equal(fetched.events.length, 10); // 1 creation + 9 actions
  });

  // ── getDeal returns undefined for bad ID ───────────────────────────────

  it('getDeal returns undefined for unknown id', () => {
    const engine = new DealRoomEngine();
    assert.equal(engine.getDeal('nonexistent'), undefined);
  });
});
