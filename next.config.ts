import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "covers.openlibrary.org",
      },
    ],
  },
  async redirects() {
    return [
      { source: "/universe", destination: "/nebula", permanent: true },
      { source: "/universe/:path*", destination: "/nebula", permanent: true },
      { source: "/world", destination: "/nebula", permanent: true },
      { source: "/world/:path*", destination: "/nebula", permanent: true },
    ];
  },
};

export default nextConfig;
