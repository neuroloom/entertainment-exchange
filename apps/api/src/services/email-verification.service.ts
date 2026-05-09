// Email verification service — token-based email confirmation on registration
import { v4 as uuid } from 'uuid';

interface VerificationToken {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  token: string;
  expiresAt: string;
  verified: boolean;
  createdAt: string;
}

const verifications: VerificationToken[] = [];
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const emailVerification = {
  createToken(tenantId: string, userId: string, email: string): { token: string; expiresAt: string } {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
    const vt: VerificationToken = {
      id: uuid(), tenantId, userId, email, token,
      expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
      verified: false, createdAt: new Date().toISOString(),
    };
    verifications.push(vt);
    return { token, expiresAt: vt.expiresAt };
  },

  verifyToken(rawToken: string): VerificationToken | null {
    const v = verifications.find(vv => vv.token === rawToken && !vv.verified);
    if (!v || new Date(v.expiresAt) < new Date()) return null;
    v.verified = true;
    return v;
  },

  isVerified(userId: string): boolean {
    return verifications.some(v => v.userId === userId && v.verified);
  },

  getStatus(userId: string): { verified: boolean; verifiedAt?: string } {
    const v = verifications.find(vv => vv.userId === userId && vv.verified);
    return { verified: !!v, verifiedAt: v?.expiresAt };
  },
};
