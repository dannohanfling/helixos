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
  return `${list} stay copy-and-paste. That's a platform limit, not ours.`;
}
/** The channels the Social Planner publishes, named from the map. */
export function publishedChannelsSentence(): string {
  const labels = (Object.keys(PUBLISHABLE) as Channel[]).filter((c) => PUBLISHABLE[c].via).map((c) => CHANNEL_SPECS.find((s) => s.key === c)?.label ?? c);
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)} publish through the Social Planner once GoHighLevel is connected on Settings → Publishing.`;
}
