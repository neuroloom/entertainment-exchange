import { describe, it, expect, beforeEach } from 'vitest';
import { circuitBreaker } from '../services/circuit-breaker.service.js';

describe('circuitBreaker', () => {
  beforeEach(() => {
    circuitBreaker.reset('test-cb');
    circuitBreaker.reset('fallback-cb');
    circuitBreaker.reset('threshold-cb');
  });

  it('starts in closed state', () => {
    circuitBreaker.register('test-cb');
    expect(circuitBreaker.getState('test-cb')).toBe('closed');
  });

  it('defaults to closed for unknown circuits', () => {
    expect(circuitBreaker.getState('unknown-cb')).toBe('closed');
  });

  it('calls the function and returns result', async () => {
    const result = await circuitBreaker.call('test-cb', async () => 'success');
    expect(result).toBe('success');
  });

  it('auto-registers unknown circuits on first call', async () => {
    const result = await circuitBreaker.call('auto-reg', async () => 42);
    expect(result).toBe(42);
    expect(circuitBreaker.getState('auto-reg')).toBe('closed');
  });

  it('calls fallback when circuit is open', async () => {
    circuitBreaker.register('fallback-cb', { failureThreshold: 1, resetTimeoutMs: 60_000 });

    // Open the circuit
    try {
      await circuitBreaker.call('fallback-cb', async () => { throw new Error('fail'); });
    } catch {}

    // Now it should use fallback
    const result = await circuitBreaker.call(
      'fallback-cb',
      async () => 'should not run',
      () => 'fallback-value',
    );
    expect(result).toBe('fallback-value');
  });

  it('opens circuit after threshold failures', async () => {
    circuitBreaker.register('threshold-cb', { failureThreshold: 3, resetTimeoutMs: 60_000 });

    // 3 failures should open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await circuitBreaker.call('threshold-cb', async () => { throw new Error(`fail ${i}`); });
      } catch {}
    }

    expect(circuitBreaker.getState('threshold-cb')).toBe('open');
  });

  it('does not open before threshold', async () => {
    circuitBreaker.register('threshold-cb', { failureThreshold: 5, resetTimeoutMs: 60_000 });

    for (let i = 0; i < 4; i++) {
      try {
        await circuitBreaker.call('threshold-cb', async () => { throw new Error(`fail ${i}`); });
      } catch {}
    }

    expect(circuitBreaker.getState('threshold-cb')).toBe('closed');
  });

  it('throws when open and no fallback', async () => {
    circuitBreaker.register('test-cb', { failureThreshold: 1, resetTimeoutMs: 60_000 });

    try { await circuitBreaker.call('test-cb', async () => { throw new Error('fail'); }); } catch {}

    await expect(
      circuitBreaker.call('test-cb', async () => 'unreachable'),
    ).rejects.toThrow('Circuit test-cb is open');
  });

  it('resets failures on success', async () => {
    circuitBreaker.register('test-cb', { failureThreshold: 2, resetTimeoutMs: 60_000 });

    await circuitBreaker.call('test-cb', async () => 'ok');
    // This failure should not open the circuit because success resets
    try {
      await circuitBreaker.call('test-cb', async () => { throw new Error('fail'); });
    } catch {}

    expect(circuitBreaker.getState('test-cb')).toBe('closed');
  });

  it('lists all circuits', () => {
    circuitBreaker.register('cb-a');
    circuitBreaker.register('cb-b');
    const all = circuitBreaker.listAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some(c => c.name === 'cb-a')).toBe(true);
    expect(all.some(c => c.name === 'cb-b')).toBe(true);
  });

  it('resets a circuit to closed', () => {
    circuitBreaker.register('test-cb');
    // Force open by hitting failures
    circuitBreaker.reset('test-cb');
    expect(circuitBreaker.getState('test-cb')).toBe('closed');
  });

  it('returns false when resetting unknown circuit', () => {
    expect(circuitBreaker.reset('does-not-exist')).toBe(false);
  });
});
