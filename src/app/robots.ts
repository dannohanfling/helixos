import type { MetadataRoute } from "next";
import { LEGAL_SLUGS } from "@/lib/engine/legal";

/**
 * A logged-in app: search engines are told to stay out, except for the six public pages (H-331: privacy, terms, support,
 * delete account, AI and your Board, community guidelines), which the app stores point at. noindex on the app's pages is the
 * belt; this is the braces.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: LEGAL_SLUGS.map((s) => `/${s}`), disallow: "/" }] };
}
