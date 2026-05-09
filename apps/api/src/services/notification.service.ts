// Notification service — in-app notifications with pluggable email/SMS providers
import { v4 as uuid } from 'uuid';

export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  type: 'booking_confirmed' | 'booking_cancelled' | 'deal_accepted' | 'payment_received' | 'rights_issued' | 'system';
  channel: 'in_app' | 'email' | 'sms';
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export interface EmailProvider {
  send(to: string, subject: string, htmlBody: string): Promise<{ success: boolean; error?: string }>;
}

export interface SmsProvider {
  send(to: string, message: string): Promise<{ success: boolean; error?: string }>;
}

interface UserPrefs {
  emailNotifications: boolean;
  smsNotifications: boolean;
  inAppNotifications: boolean;
  email?: string;
  phone?: string;
}

// Simple template engine — variable substitution
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

const TEMPLATES: Record<string, { title: string; body: string }> = {
  booking_confirmed: {
    title: 'Booking Confirmed: {{eventName}}',
    body: 'Your booking "{{eventName}}" on {{eventDate}} has been confirmed. Status: {{status}}',
  },
  booking_cancelled: {
    title: 'Booking Cancelled: {{eventName}}',
    body: 'Your booking "{{eventName}}" on {{eventDate}} has been cancelled.',
  },
  deal_accepted: {
    title: 'Deal Accepted: {{listingTitle}}',
    body: 'The deal for "{{listingTitle}}" has been accepted at {{amount}}.',
  },
  payment_received: {
    title: 'Payment Received',
    body: 'A payment of {{amount}} has been received for booking "{{eventName}}".',
  },
  rights_issued: {
    title: 'Rights Passport Issued',
    body: 'A new rights passport has been issued for {{assetTitle}}.',
  },
  system: {
    title: '{{title}}',
    body: '{{body}}',
  },
};

const notifications: Notification[] = [];
const userPrefs = new Map<string, UserPrefs>();
let _emailProvider: EmailProvider | null = null;
let _smsProvider: SmsProvider | null = null;

export const notificationService = {
  setEmailProvider(p: EmailProvider): void { _emailProvider = p; },
  setSmsProvider(p: SmsProvider): void { _smsProvider = p; },

  getUserPrefs(userId: string): UserPrefs {
    return userPrefs.get(userId) ?? { emailNotifications: true, smsNotifications: false, inAppNotifications: true };
  },

  setUserPrefs(userId: string, prefs: Partial<UserPrefs>): UserPrefs {
    const existing = this.getUserPrefs(userId);
    const updated = { ...existing, ...prefs };
    userPrefs.set(userId, updated);
    return updated;
  },

  async send(opts: {
    tenantId: string;
    userId: string;
    type: Notification['type'];
    channels?: Array<'in_app' | 'email' | 'sms'>;
    vars?: Record<string, string>;
    data?: Record<string, unknown>;
  }): Promise<Notification[]> {
    const sent: Notification[] = [];
    const prefs = this.getUserPrefs(opts.userId);
    const channels = opts.channels ?? ['in_app'];
    const tmpl = TEMPLATES[opts.type] ?? TEMPLATES.system;
    const vars = opts.vars ?? {};
    const title = render(tmpl.title, opts.type === 'system' ? vars : { ...vars, title: vars.title ?? '' });
    const body = render(tmpl.body, vars);

    for (const ch of channels) {
      if (ch === 'in_app' && prefs.inAppNotifications) {
        const n: Notification = {
          id: uuid(), tenantId: opts.tenantId, userId: opts.userId,
          type: opts.type, channel: 'in_app', title, body,
          data: opts.data, read: false, createdAt: new Date().toISOString(),
        };
        notifications.push(n);
        sent.push(n);
      }

      if (ch === 'email' && prefs.emailNotifications && prefs.email && _emailProvider) {
        await _emailProvider.send(prefs.email, title, `<p>${body}</p>`);
        const n: Notification = {
          id: uuid(), tenantId: opts.tenantId, userId: opts.userId,
          type: opts.type, channel: 'email', title, body,
          data: opts.data, read: false, createdAt: new Date().toISOString(),
        };
        notifications.push(n);
        sent.push(n);
      }

      if (ch === 'sms' && prefs.smsNotifications && prefs.phone && _smsProvider) {
        await _smsProvider.send(prefs.phone, `${title}: ${body}`);
        const n: Notification = {
          id: uuid(), tenantId: opts.tenantId, userId: opts.userId,
          type: opts.type, channel: 'sms', title, body,
          data: opts.data, read: false, createdAt: new Date().toISOString(),
        };
        notifications.push(n);
        sent.push(n);
      }
    }

    return sent;
  },

  getForUser(tenantId: string, userId: string, unreadOnly = false): Notification[] {
    const result = notifications.filter(n => n.tenantId === tenantId && n.userId === userId);
    return unreadOnly ? result.filter(n => !n.read) : result;
  },

  markRead(notificationId: string, tenantId: string): boolean {
    const n = notifications.find(nn => nn.id === notificationId && nn.tenantId === tenantId);
    if (!n) return false;
    n.read = true;
    return true;
  },

  markAllRead(tenantId: string, userId: string): number {
    let count = 0;
    for (const n of notifications) {
      if (n.tenantId === tenantId && n.userId === userId && !n.read) {
        n.read = true;
        count++;
      }
    }
    return count;
  },

  getUnreadCount(tenantId: string, userId: string): number {
    return notifications.filter(n => n.tenantId === tenantId && n.userId === userId && !n.read).length;
  },
};
