import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  experimental: {
    viewTransition: true,
  },
  async rewrites() {
    if (!process.env.VERCEL) return [];
    return [{ source: '/uploads/:path*', destination: '/api/uploads/:path*' }];
  },
};

export default nextConfig;
