// Webhook Registry & Delivery — subscription management, delivery, retry with backoff
import { v4 as uuid } from 'uuid';

export interface WebhookSubscription {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  event: string;
  payload: unknown;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  statusCode?: number;
  attempt: number;
  maxAttempts: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// Matches WebhookEventType from shared types
export type WebhookEventType =
  | 'business.created' | 'business.updated' | 'business.archived'
  | 'booking.created' | 'booking.confirmed' | 'booking.cancelled'
  | 'listing.published' | 'listing.sold'
  | 'deal.completed' | 'deal.disputed'
  | 'payment.received' | 'payment.refunded'
  | 'rights.anchored' | 'rights.transferred'
  | 'agent.run_completed';

interface EmitOpts {
  tenantId: string;
  businessId?: string;
  resourceId: string;
  payload: Record<string, unknown>;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5000;
const DELIVERY_TIMEOUT_MS = 10_000;

export class WebhookService {
  private subscriptions: WebhookSubscription[] = [];
  private deliveries: WebhookDelivery[] = [];
  private activeDeliveries = new Set<string>();

  // ── Subscription CRUD ──────────────────────────────────────────────────────

  subscribe(sub: Omit<WebhookSubscription, 'id' | 'createdAt' | 'updatedAt'>): WebhookSubscription {
    const id = uuid();
    const now = new Date().toISOString();
    const s: WebhookSubscription = { ...sub, id, active: true, createdAt: now, updatedAt: now };
    this.subscriptions.push(s);
    return s;
  }

  unsubscribe(subscriptionId: string, tenantId: string): boolean {
    const idx = this.subscriptions.findIndex(s => s.id === subscriptionId && s.tenantId === tenantId);
    if (idx === -1) return false;
    this.subscriptions[idx].active = false;
    this.subscriptions[idx].updatedAt = new Date().toISOString();
    return true;
  }

  getSubscriptions(tenantId: string): WebhookSubscription[] {
    return this.subscriptions.filter(s => s.tenantId === tenantId);
  }

  getActiveSubscriptions(tenantId: string, event: string): WebhookSubscription[] {
    return this.subscriptions.filter(s =>
      s.tenantId === tenantId && s.active && s.events.includes(event),
    );
  }

  findSubscription(id: string, tenantId: string): WebhookSubscription | undefined {
    return this.subscriptions.find(s => s.id === id && s.tenantId === tenantId);
  }

  // ── Delivery ────────────────────────────────────────────────────────────────

  async emit(event: WebhookEventType, opts: EmitOpts): Promise<void> {
    const subs = this.getActiveSubscriptions(opts.tenantId, event);
    if (subs.length === 0) return;

    const envelope = {
      event,
      tenantId: opts.tenantId,
      businessId: opts.businessId,
      resourceId: opts.resourceId,
      timestamp: new Date().toISOString(),
      data: opts.payload,
    };

    // Fire-and-forget: all subscriptions in parallel
    for (const sub of subs) {
      void this.deliver(sub, event, envelope).catch(() => { /* delivery handles errors */ });
    }
  }

  private async deliver(sub: WebhookSubscription, event: string, payload: unknown): Promise<void> {
    const deliveryId = uuid();
    const delivery: WebhookDelivery = {
      id: deliveryId, subscriptionId: sub.id, event, payload,
      status: 'pending', attempt: 1, maxAttempts: MAX_ATTEMPTS,
      createdAt: new Date().toISOString(),
    };
    this.deliveries.push(delivery);

    await this.attemptDelivery(sub, delivery);
  }

  private async attemptDelivery(sub: WebhookSubscription, delivery: WebhookDelivery): Promise<void> {
    if (this.activeDeliveries.has(delivery.id)) return;
    this.activeDeliveries.add(delivery.id);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-Id': delivery.id,
        'X-Webhook-Event': delivery.event,
      };
      if (sub.secret) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', encoder.encode(sub.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(delivery.payload)));
        headers['X-Webhook-Signature'] = `sha256=${Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('')}`;
      }

      const res = await fetch(sub.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(delivery.payload),
        signal: controller.signal,
      }).catch(err => ({ status: 0, ok: false, error: err }));

      clearTimeout(timer);

      if (res && 'ok' in res && (res.ok || res.status >= 200 && res.status < 300)) {
        delivery.status = 'success';
        delivery.statusCode = res.status;
        delivery.completedAt = new Date().toISOString();
      } else {
        await this.retryOrFail(sub, delivery, `HTTP ${'status' in res ? res.status : 'network error'}`);
      }
    } catch (err) {
      await this.retryOrFail(sub, delivery, err instanceof Error ? err.message : 'Unknown error');
    } finally {
      this.activeDeliveries.delete(delivery.id);
    }
  }

  private async retryOrFail(sub: WebhookSubscription, delivery: WebhookDelivery, error: string): Promise<void> {
    delivery.error = error;
    if (delivery.attempt < delivery.maxAttempts) {
      delivery.attempt++;
      delivery.status = 'retrying';
      const delay = BACKOFF_BASE_MS * Math.pow(2, delivery.attempt - 2);
      await new Promise(resolve => setTimeout(resolve, delay));
      await this.attemptDelivery(sub, delivery);
    } else {
      delivery.status = 'failed';
      delivery.completedAt = new Date().toISOString();
    }
  }

  // ── Delivery history ───────────────────────────────────────────────────────

  getDeliveries(subscriptionId?: string): WebhookDelivery[] {
    if (subscriptionId) return this.deliveries.filter(d => d.subscriptionId === subscriptionId);
    return this.deliveries;
  }

  getDelivery(id: string): WebhookDelivery | undefined {
    return this.deliveries.find(d => d.id === id);
  }

  retryDelivery(deliveryId: string): boolean {
    const d = this.deliveries.find(del => del.id === deliveryId);
    if (!d || d.status !== 'failed') return false;
    const sub = this.subscriptions.find(s => s.id === d.subscriptionId);
    if (!sub) return false;
    d.attempt = 1;
    d.status = 'pending';
    d.error = undefined;
    d.completedAt = undefined;
    void this.attemptDelivery(sub, d).catch(() => {});
    return true;
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  stats(tenantId?: string): { total: number; active: number; failedToday: number } {
    const subs = tenantId
      ? this.subscriptions.filter(s => s.tenantId === tenantId)
      : this.subscriptions;
    const today = new Date().toISOString().slice(0, 10);
    return {
      total: subs.length,
      active: subs.filter(s => s.active).length,
      failedToday: this.deliveries.filter(d => d.status === 'failed' && d.createdAt.startsWith(today)).length,
    };
  }
}

// Singleton
export const webhookService = new WebhookService();
