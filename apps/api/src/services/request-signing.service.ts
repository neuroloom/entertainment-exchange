// Request signing — HMAC-SHA256 verification for incoming webhooks
interface SigningKey { id: string; tenantId: string; key: string; algorithm: 'hmac-sha256'; createdAt: string; }
const keys: SigningKey[] = [];

export const requestSigning = {
  registerKey(tenantId: string, key: string): SigningKey {
    const sk: SigningKey = { id: crypto.randomUUID(), tenantId, key, algorithm: 'hmac-sha256', createdAt: new Date().toISOString() };
    keys.push(sk);
    return sk;
  },

  listKeys(tenantId: string): SigningKey[] {
    return keys.filter(k => k.tenantId === tenantId);
  },

  deleteKey(id: string, tenantId: string): boolean {
    const idx = keys.findIndex(k => k.id === id && k.tenantId === tenantId);
    if (idx === -1) return false;
    keys.splice(idx, 1);
    return true;
  },

  async sign(tenantId: string, payload: string): Promise<{ signature: string; timestamp: string; keyId: string } | null> {
    const key = keys.find(k => k.tenantId === tenantId);
    if (!key) return null;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
    const signature = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');

    return { signature: `t=${timestamp},v1=${signature}`, timestamp, keyId: key.id };
  },

  async verify(tenantId: string, signature: string, payload: string, maxAgeSeconds: number = 300): Promise<boolean> {
    const key = keys.find(k => k.tenantId === tenantId);
    if (!key) return false;

    const parts: Record<string, string> = {};
    for (const part of signature.split(',')) {
      const [k, v] = part.split('=');
      parts[k] = v;
    }

    if (!parts.t || !parts.v1) return false;

    const age = Math.floor(Date.now() / 1000) - parseInt(parts.t);
    if (Math.abs(age) > maxAgeSeconds) return false;

    const message = `${parts.t}.${payload}`;
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = new Uint8Array(parts.v1.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    return crypto.subtle.verify('HMAC', cryptoKey, sigBytes, encoder.encode(message));
  },
};
