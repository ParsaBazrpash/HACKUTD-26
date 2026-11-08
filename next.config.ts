import type { NextConfig } from "next";
import { canonicalHostRedirects } from "./lib/security/canonical-host";
import { pwaHeaders, securityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return canonicalHostRedirects({ VERCEL_ENV: process.env.VERCEL_ENV, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL });
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          spacetimeHost: process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || "wss://maincloud.spacetimedb.com",
          dev: process.env.NODE_ENV !== "production",
        }),
      },
      ...pwaHeaders(),
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
