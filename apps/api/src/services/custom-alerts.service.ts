// Custom alerts — configurable threshold-based alert rules
export interface AlertRule {
  id: string;
  tenantId: string;
  name: string;
  metric: string;          // e.g., 'error_rate', 'latency_p95', 'booking_drop'
  condition: 'gt' | 'lt' | 'change_pct';
  threshold: number;
  windowMinutes: number;
  channels: Array<'in_app' | 'email' | 'slack'>;
  enabled: boolean;
  cooldownMinutes: number;
  lastFiredAt?: string;
  createdAt: string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  tenantId: string;
  metric: string;
  threshold: number;
  actualValue: number;
  message: string;
  firedAt: string;
  acknowledged: boolean;
}

const rules: AlertRule[] = [];
const events: AlertEvent[] = [];
const MAX_EVENTS = 5000;

export const customAlerts = {
  createRule(tenantId: string, opts: Omit<AlertRule, 'id' | 'tenantId' | 'createdAt'>): AlertRule {
    const r: AlertRule = {
      id: crypto.randomUUID(), tenantId, ...opts,
      createdAt: new Date().toISOString(),
    };
    rules.push(r);
    return r;
  },

  listRules(tenantId: string): AlertRule[] {
    return rules.filter(r => r.tenantId === tenantId);
  },

  getRule(id: string, tenantId: string): AlertRule | undefined {
    return rules.find(r => r.id === id && r.tenantId === tenantId);
  },

  updateRule(id: string, tenantId: string, patch: Partial<AlertRule>): AlertRule | null {
    const r = this.getRule(id, tenantId);
    if (!r) return null;
    Object.assign(r, patch);
    return r;
  },

  deleteRule(id: string, tenantId: string): boolean {
    const idx = rules.findIndex(r => r.id === id && r.tenantId === tenantId);
    if (idx === -1) return false;
    rules.splice(idx, 1);
    return true;
  },

  evaluate(tenantId: string, metric: string, value: number): AlertEvent | null {
    const matching = rules.filter(r => r.tenantId === tenantId && r.metric === metric && r.enabled);
    for (const r of matching) {
      // Check cooldown
      if (r.lastFiredAt && Date.now() - new Date(r.lastFiredAt).getTime() < r.cooldownMinutes * 60 * 1000) continue;

      let triggered = false;
      switch (r.condition) {
        case 'gt': triggered = value > r.threshold; break;
        case 'lt': triggered = value < r.threshold; break;
        case 'change_pct': triggered = Math.abs(value) > r.threshold; break;
      }

      if (triggered) {
        r.lastFiredAt = new Date().toISOString();
        const ev: AlertEvent = {
          id: crypto.randomUUID(), ruleId: r.id, tenantId, metric: r.metric,
          threshold: r.threshold, actualValue: value,
          message: `${r.name}: ${metric} is ${value} (threshold: ${r.condition} ${r.threshold})`,
          firedAt: new Date().toISOString(), acknowledged: false,
        };
        events.push(ev);
        if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
        return ev;
      }
    }
    return null;
  },

  listEvents(tenantId: string, unacknowledgedOnly = false): AlertEvent[] {
    return events
      .filter(e => e.tenantId === tenantId && (!unacknowledgedOnly || !e.acknowledged))
      .sort((a, b) => b.firedAt.localeCompare(a.firedAt));
  },

  acknowledge(id: string, tenantId: string): boolean {
    const e = events.find(ee => ee.id === id && ee.tenantId === tenantId);
    if (!e || e.acknowledged) return false;
    e.acknowledged = true;
    return true;
  },
};
