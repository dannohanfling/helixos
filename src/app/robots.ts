import type { MetadataRoute } from "next";

/** A logged-in app: search engines are told to stay out. noindex on the pages is the belt; this is the braces. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
