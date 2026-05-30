import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["gx10-5442.tail72d5cd.ts.net"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8001/:path*", // Proxy to Backend
      },
    ];
  },
};

export default nextConfig;
