import type { NextConfig } from "next";

const REDIS_CONFIGURED = Boolean(
  (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
);

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // `next dev` refuses its own scripts to any origin but localhost, so the app
  // opened through a Cloudflare quick tunnel rendered but never hydrated.
  allowedDevOrigins: ['*.trycloudflare.com'],
  // Auto-memoizes every client component — keeps typing in the big forms
  // (DailyForm, DataOverallWorkbench) smooth without manual memo() work.
  reactCompiler: true,
  // Chromium and puppeteer must stay outside the bundle — the binary is
  // downloaded at runtime by chromium-min (see lib/pdf.ts).
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium-min'],
  cacheComponents: true,
  experimental: {
    viewTransition: true,
  },
  async rewrites() {
    // Photos live outside public/ (Redis, or /tmp on Vercel) whenever the
    // filesystem isn't the store — serve them through the API route.
    if (!process.env.VERCEL && !REDIS_CONFIGURED) return [];
    return [{ source: '/uploads/:path*', destination: '/api/uploads/:path*' }];
  },
};

export default nextConfig;
