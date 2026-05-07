// Auth plugin — JWT sign/verify with jose, Fastify plugin for Bearer token extraction
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as jose from 'jose';

// ---------- Config ----------
const JWT_ALG = 'HS256';
const JWT_EXPIRY = '24h';

let _secretKey: Uint8Array | null = null;

function getSecretKey(): Uint8Array {
  if (_secretKey) return _secretKey;
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  // HS256 requires key length >= 256 bits (32 bytes)
  // We derive a consistent key from the secret string
  _secretKey = new TextEncoder().encode(secret);
  if (_secretKey.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters for HS256');
  }
  return _secretKey;
}

// ---------- JWT Payload ----------
export interface JwtPayload {
  sub: string;       // userId
  tenant: string;    // tenantId
  permissions: string[];
  // standard claims
  iat?: number;
  exp?: number;
}

// ---------- Public API ----------

/**
 * Create a signed JWT for the given user.
 */
export async function createToken(
  userId: string,
  tenantId: string,
  permissions: string[],
): Promise<string> {
  const secret = getSecretKey();
  return await new jose.SignJWT({
    tenant: tenantId,
    permissions,
  })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(secret);
}

/**
 * Verify and decode a JWT. Returns the payload or null if invalid.
 */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const secret = getSecretKey();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    // Validate shape
    if (!payload.sub || !payload.tenant || !Array.isArray(payload.permissions)) {
      return null;
    }
    return {
      sub: payload.sub,
      tenant: payload.tenant as string,
      permissions: payload.permissions as string[],
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

// ---------- Fastify Plugin ----------
// This plugin reads the Authorization: Bearer <token> header and populates
// req.ctx with the decoded JWT info. If the token is missing or invalid,
// the request continues with a default anonymous context — authorization
// is enforced at the route level, not the plugin level.

export async function authPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return; // No token — leave ctx as-is (anonymous)

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return;

    const token = parts[1];
    const payload = await verifyToken(token);
    if (!payload) return; // Invalid — leave as anonymous

    // Merge JWT claims into the existing ctx
    const reqCtx = (req as any).ctx;
    if (reqCtx) {
      (req as any).ctx = {
        ...reqCtx,
        tenantId: payload.tenant,
        actor: {
          ...reqCtx.actor,
          id: payload.sub,
          userId: payload.sub,
          permissions: payload.permissions,
        },
      };
    }
  });
}
