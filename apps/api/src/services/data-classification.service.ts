// Data classification — sensitivity tagging and compliance labeling
export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'restricted' | 'pii' | 'phi';

export interface ClassificationTag {
  entityType: string;
  entityId: string;
  tenantId: string;
  level: SensitivityLevel;
  regulations: string[];       // e.g., ['GDPR', 'CCPA', 'PCI-DSS']
  dataCategories: string[];    // e.g., ['personal', 'financial', 'health']
  retentionRequired: boolean;
  encrypted: boolean;
  taggedBy: string;
  taggedAt: string;
}

const tags: ClassificationTag[] = [];
const AUTO_CLASSIFY: Record<string, { level: SensitivityLevel; categories: string[] }> = {
  businesses: { level: 'internal', categories: ['organizational'] },
  bookings: { level: 'confidential', categories: ['financial', 'personal'] },
  ledger_entries: { level: 'restricted', categories: ['financial'] },
  rights_passports: { level: 'confidential', categories: ['legal', 'intellectual_property'] },
  users: { level: 'pii', categories: ['personal', 'authentication'] },
};

export const dataClassification = {
  tag(opts: Omit<ClassificationTag, 'taggedAt'>): ClassificationTag {
    const existing = tags.find(t => t.entityType === opts.entityType && t.entityId === opts.entityId && t.tenantId === opts.tenantId);
    if (existing) { Object.assign(existing, opts); return existing; }

    const t: ClassificationTag = { ...opts, taggedAt: new Date().toISOString() };
    tags.push(t);
    return t;
  },

  autoClassify(tenantId: string, entityType: string, entityId: string, taggedBy: string): ClassificationTag | null {
    const rule = AUTO_CLASSIFY[entityType];
    if (!rule) return null;

    return this.tag({
      entityType, entityId, tenantId,
      level: rule.level, regulations: [], dataCategories: rule.categories,
      retentionRequired: rule.level === 'pii' || rule.level === 'restricted',
      encrypted: rule.level === 'restricted' || rule.level === 'pii',
      taggedBy,
    });
  },

  getClassification(entityType: string, entityId: string, tenantId: string): ClassificationTag | undefined {
    return tags.find(t => t.entityType === entityType && t.entityId === entityId && t.tenantId === tenantId);
  },

  listByLevel(tenantId: string, level: SensitivityLevel): ClassificationTag[] {
    return tags.filter(t => t.tenantId === tenantId && t.level === level);
  },

  getSummary(tenantId: string): { total: number; byLevel: Record<string, number>; piiCount: number; encryptedCount: number } {
    const tenant = tags.filter(t => t.tenantId === tenantId);
    const byLevel: Record<string, number> = {};
    let piiCount = 0;
    let encryptedCount = 0;

    for (const t of tenant) {
      byLevel[t.level] = (byLevel[t.level] ?? 0) + 1;
      if (t.level === 'pii' || t.level === 'phi') piiCount++;
      if (t.encrypted) encryptedCount++;
    }

    return { total: tenant.length, byLevel, piiCount, encryptedCount };
  },
};
