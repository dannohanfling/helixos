/**
 * My Board, "Choose your council" (rev 756, Danno's answers at rev 766), the pure parts: the approved expert seat library read
 * from docs/board/board-seat-library-v1.md exactly as written, the four archetypes from board-profile.md, each seat's profile in
 * board-profile.md's shape for the answer engine, and the council a member actually sits with (their four chairs, with
 * paused expert seats falling back to the classic archetypes). Nothing here reads the database or calls the AI.
 */

/** The library's twelve skill areas, in the file's order. Two are operator areas. */
export const SEAT_AREAS = [
  "Offers & pricing",
  "Sales & closing",
  "Marketing & positioning",
  "Content & audience",
  "Personal brand & influence",
  "Webinars, events & launches",
  "Business operations & systems",
  "Mindset & performance",
  "Leadership & team",
  "Habits & productivity",
  "Money & profit",
  "AI & tech",
] as const;
export const OPERATOR_AREAS: readonly string[] = ["Business operations & systems", "Habits & productivity"];

export type SeatKind = "expert" | "archetype" | "custom";
export type SeatFramework = { name: string; text: string; source: string };
export type SeatSource = { label: string; url: string | null };
/** A seat's profile, the library's fields. */
export type SeatProfile = {
  purpose: string;
  stance: string;
  questions: string[];
  frameworks: SeatFramework[];
  speaksUpOn: string;
  evidence: string;
  blindSpot: string;
  voice: string;
  boundaries: string;
  contribution: string;
  sources: SeatSource[];
};
export type LibrarySeat = { slug: string; name: string; kind: SeatKind; areas: string[]; card: string; operator: boolean; profile: SeatProfile };

/** A framework sourced to Danno's Edge Preset stays in the seat's thinking but is never shown as a public source. */
export const isEdgeSource = (source: string) => /edge preset/i.test(source);

