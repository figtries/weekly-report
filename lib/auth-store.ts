import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { existsSync, promises as fs, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { AREAS, type Account, type Role } from '@/lib/roles';
import { redisConfigured, redisGet, redisSet } from '@/lib/storage';

/*
 * Real sign-in (12 Nov 2026). Accounts, the Master's roles and the open
 * sessions are ONE document: Redis on the deployment (every lambda sees the
 * same one), `data/auth.json` on a developer machine. Passwords are scrypt
 * hashes and never leave this file; the browser's copy (`lib/signed-in.ts`) is
 * a cache of what `publicAccount` returns. While the document holds no account,
 * /login offers to create the first Master, and nothing else opens.
 */

/** `sealed` is the password itself, encrypted, so a Master can read it back (see `sealPassword`). */
export type StoredAccount = Omit<Account, 'password'> & { hash: string; sealed?: string };
interface Session { id: string; exp: number }
export interface AuthDoc { accounts: StoredAccount[]; roles: Role[] | null; sessions: Record<string, Session> }

export const SESSION_COOKIE = 'lucille_session';
export const SESSION_DAYS = 30;

const KEY = 'weekly-report:auth';
const FILE = path.join(process.cwd(), 'data', 'auth.json');
const EMPTY: AuthDoc = { accounts: [], roles: null, sessions: {} };

export async function readAuth(): Promise<AuthDoc> {
  let raw: string | null = null;
  if (redisConfigured) raw = await redisGet(KEY);
  else raw = await fs.readFile(FILE, 'utf-8').catch(() => null);
  return raw ? { ...EMPTY, ...(JSON.parse(raw) as AuthDoc) } : structuredClone(EMPTY);
}

// ponytail: one document, one writer at a time per instance; two lambdas writing
// in the same instant can drop one write (same single-writer trade as the db).
let queue: Promise<unknown> = Promise.resolve();
export function mutateAuth<T>(fn: (doc: AuthDoc) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const doc = await readAuth();
    const out = await fn(doc);
    const now = Date.now();
    for (const [t, s] of Object.entries(doc.sessions)) if (s.exp < now) delete doc.sessions[t];
    const raw = JSON.stringify(doc);
    if (redisConfigured) await redisSet(KEY, raw);
    else await fs.writeFile(FILE, raw);
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function checkPassword(pw: string, stored: string): boolean {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const want = Buffer.from(hex, 'hex');
  const got = scryptSync(pw, salt, 64);
  return got.length === want.length && timingSafeEqual(got, want);
}

/*
 * A Master can read every account's password back (asked for 12 Nov 2026), so
 * beside the hash that sign-in checks, the password is kept encrypted
 * (AES-256-GCM). The key is never in the document: AUTH_SECRET if set, else the
 * Redis token the deployment already holds, else `data/auth.key` on a disk.
 * ponytail: with the Redis token as the key, rotating that token makes the
 * stored passwords unreadable (sign-in still works; they are sealed again at
 * each account's next sign-in). Set AUTH_SECRET to make it independent.
 */
const KEY_FILE = path.join(process.cwd(), 'data', 'auth.key');
function sealKey(): Buffer {
  let secret = process.env.AUTH_SECRET || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!secret) {
    if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString('hex'));
    secret = readFileSync(KEY_FILE, 'utf-8').trim();
  }
  return createHash('sha256').update(secret).digest();
}

export function sealPassword(pw: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([c.update(pw, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

/** The password, or null when none was kept or the key has changed since. */
export function openPassword(sealed: string | undefined): string | null {
  if (!sealed) return null;
  try {
    const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', sealKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const newToken = () => randomBytes(32).toString('base64url');

export function publicAccount(a: StoredAccount): Account {
  const { hash: _hash, sealed: _sealed, ...rest } = a;
  return rest;
}

/** The account behind a session token, or null when it expired, was removed or is suspended. */
export function accountOf(doc: AuthDoc, token: string | undefined): StoredAccount | null {
  const s = token ? doc.sessions[token] : undefined;
  if (!s || s.exp < Date.now()) return null;
  const a = doc.accounts.find((x) => x.id === s.id);
  return a && a.status !== 'suspended' ? a : null;
}

export const allEdit = () => Object.fromEntries(AREAS.map((x) => [x.key, 'edit'])) as Account['access'];

export const stamp = () =>
  new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
