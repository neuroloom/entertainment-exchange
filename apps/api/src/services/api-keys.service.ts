// API key service — generation, validation, revocation for programmatic tenant access
import { v4 as uuid } from 'uuid';

export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;       // First 8 chars — safe to display
  keyHash: string;         // SHA-256 of full key
  permissions: string[];   // Scoped permission set
  lastUsedAt?: string;
  expiresAt?: string;
  revoked: boolean;
  createdAt: string;
}

const apiKeys: ApiKey[] = [];

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function generateKey(): Promise<{ full: string; prefix: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const full = `ee_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
  const prefix = full.slice(3, 11);
  const hash = await sha256(full);
  return { full, prefix, hash };
}

export const apiKeyService = {
  async createKey(tenantId: string, name: string, permissions: string[], expiresAt?: string): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const { full, prefix, hash } = await generateKey();
    const key: ApiKey = {
      id: uuid(), tenantId, name, keyPrefix: prefix, keyHash: hash,
      permissions, expiresAt, revoked: false, createdAt: new Date().toISOString(),
    };
    apiKeys.push(key);
    return { apiKey: key, rawKey: full };
  },

  async validateKey(rawKey: string): Promise<{ valid: boolean; apiKey?: ApiKey; error?: string }> {
    if (!rawKey.startsWith('ee_')) return { valid: false, error: 'Invalid key format' };
    const hash = await sha256(rawKey);
    const key = apiKeys.find(k => k.keyHash === hash);
    if (!key) return { valid: false, error: 'Unknown API key' };
    if (key.revoked) return { valid: false, error: 'API key has been revoked' };
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      return { valid: false, error: 'API key has expired' };
    }
    key.lastUsedAt = new Date().toISOString();
    return { valid: true, apiKey: key };
  },

  listKeys(tenantId: string): ApiKey[] {
    return apiKeys.filter(k => k.tenantId === tenantId);
  },

  getKey(id: string, tenantId: string): ApiKey | undefined {
    return apiKeys.find(k => k.id === id && k.tenantId === tenantId);
  },

  revokeKey(id: string, tenantId: string): boolean {
    const k = apiKeys.find(kk => kk.id === id && kk.tenantId === tenantId);
    if (!k) return false;
    k.revoked = true;
    return true;
  },

  deleteKey(id: string, tenantId: string): boolean {
    const idx = apiKeys.findIndex(k => k.id === id && k.tenantId === tenantId);
    if (idx === -1) return false;
    apiKeys.splice(idx, 1);
    return true;
  },
};
