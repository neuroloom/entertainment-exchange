// Payment link service — generate trackable payment links for bookings/deals
import { v4 as uuid } from 'uuid';

export interface PaymentLink {
  id: string;
  tenantId: string;
  bookingId?: string;
  dealId?: string;
  amountCents: number;
  currency: string;
  description: string;
  status: 'pending' | 'paid' | 'expired' | 'cancelled';
  url: string;
  expiresAt?: string;
  paidAt?: string;
  paidAmountCents?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const links: PaymentLink[] = [];
const BASE_URL = process.env.PAYMENT_LINK_BASE_URL ?? 'https://pay.example.com';

export const paymentLinks = {
  create(opts: {
    tenantId: string;
    bookingId?: string;
    dealId?: string;
    amountCents: number;
    currency?: string;
    description: string;
    expiresInHours?: number;
    metadata?: Record<string, unknown>;
  }): PaymentLink {
    const id = uuid();
    const expiresAt = opts.expiresInHours
      ? new Date(Date.now() + opts.expiresInHours * 3600000).toISOString()
      : undefined;

    const link: PaymentLink = {
      id, tenantId: opts.tenantId, bookingId: opts.bookingId, dealId: opts.dealId,
      amountCents: opts.amountCents, currency: opts.currency ?? 'USD',
      description: opts.description, status: 'pending',
      url: `${BASE_URL}/pay/${id}`,
      expiresAt, metadata: opts.metadata ?? {}, createdAt: new Date().toISOString(),
    };
    links.push(link);
    return link;
  },

  get(id: string, tenantId: string): PaymentLink | undefined {
    return links.find(l => l.id === id && l.tenantId === tenantId);
  },

  listByBooking(bookingId: string, tenantId: string): PaymentLink[] {
    return links.filter(l => l.bookingId === bookingId && l.tenantId === tenantId);
  },

  listByTenant(tenantId: string): PaymentLink[] {
    return links.filter(l => l.tenantId === tenantId);
  },

  markPaid(id: string, tenantId: string, paidAmountCents?: number): PaymentLink | null {
    const l = links.find(ll => ll.id === id && ll.tenantId === tenantId);
    if (!l || l.status !== 'pending') return null;
    l.status = 'paid';
    l.paidAt = new Date().toISOString();
    l.paidAmountCents = paidAmountCents ?? l.amountCents;
    return l;
  },

  cancelLink(id: string, tenantId: string): boolean {
    const l = links.find(ll => ll.id === id && ll.tenantId === tenantId);
    if (!l || l.status !== 'pending') return false;
    l.status = 'cancelled';
    return true;
  },

  expireLinks(): number {
    const now = new Date();
    let count = 0;
    for (const l of links) {
      if (l.status === 'pending' && l.expiresAt && new Date(l.expiresAt) < now) {
        l.status = 'expired';
        count++;
      }
    }
    return count;
  },

  stats(tenantId: string): { total: number; pending: number; paid: number; totalPaidCents: number } {
    const tenantLinks = links.filter(l => l.tenantId === tenantId);
    return {
      total: tenantLinks.length,
      pending: tenantLinks.filter(l => l.status === 'pending').length,
      paid: tenantLinks.filter(l => l.status === 'paid').length,
      totalPaidCents: tenantLinks.filter(l => l.status === 'paid').reduce((s, l) => s + (l.paidAmountCents ?? 0), 0),
    };
  },
};
