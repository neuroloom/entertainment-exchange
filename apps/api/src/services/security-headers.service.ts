// Security headers — CSP, HSTS, and other response security headers
export interface SecurityHeaderConfig {
  tenantId: string;
  hsts: { enabled: boolean; maxAge: number };
  csp: { enabled: boolean; directives: Record<string, string[]> };
  xFrameOptions: 'DENY' | 'SAMEORIGIN';
  xContentTypeOptions: boolean;
  referrerPolicy: string;
  permissionsPolicy: Record<string, string[]>;
}

const configs = new Map<string, SecurityHeaderConfig>();

const DEFAULTS: Omit<SecurityHeaderConfig, 'tenantId'> = {
  hsts: { enabled: true, maxAge: 31536000 },
  csp: { enabled: true, directives: { 'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:', 'https:'], 'connect-src': ["'self'", 'https://api.anthropic.com'], 'frame-ancestors': ["'none'"] } },
  xFrameOptions: 'DENY',
  xContentTypeOptions: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
};

export const securityHeaders = {
  get(tenantId: string): SecurityHeaderConfig {
    return configs.get(tenantId) ?? { tenantId, ...DEFAULTS };
  },

  update(tenantId: string, patch: Partial<SecurityHeaderConfig>): SecurityHeaderConfig {
    const existing = configs.get(tenantId) ?? { tenantId, ...DEFAULTS };
    const merged = { ...existing, ...patch };
    configs.set(tenantId, merged);
    return merged;
  },

  generateHeaders(tenantId: string): Record<string, string> {
    const config = this.get(tenantId);
    const headers: Record<string, string> = {};

    if (config.hsts.enabled) {
      headers['Strict-Transport-Security'] = `max-age=${config.hsts.maxAge}; includeSubDomains`;
    }

    if (config.csp.enabled) {
      const csp = Object.entries(config.csp.directives)
        .map(([key, values]) => `${key} ${values.join(' ')}`)
        .join('; ');
      headers['Content-Security-Policy'] = csp;
    }

    headers['X-Frame-Options'] = config.xFrameOptions;
    if (config.xContentTypeOptions) headers['X-Content-Type-Options'] = 'nosniff';
    headers['Referrer-Policy'] = config.referrerPolicy;

    const permissions = Object.entries(config.permissionsPolicy)
      .map(([k, v]) => `${k}=(${v.length > 0 ? v.map(x => `"${x}"`).join(' ') : ''})`)
      .join(', ');
    if (permissions) headers['Permissions-Policy'] = permissions;

    return headers;
  },
};
