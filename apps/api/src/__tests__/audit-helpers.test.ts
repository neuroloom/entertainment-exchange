import { describe, it, expect } from 'vitest';
import { writeAudit, sharedAudit } from '../services/audit-helpers.js';

describe('sharedAudit', () => {
  const ctx = {
    tenantId: 'test-tenant',
    actor: { type: 'human' as const, id: 'user-1' },
  };

  it('writes audit events via writeAudit()', () => {
    const before = sharedAudit.all('test-tenant').length;
    writeAudit(ctx, 'test.create', 'test_entity', 'entity-1');
    const after = sharedAudit.all('test-tenant').length;
    expect(after).toBe(before + 1);
  });

  it('filters by tenant ID', () => {
    writeAudit(ctx, 'test.update', 'test_entity', 'entity-2');
    const events = sharedAudit.all('test-tenant');
    expect(events.every((e: { tenantId: string }) => e.tenantId === 'test-tenant')).toBe(true);
  });

  it('includes metadata when provided', () => {
    writeAudit(ctx, 'test.meta', 'test_entity', 'entity-3', undefined, { key: 'value' });
    const events = sharedAudit.all('test-tenant');
    const last = events[events.length - 1];
    expect(last.metadata).toEqual({ key: 'value' });
  });

  it('uses provided businessId over ctx.businessId', () => {
    writeAudit(ctx, 'test.biz', 'test_entity', 'entity-4', 'override-biz');
    const events = sharedAudit.all('test-tenant');
    const last = events[events.length - 1];
    expect(last.businessId).toBe('override-biz');
  });

  it('defaults metadata to empty object', () => {
    writeAudit(ctx, 'test.default', 'test_entity', 'entity-5');
    const events = sharedAudit.all('test-tenant');
    const last = events[events.length - 1];
    expect(last.metadata).toEqual({});
  });
});
