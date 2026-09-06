/** Turns one piece of content into channel-ready drafts. Pure and deterministic; Claude can polish on top. */

import type { CHANNELS } from "@/db/schema";

export type Channel = (typeof CHANNELS)[number];

export type ChannelSpec = { key: Channel; label: string; icon: string; maxChars: number; hashtags: boolean; links: "ok" | "comment" | "bio" | "none"; tone: string; why: string };

export const CHANNEL_SPECS: ChannelSpec[] = [
  { key: "fb_personal", label: "Facebook personal", icon: "👤", maxChars: 2000, hashtags: false, links: "comment", tone: "Story-first, personal, no links in the body.", why: "Your profile is where people decide if they like you. Lead with the story." },
  { key: "fb_page", label: "Facebook business page", icon: "🏢", maxChars: 1500, hashtags: false, links: "ok", tone: "Clear value, direct CTA, link allowed.", why: "Pages get less reach but the link is fair game." },
  { key: "fb_group", label: "Your Facebook group", icon: "👥", maxChars: 2000, hashtags: true, links: "ok", tone: "Question-first. Invite replies. Use the daily hashtag.", why: "Your group rewards conversation. Every post should ask something." },
  { key: "other_groups", label: "Other people's groups", icon: "🤝", maxChars: 1200, hashtags: false, links: "none", tone: "Pure value. No links, no pitch, no CTA. Invite DMs only if asked.", why: "You're a guest. Give the whole lesson and let people come to you." },
  { key: "stories", label: "Stories (FB / IG)", icon: "📱", maxChars: 220, hashtags: false, links: "ok", tone: "Three frames. One idea per frame. Big text.", why: "Stories are read in 3 seconds each. One line per frame." },
  { key: "instagram", label: "Instagram caption", icon: "📸", maxChars: 2200, hashtags: true, links: "bio", tone: "Hook line, spaced lines, hashtags at the end, 'link in bio'.", why: "The first line is all they see before 'more'." },
  { key: "threads", label: "Threads", icon: "🧵", maxChars: 500, hashtags: false, links: "ok", tone: "500 characters. One sharp idea. Conversational.", why: "Threads punishes long posts and rewards a strong take." },
  { key: "linkedin", label: "LinkedIn", icon: "💼", maxChars: 3000, hashtags: true, links: "comment", tone: "Professional but human. Short lines. Lesson at the end. Link in first comment.", why: "LinkedIn readers want the business lesson, not the hype." },
  { key: "email", label: "Email", icon: "📧", maxChars: 4000, hashtags: false, links: "ok", tone: "Subject line, one story, one CTA, one P.S.", why: "Email is the only channel you own. One ask per email." },
  { key: "skool", label: "Skool community", icon: "🏫", maxChars: 3000, hashtags: false, links: "ok", tone: "Discussion post. Teach, then ask members to share their version.", why: "Skool ranks by comments. End with a real question." },
];

export type SourceContent = { title: string; hook?: string | null; body?: string | null; hasCta?: boolean; ctaText?: string | null; hashtag?: string | null; firstName?: string | null };

function lines(body: string): string[] {
  return body
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return (at > max * 0.6 ? cut.slice(0, at + 1) : cut).trim() + (at > max * 0.6 ? "" : "…");
}

export function hashtagsFor(src: SourceContent): string {
  const words = `${src.title} ${src.hook ?? ""}`.toLowerCase().match(/[a-z]{5,}/g) ?? [];
  const stop = new Set(["their", "about", "these", "those", "there", "which", "would", "could", "should", "every", "still", "after", "before", "because", "while", "where", "being", "other"]);
  const picked = [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 4).map((w) => `#${w}`);
  if (src.hashtag) picked.unshift(src.hashtag.startsWith("#") ? src.hashtag : `#${src.hashtag}`);
  return picked.join(" ");
}

export function repurpose(src: SourceContent, channel: Channel): { body: string; subject?: string } {
  const hook = (src.hook ?? "").trim() || src.title;
  const body = (src.body ?? "").trim();
  const ls = lines(body);
  const first = ls[0] ?? "";
  const rest = ls.slice(1);
  const lesson = rest.length ? rest[rest.length - 1] : first;
  const cta = src.hasCta ? (src.ctaText?.trim() || "If you want the full breakdown, comment \"more\" and I'll send it over.") : "";

  switch (channel) {
    case "fb_personal": {
      const out = [hook, "", ...ls, "", src.hasCta ? "Want the full version? Drop a comment and I'll DM it. No link, no pitch." : "What's your version of this?"];
      return { body: truncate(out.join("\n"), 2000) };
    }
    case "fb_page": {
      const out = [hook, "", ...ls, "", cta || "Save this for later."];
      return { body: truncate(out.join("\n"), 1500) };
    }
    case "fb_group": {
      const q = `Question for the group: ${first ? first.replace(/\.$/, "") : hook}?`;
      const out = [q, "", "Here's my take:", "", ...ls.slice(0, 6), "", "Your turn. Where are you with this? Reply below.", src.hashtag ? `\n${src.hashtag.startsWith("#") ? src.hashtag : `#${src.hashtag}`}` : ""];
      return { body: truncate(out.join("\n"), 2000) };
    }
    case "other_groups": {
      const out = [hook, "", ...ls, "", "Hope that helps someone here. Happy to expand in the comments."];
      return { body: truncate(out.join("\n"), 1200) };
    }
    case "stories": {
      const frames = [hook, first || lesson, src.hasCta ? "DM me \"more\" for the full thing" : lesson === first ? "Save this one." : lesson];
      return { body: frames.map((f, i) => `Frame ${i + 1}: ${truncate(f, 110)}`).join("\n\n") };
    }
    case "instagram": {
      const out = [hook, "", ...ls.map((l) => l), "", src.hasCta ? "Link in bio for the full breakdown." : "Save this for the next time you need it.", "", hashtagsFor(src)];
      return { body: truncate(out.join("\n"), 2200) };
    }
    case "threads": {
      const out = [hook, "", first !== hook ? first : "", lesson !== first ? lesson : ""].filter(Boolean);
      return { body: truncate(out.join("\n\n"), 500) };
    }
    case "linkedin": {
      const out = [hook, "", ...ls.slice(0, 8), "", `The lesson: ${lesson.replace(/^The lesson:\s*/i, "")}`, "", src.hasCta ? "Full breakdown in the first comment." : "Agree? Disagree? Tell me below.", "", hashtagsFor(src)];
      return { body: truncate(out.join("\n"), 3000) };
    }
    case "email": {
      const subject = truncate(hook.replace(/[.!]$/, ""), 60);
      const out = [`Hey ${src.firstName ?? "there"},`, "", ...ls, "", cta || "Hit reply and tell me where you are with this. I read every one.", "", "Talk soon,", "", `P.S. ${lesson}`];
      return { subject, body: out.join("\n") };
    }
    case "skool": {
      const out = [hook, "", ...ls, "", "Now you: what's the version of this you're dealing with right now? Post it below and I'll reply to every one."];
      return { body: truncate(out.join("\n"), 3000) };
    }
  }
}

export function repurposeAll(src: SourceContent, channels: Channel[] = CHANNEL_SPECS.map((c) => c.key)): { channel: Channel; body: string; subject?: string }[] {
  return channels.map((channel) => ({ channel, ...repurpose(src, channel) }));
}
