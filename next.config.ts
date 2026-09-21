import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { optimizePackageImports: ["lucide-react"] },
  // The DBPR index is read from disk at runtime, not imported, so Next's file
  // tracing cannot see it. DBPR blocks datacenter IPs, so without this the
  // deployed app has no contact data at all.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
