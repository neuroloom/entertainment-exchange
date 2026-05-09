// Scheduled reports — configurable recurring report generation and delivery
import { v4 as uuid } from 'uuid';

export interface ReportSchedule {
  id: string;
  tenantId: string;
  name: string;
  type: 'revenue_summary' | 'booking_digest' | 'agent_performance' | 'marketplace_activity';
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: number;       // 0=Sun for weekly
  dayOfMonth?: number;      // 1-31 for monthly
  recipients: string[];     // email addresses
  format: 'json' | 'csv' | 'html';
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface GeneratedReport {
  id: string;
  scheduleId: string;
  tenantId: string;
  type: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  content: string;
  format: string;
  sent: boolean;
}

const schedules: ReportSchedule[] = [];
const reports: GeneratedReport[] = [];

function computeNextRun(frequency: string, dayOfWeek?: number, dayOfMonth?: number): string {
  const now = new Date();
  switch (frequency) {
    case 'daily': {
      const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      d.setHours(8, 0, 0, 0);
      return d.toISOString();
    }
    case 'weekly': {
      const targetDay = dayOfWeek ?? 1; // Default Monday
      const d = new Date(now);
      d.setDate(d.getDate() + ((targetDay + 7 - d.getDay()) % 7 || 7));
      d.setHours(8, 0, 0, 0);
      return d.toISOString();
    }
    case 'monthly': {
      const targetDay = Math.min(dayOfMonth ?? 1, 28);
      const d = new Date(now.getFullYear(), now.getMonth() + 1, targetDay);
      d.setHours(8, 0, 0, 0);
      if (d <= now) d.setMonth(d.getMonth() + 1);
      return d.toISOString();
    }
  }
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export const scheduledReports = {
  create(opts: {
    tenantId: string;
    name: string;
    type: ReportSchedule['type'];
    frequency: ReportSchedule['frequency'];
    dayOfWeek?: number;
    dayOfMonth?: number;
    recipients: string[];
    format?: ReportSchedule['format'];
  }): ReportSchedule {
    const s: ReportSchedule = {
      id: uuid(), tenantId: opts.tenantId, name: opts.name,
      type: opts.type, frequency: opts.frequency,
      dayOfWeek: opts.dayOfWeek, dayOfMonth: opts.dayOfMonth,
      recipients: opts.recipients, format: opts.format ?? 'json',
      enabled: true, createdAt: new Date().toISOString(),
    };
    s.nextRunAt = computeNextRun(s.frequency, s.dayOfWeek, s.dayOfMonth);
    schedules.push(s);
    return s;
  },

  list(tenantId: string): ReportSchedule[] {
    return schedules.filter(s => s.tenantId === tenantId);
  },

  get(id: string, tenantId: string): ReportSchedule | undefined {
    return schedules.find(s => s.id === id && s.tenantId === tenantId);
  },

  update(id: string, tenantId: string, patch: Partial<ReportSchedule>): ReportSchedule | null {
    const s = schedules.find(ss => ss.id === id && ss.tenantId === tenantId);
    if (!s) return null;
    Object.assign(s, patch);
    if (patch.frequency || patch.dayOfWeek !== undefined || patch.dayOfMonth !== undefined) {
      s.nextRunAt = computeNextRun(s.frequency, s.dayOfWeek, s.dayOfMonth);
    }
    return s;
  },

  delete(id: string, tenantId: string): boolean {
    const idx = schedules.findIndex(s => s.id === id && s.tenantId === tenantId);
    if (idx === -1) return false;
    schedules.splice(idx, 1);
    return true;
  },

  generateReport(scheduleId: string, tenantId: string): GeneratedReport | null {
    const s = schedules.find(ss => ss.id === scheduleId && ss.tenantId === tenantId);
    if (!s) return null;

    const now = new Date();
    let periodStart: Date;
    switch (s.frequency) {
      case 'daily': periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case 'weekly': periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case 'monthly': periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); break;
    }

    const r: GeneratedReport = {
      id: uuid(), scheduleId, tenantId, type: s.type,
      generatedAt: now.toISOString(),
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
      content: JSON.stringify({
        reportType: s.type,
        tenantId,
        generatedAt: now.toISOString(),
        period: { start: periodStart.toISOString(), end: now.toISOString() },
        message: `${s.type} report for tenant ${tenantId}`,
      }),
      format: s.format, sent: false,
    };
    reports.push(r);

    // Mark schedule as run
    s.lastRunAt = now.toISOString();
    s.nextRunAt = computeNextRun(s.frequency, s.dayOfWeek, s.dayOfMonth);

    return r;
  },

  listReports(tenantId: string): GeneratedReport[] {
    return reports.filter(r => r.tenantId === tenantId);
  },

  getReport(id: string, tenantId: string): GeneratedReport | undefined {
    return reports.find(r => r.id === id && r.tenantId === tenantId);
  },
};
