import type { NextConfig } from "next";

const REDIS_CONFIGURED = Boolean(
  (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
);

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  // Auto-memoizes every client component — keeps typing in the big forms
  // (DailyForm, DataOverallWorkbench) smooth without manual memo() work.
  reactCompiler: true,
  // Chromium and puppeteer must stay outside the bundle — the binary is loaded
  // from disk at runtime (see lib/pdf.ts).
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  // Externalizing alone isn't enough on Vercel: the brotli-packed Chromium in
  // bin/ is opened with computed fs paths the tracer can't follow, so without
  // this the lambda ships the JS but not the browser and the PDF routes 500
  // ("input directory .../bin does not exist").
  outputFileTracingIncludes: {
    '/api/pdf/**': ['node_modules/@sparticuz/chromium/bin/**/*'],
  },
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
