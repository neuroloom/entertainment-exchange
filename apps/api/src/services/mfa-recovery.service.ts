// MFA recovery — account recovery flow for lost 2FA devices
interface RecoveryCode {
  userId: string;
  tenantId: string;
  codes: string[];     // Hashed single-use recovery codes
  generatedAt: string;
}

const recoveryCodes: RecoveryCode[] = [];
const CODE_COUNT = 10;

async function hash(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export const mfaRecovery = {
  async generateCodes(userId: string, tenantId: string): Promise<string[]> {
    // Remove existing codes
    const existing = recoveryCodes.findIndex(r => r.userId === userId && r.tenantId === tenantId);
    if (existing >= 0) recoveryCodes.splice(existing, 1);

    const rawCodes: string[] = [];
    for (let i = 0; i < CODE_COUNT; i++) {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      rawCodes.push(Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, 10));
    }

    const hashed = await Promise.all(rawCodes.map(c => hash(c)));
    recoveryCodes.push({ userId, tenantId, codes: hashed, generatedAt: new Date().toISOString() });

    return rawCodes; // Return once — never stored in plaintext
  },

  async verifyRecoveryCode(userId: string, tenantId: string, code: string): Promise<boolean> {
    const r = recoveryCodes.find(rr => rr.userId === userId && rr.tenantId === tenantId);
    if (!r || r.codes.length === 0) return false;

    const codeHash = await hash(code);
    const idx = r.codes.findIndex(c => c === codeHash);
    if (idx === -1) return false;

    // Remove used code (single-use)
    r.codes.splice(idx, 1);

    // If all codes used, generate new set
    if (r.codes.length === 0) {
      await this.generateCodes(userId, tenantId);
    }

    return true;
  },

  getRemainingCodes(userId: string, tenantId: string): number {
    const r = recoveryCodes.find(rr => rr.userId === userId && rr.tenantId === tenantId);
    return r?.codes.length ?? 0;
  },
};
