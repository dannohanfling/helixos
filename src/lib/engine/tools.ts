import { FEATURES } from "@/lib/engine/ai-usage";

/**
 * The front door to what the app can generate. One entry per AI feature: what it makes (from the code, not the brochure),
 * what it reads before it runs, and where it lives. Names and promises are Danno's; src/data/tools.json holds them and
 * ships empty, so an unnamed tool shows its working label until he writes the real one.
 */

export type NeedKey = "ai_key" | "ladder_facts" | "proof" | "brand_voice" | "webinar" | "content" | "groups" | "principles";
export type ToolNeed = { key: NeedKey; label: string; required: boolean; href: string; missing: string };
export type ToolDef = { feature: string; icon: string; makes: string[]; needs: ToolNeed[]; open: string; openLabel: string };

const KEY: ToolNeed = { key: "ai_key", label: "Your AI key connected", required: true, href: "/settings#ai", missing: "Connect your Anthropic or OpenAI key in Settings" };
const VOICE: ToolNeed = { key: "brand_voice", label: "A brand voice on Settings", required: false, href: "/settings", missing: "Without a brand voice the drafts use the house voice" };

export const TOOLS: ToolDef[] = [
  {
    feature: "ladder",
    icon: "🪜",
    makes: ["The post body", "9 to 11 author comments, in order", "A headline with alternates", "A carousel", "An Instagram caption", "A Threads chain"],
    needs: [
      KEY,
      { key: "ladder_facts", label: "Your product facts (name, price, what you may claim)", required: true, href: "/content/ladders/profile", missing: "Fill in your product facts once; every ladder is written from them" },
      { key: "proof", label: "An approved proof in the Proof Bank", required: false, href: "/proof", missing: "Without one the ladder carries a [PROOF PLACEHOLDER]; testimonials are never invented" },
      VOICE,
    ],
    open: "/content/ladders",
    openLabel: "Write a ladder",
  },
  {
    feature: "webinar_section",
    icon: "🎤",
    makes: ["The spoken script for one section, 120 to 260 words", "Written to the act it sits in and the belief that act has to move"],
    needs: [KEY, { key: "webinar", label: "A webinar with its foundation filled in", required: true, href: "/webinars", missing: "Start a webinar and fill in the foundation step first" }, VOICE],
    open: "/webinars",
    openLabel: "Open your webinars",
  },
  {
    feature: "composer_polish",
    icon: "✍️",
    makes: ["One version of your draft per channel you chose", "Your voice kept, padding cut"],
    needs: [KEY, VOICE],
    open: "/content/compose",
    openLabel: "Open the composer",
  },
  {
    feature: "repurpose",
    icon: "🔁",
    makes: ["A draft for each channel format you pick", "Rewritten for the format, not trimmed"],
    needs: [KEY, { key: "content", label: "A piece of content to start from", required: true, href: "/content", missing: "Write or import one piece of content first" }, VOICE],
    open: "/content",
    openLabel: "Pick a piece of content",
  },
  {
    feature: "group_variant",
    icon: "🎯",
    makes: ["One draft per group you select", "Your own group gets the full CTA; other people's groups get value first and no links"],
    needs: [KEY, { key: "content", label: "A piece of content to start from", required: true, href: "/content", missing: "Write or import one piece of content first" }, { key: "groups", label: "Groups saved on the Groups page", required: true, href: "/groups", missing: "Add the groups you post in, with their rules" }, VOICE],
    open: "/content",
    openLabel: "Pick a piece of content",
  },
  {
    feature: "principle_content",
    icon: "🏛️",
    makes: ["A belief-shifting post", "A sixty-second reel script", "A ten-minute training in five beats"],
    needs: [KEY, { key: "principles", label: "The doctrine library", required: true, href: "/doctrine", missing: "Your coach hasn't published the principles yet" }, VOICE],
    open: "/doctrine",
    openLabel: "Open the doctrine",
  },
];

export type ToolFacts = Record<NeedKey, boolean>;
export type ToolNaming = Record<string, { name?: string; promise?: string }>;

export function toolName(feature: string, naming: ToolNaming): { name: string; promise: string; named: boolean } {
  const n = naming[feature] ?? {};
  const name = (n.name ?? "").trim();
  return { name: name || FEATURES[feature]?.label || feature, promise: (n.promise ?? "").trim(), named: Boolean(name) };
}

/** Ready means every required input is there. Optional inputs are listed so the client knows what would make it better. */
export function toolStatus(tool: ToolDef, facts: ToolFacts): { ready: boolean; missing: ToolNeed[]; optional: ToolNeed[] } {
  const missing = tool.needs.filter((n) => n.required && !facts[n.key]);
  const optional = tool.needs.filter((n) => !n.required && !facts[n.key]);
  return { ready: missing.length === 0, missing, optional };
}
