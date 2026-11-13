import { createHmac, timingSafeEqual } from 'node:crypto';

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

/**
 * Short-lived HMAC token for gating /print/* routes.
 * Payload: `{userId}|{resource}|{exp}` — base64url-encoded, dot-separated from its hex sig.
 */
export function generatePdfToken(userId: string, resource: string, expiresIn = 300): string {
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const payload = `${userId}|${resource}|${exp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyPdfToken(token: string): { userId: string; resource: string } | null {
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const b64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const payload = Buffer.from(b64, 'base64url').toString('utf8');
    const expected = createHmac('sha256', secret()).update(payload).digest('hex');
    // Constant-time compare to prevent timing attacks.
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
    const parts = payload.split('|');
    if (parts.length < 3) return null;
    const [userId, resource, expStr] = parts;
    if (!userId || !resource || !expStr) return null;
    if (Math.floor(Date.now() / 1000) > Number(expStr)) return null;
    return { userId, resource };
  } catch {
    return null;
  }
}
