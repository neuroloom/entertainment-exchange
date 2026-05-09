// Tenant billing — invoice generation with usage-based line items
import { v4 as uuid } from 'uuid';

export interface BillingInvoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  status: 'draft' | 'issued' | 'paid' | 'overdue' | 'void';
  lineItems: InvoiceLineItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  issuedAt?: string;
  paidAt?: string;
  dueAt?: string;
  createdAt: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

interface BillingPlan {
  name: string;
  monthlyBaseCents: number;
  includedBookings: number;
  overagePerBookingCents: number;
  includedAgents: number;
  overagePerAgentCents: number;
  includedListings: number;
  overagePerListingCents: number;
}

const PLANS: Record<string, BillingPlan> = {
  starter: { name: 'Starter', monthlyBaseCents: 0, includedBookings: 10, overagePerBookingCents: 500, includedAgents: 1, overagePerAgentCents: 1000, includedListings: 3, overagePerListingCents: 500 },
  pro: { name: 'Professional', monthlyBaseCents: 9900, includedBookings: 100, overagePerBookingCents: 200, includedAgents: 5, overagePerAgentCents: 500, includedListings: 20, overagePerListingCents: 200 },
  enterprise: { name: 'Enterprise', monthlyBaseCents: 49900, includedBookings: 1000, overagePerBookingCents: 100, includedAgents: 20, overagePerAgentCents: 250, includedListings: 100, overagePerListingCents: 100 },
};

const invoices: BillingInvoice[] = [];
let nextInvoiceNumber = 1000;

export const billingService = {
  listPlans(): Record<string, BillingPlan> { return { ...PLANS }; },

  generateInvoice(opts: {
    tenantId: string;
    plan: string;
    periodStart: string;
    periodEnd: string;
    bookingCount: number;
    agentCount: number;
    listingCount: number;
    currency?: string;
  }): BillingInvoice {
    const plan = PLANS[opts.plan] ?? PLANS.starter;
    const lineItems: InvoiceLineItem[] = [];

    // Base fee
    if (plan.monthlyBaseCents > 0) {
      lineItems.push({ description: `${plan.name} Monthly Base`, quantity: 1, unitCents: plan.monthlyBaseCents, totalCents: plan.monthlyBaseCents });
    }

    // Booking overage
    const bookingOverage = Math.max(0, opts.bookingCount - plan.includedBookings);
    if (bookingOverage > 0) {
      lineItems.push({ description: `Booking Overage (${bookingOverage} over ${plan.includedBookings} included)`, quantity: bookingOverage, unitCents: plan.overagePerBookingCents, totalCents: bookingOverage * plan.overagePerBookingCents });
    }

    // Agent overage
    const agentOverage = Math.max(0, opts.agentCount - plan.includedAgents);
    if (agentOverage > 0) {
      lineItems.push({ description: `Agent Overage (${agentOverage} over ${plan.includedAgents} included)`, quantity: agentOverage, unitCents: plan.overagePerAgentCents, totalCents: agentOverage * plan.overagePerAgentCents });
    }

    // Listing overage
    const listingOverage = Math.max(0, opts.listingCount - plan.includedListings);
    if (listingOverage > 0) {
      lineItems.push({ description: `Listing Overage (${listingOverage} over ${plan.includedListings} included)`, quantity: listingOverage, unitCents: plan.overagePerListingCents, totalCents: listingOverage * plan.overagePerListingCents });
    }

    const subtotalCents = lineItems.reduce((s, li) => s + li.totalCents, 0);
    const taxCents = Math.round(subtotalCents * 0); // Tax handled separately
    const invoiceNumber = `INV-${String(nextInvoiceNumber++).padStart(6, '0')}`;
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const invoice: BillingInvoice = {
      id: uuid(), tenantId: opts.tenantId, invoiceNumber,
      periodStart: opts.periodStart, periodEnd: opts.periodEnd,
      status: 'draft', lineItems, subtotalCents, taxCents,
      totalCents: subtotalCents + taxCents,
      currency: opts.currency ?? 'USD', dueAt, createdAt: new Date().toISOString(),
    };
    invoices.push(invoice);
    return invoice;
  },

  getInvoice(id: string, tenantId: string): BillingInvoice | undefined {
    return invoices.find(i => i.id === id && i.tenantId === tenantId);
  },

  listInvoices(tenantId: string): BillingInvoice[] {
    return invoices.filter(i => i.tenantId === tenantId);
  },

  issueInvoice(id: string, tenantId: string): BillingInvoice | null {
    const inv = invoices.find(i => i.id === id && i.tenantId === tenantId);
    if (!inv || inv.status !== 'draft') return null;
    inv.status = 'issued';
    inv.issuedAt = new Date().toISOString();
    return inv;
  },

  markPaid(id: string, tenantId: string): BillingInvoice | null {
    const inv = invoices.find(i => i.id === id && i.tenantId === tenantId);
    if (!inv || (inv.status !== 'issued' && inv.status !== 'overdue')) return null;
    inv.status = 'paid';
    inv.paidAt = new Date().toISOString();
    return inv;
  },
};
