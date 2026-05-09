// ProtocolRouter — Multi-Protocol Agent Mesh
//
// Provides a unified payment-routing layer that abstracts away protocol differences,
// optimizes route selection across cost/speed/reliability axes, and tracks cross-
// protocol settlements through an embedded AuditStore.
//
// Once tenants build workflows that span Stripe Connect, ACH, and USDC rails,
// switching costs are prohibitive — this is Moat 10.

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ProtocolAdapter {
  protocolId: string;
  protocolName: string;
  capabilities: {
    supportsInstantSettlement: boolean;
    supportsRecurring: boolean;
    supportsInternational: boolean;
    maxTransactionCents: number;
    supportedCurrencies: string[];
  };
  feeStructure: {
    flatFeeCents: number;
    /** e.g. 0.029 for 2.9 % */
    percentageFee: number;
    internationalMarkup: number;
  };
  /** Estimated end-to-end settlement in milliseconds. */
  estimatedSettlementTimeMs: number;

  initiatePayment(params: PaymentParams): Promise<PaymentResult>;
  verifyPayment(paymentId: string): Promise<PaymentVerification>;
  refundPayment(paymentId: string, amountCents: number): Promise<PaymentResult>;
}

export interface PaymentParams {
  amountCents: number;
  currency: string;
  /** Customer / sender identifier. */
  sourceId: string;
  /** Merchant / recipient identifier. */
  destinationId: string;
  description: string;
  metadata: Record<string, unknown>;
  urgency: 'normal' | 'urgent' | 'critical';
}

export interface PaymentResult {
  paymentId: string;
  protocolId: string;
  status: 'initiated' | 'processing' | 'completed' | 'failed';
  /** Protocol-specific tracking reference. */
  trackingRef: string;
  estimatedSettlementMs: number;
  feeBreakdown: {
    flatCents: number;
    percentageCents: number;
    totalCents: number;
  };
  initiatedAt: number;
}

export interface PaymentVerification {
  paymentId: string;
  verified: boolean;
  status: PaymentResult['status'];
  settledAt: number | null;
  failureReason?: string;
}

export interface RouteRecommendation {
  protocolId: string;
  totalCostCents: number;
  estimatedSettlementMs: number;
  /** 0-1 optimisation score (weighted cost + speed + reliability). */
  score: number;
  reasoning: string[];
  alternative: Array<{
    protocolId: string;
    totalCostCents: number;
    estimatedSettlementMs: number;
    score: number;
  }>;
}

export interface ProtocolStatus {
  id: string;
  healthy: boolean;
  latencyMs: number;
  volumeCents: number;
}

// ---------------------------------------------------------------------------
// AuditStore — embedded settlement tracker
// ---------------------------------------------------------------------------

interface SettlementRecord {
  settlementId: string;
  paymentId: string;
  protocolId: string;
  amountCents: number;
  currency: string;
  direction: 'in' | 'out';
  status: PaymentResult['status'];
  trackingRef: string;
  createdAt: number;
  settledAt: number | null;
}

class AuditStore {
  #records: Map<string, SettlementRecord> = new Map();

  record(entry: SettlementRecord): void {
    this.#records.set(entry.settlementId, { ...entry });
  }

  update(
    settlementId: string,
    patch: Partial<Pick<SettlementRecord, 'status' | 'settledAt'>>,
  ): boolean {
    const existing = this.#records.get(settlementId);
    if (!existing) return false;
    this.#records.set(settlementId, { ...existing, ...patch });
    return true;
  }

  getByPaymentId(paymentId: string): SettlementRecord[] {
    const results: SettlementRecord[] = [];
    for (const rec of this.#records.values()) {
      if (rec.paymentId === paymentId) results.push(rec);
    }
    return results;
  }

  getByProtocol(protocolId: string): SettlementRecord[] {
    const results: SettlementRecord[] = [];
    for (const rec of this.#records.values()) {
      if (rec.protocolId === protocolId) results.push(rec);
    }
    return results;
  }

  /** Total settled volume in cents, grouped by protocol. */
  volumeByProtocol(): Map<string, number> {
    const vol = new Map<string, number>();
    for (const rec of this.#records.values()) {
      if (rec.status !== 'completed') continue;
      vol.set(rec.protocolId, (vol.get(rec.protocolId) ?? 0) + rec.amountCents);
    }
    return vol;
  }

