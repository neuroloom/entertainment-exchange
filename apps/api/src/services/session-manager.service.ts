// Session manager — active session tracking, listing, and revocation
import { v4 as uuid } from 'uuid';

export interface UserSession {
  id: string;
  tenantId: string;
  userId: string;
  tokenJti: string;          // JWT ID for linking to tokens
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  revoked: boolean;
}

const sessions: UserSession[] = [];
const MAX_SESSIONS_PER_USER = 10;

export const sessionManager = {
  create(opts: {
    tenantId: string;
    userId: string;
    tokenJti: string;
    ipAddress?: string;
    userAgent?: string;
    ttlMs?: number;
  }): UserSession {
    // Enforce max sessions per user — revoke oldest
    const userSessions = sessions.filter(
      s => s.userId === opts.userId && s.tenantId === opts.tenantId && !s.revoked,
    );
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
      userSessions.slice(0, userSessions.length - MAX_SESSIONS_PER_USER + 1)
        .forEach(s => { s.revoked = true; });
    }

    const now = new Date();
    const ttl = opts.ttlMs ?? 15 * 60 * 1000; // 15 min default

    const session: UserSession = {
      id: uuid(), tenantId: opts.tenantId, userId: opts.userId,
      tokenJti: opts.tokenJti, ipAddress: opts.ipAddress, userAgent: opts.userAgent,
      createdAt: now.toISOString(), lastActivityAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      revoked: false,
    };
    sessions.push(session);
    return session;
  },

  touch(sessionId: string): boolean {
    const s = sessions.find(ss => ss.id === sessionId && !ss.revoked);
    if (!s) return false;
    s.lastActivityAt = new Date().toISOString();
    return true;
  },

  revoke(sessionId: string, tenantId: string): boolean {
    const s = sessions.find(ss => ss.id === sessionId && ss.tenantId === tenantId);
    if (!s || s.revoked) return false;
    s.revoked = true;
    return true;
  },

  revokeAllForUser(userId: string, tenantId: string): number {
    let count = 0;
    for (const s of sessions) {
      if (s.userId === userId && s.tenantId === tenantId && !s.revoked) {
        s.revoked = true;
        count++;
      }
    }
    return count;
  },

  isValid(sessionId: string): boolean {
    const s = sessions.find(ss => ss.id === sessionId);
    if (!s || s.revoked) return false;
    if (new Date(s.expiresAt) < new Date()) {
      s.revoked = true;
      return false;
    }
    return true;
  },

  listForUser(userId: string, tenantId: string): UserSession[] {
    return sessions
      .filter(s => s.userId === userId && s.tenantId === tenantId)
      .map(({ tokenJti, ...rest }) => rest as UserSession); // Don't expose JTI
  },

  listAll(tenantId: string): UserSession[] {
    return sessions.filter(s => s.tenantId === tenantId);
  },

  stats(tenantId: string): { active: number; total: number } {
    const tenant = sessions.filter(s => s.tenantId === tenantId);
    return {
      active: tenant.filter(s => !s.revoked && new Date(s.expiresAt) > new Date()).length,
      total: tenant.length,
    };
  },

  cleanup(): number {
    const now = new Date();
    let count = 0;
    for (const s of sessions) {
      if (!s.revoked && new Date(s.expiresAt) < now) {
        s.revoked = true;
        count++;
      }
    }
    return count;
  },
};