export function slugOf(name: string): string {
  return name
    .replace(/\s+style$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const field = (block: string, label: string): string => {
  const m = block.match(new RegExp(`^- \\*\\*${label.replace(/[()]/g, "\\$&")}[^*]*:\\*\\*[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim() : "";
};
/** The indented "  - …" lines under a field, up to the next top-level field. */
const items = (block: string, label: string): string[] => {
  const start = block.search(new RegExp(`^- \\*\\*${label}[^*]*:\\*\\*`, "m"));
  if (start < 0) return [];
  const rest = block.slice(start).split("\n").slice(1);
  const out: string[] = [];
  for (const line of rest) {
    if (/^ {2}- /.test(line)) out.push(line.replace(/^ {2}- /, "").trim());
    else if (line.trim()) break;
  }
  return out;
};

/** "**Value Equation:** Value rises … (Source: $100M Offers)" */
function framework(line: string): SeatFramework {
  const m = line.match(/^\*\*(.+?):\*\*\s*(.*?)\s*(?:\(Source:\s*(.+?)\))?$/);
  return m ? { name: m[1].trim(), text: m[2].trim(), source: (m[3] ?? "").trim() } : { name: line, text: "", source: "" };
}
/** "Books page: https://…", or a plain title. */
function source(line: string): SeatSource {
  const m = line.match(/^(.*?):?\s*(https?:\/\/\S+)$/);
  return m ? { label: m[1].replace(/:$/, "").trim() || m[2], url: m[2] } : { label: line, url: null };
}

/**
 * The library, exactly as the file says: one seat per "## {Name} style" block, under its first area heading. A person listed in
 * two areas is written once and carries both areas. "(top-up of Edge seat)" in a heading is a note for the file, not the name.
 */
export function parseSeatLibrary(md: string): LibrarySeat[] {
  const seats: LibrarySeat[] = [];
  for (const block of md.split(/^## /m).slice(1)) {
    const name = block.split("\n")[0].replace(/\s*\(.*\)\s*$/, "").trim();
    const areas = field(block, "Skill area")
      .split(";")
      .map((a) => a.trim())
      .filter(Boolean);
    seats.push({
      slug: slugOf(name),
      name,
      kind: "expert",
      areas,
      card: field(block, "Card"),
      operator: areas.some((a) => OPERATOR_AREAS.includes(a)),
      profile: {
        purpose: field(block, "Purpose"),
        stance: field(block, "Core stance"),
        questions: items(block, "Decision questions"),
        frameworks: items(block, "Key frameworks").map(framework),
        speaksUpOn: field(block, "Speaks up on"),
        evidence: field(block, "Evidence standard"),
        blindSpot: field(block, "Likely blind spot"),
        voice: field(block, "Voice"),
        boundaries: field(block, "Hard boundaries"),
        contribution: field(block, "Unique contribution"),
        sources: items(block, "Public sources").map(source),
      },
    });
  }
  return seats;
}

/** The four classic seats, by the keys their old answers already use, in their default chairs' order. */
export const ARCHETYPE_KEYS = ["alex", "jordan", "riley", "morgan"] as const;
/** The default council, chair by chair: left, right, front left, front right. */
export const DEFAULT_COUNCIL: readonly string[] = ARCHETYPE_KEYS;
export const CHAIR_LABELS = ["Head", "Left", "Right", "Front left", "Front right"] as const;
export { CHAIR_KEYS } from "@/lib/engine/board-view";

/** The archetypes from board-profile.md, word for word: "## Alex, the Strategist 🎯" blocks. */
export function parseArchetypes(profileMd: string): LibrarySeat[] {
  const out: LibrarySeat[] = [];
  for (const block of profileMd.split(/^## /m).slice(1)) {
    const title = block.split("\n")[0].replace(/\s*\p{Extended_Pictographic}.*$/u, "").trim();
    const key = title.split(",")[0].trim().toLowerCase();
    if (!(ARCHETYPE_KEYS as readonly string[]).includes(key)) continue;
    const purpose = field(block, "Purpose");
    out.push({
      slug: key,
      name: title,
      kind: "archetype",
      areas: [],
      card: purpose,
      operator: key === "jordan",
      profile: {
        purpose,
        stance: field(block, "Core stance"),
        questions: items(block, "Decision questions"),
        frameworks: [],
        speaksUpOn: field(block, "Activation triggers"),
        evidence: field(block, "Evidence standard"),
        blindSpot: field(block, "Likely blind spot"),
        voice: field(block, "Voice"),
        boundaries: field(block, "Hard boundaries"),
        contribution: field(block, "Unique contribution"),
        sources: [],
      },
    });
  }
  return ARCHETYPE_KEYS.map((k) => out.find((s) => s.slug === k)!).filter(Boolean);
}

/** The standard boundaries every custom seat carries (rev 756 §3). */
export const CUSTOM_BOUNDARIES =
  "Style advisor only: never claims to be a real person, never invents quotes, never implies endorsement or private knowledge. Never promises income or results. Anything beyond its focus and the member's context is labelled \"my read\".";

/**
 * A seat's profile in board-profile.md's shape, for the answer engine. Frameworks sourced to the Edge Preset stay here (they are
 * the seat's thinking) without their source; the public sources are listed as approved sources.
 */
export function profileBlock(s: { name: string; kind: SeatKind; profile: SeatProfile; operator: boolean; myRead?: boolean }): string {
  const p = s.profile;
  const lines = [
    `## ${s.name}`,
    "",
    `- **Purpose:** ${p.purpose}`,
    `- **Core stance:** ${p.stance}`,
    "- **Decision questions:**",
    ...p.questions.map((q) => `  - ${q}`),
    ...(p.frameworks.length ? ["- **Key frameworks:**", ...p.frameworks.map((f) => `  - **${f.name}:** ${f.text}${f.source && !isEdgeSource(f.source) ? ` (Source: ${f.source})` : ""}`)] : []),
    `- **Activation triggers:** ${p.speaksUpOn}`,
    `- **Evidence standard:** ${s.myRead ? 'No sources were given for this seat: everything it says is labelled "my read".' : p.evidence}`,
    `- **Likely blind spot:** ${p.blindSpot}`,
    `- **Voice:** ${p.voice}`,
    `- **Hard boundaries:** ${p.boundaries}`,
    `- **Unique contribution:** ${p.contribution}`,
    `- **Approved sources:** ${p.sources.length ? p.sources.map((x) => x.label).join("; ") : "Not applicable."}${s.operator ? "\n- **Operator:** owns the action steps when it is the council's operator." : ""}`,
  ];
  return lines.join("\n");
}

/** What the engine needs about one chair's seat, after the council's rules. */
export type CouncilRow = { id: string; slug: string; name: string; kind: SeatKind; areas: string[]; card: string; isOperator: boolean; enabled: boolean; version: number; profile: SeatProfile; sourcesGiven?: boolean };
export type CouncilChair = CouncilRow & { paused: boolean; retired: boolean; myRead: boolean };

/**
 * The four chairs a member sits with (rev 766): their picks in chair order, or the archetypes when they never chose. While
 * "Expert seats live" is off, an expert seat is paused: its chair falls back to the classic archetype for its role (Jordan for
 * an operator seat, otherwise the archetype that sits in that chair by default), never one already at the table, and the pick
 * returns when the switch is back on. A seat the coach turned off stays, marked retired, until the member swaps it.
 */
export function effectiveCouncil(picked: (CouncilRow | null)[], live: boolean, archetypes: CouncilRow[]): CouncilChair[] {
  const bySlug = new Map(archetypes.map((a) => [a.slug, a]));
  const chairs: (CouncilChair | null)[] = [0, 1, 2, 3].map((i) => {
    const row = picked[i] ?? null;
    if (!row || (row.kind === "expert" && !live)) return null;
    return { ...row, paused: false, retired: !row.enabled, myRead: row.kind === "custom" && row.sourcesGiven === false };
  });
  const used = new Set(chairs.filter(Boolean).map((c) => c!.slug));
  return chairs.map((c, i) => {
    if (c) return c;
    const row = picked[i] ?? null;
    const paused = Boolean(row && row.kind === "expert" && !live);
    const wants = [paused && row!.isOperator ? "jordan" : DEFAULT_COUNCIL[i], ...DEFAULT_COUNCIL].filter((k) => !used.has(k));
    const a = bySlug.get(wants[0])!;
    used.add(a.slug);
    return { ...a, paused, retired: false, myRead: false };
  });
}

/** The chair that owns the action steps: the first operator in chair order (the first picked, unless chairs were swapped). */
export function operatorOf<T extends { isOperator: boolean }>(chairs: T[]): T | null {
  return chairs.find((c) => c.isOperator) ?? null;
}

/** Can this council be saved (rev 756 §2)? Four seats, one an operator, each person once. */
export function councilProblem(chairs: ({ slug: string; isOperator: boolean } | null)[]): string | null {
  if (chairs.length !== 4 || chairs.some((c) => !c)) return "Pick four seats for your council.";
  if (new Set(chairs.map((c) => c!.slug)).size !== 4) return "A seat can sit in one chair only.";
  if (!chairs.some((c) => c!.isOperator)) return "Pick at least one operator seat so your Board ends with clear action steps.";
  return null;
}

/** "Alex Hormozi" from "Alex Hormozi style": the person a seat is named after, for the identity and quote checks. */
export const personOf = (name: string) => name.replace(/\s+style$/i, "").trim();
/** Does a custom seat's name look like a real person's ("First Last")? Pre-ticks "named after a real person". */
export const looksLikePerson = (name: string) => /^\p{Lu}[\p{L}'.-]+(\s+\p{Lu}\.?)?\s+\p{Lu}[\p{L}'.-]+(\s+style)?$/u.test(name.trim());

/**
 * Lines an expert or custom seat must never say (rev 756 §1): "I am {Name}", a quote put in the person's mouth, or speaking as
 * them. Returns the text without those sentences, and whether any went.
 */
export function withoutPersonClaims(text: string, name: string): { text: string; cut: boolean } {
  const person = personOf(name);
  const parts = person.split(/\s+/);
  const last = parts.at(-1) ?? person;
  const who = `(${[person, last].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
  const claim = new RegExp(`\\b(I am|I'm|this is|as|speaking as)\\s+${who}\\b`, "i");
  const quoted = new RegExp(`${who}('s)?\\s+(says|said|puts it|wrote|writes|tells|told|once said|likes to say)\\b|["“][^"”]{3,}["”]\\s*[-–—,]?\\s*${who}\\b|${who}\\s*[:,]\\s*["“]`, "i");
  let cut = false;
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => {
      const bad = claim.test(s) || quoted.test(s);
      if (bad) cut = true;
      return !bad;
    })
    .join(" ")
    .trim();
  return { text: kept, cut };
}

/* ───────────────────────── The coach's seat editor (rev 756 §4) ───────────────────────── */

/** One framework per line, as the library writes them: "Name: what it says (Source: where)". */
export const frameworkLine = (f: SeatFramework) => `${f.name}: ${f.text}${f.source ? ` (Source: ${f.source})` : ""}`;
export const sourceLine = (x: SeatSource) => (x.url ? `${x.label}: ${x.url}` : x.label);
const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export type SeatForm = {
  name: string;
  areas: string[];
  card: string;
  purpose: string;
  stance: string;
  questions: string;
  frameworks: string;
  speaksUpOn: string;
  evidence: string;
  blindSpot: string;
  voice: string;
  boundaries: string;
  contribution: string;
  sources: string;
  operator: boolean;
};
/**
 * A seat from the editor, or why not: an expert seat is "{Name} style" with an area, a card of at most 20 words, and every
 * profile field; frameworks and sources one per line in the library's own shape.
 */
export function seatFromForm(f: SeatForm, kind: SeatKind): { ok: true; seat: Omit<LibrarySeat, "slug" | "kind"> } | { ok: false; error: string } {
  const name = f.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Give the seat a name." };
  if (kind === "expert" && !/\sstyle$/.test(name)) return { ok: false, error: 'An expert seat is named "{Name} style".' };
  const areas = f.areas.filter((a) => (SEAT_AREAS as readonly string[]).includes(a));
  if (kind === "expert" && !areas.length) return { ok: false, error: "Pick at least one skill area." };
  if (f.card.trim().split(/\s+/).filter(Boolean).length > 20) return { ok: false, error: "Keep the card to 20 words or fewer." };
  const required: [string, string][] = [
    ["purpose", f.purpose],
    ["core stance", f.stance],
    ["voice", f.voice],
    ["hard boundaries", f.boundaries],
  ];
  const missing = required.filter(([, v]) => !v.trim()).map(([k]) => k);
  if (missing.length) return { ok: false, error: `Fill in the ${missing.join(", ")}.` };
  const questions = lines(f.questions);
  if (questions.length < 1) return { ok: false, error: "Add at least one question the seat asks." };
  return {
    ok: true,
    seat: {
      name,
      areas,
      card: f.card.trim(),
      operator: f.operator,
      profile: {
        purpose: f.purpose.trim(),
        stance: f.stance.trim(),
        questions,
        frameworks: lines(f.frameworks).map((l) => {
          const m = l.match(/^(.+?):\s*(.*?)\s*(?:\(Source:\s*(.+?)\))?$/);
          return m ? { name: m[1].trim(), text: m[2].trim(), source: (m[3] ?? "").trim() } : { name: l, text: "", source: "" };
        }),
        speaksUpOn: f.speaksUpOn.trim(),
        evidence: f.evidence.trim() || 'Only the member\'s context and the frameworks above. Anything beyond them is labelled "my read".',
        blindSpot: f.blindSpot.trim(),
        voice: f.voice.trim(),
        boundaries: f.boundaries.trim(),
        contribution: f.contribution.trim(),
        sources: lines(f.sources).map(source),
      },
    },
  };
}
