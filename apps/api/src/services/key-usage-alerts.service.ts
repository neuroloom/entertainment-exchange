// Key usage alerts — detect unusual API key usage patterns
export interface KeyUsageAlert {
  id: string;
  tenantId: string;
  keyId: string;
  type: 'unused' | 'overused' | 'new_ip' | 'off_hours' | 'error_spike';
  severity: 'low' | 'medium' | 'high';
  message: string;
  detectedAt: string;
  acknowledged: boolean;
}

interface KeyProfile {
  keyId: string;
  tenantId: string;
  lastUsedAt?: string;
  dailyAvg: number;
  commonIps: string[];
  commonHours: number[];
  errorRate: number;
}

const alerts: KeyUsageAlert[] = [];
const profiles = new Map<string, KeyProfile>();

export const keyUsageAlerts = {
  updateProfile(keyId: string, tenantId: string, ip: string, statusCode: number): void {
    const hour = new Date().getHours();
    const key = `${tenantId}:${keyId}`;
    let profile = profiles.get(key);

    if (!profile) {
      profile = { keyId, tenantId, dailyAvg: 0, commonIps: [], commonHours: [], errorRate: 0 };
      profiles.set(key, profile);
    }

    profile.lastUsedAt = new Date().toISOString();

    // Track common IPs (top 5)
    if (!profile.commonIps.includes(ip)) {
      profile.commonIps.push(ip);
      if (profile.commonIps.length > 5) profile.commonIps.shift();

      // New IP alert
      if (profile.commonIps.length >= 3 && !profile.commonIps.slice(0, -1).includes(ip)) {
        this.createAlert(tenantId, keyId, 'new_ip', 'low', `API key used from new IP: ${ip}`);
      }
    }

    // Track common hours
    if (!profile.commonHours.includes(hour)) {
      profile.commonHours.push(hour);
      if (profile.commonHours.length > 12) profile.commonHours.shift();

      // Off-hours alert
      if (profile.commonHours.length >= 5 && (hour < 6 || hour > 22)) {
        const offHourCount = profile.commonHours.filter(h => h < 6 || h > 22).length;
        if (offHourCount > 3) {
          this.createAlert(tenantId, keyId, 'off_hours', 'medium', `Unusual off-hours activity: ${offHourCount} requests outside 6am-10pm`);
        }
      }
    }

    // Error spike
    if (statusCode >= 400) {
      profile.errorRate = Math.round((profile.errorRate * profile.dailyAvg + 1) / (profile.dailyAvg + 1) * 100);
      if (profile.errorRate > 50 && profile.dailyAvg > 5) {
        this.createAlert(tenantId, keyId, 'error_spike', 'high', `Error rate at ${profile.errorRate}% over last ${profile.dailyAvg} requests`);
      }
    }
  },

  checkUnused(): void {
    const now = Date.now();
    for (const [, profile] of profiles) {
      if (profile.lastUsedAt) {
        const daysSince = (now - new Date(profile.lastUsedAt).getTime()) / (24 * 60 * 60 * 1000);
        if (daysSince > 30) {
          this.createAlert(profile.tenantId, profile.keyId, 'unused', 'low', `API key unused for ${Math.round(daysSince)} days`);
        }
      }
    }
  },

  createAlert(tenantId: string, keyId: string, type: KeyUsageAlert['type'], severity: KeyUsageAlert['severity'], message: string): KeyUsageAlert {
    // Dedup: same type+key in last hour
    const recent = alerts.find(a => a.keyId === keyId && a.type === type && Date.now() - new Date(a.detectedAt).getTime() < 3600000);
    if (recent) return recent;

    const a: KeyUsageAlert = {
      id: crypto.randomUUID(), tenantId, keyId, type, severity, message,
      detectedAt: new Date().toISOString(), acknowledged: false,
    };
    alerts.push(a);
    if (alerts.length > 5000) alerts.splice(0, alerts.length - 5000);
    return a;
  },

  list(tenantId: string, unacknowledged = false): KeyUsageAlert[] {
    return alerts
      .filter(a => a.tenantId === tenantId && (!unacknowledged || !a.acknowledged))
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  },

  acknowledge(id: string, tenantId: string): boolean {
    const a = alerts.find(aa => aa.id === id && aa.tenantId === tenantId);
    if (!a || a.acknowledged) return false;
    a.acknowledged = true;
    return true;
  },
};
