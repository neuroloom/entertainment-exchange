// API versioning — version negotiation, deprecation notices, changelog
export interface ApiVersion {
  version: string;
  releaseDate: string;
  status: 'current' | 'supported' | 'deprecated' | 'sunset';
  sunsetDate?: string;
}

export interface ApiChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

const VERSIONS: ApiVersion[] = [
  { version: '2026-01-01', releaseDate: '2026-01-01', status: 'sunset', sunsetDate: '2026-04-01' },
  { version: '2026-04-01', releaseDate: '2026-04-01', status: 'supported' },
  { version: '2026-05-01', releaseDate: '2026-05-09', status: 'current' },
];

const CHANGELOG: ApiChangelogEntry[] = [
  {
    version: '2026-05-01', date: '2026-05-09',
    changes: [
      'Added webhook subscriptions, search, revenue forecasting',
      'Added activity feed, tenant settings, bulk bookings, rate cards',
      'Added conflict detection, commission splits, iCal feeds, recurring bookings',
      'Added notifications, API keys, tax calculation, event check-in',
      'Added payment links, contract templates, multi-currency, GDPR endpoints',
      'Added usage metering, tenant billing, dashboard KPIs, SSE realtime',
      'Added file attachments, Slack integration, CSV import, data archival',
      'Added scheduled reports, session management, audit reports, per-tenant rate limits',
      'Added custom fields, onboarding wizard, TOTP 2FA, API versioning',
    ],
  },
];

const DEPRECATED_ENDPOINTS: Array<{ path: string; method: string; deprecatedIn: string; sunsetDate: string; replacement: string }> = [];

export const apiVersioning = {
  getCurrentVersion(): ApiVersion {
    return VERSIONS.find(v => v.status === 'current') ?? VERSIONS[0];
  },

  getAllVersions(): ApiVersion[] {
    return [...VERSIONS];
  },

  getChangelog(): ApiChangelogEntry[] {
    return [...CHANGELOG];
  },

  resolveVersion(acceptHeader?: string): string {
    if (!acceptHeader) return this.getCurrentVersion().version;
    // Parse: application/vnd.ee.v2026-05-01+json
    const match = acceptHeader.match(/v(\d{4}-\d{2}-\d{2})/);
    if (!match) return this.getCurrentVersion().version;

    const requested = match[1];
    const found = VERSIONS.find(v => v.version === requested);
    if (!found) return this.getCurrentVersion().version;
    if (found.status === 'sunset') return this.getCurrentVersion().version;
    return requested;
  },

  addDeprecation(path: string, method: string, replacement: string, sunsetDate?: string): void {
    DEPRECATED_ENDPOINTS.push({
      path, method,
      deprecatedIn: this.getCurrentVersion().version,
      sunsetDate: sunsetDate ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      replacement,
    });
  },

  getDeprecations(): typeof DEPRECATED_ENDPOINTS {
    return [...DEPRECATED_ENDPOINTS];
  },

  getDeprecationNotice(path: string, method: string): string | null {
    const dep = DEPRECATED_ENDPOINTS.find(d => d.path === path && d.method === method);
    if (!dep) return null;
    return `Deprecated. Use ${dep.replacement} instead. Sunsets ${dep.sunsetDate}.`;
  },
};
