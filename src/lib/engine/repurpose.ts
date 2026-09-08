/** Turns one piece of content into channel-ready drafts. Pure and deterministic; Claude can polish on top. */

import type { CHANNELS } from "@/db/schema";

export type Channel = (typeof CHANNELS)[number];

/**
 * One channel's rules. `tone` is the channel's posture: what would change if the writer changed on the same channel. `format`
 * is the container the words go in: what would change if the channel changed for the same writer. Format belongs to the
 * channel, never to the feature that wrote the post: a ladder rung and a composer post on the same feed carry the same line.
 * The Facebook lines are the ladder's, verbatim; the rest are Danno's signed-off lines. An empty tone is fine and is not
 * padded: the voice then comes entirely from the client's Essence. Neither column restates the limit or the link rule,
 * which the prompt prints beside them, and neither carries a house practice (a client's hashtag comes from their own
 * settings, never from here).
 */
export type ChannelSpec = { key: Channel; label: string; icon: string; maxChars: number; hashtags: boolean; links: "ok" | "comment" | "bio" | "none"; tone: string; format: string; why: string };

const FACEBOOK_FORMAT = "4th-grade reading level. Sentences average 5–7 words. Line break between every sentence or short thought.";

export const CHANNEL_SPECS: ChannelSpec[] = [
  { key: "fb_personal", label: "Facebook personal", icon: "👤", maxChars: 2000, hashtags: false, links: "comment", tone: "Story-first, personal.", format: FACEBOOK_FORMAT, why: "Your profile is where people decide if they like you. Lead with the story." },
  { key: "fb_page", label: "Facebook business page", icon: "🏢", maxChars: 1500, hashtags: false, links: "ok", tone: "Clear value, direct CTA.", format: FACEBOOK_FORMAT, why: "Pages get less reach but the link is fair game." },
  { key: "fb_group", label: "Your Facebook group", icon: "👥", maxChars: 2000, hashtags: true, links: "ok", tone: "Question-first. Invite replies.", format: "4th-grade reading level. Line break between every sentence or short thought. No headings — a group post is a message, not an article.", why: "Your group rewards conversation. Every post should ask something." },
  { key: "other_groups", label: "Other people's groups", icon: "🤝", maxChars: 1200, hashtags: false, links: "none", tone: "Pure value. No pitch, no CTA. Invite DMs only if asked.", format: "4th-grade reading level. Line break between every sentence or short thought. One thought only — a guest post that runs long reads as a takeover.", why: "You're a guest. Give the whole lesson and let people come to you." },
  { key: "stories", label: "Stories (FB / IG)", icon: "📱", maxChars: 220, hashtags: false, links: "ok", tone: "", format: "Three frames. One idea per frame, twelve words at most. Big text. The action goes on the last frame.", why: "Stories are read in 3 seconds each. One line per frame." },
  { key: "instagram", label: "Instagram caption", icon: "📸", maxChars: 2200, hashtags: true, links: "bio", tone: "", format: "The first line is the whole hook; everything after it hides behind \"more\". Spaced lines, one thought each. Hashtags at the end. 4th-grade reading level.", why: "The first line is all they see before 'more'." },
  { key: "threads", label: "Threads", icon: "🧵", maxChars: 500, hashtags: false, links: "ok", tone: "Conversational.", format: "One idea per post in the chain. Plain sentences, no headings, no formatting.", why: "Threads punishes long posts and rewards a strong take." },
  { key: "linkedin", label: "LinkedIn", icon: "💼", maxChars: 3000, hashtags: true, links: "comment", tone: "Professional but human.", format: "The first three lines show before \"see more\"; put the hook there. One or two sentences a paragraph. The lesson lands at the end. Plain language, full sentences. No emoji in the body.", why: "LinkedIn readers want the business lesson, not the hype." },
  { key: "email", label: "Email", icon: "📧", maxChars: 4000, hashtags: false, links: "ok", tone: "", format: "Subject line under 50 characters. Write the preview text; do not let it inherit the first line. One idea a paragraph, one to three sentences. One story, one CTA, one P.S.", why: "Email is the only channel you own. One ask per email." },
  { key: "skool", label: "Skool community", icon: "🏫", maxChars: 3000, hashtags: false, links: "ok", tone: "Teaching, not broadcasting.", format: "Lead with the point, not a tease — nothing is truncated and the audience is already here. Short paragraphs, headings allowed. Ends by asking members to share their version.", why: "Skool ranks by comments. End with a real question." },
];

/** The clauses a prompt appends for a channel's tone and format; nothing for an empty column, never filler. */
export const toneClause = (spec?: Pick<ChannelSpec, "tone"> | null): string => (spec?.tone ? ` ${spec.tone}` : "");
export const formatClause = (spec?: Pick<ChannelSpec, "format"> | null): string => (spec?.format ? ` Format: ${spec.format}` : "");

export type SourceContent = { title: string; hook?: string | null; body?: string | null; hasCta?: boolean; ctaText?: string | null; hashtag?: string | null; firstName?: string | null };

const TAG_LINE = /^(#[\p{L}\p{N}_]+\s*)+$/u;

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
  // The first line and the lesson come from the prose: a hashtag-only line (the "# Hashtags" button) is never "the lesson".
  const prose = ls.filter((l) => !TAG_LINE.test(l));
  const first = prose[0] ?? "";
  const rest = prose.slice(1);
  const lesson = rest.length ? rest[rest.length - 1] : first;
  // The CTA is its own field. When the client chose one it is the closing line on every channel that carries a CTA;
  // without one each channel keeps its own default. It is never folded into the body, so nothing can double it.
  const chosen = src.hasCta ? (src.ctaText?.trim() ?? "") : "";
  const cta = src.hasCta ? chosen || "If you want the full breakdown, comment \"more\" and I'll send it over." : "";
  // Hashtags are composed at render; a body that already carries the same line (the "# Hashtags" button) is not tagged twice.
  const tags = hashtagsFor(src);
  const tagLine = tags && !body.includes(tags) ? tags : "";

  switch (channel) {
    case "fb_personal": {
      const out = [hook, "", ...ls, "", src.hasCta ? chosen || "Want the full version? Drop a comment and I'll DM it. No link, no pitch." : "What's your version of this?"];
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
      const frames = [hook, first || lesson, src.hasCta ? chosen || "DM me \"more\" for the full thing" : lesson === first ? "Save this one." : lesson];
      return { body: frames.map((f, i) => `Frame ${i + 1}: ${truncate(f, 110)}`).join("\n\n") };
    }
    case "instagram": {
      const out = [hook, "", ...ls.map((l) => l), "", src.hasCta ? chosen || "Link in bio for the full breakdown." : "Save this for the next time you need it.", "", tagLine];
      return { body: truncate(out.join("\n"), 2200) };
    }
    case "threads": {
      const out = [hook, "", first !== hook ? first : "", lesson !== first ? lesson : ""].filter(Boolean);
      return { body: truncate(out.join("\n\n"), 500) };
    }
    case "linkedin": {
      const out = [hook, "", ...ls.slice(0, 8), "", `The lesson: ${lesson.replace(/^The lesson:\s*/i, "")}`, "", src.hasCta ? chosen || "Full breakdown in the first comment." : "Agree? Disagree? Tell me below.", "", tagLine];
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
