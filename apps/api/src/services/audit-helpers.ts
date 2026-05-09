// Shared audit helpers — single AuditStore instance and writeAudit function
// Consolidates 11 duplicate AuditStore instances and 6 duplicate writeAudit functions
import { v4 as uuid } from 'uuid';
import { AuditStore } from './repo.js';

export const sharedAudit = new AuditStore();

export function writeAudit(
  ctx: { tenantId: string; actor: { type: string; id: string }; businessId?: string },
  action: string,
  resourceType: string,
  resourceId: string,
  businessId?: string,
  metadata?: Record<string, unknown>,
): void {
  sharedAudit.push({
    id: uuid(),
    tenantId: ctx.tenantId,
    businessId: businessId ?? ctx.businessId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action,
    resourceType,
    resourceId,
    metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}
