// Stripe payment service — real payment processing via Stripe SDK
import Stripe from 'stripe';

const API_VERSION = '2025-06-15';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key === 'sk_test_placeholder') return null;
  return new Stripe(key, { apiVersion: API_VERSION } as unknown as ConstructorParameters<typeof Stripe>[1]);
}

export interface StripePaymentIntent {
  id: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
  status: string;
}

export interface StripeSession {
  id: string;
  url: string;
}

export const stripeService = {
  isConfigured(): boolean {
    return getStripe() !== null;
  },

  async createPaymentIntent(opts: {
    amountCents: number;
    currency?: string;
    bookingId?: string;
    tenantId: string;
    metadata?: Record<string, string>;
  }): Promise<StripePaymentIntent | { error: string }> {
    const stripe = getStripe();
    if (!stripe) return { error: 'Stripe not configured. Set STRIPE_SECRET_KEY.' };

    try {
      const intent = await stripe.paymentIntents.create({
        amount: opts.amountCents,
        currency: (opts.currency ?? 'usd').toLowerCase(),
        metadata: {
          tenant_id: opts.tenantId,
          booking_id: opts.bookingId ?? '',
          ...opts.metadata,
        },
      });
      return {
        id: intent.id,
        clientSecret: intent.client_secret!,
        amountCents: intent.amount,
        currency: intent.currency,
        status: intent.status,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Stripe error' };
    }
  },

  async createCheckoutSession(opts: {
    amountCents: number;
    currency?: string;
    bookingId?: string;
    tenantId: string;
    successUrl: string;
    cancelUrl: string;
    description: string;
  }): Promise<StripeSession | { error: string }> {
    const stripe = getStripe();
    if (!stripe) return { error: 'Stripe not configured. Set STRIPE_SECRET_KEY.' };

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: (opts.currency ?? 'usd').toLowerCase(),
            product_data: { name: opts.description },
            unit_amount: opts.amountCents,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: opts.successUrl,
        cancel_url: opts.cancelUrl,
        metadata: {
          tenant_id: opts.tenantId,
          booking_id: opts.bookingId ?? '',
        },
      });
      return { id: session.id, url: session.url! };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Stripe error' };
    }
  },

  async retrievePaymentIntent(paymentIntentId: string): Promise<StripePaymentIntent | { error: string }> {
    const stripe = getStripe();
    if (!stripe) return { error: 'Stripe not configured.' };

    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      return {
        id: intent.id,
        clientSecret: intent.client_secret!,
        amountCents: intent.amount,
        currency: intent.currency,
        status: intent.status,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Stripe error' };
    }
  },

  /** Verify a Stripe webhook signature — call in the webhook handler */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return false;
    try {
      const stripe = getStripe();
      if (!stripe) return false;
      stripe.webhooks.constructEvent(payload, signature, secret);
      return true;
    } catch {
      return false;
    }
  },
};
