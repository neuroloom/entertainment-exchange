// Anomaly alerts — detect suspicious activity patterns per tenant
export interface AnomalyAlert {
  id: string;
  tenantId: string;
  type: 'spike' | 'drop' | 'unusual_hour' | 'geo_anomaly' | 'rate_surge';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  detectedAt: string;
  acknowledged: boolean;
}

const alerts: AnomalyAlert[] = [];
const hourlyCounts = new Map<string, number>(); // tenantId:hour → count

export const anomalyAlerts = {
  recordRequest(tenantId: string): void {
    const hour = new Date().getHours();
    const key = `${tenantId}:${hour}`;
    hourlyCounts.set(key, (hourlyCounts.get(key) ?? 0) + 1);

    // Check for rate surge (>3x baseline)
    const counts: number[] = [];
    for (const [k, c] of hourlyCounts) {
      if (k.startsWith(tenantId)) counts.push(c);
    }

    if (counts.length >= 2) {
      const avg = counts.reduce((s, c) => s + c, 0) / counts.length;
      const current = counts[counts.length - 1];
      if (avg > 10 && current > avg * 3) {
        this.createAlert(tenantId, 'rate_surge', 'high', `Request rate ${current} is 3x baseline of ${Math.round(avg)}`);
      }
    }
  },

  createAlert(tenantId: string, type: AnomalyAlert['type'], severity: AnomalyAlert['severity'], message: string): AnomalyAlert {
    const alert: AnomalyAlert = {
      id: crypto.randomUUID(), tenantId, type, severity, message,
      detectedAt: new Date().toISOString(), acknowledged: false,
    };
    alerts.push(alert);
    if (alerts.length > 5000) alerts.splice(0, alerts.length - 5000);
    return alert;
  },

  list(tenantId: string, options?: { unacknowledged?: boolean; severity?: string }): AnomalyAlert[] {
    return alerts
      .filter(a => a.tenantId === tenantId)
      .filter(a => !options?.unacknowledged || !a.acknowledged)
      .filter(a => !options?.severity || a.severity === options.severity)
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  },

  acknowledge(id: string, tenantId: string): boolean {
    const a = alerts.find(aa => aa.id === id && aa.tenantId === tenantId);
    if (!a || a.acknowledged) return false;
    a.acknowledged = true;
    return true;
  },

  stats(tenantId: string): { total: number; unacknowledged: number; bySeverity: Record<string, number> } {
    const tenant = alerts.filter(a => a.tenantId === tenantId);
    const bySeverity: Record<string, number> = {};
    for (const a of tenant) bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    return { total: tenant.length, unacknowledged: tenant.filter(a => !a.acknowledged).length, bySeverity };
  },
};
