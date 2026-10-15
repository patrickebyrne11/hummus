import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BeanCounter: the agent, policy guard, Stripe and Cognee live in the Python API.
  async rewrites() {
    return [{ source: "/bc/:path*", destination: `${process.env.BEANCOUNTER_API ?? "http://127.0.0.1:8000"}/:path*` }];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
