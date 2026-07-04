import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second dev server (e.g. an agent's preview) run alongside the main
  // one without fighting over the .next lockfile.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  experimental: {
    viewTransition: true,
  },
};

export default nextConfig;
