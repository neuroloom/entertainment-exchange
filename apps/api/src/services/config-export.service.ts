// Config export — export all tenant settings as structured JSON
export interface ConfigExport {
  tenantId: string;
  exportedAt: string;
  settings: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
  rateLimits: Record<string, unknown>;
  webhooks: Record<string, unknown>;
  integrations: Record<string, unknown>;
  customFields: Record<string, unknown>;
  validationRules: Record<string, unknown>;
  retentionPolicies: Record<string, unknown>;
  metadata: { version: string; exportedBy: string };
}

const exports: ConfigExport[] = [];

export const configExport = {
  exportTenant(tenantId: string, exportedBy: string, data: {
    settings?: Record<string, unknown>;
    featureFlags?: Record<string, unknown>;
    rateLimits?: Record<string, unknown>;
    webhooks?: Record<string, unknown>;
    integrations?: Record<string, unknown>;
    customFields?: Record<string, unknown>;
    validationRules?: Record<string, unknown>;
    retentionPolicies?: Record<string, unknown>;
  }): ConfigExport {
    const exp: ConfigExport = {
      tenantId,
      exportedAt: new Date().toISOString(),
      settings: data.settings ?? {},
      featureFlags: data.featureFlags ?? {},
      rateLimits: data.rateLimits ?? {},
      webhooks: data.webhooks ?? {},
      integrations: data.integrations ?? {},
      customFields: data.customFields ?? {},
      validationRules: data.validationRules ?? {},
      retentionPolicies: data.retentionPolicies ?? {},
      metadata: { version: new Date().toISOString().slice(0, 10), exportedBy },
    };
    exports.push(exp);
    return exp;
  },

  listExports(tenantId: string): ConfigExport[] {
    return exports.filter(e => e.tenantId === tenantId).sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
  },

  getExport(tenantId: string, exportedAt: string): ConfigExport | undefined {
    return exports.find(e => e.tenantId === tenantId && e.exportedAt === exportedAt);
  },

  diff(a: Record<string, unknown>, b: Record<string, unknown>): Array<{ key: string; a: unknown; b: unknown }> {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const changes: Array<{ key: string; a: unknown; b: unknown }> = [];

    for (const k of allKeys) {
      const av = JSON.stringify(a[k]);
      const bv = JSON.stringify(b[k]);
      if (av !== bv) changes.push({ key: k, a: a[k], b: b[k] });
    }

    return changes;
  },
};
