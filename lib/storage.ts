// Upstash-compatible Redis over REST (Vercel Marketplace "Upstash for Redis"
// sets KV_REST_API_*; a manual Upstash account sets UPSTASH_REDIS_REST_*).
// Plain fetch — no SDK needed, works in any runtime.
//
// Why this exists: on Vercel the filesystem is ephemeral and per-instance, so
// writing db.json to /tmp silently loses data whenever a request lands on a
// different (or freshly booted) lambda. Redis gives every instance the same
// durable view.

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const redisConfigured = Boolean(REST_URL && REST_TOKEN);

async function command<T>(cmd: string[]): Promise<T> {
  const res = await fetch(REST_URL!, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) {
    throw new Error(`Redis request failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { result?: T; error?: string };
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result as T;
}

export function redisGet(key: string): Promise<string | null> {
  return command<string | null>(['GET', key]);
}

export function redisSet(key: string, value: string): Promise<'OK'> {
  return command<'OK'>(['SET', key, value]);
}

export function redisDel(key: string): Promise<number> {
  return command<number>(['DEL', key]);
}
