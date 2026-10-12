/**
 * The platforms a member works in beside HelixOS (Danno, 7 Oct): outbound links only, shown to coaches, clients and team
 * members alike, in the sidebar's Platforms section and on the phone's Everything menu. One list, so another platform is one
 * line here and nowhere else. Each opens in a new tab and reaches no HelixOS data.
 *
 * Rev 843: the addresses are the coach's to set on Settings → Workspace, so a new domain is one edit; the ones here are what
 * shows until then. Community has no default: it shows once the coach sets the workspace's community link, or a member has
 * their own (the pass community address on the Community page).
 */
export type PlatformKey = "cl" | "academy" | "oms" | "community";
export type Platform = { key: PlatformKey; href: string; label: string; line: string; icon: string };
export type PlatformLinks = Partial<Record<PlatformKey, string>>;

export const PLATFORMS: Platform[] = [
  { key: "cl", href: "https://communityloyalty.io", label: "Community Loyalty", line: "your chatbot and automations", icon: "🤖" },
  { key: "academy", href: "https://academy.evolveomega.com", label: "Academy", line: "courses and community", icon: "🎓" },
  { key: "oms", href: "https://app.evolveomega.com", label: "Omnichannel Marketing System", line: "CRM, calendar, funnels", icon: "💸" },
  { key: "community", href: "", label: "Community", line: "where your people meet", icon: "🏛️" },
];

/** An address the coach may set: https only, a real host, at most 300 characters. Anything else is not kept. */
export function cleanPlatformLink(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > 300) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Where a platform link goes for this member: the member's own community first, then the coach's setting, then the default. */
export function platformHref(key: PlatformKey, links: PlatformLinks, ownCommunity?: string | null): string {
  if (key === "community" && cleanPlatformLink(ownCommunity)) return cleanPlatformLink(ownCommunity)!;
  return cleanPlatformLink(links[key]) ?? PLATFORMS.find((p) => p.key === key)?.href ?? "";
}
