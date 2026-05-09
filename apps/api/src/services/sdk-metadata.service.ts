// SDK metadata — OpenAPI-style endpoint registry for client generation
export interface EndpointMeta {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  summary: string;
  domain: string;
  auth: boolean;
  permissions: string[];
  requestBody?: Record<string, unknown>;
  responseExample?: Record<string, unknown>;
  deprecated: boolean;
  version: string;
}

const endpoints: EndpointMeta[] = [];

const REGISTRY: EndpointMeta[] = [
  { path: '/api/v1/auth/register', method: 'POST', summary: 'Register a new user', domain: 'auth', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/auth/login', method: 'POST', summary: 'Login and receive JWT', domain: 'auth', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/auth/refresh', method: 'POST', summary: 'Refresh expired JWT', domain: 'auth', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/businesses', method: 'POST', summary: 'Create a business', domain: 'business', auth: true, permissions: ['business:create'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/businesses', method: 'GET', summary: 'List businesses', domain: 'business', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/businesses/:id', method: 'GET', summary: 'Get business details', domain: 'business', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/businesses/:id', method: 'PUT', summary: 'Update a business', domain: 'business', auth: true, permissions: ['business:manage'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/businesses/:id', method: 'DELETE', summary: 'Archive a business', domain: 'business', auth: true, permissions: ['business:manage'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/businesses/:id/metrics', method: 'GET', summary: 'Business financial metrics', domain: 'business', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/businesses/:id/forecast', method: 'GET', summary: 'Revenue forecast', domain: 'business', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/bookings', method: 'POST', summary: 'Create a booking', domain: 'booking', auth: true, permissions: ['booking:create'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/bookings/batch', method: 'POST', summary: 'Bulk create bookings', domain: 'booking', auth: true, permissions: ['booking:create'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/bookings/:id/status', method: 'PATCH', summary: 'Update booking status', domain: 'booking', auth: true, permissions: ['booking:confirm'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/bookings/:id/cancel', method: 'POST', summary: 'Cancel a booking', domain: 'booking', auth: true, permissions: ['booking:confirm'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/bookings/recurring', method: 'POST', summary: 'Create recurring bookings', domain: 'booking', auth: true, permissions: ['booking:create'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/bookings/calendar.ics', method: 'GET', summary: 'iCal feed', domain: 'booking', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/ledger/journal', method: 'POST', summary: 'Post journal entry', domain: 'ledger', auth: true, permissions: ['payment:create'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/marketplace/listings', method: 'POST', summary: 'Create listing', domain: 'marketplace', auth: true, permissions: ['listing:publish'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/marketplace/deals', method: 'POST', summary: 'Create deal', domain: 'marketplace', auth: true, permissions: ['deal:close'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/rights/anchors', method: 'POST', summary: 'Create rights anchor', domain: 'rights', auth: true, permissions: ['rights:issue'], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/search', method: 'GET', summary: 'Cross-domain search', domain: 'search', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/dashboard', method: 'GET', summary: 'Dashboard KPIs', domain: 'dashboard', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/export/:domain', method: 'GET', summary: 'Export data', domain: 'export', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/settings', method: 'GET', summary: 'Get tenant settings', domain: 'settings', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/notifications', method: 'GET', summary: 'List notifications', domain: 'notifications', auth: true, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/api-keys', method: 'POST', summary: 'Create API key', domain: 'api-keys', auth: true, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/webhooks/subscriptions', method: 'POST', summary: 'Create webhook subscription', domain: 'webhooks', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/rate-cards', method: 'POST', summary: 'Create rate card', domain: 'rate-cards', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
  { path: '/api/v1/activity', method: 'GET', summary: 'Activity feed', domain: 'activity', auth: false, permissions: [], deprecated: false, version: '2026-05-01' },
];

export const sdkMetadata = {
  registerEndpoint(meta: EndpointMeta): void {
    endpoints.push(meta);
  },

  listEndpoints(filter?: { domain?: string; method?: string; auth?: boolean }): EndpointMeta[] {
    return REGISTRY.filter(e => {
      if (filter?.domain && e.domain !== filter.domain) return false;
      if (filter?.method && e.method !== filter.method) return false;
      if (filter?.auth !== undefined && e.auth !== filter.auth) return false;
      return true;
    });
  },

  getEndpoint(path: string, method: string): EndpointMeta | undefined {
    return REGISTRY.find(e => e.path === path && e.method === method);
  },

  getDomains(): string[] {
    return [...new Set(REGISTRY.map(e => e.domain))];
  },

  generateClientConfig(language: 'typescript' | 'python' | 'curl'): Record<string, unknown> {
    switch (language) {
      case 'typescript':
        return {
          baseUrl: 'process.env.API_BASE_URL',
          endpoints: REGISTRY.map(e => ({
            name: `${e.method}_${e.path.replace(/[\/:]/g, '_').replace(/_+/g, '_')}`,
            method: e.method, path: e.path,
            requiresAuth: e.auth,
          })),
        };
      case 'python':
        return { baseUrl: 'os.environ.get("API_BASE_URL")', endpoints: REGISTRY.length };
      case 'curl':
        return { endpoints: REGISTRY.map(e => `curl -X ${e.method} ${e.path}`) };
    }
  },
};