  /** Number of records in the store (useful for tests / monitoring). */
  get size(): number {
    return this.#records.size;
  }
}

// ---------------------------------------------------------------------------
// Mock protocol adapters
// ---------------------------------------------------------------------------

const makePaymentId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const stubFeeBreakdown = (
  adapter: ProtocolAdapter,
  amountCents: number,
  isInternational: boolean,
): PaymentResult['feeBreakdown'] => {
  const percentageCents = Math.round(
    amountCents * (adapter.feeStructure.percentageFee + (isInternational ? adapter.feeStructure.internationalMarkup : 0)),
  );
  const flatCents = adapter.feeStructure.flatFeeCents;
  return { flatCents, percentageCents, totalCents: flatCents + percentageCents };
};

const resolveAfter = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function createStripeAdapter(): ProtocolAdapter {
  return {
    protocolId: 'stripe',
    protocolName: 'Stripe Connect',
    capabilities: {
      supportsInstantSettlement: false,
      supportsRecurring: true,
      supportsInternational: true,
      maxTransactionCents: 999_999_99, // $999,999.99
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'],
    },
    feeStructure: { flatFeeCents: 30, percentageFee: 0.029, internationalMarkup: 0.015 },
    estimatedSettlementTimeMs: 2 * 24 * 60 * 60 * 1000, // T+2

    async initiatePayment(params: PaymentParams): Promise<PaymentResult> {
      const isIntl = params.currency !== 'USD';
      const fee = stubFeeBreakdown(this, params.amountCents, isIntl);
      return {
        paymentId: makePaymentId('stripe'),
        protocolId: 'stripe',
        status: 'initiated',
        trackingRef: `ch_${Math.random().toString(36).slice(2, 14)}`,
        estimatedSettlementMs: isIntl ? 5 * 24 * 60 * 60 * 1000 : this.estimatedSettlementTimeMs,
        feeBreakdown: fee,
        initiatedAt: Date.now(),
      };
    },

    async verifyPayment(paymentId: string): Promise<PaymentVerification> {
      return { paymentId, verified: true, status: 'processing', settledAt: null };
    },

    async refundPayment(paymentId: string, amountCents: number): Promise<PaymentResult> {
      return {
        paymentId: makePaymentId('stripe_refund'),
        protocolId: 'stripe',
        status: 'initiated',
        trackingRef: `re_${Math.random().toString(36).slice(2, 14)}`,
        estimatedSettlementMs: 5 * 24 * 60 * 60 * 1000,
        feeBreakdown: stubFeeBreakdown(this, amountCents, false),
        initiatedAt: Date.now(),
      };
    },
  };
}

function createACHAdapter(): ProtocolAdapter {
  return {
    protocolId: 'ach',
    protocolName: 'ACH Direct',
    capabilities: {
      supportsInstantSettlement: false,
      supportsRecurring: true,
      supportsInternational: false,
      maxTransactionCents: 25_000_00, // $25,000
      supportedCurrencies: ['USD'],
    },
    feeStructure: { flatFeeCents: 25, percentageFee: 0.005, internationalMarkup: 0 },
    estimatedSettlementTimeMs: 3 * 24 * 60 * 60 * 1000, // ~3 business days

    async initiatePayment(params: PaymentParams): Promise<PaymentResult> {
      const fee = stubFeeBreakdown(this, params.amountCents, false);
      return {
        paymentId: makePaymentId('ach'),
        protocolId: 'ach',
        status: 'initiated',
        trackingRef: `ACH-${Math.random().toString(36).slice(2, 14).toUpperCase()}`,
        estimatedSettlementMs: this.estimatedSettlementTimeMs,
        feeBreakdown: fee,
        initiatedAt: Date.now(),
      };
    },

    async verifyPayment(paymentId: string): Promise<PaymentVerification> {
      return { paymentId, verified: true, status: 'processing', settledAt: null };
    },

    async refundPayment(paymentId: string, amountCents: number): Promise<PaymentResult> {
      return {
        paymentId: makePaymentId('ach_refund'),
        protocolId: 'ach',
        status: 'initiated',
        trackingRef: `ACH-R-${Math.random().toString(36).slice(2, 14).toUpperCase()}`,
        estimatedSettlementMs: 5 * 24 * 60 * 60 * 1000,
        feeBreakdown: stubFeeBreakdown(this, amountCents, false),
        initiatedAt: Date.now(),
      };
    },
  };
}

