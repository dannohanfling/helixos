/** Maps HelixOS channels onto a client's connected GoHighLevel Social Planner accounts. Pure. */
import { CHANNEL_SPECS, type Channel } from "./repurpose";

export type Account = { id: string; name: string; platform: string; type: string; isExpired: boolean };

/** Channels the Social Planner can publish. Everything else is copy-and-paste by design. */
export const PUBLISHABLE: Record<Channel, { via: "facebook" | "instagram" | "linkedin" | "threads" | null; note: string }> = {
  fb_personal: { via: null, note: "Facebook doesn't allow posting to personal profiles through any API. Paste it." },
  fb_page: { via: "facebook", note: "Facebook page" },
  // Meta removed group posting for every third-party tool in April 2024 (Graph API v19: publish_to_groups and the Groups API
  // gone; group admins can no longer install apps). GoHighLevel connects Facebook as Pages only. A "group" post that works in
  // the Social Planner today is a HighLevel Community, not a Facebook group.
  fb_group: { via: null, note: "Facebook removed group posting for every third-party tool in April 2024. Paste it." },
  other_groups: { via: null, note: "Other people's groups are posted by hand, which also keeps you inside their rules." },
  stories: { via: "instagram", note: "Instagram story (needs a photo or video)" },
  instagram: { via: "instagram", note: "Instagram business account" },
  threads: { via: "threads", note: "Threads profile (connected through Instagram in the Social Planner)" },
  linkedin: { via: "linkedin", note: "LinkedIn profile or page" },
  email: { via: null, note: "Email goes out through your email tool, not the Social Planner." },
  skool: { via: null, note: "Skool has no posting API. Paste it." },
};

/** The outside service a channel publishes to, as the client knows it: the name a reason sentence may use. */
const PLATFORM_NAMES: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn" };
export const platformName = (channel: string): string => PLATFORM_NAMES[PUBLISHABLE[channel as Channel]?.via ?? ""] ?? "the platform";

/** The Social Planner post type for a channel. */
export function postTypeFor(channel: Channel): "post" | "story" | "reel" {
  return channel === "stories" ? "story" : "post";
}

/** Facebook groups need type=group; pages type=page; LinkedIn profile or page both fine. */
function fits(channel: Channel, a: Account): boolean {
  const p = a.platform.toLowerCase();
  const t = a.type.toLowerCase();
  switch (channel) {
    case "fb_page":
      return p === "facebook" && t !== "group";
    case "fb_group":
      return p === "facebook" && t === "group";
    case "instagram":
    case "stories":
      return p === "instagram";
    case "linkedin":
      return p === "linkedin";
    case "threads":
      return p === "threads" || t === "threads";
    default:
      return false;
  }
}

/** Fills in any channel that has an obvious match, keeping choices the user already made, an explicit "don't" ("") included. */
export function autoMap(accounts: Account[], existing: Record<string, string> = {}): Record<string, string> {
  const live = accounts.filter((a) => !a.isExpired);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(existing)) if (PUBLISHABLE[k as Channel]?.via && (v === "" || live.some((a) => a.id === v))) out[k] = v;
  for (const ch of Object.keys(PUBLISHABLE) as Channel[]) {
    if (ch in out || !PUBLISHABLE[ch].via) continue;
    const matches = live.filter((a) => fits(ch, a));
    if (matches.length >= 1) out[ch] = matches[0].id;
  }
  return out;
}

/**
 * The part of a Social Planner account id that names the page or profile itself: GoHighLevel composes the id as an OAuth
 * prefix, an underscore and the platform's own id, and the prefix changes whenever the account is reconnected in GoHighLevel
 * (rev 567: Instagram reconnected, the stored id refused with a 422 while the same account posted fine from the planner).
 */
export const originId = (id: string): string => (id.includes("_") ? id.slice(id.lastIndexOf("_") + 1) : id);

/**
 * The live account that is the same page or profile as a stored id the planner no longer knows: the one fitting the channel
 * with the same origin id, else the one account that fits the channel at all. Null when the stored id is still live, or
 * when nothing can be said for sure (two fitting accounts and no origin match: the member picks on Settings).
 */
export function healAccountId(stale: string, accounts: Account[], channel: Channel): string | null {
  const live = accounts.filter((a) => !a.isExpired);
  if (live.some((a) => a.id === stale)) return null;
  const fitting = live.filter((a) => fits(channel, a));
  const same = fitting.filter((a) => originId(a.id) === originId(stale));
  if (same.length === 1) return same[0].id;
  return fitting.length === 1 ? fitting[0].id : null;
}

/** An account id as a log line or a reason may show it: the tail, so a long composite id stays readable and the prefix is not repeated. */
export const shortAccountId = (id: string): string => (id.length > 20 ? `…${id.slice(-20)}` : id);

/** Candidate accounts for a channel's dropdown. */
export function candidates(channel: Channel, accounts: Account[]): Account[] {
  return accounts.filter((a) => fits(channel, a));
}

export function readiness(mapping: Record<string, string>): { mapped: number; total: number } {
  const total = Object.values(PUBLISHABLE).filter((p) => p.via).length;
  const mapped = (Object.keys(PUBLISHABLE) as Channel[]).filter((c) => PUBLISHABLE[c].via && mapping[c]).length;
  return { mapped, total };
}

/** The media type GHL expects for a URL, guessed from the extension. */
export function mediaTypeFor(url: string): string {
  const ext = (url.split("?")[0].split(".").pop() ?? "").toLowerCase();
  if (["mp4", "mov", "m4v"].includes(ext)) return `video/${ext === "mov" ? "quicktime" : "mp4"}`;
  if (["png", "gif", "webp"].includes(ext)) return `image/${ext}`;
  return "image/jpeg";
}

/** The one sentence about what stays copy-and-paste, built from the map so no screen can say something different. */
export function manualChannelsSentence(): string {
  const labels = (Object.keys(PUBLISHABLE) as Channel[]).filter((c) => !PUBLISHABLE[c].via).map((c) => CHANNEL_SPECS.find((s) => s.key === c)?.label ?? c);
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : (labels[0] ?? "");
  return `${list} you post yourself, by copy and paste: those platforms do not let an app post for you.`;
}
/** The channels the Social Planner publishes, named from the map. */
export function publishedChannelsSentence(): string {
  const labels = (Object.keys(PUBLISHABLE) as Channel[]).filter((c) => PUBLISHABLE[c].via).map((c) => CHANNEL_SPECS.find((s) => s.key === c)?.label ?? c);
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)} are posted for you once GoHighLevel is connected on Settings → Publishing.`;
}
