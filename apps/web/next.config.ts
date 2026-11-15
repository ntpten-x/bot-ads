import type { NextConfig } from "next";
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:4318";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(backend))
  throw new Error("BACKEND_URL must be a local HTTP server");
const config: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default config;
