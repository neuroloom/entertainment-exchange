// Repository tests — MemoryStore, AuditStore, JournalStore CRUD operations
import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryStore, AuditStore, JournalStore, setCurrentTraceId, getCurrentTraceId, registerStore } from '../services/repo.js';

describe('MemoryStore', () => {
  let store: MemoryStore<any>;

  beforeAll(() => {
    store = new MemoryStore(); // no tableName — skip PG persistence in tests
  });

  it('set by key/value and get returns the item', () => {
    store.set('item-1', { id: 'item-1', name: 'Test Item', tenantId: 't1' });
    const item = store.get('item-1');
    expect(item).toBeDefined();
    expect(item.name).toBe('Test Item');
    expect(item.tenantId).toBe('t1');
  });

  it('set by object with id auto-detects key', () => {
    const obj = { id: 'auto-1', value: 42, tenantId: 't1' };
    store.set(obj);
    expect(store.get('auto-1')).toEqual(obj);
  });

  it('has returns true for existing items', () => {
    store.set('exists-test', { id: 'exists-test', tenantId: 't1' });
    expect(store.has('exists-test')).toBe(true);
    expect(store.has('no-such-key')).toBe(false);
  });

  it('get returns undefined for missing key', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('delete removes the item and returns true', () => {
    store.set('del-me', { id: 'del-me', tenantId: 't1' });
    expect(store.has('del-me')).toBe(true);
    expect(store.delete('del-me')).toBe(true);
    expect(store.get('del-me')).toBeUndefined();
  });

  it('delete returns false for nonexistent key', () => {
    expect(store.delete('ghost')).toBe(false);
  });

  it('all filters by tenantId', () => {
    store.set({ id: 'a1', tenantId: 'alpha', name: 'Alpha 1' });
    store.set({ id: 'a2', tenantId: 'alpha', name: 'Alpha 2' });
    store.set({ id: 'b1', tenantId: 'bravo', name: 'Bravo 1' });

    const alpha = store.all('alpha');
    // Should only get items where tenantId === 'alpha'
    const alphaIds = alpha.map((i: any) => i.id);
    expect(alphaIds).toContain('a1');
    expect(alphaIds).toContain('a2');
    alphaIds.forEach((id: string) => expect(id).not.toBe('b1'));
  });

  it('all returns empty array for tenant with no items', () => {
    expect(store.all('charlie')).toEqual([]);
  });

  it('find returns first matching item by predicate', () => {
    store.set({ id: 'find-1', type: 'alpha', tenantId: 't1' });
    store.set({ id: 'find-2', type: 'bravo', tenantId: 't1' });

    const found = store.find((item: any) => item.type === 'bravo');
    expect(found).toBeDefined();
    expect(found!.id).toBe('find-2');
  });

  it('find returns undefined when no match', () => {
    const found = store.find((item: any) => item.type === 'charlie');
    expect(found).toBeUndefined();
  });

  it('values iterates over all stored items', () => {
    const items = Array.from(store.values());
    expect(items.length).toBeGreaterThan(0);
  });

  it('size returns the correct count', () => {
    const s = new MemoryStore();
    s.set({ id: 's1', tenantId: 't' });
    s.set({ id: 's2', tenantId: 't' });
    expect(s.size()).toBe(2);
  });
});

describe('AuditStore', () => {
  let audit: AuditStore;

  beforeAll(() => {
    audit = new AuditStore();
  });

  it('push and all returns events', () => {
    audit.push({
      id: 'evt-1', tenantId: 't1', businessId: 'b1',
      actorType: 'human', actorId: 'u1', action: 'create',
      resourceType: 'booking', resourceId: 'bk-1',
      metadata: {}, createdAt: new Date().toISOString(),
    });
    const all = audit.all();
    expect(all.length).toBeGreaterThan(0);
    const found = all.find(e => e.id === 'evt-1');
    expect(found).toBeDefined();
    expect(found!.action).toBe('create');
  });

  it('all filters by tenantId', () => {
    audit.push({
      id: 'evt-2', tenantId: 't2', businessId: 'b2',
      actorType: 'agent', actorId: 'a1', action: 'status',
      resourceType: 'booking', resourceId: 'bk-2',
      metadata: {}, createdAt: new Date().toISOString(),
    });
    const t1Events = audit.all('t1');
    t1Events.forEach((e: any) => expect(e.tenantId).toBe('t1'));
  });

  it('filter returns matching events by predicate', () => {
    const results = audit.filter((e: any) => e.action === 'create');
    expect(results.length).toBeGreaterThan(0);
    results.forEach((e: any) => expect(e.action).toBe('create'));
  });

  it('find returns first event matching predicate', () => {
    const found = audit.find(e => e.actorType === 'agent');
    expect(found).toBeDefined();
    expect(found!.actorType).toBe('agent');
  });

  it('find returns undefined when no match', () => {
    expect(audit.find((e: any) => e.action === 'nonexistent')).toBeUndefined();
  });

  it('some returns true when predicate matches', () => {
    expect(audit.some((e: any) => e.tenantId === 't1')).toBe(true);
  });

  it('some returns false when no predicate matches', () => {
    expect(audit.some((e: any) => e.tenantId === 'nonexistent')).toBe(false);
  });

  it('count returns total events for tenant', () => {
    const count = audit.count('t1');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('count returns 0 for tenant with no events', () => {
    expect(audit.count('no-such-tenant')).toBe(0);
  });
});

describe('JournalStore', () => {
  let store: JournalStore;

  beforeAll(() => {
    store = new JournalStore();
  });

  it('addJournal stores journal and entries', () => {
    const journal = {
      id: 'j-1', tenantId: 't1', businessId: 'b1',
      memo: 'Test journal', referenceType: 'booking',
      referenceId: 'bk-xyz', occurredAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const entries = [
      { id: 'e-1', tenantId: 't1', journalId: 'j-1', accountId: 'a-1', direction: 'debit', amountCents: 10000 },
      { id: 'e-2', tenantId: 't1', journalId: 'j-1', accountId: 'a-2', direction: 'credit', amountCents: 10000 },
    ];
    store.addJournal(journal, entries);

    expect(store.getJournal('j-1')).toMatchObject({ memo: 'Test journal' });
    expect(store.journals.length).toBeGreaterThanOrEqual(1);
    expect(store.entries.length).toBeGreaterThanOrEqual(2);
  });

  it('getJournal returns undefined for missing id', () => {
    expect(store.getJournal('nonexistent')).toBeUndefined();
  });

  it('getEntries returns entries for a journalId', () => {
    const entries = store.getEntries('j-1');
    expect(entries).toHaveLength(2);
    expect(entries[0].journalId).toBe('j-1');
    expect(entries[1].journalId).toBe('j-1');
  });

  it('getEntries returns empty array for unknown journalId', () => {
    expect(store.getEntries('no-such-journal')).toEqual([]);
  });

  it('listJournals filters by tenantId', () => {
    const journals = store.listJournals('t1');
    expect(journals.length).toBeGreaterThanOrEqual(1);
    journals.forEach((j: any) => expect(j.tenantId).toBe('t1'));
  });

  it('listJournals filters by tenantId and businessId', () => {
    const journals = store.listJournals('t1', 'b1');
    expect(journals.length).toBeGreaterThanOrEqual(1);
    journals.forEach((j: any) => {
      expect(j.tenantId).toBe('t1');
      expect(j.businessId).toBe('b1');
    });
  });

  it('listJournals returns empty for non-matching tenantId', () => {
    expect(store.listJournals('ghost-tenant')).toEqual([]);
  });
});

describe('repo utilities', () => {
  it('setCurrentTraceId and getCurrentTraceId work in sync', () => {
    setCurrentTraceId('trace-abc-123');
    expect(getCurrentTraceId()).toBe('trace-abc-123');
    setCurrentTraceId('trace-xyz-789');
    expect(getCurrentTraceId()).toBe('trace-xyz-789');
  });

  it('registerStore adds to internal store registry', () => {
    const dummy = { hydrate: async () => {} };
    // Should not throw
    expect(() => registerStore(dummy)).not.toThrow();
  });
});
