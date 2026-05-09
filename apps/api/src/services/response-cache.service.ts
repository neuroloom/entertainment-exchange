// Response cache — simple in-memory cache with ETag support
interface CacheEntry {
  key: string;
  body: string;
  etag: string;
  contentType: string;
  createdAt: string;
  ttlMs: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 500;

export const responseCache = {
  get(key: string): CacheEntry | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - new Date(entry.createdAt).getTime() > entry.ttlMs) {
      cache.delete(key);
      return null;
    }
    return entry;
  },

  set(key: string, body: unknown, contentType: string, ttlMs: number = 30_000): string {
    const serialized = JSON.stringify(body);
    const etag = `"${simpleHash(serialized)}"`;

    if (cache.size >= MAX_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt))[0];
      if (oldest) cache.delete(oldest[0]);
    }

    cache.set(key, { key, body: serialized, etag, contentType, createdAt: new Date().toISOString(), ttlMs });
    return etag;
  },

  invalidate(prefix: string): number {
    let count = 0;
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) { cache.delete(key); count++; }
    }
    return count;
  },

  stats(): { entries: number; keys: string[] } {
    return { entries: cache.size, keys: [...cache.keys()] };
  },
};

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}
