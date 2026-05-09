// Circuit breaker — protect against cascading dependency failures
export type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitConfig {
  name: string;
  failureThreshold: number;   // consecutive failures to open
  resetTimeoutMs: number;      // wait before half-open
  successThreshold: number;    // successes in half-open to close
}

interface Circuit {
  config: CircuitConfig;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt?: string;
  lastStateChangeAt: string;
  openedAt?: string;
}

const circuits = new Map<string, Circuit>();

export const circuitBreaker = {
  register(name: string, config?: Partial<CircuitConfig>): void {
    circuits.set(name, {
      config: { name, failureThreshold: config?.failureThreshold ?? 5, resetTimeoutMs: config?.resetTimeoutMs ?? 30_000, successThreshold: config?.successThreshold ?? 3 },
      state: 'closed', failures: 0, successes: 0,
      lastStateChangeAt: new Date().toISOString(),
    });
  },

  getState(name: string): CircuitState {
    const c = circuits.get(name);
    if (!c) return 'closed';
    if (c.state === 'open' && c.openedAt) {
      if (Date.now() - new Date(c.openedAt).getTime() > c.config.resetTimeoutMs) {
        c.state = 'half_open';
        c.successes = 0;
        c.lastStateChangeAt = new Date().toISOString();
      }
    }
    return c.state;
  },

  async call<T>(name: string, fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (!circuits.has(name)) this.register(name);

    const state = this.getState(name);
    const c = circuits.get(name)!;

    if (state === 'open') {
      if (fallback) return fallback();
      throw new Error(`Circuit ${name} is open`);
    }

    try {
      const result = await fn();
      c.failures = 0;

      if (c.state === 'half_open') {
        c.successes++;
        if (c.successes >= c.config.successThreshold) {
          c.state = 'closed';
          c.lastStateChangeAt = new Date().toISOString();
        }
      }
      return result;
    } catch (err) {
      c.failures++;
      c.lastFailureAt = new Date().toISOString();

      if (c.failures >= c.config.failureThreshold) {
        c.state = 'open';
        c.openedAt = new Date().toISOString();
        c.lastStateChangeAt = c.openedAt;
      }

      if (fallback) return fallback();
      throw err;
    }
  },

  listAll(): Array<{ name: string; state: CircuitState; failures: number; lastFailureAt?: string }> {
    return [...circuits.entries()].map(([name, c]) => ({
      name, state: c.state, failures: c.failures, lastFailureAt: c.lastFailureAt,
    }));
  },

  reset(name: string): boolean {
    const c = circuits.get(name);
    if (!c) return false;
    c.state = 'closed';
    c.failures = 0;
    c.successes = 0;
    c.lastStateChangeAt = new Date().toISOString();
    return true;
  },
};
