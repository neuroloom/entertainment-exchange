import { describe, it, expect } from 'vitest';
import { idempotency } from '../services/idempotency.service.js';

describe('idempotency', () => {
  it('returns null for unknown keys', () => {
    expect(idempotency.check('unknown-key', 'tenant-1')).toBeNull();
  });

  it('stores and retrieves idempotency records', () => {
    idempotency.store('test-key', 'tenant-1', 201, { result: 'created' });
    const rec = idempotency.check('test-key', 'tenant-1');
    expect(rec).not.toBeNull();
    expect(rec!.response.statusCode).toBe(201);
    expect(rec!.response.body).toEqual({ result: 'created' });
  });

  it('isolates by tenant', () => {
    idempotency.store('shared-key', 'tenant-1', 200, { ok: true });
    expect(idempotency.check('shared-key', 'tenant-1')).not.toBeNull();
    expect(idempotency.check('shared-key', 'tenant-2')).toBeNull();
  });

  it('clears records for a tenant', () => {
    idempotency.store('clear-key', 'tenant-clear', 200, {});
    expect(idempotency.check('clear-key', 'tenant-clear')).not.toBeNull();
    idempotency.clearForTenant('tenant-clear');
    expect(idempotency.check('clear-key', 'tenant-clear')).toBeNull();
  });
});