function createUSDCAdapter(): ProtocolAdapter {
  return {
    protocolId: 'usdc',
    protocolName: 'USDC (Crypto)',
    capabilities: {
      supportsInstantSettlement: true,
      supportsRecurring: false,
      supportsInternational: true,
      maxTransactionCents: 10_000_000_00, // $10M
      supportedCurrencies: ['USDC', 'USD'],
    },
    feeStructure: { flatFeeCents: 50, percentageFee: 0.001, internationalMarkup: 0 },
    estimatedSettlementTimeMs: 30_000, // ~30 seconds on-chain

    async initiatePayment(params: PaymentParams): Promise<PaymentResult> {
      const isIntl = params.currency !== 'USD' && params.currency !== 'USDC';
      const fee = stubFeeBreakdown(this, params.amountCents, isIntl);
      return {
        paymentId: makePaymentId('usdc'),
        protocolId: 'usdc',
        status: 'initiated',
        trackingRef: `0x${Math.random().toString(16).slice(2, 42)}`,
        estimatedSettlementMs: this.estimatedSettlementTimeMs,
        feeBreakdown: fee,
        initiatedAt: Date.now(),
      };
    },

    async verifyPayment(paymentId: string): Promise<PaymentVerification> {
      return { paymentId, verified: true, status: 'processing', settledAt: null };
    },

    async refundPayment(paymentId: string, amountCents: number): Promise<PaymentResult> {
      return {
        paymentId: makePaymentId('usdc_refund'),
        protocolId: 'usdc',
        status: 'initiated',
        trackingRef: `0x${Math.random().toString(16).slice(2, 42)}`,
        estimatedSettlementMs: 30_000,
        feeBreakdown: stubFeeBreakdown(this, amountCents, false),
        initiatedAt: Date.now(),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Route optimisation engine
// ---------------------------------------------------------------------------

/** Scoring weights — cost dominates (60 %), speed (30 %), reliability (10 %). */
const COST_WEIGHT = 0.6;
const SPEED_WEIGHT = 0.3;
const RELIABILITY_WEIGHT = 0.1;

/** Maximum realistic settlement time used to normalise speed scores (7 days in ms). */
const MAX_SETTLEMENT_MS = 7 * 24 * 60 * 60 * 1000;

/** Reliability baseline per protocol — backed by historical uptime data. */
const RELIABILITY_BASELINE: Record<string, number> = {
  stripe: 0.999,
  ach: 0.997,
  usdc: 0.995,
};

function computeOptimisationScore(
  totalCostCents: number,
  estimatedSettlementMs: number,
  protocolId: string,
  maxCostCents: number,
): number {
  // Normalise cost — lower is better.
  const costNorm = maxCostCents > 0 ? totalCostCents / maxCostCents : 0;
  const costScore = 1 - Math.min(costNorm, 1);

  // Normalise speed — lower is better, clamped to MAX_SETTLEMENT_MS.
  const settlementClamped = Math.min(estimatedSettlementMs, MAX_SETTLEMENT_MS);
  const speedScore = 1 - settlementClamped / MAX_SETTLEMENT_MS;

  // Reliability — higher is better, already in [0, 1].
  const reliabilityScore = RELIABILITY_BASELINE[protocolId] ?? 0.99;

  return costScore * COST_WEIGHT + speedScore * SPEED_WEIGHT + reliabilityScore * RELIABILITY_WEIGHT;
}

// ---------------------------------------------------------------------------
// ProtocolRouter
// ---------------------------------------------------------------------------

export class ProtocolRouter {
  #adapters: Map<string, ProtocolAdapter> = new Map();
  #audit: AuditStore = new AuditStore();
  #healthState: Map<string, { healthy: boolean; lastLatencyMs: number; volumeCents: number }> = new Map();
  #retryBudget: Map<string, number> = new Map(); // protocolId → remaining retries before backoff
  static readonly MAX_RETRIES = 3;
  static readonly RETRY_WINDOW_MS = 60_000;

  // ---- Registration ---------------------------------------------------

  /**
   * Register a new protocol adapter. If a protocol with the same id already
   * exists it is replaced (upsert semantics).
   */
  registerProtocol(adapter: ProtocolAdapter): void {
    this.#adapters.set(adapter.protocolId, adapter);
    if (!this.#healthState.has(adapter.protocolId)) {
      this.#healthState.set(adapter.protocolId, { healthy: true, lastLatencyMs: 0, volumeCents: 0 });
    }
    if (!this.#retryBudget.has(adapter.protocolId)) {
      this.#retryBudget.set(adapter.protocolId, ProtocolRouter.MAX_RETRIES);
    }
  }

  // ---- Convenience — register the 3 built-in mock adapters ------------

  buildInAdapters(): void {
    this.registerProtocol(createStripeAdapter());
    this.registerProtocol(createACHAdapter());
    this.registerProtocol(createUSDCAdapter());
  }

  // ---- Routing ---------------------------------------------------------

  /**
   * Select the best protocol for the given payment parameters.
   *
   * The optimisation function weights cost at 60 %, speed at 30 %, and
   * reliability at 10 %.  Every registered protocol is scored and the caller
   * receives the primary recommendation plus every alternative.
   */
  routePayment(params: PaymentParams): RouteRecommendation {
    const candidates = Array.from(this.#adapters.values()).filter((a) => {
      const healthy = this.#healthState.get(a.protocolId)?.healthy ?? true;
      if (!healthy) return false;
      if (params.amountCents > a.capabilities.maxTransactionCents) return false;
      if (!a.capabilities.supportedCurrencies.includes(params.currency)) return false;
      if (!a.capabilities.supportsInternational && params.currency !== 'USD') return false;
      return true;
    });

    if (candidates.length === 0) {
      throw new Error(
        `No protocol supports the requested payment (amount=${params.amountCents}, currency=${params.currency})`,
      );
    }

    const scored = candidates.map((a) => {
      const isIntl = params.currency !== 'USD';
      const percentageCents = Math.round(
        params.amountCents *
          (a.feeStructure.percentageFee + (isIntl ? a.feeStructure.internationalMarkup : 0)),
      );
      const flatCents = a.feeStructure.flatFeeCents;
      const totalCostCents = flatCents + percentageCents;

      let settlementMs = a.estimatedSettlementTimeMs;
      if (isIntl && a.capabilities.supportsInternational) {
        // International wires/A CH may add 1–2 extra days.
        settlementMs += 2 * 24 * 60 * 60 * 1000;
      }

      return {
        protocolId: a.protocolId,
        totalCostCents,
        estimatedSettlementMs: settlementMs,
        score: 0, // computed after we know the max cost
        adapter: a,
        isIntl,
      };
    });

    const maxCostCents = Math.max(...scored.map((s) => s.totalCostCents), 1);

    const ranked = scored
      .map((s) => ({
        protocolId: s.protocolId,
        totalCostCents: s.totalCostCents,
        estimatedSettlementMs: s.estimatedSettlementMs,
        score: computeOptimisationScore(s.totalCostCents, s.estimatedSettlementMs, s.protocolId, maxCostCents),
        reasoning: buildReasoning(s.adapter, params, s.totalCostCents, s.estimatedSettlementMs, s.isIntl),
      }))
      .sort((a, b) => b.score - a.score);

    const [primary, ...rest] = ranked;
    return {
      protocolId: primary.protocolId,
      totalCostCents: primary.totalCostCents,
      estimatedSettlementMs: primary.estimatedSettlementMs,
      score: Math.round(primary.score * 1e4) / 1e4,
      reasoning: primary.reasoning,
      alternative: rest.map((r) => ({
        protocolId: r.protocolId,
        totalCostCents: r.totalCostCents,
        estimatedSettlementMs: r.estimatedSettlementMs,
        score: Math.round(r.score * 1e4) / 1e4,
      })),
    };
  }

  // ---- Execution -------------------------------------------------------

  /**
   * Route *and* execute a payment through the best protocol.
   *
   * On failure the router will try the next-best alternative up to
   * `MAX_RETRIES` times.  Every attempt is recorded in the audit store.
   */
  async executePayment(params: PaymentParams): Promise<PaymentResult> {
    const route = this.routePayment(params);
    const protocolIds = [route.protocolId, ...route.alternative.map((a) => a.protocolId)];
    const errors: Error[] = [];

    for (let i = 0; i < Math.min(protocolIds.length, ProtocolRouter.MAX_RETRIES + 1); i++) {
      const pid = protocolIds[i];
      const adapter = this.#adapters.get(pid);
      if (!adapter) {
        errors.push(new Error(`Protocol ${pid} not registered`));
        continue;
      }

      const budget = this.#retryBudget.get(pid) ?? 0;
      if (budget <= 0) {
        errors.push(new Error(`Protocol ${pid} has exhausted its retry budget`));
        continue;
      }

      const start = Date.now();
      try {
        const result = await adapter.initiatePayment(params);
        const latencyMs = Date.now() - start;

        this.#recordSettlement(result, params, 'out');
        this.#updateHealth(pid, true, latencyMs, params.amountCents);
        this.#retryBudget.set(pid, ProtocolRouter.MAX_RETRIES); // reset on success

        return result;
      } catch (err) {
        const latencyMs = Date.now() - start;
        this.#updateHealth(pid, false, latencyMs, 0);
        this.#retryBudget.set(pid, budget - 1);
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    throw new AggregateError(
      errors,
      `Payment failed after exhausting ${protocolIds.length} protocol attempts`,
    );
  }

  // ---- Health & status ------------------------------------------------

  getProtocolStatus(protocolId?: string): ProtocolStatus[] {
    const entries = protocolId
      ? ([[protocolId, this.#healthState.get(protocolId)]] as const)
      : Array.from(this.#healthState.entries());

    const result: ProtocolStatus[] = [];
    for (const [id, state] of entries) {
      if (!state) continue;
      result.push({ id, healthy: state.healthy, latencyMs: state.lastLatencyMs, volumeCents: state.volumeCents });
    }
    return result;
  }

  // ---- Cross-protocol settlement tracking ------------------------------

  /** Retrieve all settlements associated with a payment. */
  getSettlements(paymentId: string): SettlementRecord[] {
    return this.#audit.getByPaymentId(paymentId);
  }

  /** Total completed volume per protocol. */
  volumeByProtocol(): Map<string, number> {
    return this.#audit.volumeByProtocol();
  }

  /** Number of settlement records (useful for tests / monitoring). */
  get settlementCount(): number {
    return this.#audit.size;
  }

  // ---- Internal helpers ------------------------------------------------

  #updateHealth(id: string, healthy: boolean, latencyMs: number, amountCents: number): void {
    const current = this.#healthState.get(id) ?? { healthy: true, lastLatencyMs: 0, volumeCents: 0 };
    this.#healthState.set(id, {
      healthy,
      lastLatencyMs: latencyMs,
      volumeCents: current.volumeCents + amountCents,
    });
  }

  #recordSettlement(result: PaymentResult, params: PaymentParams, direction: 'in' | 'out'): void {
    this.#audit.record({
      settlementId: `settle_${result.paymentId}`,
      paymentId: result.paymentId,
      protocolId: result.protocolId,
      amountCents: params.amountCents,
      currency: params.currency,
      direction,
      status: result.status,
      trackingRef: result.trackingRef,
      createdAt: result.initiatedAt,
      settledAt: null,
    });
  }
}

// ---------------------------------------------------------------------------
// Reasoning helper — explains *why* a route was chosen
// ---------------------------------------------------------------------------

function buildReasoning(
  adapter: ProtocolAdapter,
  params: PaymentParams,
  totalCostCents: number,
  settlementMs: number,
  isIntl: boolean,
): string[] {
  const lines: string[] = [];

  if (isIntl) {
    lines.push(
      `International payment — ${adapter.protocolName} ${adapter.capabilities.supportsInternational ? 'supports' : 'does not support'} cross-border transactions`,
    );
  }

  lines.push(
    `Fee: $${(totalCostCents / 100).toFixed(2)} (flat=${(adapter.feeStructure.flatFeeCents / 100).toFixed(2)} + ${(adapter.feeStructure.percentageFee * 100).toFixed(1)}%)`,
  );

  if (adapter.capabilities.supportsInstantSettlement) {
    lines.push(`Settlement: ~${Math.round(settlementMs / 1000)}s (instant-capable protocol)`);
  } else {
    const days = (settlementMs / (24 * 60 * 60 * 1000)).toFixed(1);
    lines.push(`Settlement: ~${days} days`);
  }

  if (params.urgency === 'critical' && !adapter.capabilities.supportsInstantSettlement) {
    lines.push(`Warning: urgency=${params.urgency} but ${adapter.protocolName} cannot settle instantly`);
  }

  if (params.amountCents < 500) {
    lines.push(`Small payment — flat fees dominate at this amount level`);
  }

  return lines;
}
