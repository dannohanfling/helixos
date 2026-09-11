/**
 * Lead magnets: the record, the keyword, the tracked link's sources, and the outputs built from one set of content. Pure.
 * The copy inside a magnet is the client's (or the model's, in their voice, stripped of anything blacklisted); the shapes
 * here are structure: what a checklist is versus a guide, what a Canva hand-off carries.
 */
import type { MagnetContent, MagnetFormats, MagnetType } from "@/db/schema";
import { stripFabricated, stripNote } from "./blacklist";

export const MAGNET_TYPE_INFO: Record<MagnetType, { label: string; shape: string; itemsLabel: string }> = {
  checklist: { label: "Checklist", shape: "Short items, tickable, one page.", itemsLabel: "Items to tick" },
  guide: { label: "Guide", shape: "Sections with a why and a how, several pages.", itemsLabel: "Steps" },
  cheat_sheet: { label: "Cheat sheet", shape: "One page, scannable, no prose.", itemsLabel: "Lines" },
  swipe_file: { label: "Swipe file", shape: "Templates to copy, minimal framing.", itemsLabel: "Templates" },
  audit: { label: "Audit or scorecard", shape: "Questions with a score and what each result means.", itemsLabel: "Questions" },
  resource_list: { label: "Resource list", shape: "Curated links with a line each on why.", itemsLabel: "Resources" },
};

/** The word people comment: upper case letters and digits, nothing else. */
export const keywordOf = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);

/** The public address. Letters, digits and dashes from the title; never an id, never a name from a person. */
export function slugify(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "magnet";
}

/** Where a click came from. A closed list: the link is public and forwarded, so nothing else may ride on it. */
export const HIT_SOURCES = ["chatbot", "dm", "email", "rung", "page", "other"] as const;
export type HitSource = (typeof HIT_SOURCES)[number];
export const hitSource = (raw: string | null | undefined): HitSource => (HIT_SOURCES as readonly string[]).includes(raw ?? "") ? (raw as HitSource) : "other";

export const emptyContent = (): MagnetContent => ({ intro: "", sections: [], closing: "" });

/**
 * The editor's plain shape: "## Heading" starts a section, "- item" adds an item, "why:" and "how:" lines fill a guide's
 * why and how; anything before the first heading is the intro, and a final "---" starts the closing. Round-trips.
 */
export function parseContent(text: string): MagnetContent {
  const c = emptyContent();
  const introLines: string[] = [];
  const closingLines: string[] = [];
  let mode: "intro" | "section" | "closing" = "intro";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^---\s*$/.test(line)) {
      mode = "closing";
      continue;
    }
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      c.sections.push({ heading: h[1].trim(), items: [] });
      mode = "section";
      continue;
    }
    if (mode === "intro") introLines.push(line);
    else if (mode === "closing") closingLines.push(line);
    else {
      const s = c.sections[c.sections.length - 1];
      const item = line.match(/^[-*•]\s+(.+)$/);
      const why = line.match(/^why:\s*(.+)$/i);
      const how = line.match(/^how:\s*(.+)$/i);
      if (item) s.items.push(item[1].trim());
      else if (why) s.why = why[1].trim();
      else if (how) s.how = how[1].trim();
    }
  }
  c.intro = introLines.join("\n").trim();
  c.closing = closingLines.join("\n").trim();
  return c;
}

export function contentToText(c: MagnetContent): string {
  const parts: string[] = [];
  if (c.intro) parts.push(c.intro);
  for (const s of c.sections) {
    parts.push(`## ${s.heading}`);
    if (s.why) parts.push(`why: ${s.why}`);
    if (s.how) parts.push(`how: ${s.how}`);
    for (const i of s.items) parts.push(`- ${i}`);
  }
  if (c.closing) parts.push("---", c.closing);
  return parts.join("\n");
}

/** The copy-out: the magnet as plain text a client pastes anywhere. */
export function magnetText(m: { title: string; promise: string; content: MagnetContent; type: MagnetType }): string {
  const lines = [m.title, m.promise, ""];
  if (m.content.intro) lines.push(m.content.intro, "");
  for (const s of m.content.sections) {
    lines.push(s.heading.toUpperCase());
    if (s.why) lines.push(`Why: ${s.why}`);
    if (s.how) lines.push(`How: ${s.how}`);
    for (const i of s.items) lines.push(m.type === "checklist" || m.type === "audit" ? `[ ] ${i}` : `• ${i}`);
    lines.push("");
  }
  if (m.content.closing) lines.push(m.content.closing);
  return lines.join("\n").trim();
}

