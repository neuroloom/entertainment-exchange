// Password reset service — token-based forgot/reset flow with expiry
import { v4 as uuid } from 'uuid';

interface ResetToken {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  token: string;
  expiresAt: string;
  used: boolean;
  createdAt: string;
}

const tokens: ResetToken[] = [];
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export const passwordReset = {
  createToken(tenantId: string, userId: string, email: string): { token: string; expiresAt: string } {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    const rt: ResetToken = {
      id: uuid(), tenantId, userId, email, token,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      used: false, createdAt: new Date().toISOString(),
    };
    tokens.push(rt);
    return { token, expiresAt: rt.expiresAt };
  },

  validateToken(rawToken: string): ResetToken | null {
    const t = tokens.find(tt => tt.token === rawToken && !tt.used);
    if (!t || new Date(t.expiresAt) < new Date()) return null;
    return t;
  },

  consumeToken(rawToken: string, newPasswordHash: string, updatePassword: (userId: string, hash: string) => boolean): boolean {
    const t = this.validateToken(rawToken);
    if (!t) return false;
    const ok = updatePassword(t.userId, newPasswordHash);
    if (!ok) return false;
    t.used = true;
    return true;
  },

  cleanup(): number {
    const before = tokens.length;
    const now = new Date();
    const remaining = tokens.filter(t => new Date(t.expiresAt) >= now && !t.used);
    tokens.length = 0;
    tokens.push(...remaining);
    return before - tokens.length;
  },
};
