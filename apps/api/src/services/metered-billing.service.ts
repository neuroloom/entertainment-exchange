// Metered billing — usage-based charge calculation for API consumption
export interface MeteredBill {
  id: string;
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  lineItems: Array<{ resource: string; quantity: number; unitCents: number; totalCents: number }>;
  subtotalCents: number;
  totalCents: number;
  status: 'estimated' | 'final';
  generatedAt: string;
}

const bills: MeteredBill[] = [];
const RATES: Record<string, number> = {
  api_calls: 0.01,        // per call
  bookings: 10,           // per booking
  agents: 100,            // per agent-month
  listings: 50,           // per listing
  storage_mb: 5,          // per MB-month
  webhook_deliveries: 0.1, // per delivery
};

export const meteredBilling = {
  getRates(): Record<string, number> { return { ...RATES }; },

  estimate(opts: {
    tenantId: string;
    periodStart: string;
    periodEnd: string;
    usage: Record<string, number>; // resource → quantity
    currency?: string;
  }): MeteredBill {
    const lineItems: MeteredBill['lineItems'] = [];
    let subtotal = 0;

    for (const [resource, qty] of Object.entries(opts.usage)) {
      const unitCents = RATES[resource] ? Math.round(RATES[resource] * 100) : 0;
      const totalCents = Math.round(qty * unitCents);
      if (totalCents > 0) {
        lineItems.push({ resource, quantity: qty, unitCents, totalCents });
        subtotal += totalCents;
      }
    }

    const bill: MeteredBill = {
      id: crypto.randomUUID(), tenantId: opts.tenantId,
      periodStart: opts.periodStart, periodEnd: opts.periodEnd,
      lineItems, subtotalCents: subtotal, totalCents: subtotal,
      status: 'estimated', generatedAt: new Date().toISOString(),
    };
    bills.push(bill);
    return bill;
  },

  listBills(tenantId: string): MeteredBill[] {
    return bills.filter(b => b.tenantId === tenantId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  },

  getBill(id: string, tenantId: string): MeteredBill | undefined {
    return bills.find(b => b.id === id && b.tenantId === tenantId);
  },
};
