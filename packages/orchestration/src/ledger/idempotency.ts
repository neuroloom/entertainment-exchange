// IdempotencyStore — ensures journal posts with the same idempotency key
// return the cached result instead of creating duplicate entries.
// Map-based store with 24-hour TTL and periodic auto-cleanup.

export interface IdempotencyEntry {
  response: { journalId: string; journal: unknown; entries: unknown[] };
  expiresAt: number;
}

/** Cleanup interval in ms — expired entries are purged every hour. */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** TTL for idempotency keys — 24 hours. */
const TTL_MS = 24 * 60 * 60 * 1000;

export class IdempotencyStore {
  #store: Map<string, IdempotencyEntry>;
  #cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.#store = new Map();
    this.#cleanupTimer = setInterval(() => this.#purgeExpired(), CLEANUP_INTERVAL_MS);
    // Unref so the timer doesn't keep the process alive in test environments.
    if (typeof this.#cleanupTimer === 'object' && 'unref' in this.#cleanupTimer) {
      this.#cleanupTimer.unref();
    }
  }

  /**
   * Check whether an idempotency key has already been processed.
   * Returns the cached response if the key exists and is not expired,
   * or `null` if the key is absent or has expired.
   */
  checkIdempotent(key: string): { journalId: string; journal: unknown; entries: unknown[] } | null {
    const entry = this.#store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.#store.delete(key);
      return null;
    }

    return entry.response;
  }

  /**
   * Mark an idempotency key as processed by storing the journal result.
   * The entry expires after 24 hours.
   */
  markProcessed(key: string, journalId: string, journal: unknown, entries: unknown[]): void {
    this.#store.set(key, {
      response: { journalId, journal, entries },
      expiresAt: Date.now() + TTL_MS,
    });
  }

  /** Remove all expired entries from the store. */
  #purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.#store) {
      if (now > entry.expiresAt) {
        this.#store.delete(key);
      }
    }
  }

  /** Stop the cleanup timer. Call when tearing down the process. */
  destroy(): void {
    clearInterval(this.#cleanupTimer);
  }

  /** Number of entries currently in the store (useful for tests/monitoring). */
  get size(): number {
    return this.#store.size;
  }
}

/** Singleton instance shared across the application. */
export const idempotencyStore = new IdempotencyStore();
