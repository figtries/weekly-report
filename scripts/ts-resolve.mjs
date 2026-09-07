/**
 * Lets a plain `node scripts/*.ts` run import the app's own `lib/` modules.
 *
 * Those modules import each other the way Next resolves them — `./progress`,
 * no extension — which node's ESM resolver rejects. Rewriting the imports to
 * satisfy a handful of scripts would be the tail wagging the dog, so the
 * scripts carry the resolver instead.
 *
 * Used as: node --import ./scripts/ts-resolve.mjs scripts/verify-worklist.ts
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
    const base = new URL(specifier, context.parentURL).href;
    for (const suffix of ['.ts', '.tsx', '/index.ts']) {
      if (existsSync(fileURLToPath(base + suffix))) return next(specifier + suffix, context);
    }
  }
  return next(specifier, context);
}

// Self-registering: `--import` runs this file on the main thread, and
// `register` then loads it again as the hook module.
register(import.meta.url);