/** The Canva hand-off: the content plus art direction, one block per page, the same output the deck outline produces for a webinar. */
export function canvaHandoff(m: { title: string; promise: string; content: MagnetContent; type: MagnetType; businessName?: string | null }): string {
  const info = MAGNET_TYPE_INFO[m.type];
  const out = [`${m.title} — Canva hand-off`, `Type: ${info.label}. ${info.shape}`, m.businessName ? `Brand: ${m.businessName}. Gold #F0C030 as a fill behind dark text, never as text colour.` : "Gold #F0C030 as a fill behind dark text, never as text colour.", ""];
  out.push(`PAGE 1 — COVER`, `Headline: ${m.title}`, `Subline: ${m.promise}`, `Art direction: the title over a brand-gold band, the logo small at the foot. Nothing else on the page.`, "");
  m.content.sections.forEach((s, i) => {
    out.push(`PAGE ${i + 2} — ${s.heading.toUpperCase()}`);
    if (s.why) out.push(`Why: ${s.why}`);
    if (s.how) out.push(`How: ${s.how}`);
    for (const it of s.items) out.push(`- ${it}`);
    out.push(`Art direction: ${m.type === "checklist" || m.type === "audit" ? "tick boxes down the left, one line each, plenty of air." : m.type === "cheat_sheet" ? "two columns, no paragraphs, headings in the gold band." : m.type === "resource_list" ? "one link per row with its one line beneath." : "one idea per page, heading large, body in a single column."}`, "");
  });
  if (m.content.closing) out.push(`LAST PAGE — CLOSE`, m.content.closing, `Art direction: the closing line alone, then the keyword or link, then the logo.`);
  return out.join("\n").trim();
}

/** What the model returns, parsed and stripped: any blacklisted claim comes out of every string, and the note says so. */
export type Generated = { content: MagnetContent; personalReply: string; personalDm: string; chatbotAnswer: string; chatbotDelivery: string; chatbotQuestions: string[]; note: string | null };
export function parseGenerated(text: string): Generated | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const removed: ReturnType<typeof stripFabricated>["removed"] = [];
  const clean = (v: unknown): string => {
    const r = stripFabricated(String(v ?? "").trim());
    removed.push(...r.removed);
    return r.text;
  };
  const sectionsRaw = Array.isArray(j.sections) ? (j.sections as Record<string, unknown>[]) : [];
  const content: MagnetContent = {
    intro: clean(j.intro),
    sections: sectionsRaw.map((s) => ({ heading: clean(s.heading), items: (Array.isArray(s.items) ? s.items : []).map(clean).filter(Boolean), why: s.why ? clean(s.why) : undefined, how: s.how ? clean(s.how) : undefined })).filter((s) => s.heading),
    closing: clean(j.closing),
  };
  if (!content.sections.length) return null;
  return {
    content,
    personalReply: clean(j.personalReply),
    personalDm: clean(j.personalDm),
    chatbotAnswer: clean(j.chatbotAnswer),
    chatbotDelivery: clean(j.chatbotDelivery),
    chatbotQuestions: (Array.isArray(j.chatbotQuestions) ? j.chatbotQuestions : []).map(clean).filter(Boolean).slice(0, 5),
    note: stripNote(removed),
  };
}

/** Which output the tracked link points at: the client nominates one; a format that is off cannot be primary. */
export function primaryTarget(m: { primary: "page" | "pdf" | "file"; formats: MagnetFormats; slug: string; pdfKey: string | null; fileKey: string | null }, publicUrlFor: (key: string) => string | null): string | null {
  if (m.primary === "file" && m.fileKey) return publicUrlFor(m.fileKey);
  if (m.primary === "pdf" && m.formats.pdf && m.pdfKey) return publicUrlFor(m.pdfKey);
  if (m.formats.page) return `/m/${m.slug}`;
  if (m.formats.pdf && m.pdfKey) return publicUrlFor(m.pdfKey);
  if (m.fileKey) return publicUrlFor(m.fileKey);
  return null;
}

/** A structure for a client with no model: the type's shape as empty sections to fill, their promise as the intro. Nothing invented. */
export function scaffoldContent(type: MagnetType, promise: string): MagnetContent {
  const headings: Record<MagnetType, string[]> = {
    checklist: ["Before you start", "The list", "When you're done"],
    guide: ["Why this matters", "Step one", "Step two", "Step three", "What to do next"],
    cheat_sheet: ["At a glance"],
    swipe_file: ["Template 1", "Template 2", "Template 3"],
    audit: ["Score yourself", "What your score means"],
    resource_list: ["The list"],
  };
  return { intro: promise, sections: headings[type].map((heading) => ({ heading, items: [] })), closing: "" };
}
