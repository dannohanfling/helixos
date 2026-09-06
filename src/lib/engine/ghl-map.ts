/** Maps HelixOS channels onto a client's connected GoHighLevel Social Planner accounts. Pure. */
import type { Channel } from "./repurpose";

export type Account = { id: string; name: string; platform: string; type: string; isExpired: boolean };

/** Channels the Social Planner can publish. Everything else is copy-and-paste by design. */
export const PUBLISHABLE: Record<Channel, { via: "facebook" | "instagram" | "linkedin" | null; note: string }> = {
  fb_personal: { via: null, note: "Facebook doesn't allow posting to personal profiles through any API. Paste it." },
  fb_page: { via: "facebook", note: "Facebook page" },
  fb_group: { via: "facebook", note: "Facebook group, when it's connected in the sub-account" },
  other_groups: { via: null, note: "Other people's groups are posted by hand, which also keeps you inside their rules." },
  stories: { via: "instagram", note: "Instagram story (needs a photo or video)" },
  instagram: { via: "instagram", note: "Instagram business account" },
  threads: { via: null, note: "Threads isn't in the Social Planner yet. Paste it." },
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
    default:
      return false;
  }
}

/** Fills in any channel that has exactly one obvious match, keeping choices the user already made. */
export function autoMap(accounts: Account[], existing: Record<string, string> = {}): Record<string, string> {
  const live = accounts.filter((a) => !a.isExpired);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(existing)) if (live.some((a) => a.id === v)) out[k] = v;
  for (const ch of Object.keys(PUBLISHABLE) as Channel[]) {
    if (out[ch] || !PUBLISHABLE[ch].via) continue;
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
