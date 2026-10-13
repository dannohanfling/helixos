/** Small pure rules for Hermes's settings and pages: the thank-you video, the pixel id, the photos. */

/**
 * The thank-you video: a YouTube link (watch, youtu.be, shorts, embed or live) becomes its youtube-nocookie.com embed. Anything
 * else is refused, so the page never frames a host the security policy doesn't name.
 */
export function youtubeEmbed(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = m?.[1] ?? null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
}

/** A Meta Pixel id is digits only (15 or 16 today); anything else is not kept. */
export function cleanPixelId(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, "");
  return /^\d{6,20}$/.test(s) ? s : null;
}

/** Meta's no-script beacon: an image request, no script and no personal data, only the event name. */
export const pixelBeacon = (pixelId: string, event: "PageView" | "CompleteRegistration") =>
  `https://www.facebook.com/tr?id=${encodeURIComponent(pixelId)}&ev=${event}&noscript=1`;

/** The 43-character Magic funnel code (32 random bytes, base64url), the only key a personal page is found by. */
export const isPageCode = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s);

/** A webinar id as HelixOS makes them, checked before it reaches a query. */
export const isWebinarId = (s: string) => /^[A-Za-z0-9_-]{8,64}$/.test(s);

/** Email as the form sends it: trimmed, lower case, one @, a dot after it, at most 254 characters. */
export function cleanEmail(raw: unknown): string | null {
  const s = (typeof raw === "string" ? raw : "").trim().toLowerCase();
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}
