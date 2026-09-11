import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy. Next.js needs inline scripts and styles for hydration and Tailwind's runtime classes, so those stay
 * inline-allowed; everything else is same-origin. Images may come from anywhere over HTTPS because posts preview remote media.
 * No `frame-ancestors` and no X-Frame-Options: the app may one day be embedded inside GoHighLevel.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // A lead magnet upload rides in a server action; eight megabytes covers a designed PDF and stays under Vercel's request cap.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
