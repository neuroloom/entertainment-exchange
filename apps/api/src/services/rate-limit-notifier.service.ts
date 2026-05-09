// Rate limit notifier — alert when tenants approach or hit rate limits
export interface RateLimitNotification {
  id: string;
  tenantId: string;
  type: 'approaching' | 'exceeded' | 'repeated';
  threshold: number;
  currentUtilization: number;
  occurredAt: string;
  acknowledged: boolean;
}

const notifications: RateLimitNotification[] = [];
const cooldownMs = 5 * 60 * 1000; // 5 min cooldown per type

export const rateLimitNotifier = {
  checkAndNotify(tenantId: string, utilization: number, threshold: number = 80): RateLimitNotification | null {
    // Dedup: don't re-notify for same type within cooldown
    const recent = notifications.find(
      n => n.tenantId === tenantId && n.type === 'exceeded' &&
      Date.now() - new Date(n.occurredAt).getTime() < cooldownMs,
    );
    if (recent) return null;

    let type: RateLimitNotification['type'] | null = null;

    if (utilization >= 100) type = 'exceeded';
    else if (utilization >= threshold) type = 'approaching';

    // Check for repeated exceeding
    const recentExceeded = notifications.filter(
      n => n.tenantId === tenantId && n.type === 'exceeded' &&
      Date.now() - new Date(n.occurredAt).getTime() < 60 * 60 * 1000,
    );
    if (recentExceeded.length >= 3) type = 'repeated';

    if (!type) return null;

    const n: RateLimitNotification = {
      id: crypto.randomUUID(), tenantId, type, threshold,
      currentUtilization: utilization, occurredAt: new Date().toISOString(), acknowledged: false,
    };
    notifications.push(n);
    return n;
  },

  list(tenantId: string, unacknowledged = false): RateLimitNotification[] {
    return notifications
      .filter(n => n.tenantId === tenantId && (!unacknowledged || !n.acknowledged))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  },

  acknowledge(id: string, tenantId: string): boolean {
    const n = notifications.find(nn => nn.id === id && nn.tenantId === tenantId);
    if (!n || n.acknowledged) return false;
    n.acknowledged = true;
    return true;
  },

  stats(tenantId: string): { total: number; approaching: number; exceeded: number; repeated: number } {
    const tenant = notifications.filter(n => n.tenantId === tenantId);
    return {
      total: tenant.length,
      approaching: tenant.filter(n => n.type === 'approaching').length,
      exceeded: tenant.filter(n => n.type === 'exceeded').length,
      repeated: tenant.filter(n => n.type === 'repeated').length,
    };
  },
};
