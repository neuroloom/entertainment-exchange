// TOTP service — time-based one-time password generation and verification
// RFC 6238 compliant, compatible with Google Authenticator, Authy, etc.

interface TotpConfig {
  tenantId: string;
  userId: string;
  secret: string;         // Base32-encoded
  enabled: boolean;
  verified: boolean;
  backupCodes: string[];  // Hashed
  createdAt: string;
}

const configs: TotpConfig[] = [];
const BACKUP_CODE_COUNT = 8;

// Base32 helpers (RFC 4648)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateSecret(): string {
  const bytes = new Uint8Array(20); // 160-bit
  crypto.getRandomValues(bytes);
  let result = '';
  let buffer = 0;
  let bitsLeft = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      result += BASE32_ALPHABET[(buffer >>> (bitsLeft - 5)) & 31];
      bitsLeft -= 5;
    }
  }
  if (bitsLeft > 0) result += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 31];
  return result;
}

function base32ToBytes(b32: string): Uint8Array {
  const cleaned = b32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (const c of cleaned) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(c);
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bytes.push((buffer >>> (bitsLeft - 8)) & 255);
      bitsLeft -= 8;
    }
  }
  return new Uint8Array(bytes);
}

async function generateTotp(secretBytes: Uint8Array, timeStep = 30, digits = 6): Promise<string> {
  let counterVal = Math.floor(Date.now() / 1000 / timeStep);
  const counterBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = counterVal & 0xFF;
    counterVal = Math.floor(counterVal / 256);
  }

  const key = await crypto.subtle.importKey('raw', secretBytes as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hmac = await crypto.subtle.sign('HMAC', key, counterBytes as BufferSource);
  const hmacBytes = new Uint8Array(hmac);
  const offset = hmacBytes[19] & 0xF;
  const binCode = ((hmacBytes[offset] & 0x7F) << 24)
    | ((hmacBytes[offset + 1] & 0xFF) << 16)
    | ((hmacBytes[offset + 2] & 0xFF) << 8)
    | (hmacBytes[offset + 3] & 0xFF);
  return String(binCode % Math.pow(10, digits)).padStart(digits, '0');
}

function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  });
}

async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(code));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export const totpService = {
  async setup(userId: string, tenantId: string): Promise<{ secret: string; uri: string; backupCodes: string[] }> {
    // Remove existing
    const idx = configs.findIndex(c => c.userId === userId && c.tenantId === tenantId);
    if (idx >= 0) configs.splice(idx, 1);

    const secret = generateSecret();
    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map(c => hashCode(c)));

    configs.push({
      tenantId, userId, secret,
      enabled: false, verified: false,
      backupCodes: hashedCodes,
      createdAt: new Date().toISOString(),
    });

    const issuer = encodeURIComponent('EntEx');
    const label = encodeURIComponent(userId);
    const uri = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

    return { secret, uri, backupCodes };
  },

  async verify(userId: string, tenantId: string, token: string): Promise<{ valid: boolean; error?: string }> {
    const config = configs.find(c => c.userId === userId && c.tenantId === tenantId);
    if (!config) return { valid: false, error: '2FA not set up' };

    // Check backup codes (hashed comparison)
    const tokenHash = await hashCode(token);
    const bcIdx = config.backupCodes.findIndex(c => c === tokenHash);
    if (bcIdx >= 0) {
      // Remove used backup code
      config.backupCodes.splice(bcIdx, 1);
      return { valid: true };
    }

    try {
      const secretBytes = base32ToBytes(config.secret);
      const expected = await generateTotp(secretBytes);
      if (token === expected) {
        if (!config.verified) {
          config.verified = true;
          config.enabled = true;
        }
        return { valid: true };
      }
      return { valid: false, error: 'Invalid code' };
    } catch {
      return { valid: false, error: 'Verification failed' };
    }
  },

  disable(userId: string, tenantId: string): boolean {
    const config = configs.find(c => c.userId === userId && c.tenantId === tenantId);
    if (!config) return false;
    config.enabled = false;
    config.verified = false;
    return true;
  },

  isEnabled(userId: string, tenantId: string): boolean {
    return configs.some(c => c.userId === userId && c.tenantId === tenantId && c.enabled);
  },

  getStatus(userId: string, tenantId: string): { configured: boolean; enabled: boolean; backupCodesRemaining: number } {
    const c = configs.find(cc => cc.userId === userId && cc.tenantId === tenantId);
    return {
      configured: !!c,
      enabled: c?.enabled ?? false,
      backupCodesRemaining: c?.backupCodes.length ?? 0,
    };
  },
};
