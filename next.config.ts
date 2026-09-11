import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
// A lead magnet file goes from the browser straight to the bucket, so the bucket's API is the one cross-origin connection the
// page may open. Vercel Blob's API lives under vercel.com; locally the SDK is pointed at scripts/mock-blob.ts.
// Nothing renders a stored file inside a page today: the editor and the hosted page link to the PDF and the uploaded file,
// and a link navigation is governed by neither connect-src nor img-src. The rule from here: the feature that first renders a
// stored file inside a page (a magnet cover in the grid: img-src narrowed to the blob host; an in-app PDF preview: frame-src
// or object-src) owns its directive, and never leans on the permissive img-src that happens to be there.
// Scoped to the API's own path, not the whole host: a CSP source with a trailing slash matches that path prefix only.
const blobApi = new URL(process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL || "https://vercel.com/api/blob");
const blobApiSource = `${blobApi.origin}${blobApi.pathname.replace(/\/?$/, "/")}`;

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
  `connect-src 'self' ${blobApiSource}${dev ? " ws: wss:" : ""}`,
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
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
