// Auth plugin — JWT sign/verify with jose, permission enforcement, CORS
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import * as jose from 'jose';

// ── Config ──────────────────────────────────────────────────────────────────

const JWT_ALG = 'HS256';
const JWT_EXPIRY = '15m';        // Short-lived access token
const REFRESH_EXPIRY_DAYS = 7;    // Long-lived refresh token
const REFRESH_TOKEN_BYTES = 32;

let _secretKey: Uint8Array | null = null;

function getSecretKey(): Uint8Array {
  if (_secretKey) return _secretKey;
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  _secretKey = new TextEncoder().encode(secret);
  if (_secretKey.length < 32) throw new Error('JWT_SECRET must be at least 32 characters for HS256');
  return _secretKey;
}

// ── Token helpers ───────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  tenant: string;
  permissions: string[];
  iat?: number;
  exp?: number;
}

export async function createToken(userId: string, tenantId: string, permissions: string[]): Promise<string> {
  const secret = getSecretKey();
  return new jose.SignJWT({ tenant: tenantId, permissions })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const secret = getSecretKey();
    const { payload } = await jose.jwtVerify(token, secret, { algorithms: [JWT_ALG] });
    if (!payload.sub || !payload.tenant || !Array.isArray(payload.permissions)) return null;
    return {
      sub: payload.sub, tenant: payload.tenant as string,
      permissions: payload.permissions as string[],
      iat: payload.iat, exp: payload.exp,
    };
  } catch { return null; }
}

// ── Refresh token ───────────────────────────────────────────────────────────

export function generateRefreshToken(): string {
  const bytes = new Uint8Array(REFRESH_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function refreshTokenExpiresAt(): number {
  return Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}

// ── withAuth — route-level permission enforcement ────────────────────────────

export interface PermissionSet {
  permissions: string[];
}

export function withAuth(...required: string[]): preHandlerHookHandler {
  return async (req: FastifyRequest) => {
    const ctx = (req as any).ctx;
    if (!ctx?.actor?.userId) throw unauthorized();
    if (required.length === 0) return; // auth only, no specific permissions
    const has = new Set(ctx.actor.permissions ?? []);
    const missing = required.filter(p => !has.has(p));
    if (missing.length > 0) throw forbidden(`Missing permissions: ${missing.join(', ')}`);
  };
}

function unauthorized(): Error {
  const err = new Error('Authentication required');
  (err as any).statusCode = 401;
  (err as any).code = 'UNAUTHENTICATED';
  return err;
}

function forbidden(msg: string): Error {
  const err = new Error(msg);
  (err as any).statusCode = 403;
  (err as any).code = 'FORBIDDEN';
  return err;
}

// ── Fastify Plugin ──────────────────────────────────────────────────────────

export async function authPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return;
    const payload = await verifyToken(parts[1]);
    if (!payload) return;
    const reqCtx = (req as any).ctx;
    if (reqCtx) {
      (req as any).ctx = {
        ...reqCtx,
        tenantId: payload.tenant,
        actor: {
          ...reqCtx.actor,
          id: payload.sub, userId: payload.sub,
          permissions: payload.permissions,
        },
      };
    }
  });
}
