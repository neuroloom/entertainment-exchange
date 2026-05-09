// Compliance evidence — gather and store evidence for SOC2, ISO27001, GDPR
export interface EvidenceItem {
  id: string;
  tenantId: string;
  control: string;          // e.g., 'SOC2_CC6.1', 'ISO_A.9.2', 'GDPR_ART32'
  category: 'access_control' | 'data_protection' | 'audit_log' | 'incident_response' | 'change_management';
  description: string;
  evidence: Record<string, unknown>;
  collectedAt: string;
  retentionDate: string;    // When evidence can be purged
}

const items: EvidenceItem[] = [];
const MAX_ITEMS = 10_000;

const CONTROLS: Record<string, { category: EvidenceItem['category']; description: string }> = {
  SOC2_CC6_1: { category: 'access_control', description: 'Logical and physical access controls' },
  SOC2_CC6_2: { category: 'access_control', description: 'User access provisioning and deprovisioning' },
  SOC2_CC7_1: { category: 'incident_response', description: 'Incident detection and response procedures' },
  SOC2_CC8_3: { category: 'change_management', description: 'Change management authorization' },
  ISO_A_9_2: { category: 'access_control', description: 'User access management' },
  ISO_A_12_4: { category: 'audit_log', description: 'Event logging and monitoring' },
  GDPR_ART32: { category: 'data_protection', description: 'Security of processing' },
  GDPR_ART30: { category: 'data_protection', description: 'Records of processing activities' },
};

export const complianceEvidence = {
  listControls(): Record<string, { category: string; description: string }> {
    return { ...CONTROLS };
  },

  collect(tenantId: string, control: string, evidence: Record<string, unknown>): EvidenceItem {
    const ctrl = CONTROLS[control] ?? { category: 'audit_log' as const, description: 'Custom control' };

    const item: EvidenceItem = {
      id: crypto.randomUUID(), tenantId, control,
      category: ctrl.category, description: ctrl.description,
      evidence, collectedAt: new Date().toISOString(),
      retentionDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    items.push(item);
    if (items.length > MAX_ITEMS) items.splice(0, items.length - MAX_ITEMS);
    return item;
  },

  list(tenantId: string, control?: string, category?: string): EvidenceItem[] {
    return items
      .filter(i => i.tenantId === tenantId)
      .filter(i => !control || i.control === control)
      .filter(i => !category || i.category === category)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  },

  get(id: string, tenantId: string): EvidenceItem | undefined {
    return items.find(i => i.id === id && i.tenantId === tenantId);
  },

  getCoverage(tenantId: string): { total: number; byControl: Record<string, number>; byCategory: Record<string, number> } {
    const tenant = items.filter(i => i.tenantId === tenantId);
    const byControl: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const i of tenant) {
      byControl[i.control] = (byControl[i.control] ?? 0) + 1;
      byCategory[i.category] = (byCategory[i.category] ?? 0) + 1;
    }

    return { total: tenant.length, byControl, byCategory };
  },
};
