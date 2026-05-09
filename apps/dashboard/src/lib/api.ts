// EntEx API client — typed fetch wrapper for all domain endpoints

const BASE = '/api/v1';

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers as Record<string, string> },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? res.statusText);
  }
  return (await res.json()).data as T;
}

export interface Booking {
  id: string; eventType: string; eventName: string | null;
  eventDate: string; status: string; quotedAmountCents: number | null;
  clientId: string | null; artistId: string | null; venueId: string | null;
  source: string | null; createdAt: string;
}

export interface Business {
  id: string; name: string; vertical: string; status: string;
  metadata: Record<string, unknown>; createdAt: string;
}

export interface Agent {
  id: string; name: string; role: string; autonomyLevel: number;
  status: string; budgetDailyCents: number;
}

export interface Listing {
  id: string; title: string; listingType: string; status: string;
  askingPriceCents: number | null; evidenceTier: string;
  sellerBusinessId: string; publishedAt: string | null;
}

export interface Deal {
  id: string; listingId: string; buyerUserId: string | null;
  sellerBusinessId: string; amountCents: number; status: string;
  events: Array<{ timestamp: string; fromState?: string; toState?: string }>;
  createdAt: string;
}

export interface DashboardKPI {
  bookings: { total: number; confirmed: number; pipeline: number; revenue: { totalCents: number; formatted: string } };
  businesses: { total: number; active: number };
  agents: { total: number; active: number; utilisationPct: number };
  marketplace: { listings: number; deals: number };
  usage: { callsMtd: number; errorRate: string };
}

export const api = {
  bookings: {
    list: (tenantId: string) => fetchJSON<Booking[]>(`/bookings`, { headers: { 'x-tenant-id': tenantId } }),
    get: (id: string, tenantId: string) => fetchJSON<Booking>(`/bookings/${id}`, { headers: { 'x-tenant-id': tenantId } }),
    patchStatus: (id: string, status: string, tenantId: string) =>
      fetchJSON<Booking>(`/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }), headers: { 'x-tenant-id': tenantId } }),
  },
  businesses: {
    list: (tenantId: string) => fetchJSON<Business[]>(`/businesses`, { headers: { 'x-tenant-id': tenantId } }),
  },
  agents: {
    list: (tenantId: string) => fetchJSON<Agent[]>(`/agents`, { headers: { 'x-tenant-id': tenantId } }),
  },
  marketplace: {
    listings: (tenantId: string) => fetchJSON<Listing[]>(`/marketplace/listings`, { headers: { 'x-tenant-id': tenantId } }),
    deals: (tenantId: string) => fetchJSON<Deal[]>(`/marketplace/deals`, { headers: { 'x-tenant-id': tenantId } }),
  },
  dashboard: {
    kpis: (tenantId: string) => fetchJSON<DashboardKPI>(`/dashboard`, { headers: { 'x-tenant-id': tenantId } }),
  },
};
