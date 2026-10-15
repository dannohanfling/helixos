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

/**
 * A proof line that states a number: digits, money, a percentage, or a count in words ("three clients", "doubled"). Until Danno
 * picks the proof for a webinar, public pages hide these (H-21 A): a figure on a page is a claim he hasn't chosen to make.
 */
export function hasNumbers(text: string): boolean {
  return /[\d$€£%]|\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|double[ds]?|tripled?|percent)\b/i.test(text);
}

/**
 * The quote without its own attribution, so the name shows once, under it (H-21 A). Strips a trailing "— Name …", "- Name",
 * "~ Name" or "(Name)" and a leading "Name:" when Name is who said it (full name or first name).
 */
export function quoteOnce(quote: string, who: string): string {
  const name = who.trim();
  if (!name) return quote.trim();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The full name, the first name, and the initial forms a Proof Bank entry carries ("Kim Y.", "K. Yates") for the same person (H-142).
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const forms = [name, first, last && `${first} ${last[0]}.`, last && `${first} ${last[0]}`, last && `${first[0]}. ${last}`, last && `${first[0]} ${last}`].filter(Boolean) as string[];
  const names = [...new Set(forms)].map(esc).join("|");
  let q = quote.trim();
  q = q.replace(new RegExp(`\\s*(?:[-–—~]+\\s*|\\(\\s*)(?:${names})\\b[^"”]*$`, "i"), "");
  q = q.replace(new RegExp(`^(?:${names})\\s*:\\s*`, "i"), "");
  q = q.replace(/^["“]+|["”]+$/g, "").trim();
  return q || quote.trim();
}
