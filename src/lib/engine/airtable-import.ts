/**
 * A client's HelixOS Airtable base, read into their HelixOS (handoff 27 Sep: "Import a client from Airtable"), Phase 1: pathways
 * and the offer ladder, brand into Essence, founder stories, beliefs, revenue targets on their goals, methodologies, the buyer-
 * readiness journey, tasks and groups. Pure: the page fetches the rows (GET only, the token used for that run and never kept) and
 * the rows the client already has; this decides what each Airtable row becomes, or why it is skipped, and the dry run shows
 * exactly that. Her words go in as she wrote them: nothing here rewords, rounds or re-prices. Every row is matched on its Airtable
 * record id, so a re-run updates instead of doubling.
 */

export type AirtableRecord = { id: string; createdTime: string; fields: Record<string, unknown> };
/** One table as fetched: its name in the base and its rows. */
export type SourceTable = { name: string; records: AirtableRecord[] };
export type ImportSource = { v2: Record<string, SourceTable | undefined>; v1: Record<string, SourceTable | undefined> };

/** A field's name without its emoji and with single spaces, lowercased: "🗝️ V1 Record ID" → "v1 record id". */
export const fieldKey = (name: string): string =>
  name
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
/** A table's name the same way: "🌎  Vision" → "vision". */
export const tableKey = fieldKey;

/** The value of the first field whose key is one of `keys`, as Airtable returned it. */
export function field(r: AirtableRecord, ...keys: string[]): unknown {
  for (const [name, value] of Object.entries(r.fields)) if (keys.includes(fieldKey(name))) return value;
  return undefined;
}
/** A text value, trimmed; a select's name; a list's items joined by new lines. Empty is "". */
export function text(r: AirtableRecord, ...keys: string[]): string {
  const v = field(r, ...keys);
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : typeof x === "object" && x && "name" in x ? String((x as { name: unknown }).name) : "")).filter(Boolean).join("\n").trim();
  if (typeof v === "object" && "name" in (v as object)) return String((v as { name: unknown }).name).trim();
  return "";
}
/** A select's name without its emoji: "✅ Launched" → "Launched". */
export const option = (s: string): string => s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
export function list(r: AirtableRecord, ...keys: string[]): string[] {
  const v = field(r, ...keys);
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : typeof x === "object" && x && "name" in x ? String((x as { name: unknown }).name) : "")).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : [];
}
export function num(r: AirtableRecord, ...keys: string[]): number | null {
  const v = field(r, ...keys);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** What makes a row not the client's: the template's own, a test row, an empty one, or older than the cut-off. */
export type SkipRules = { createdSince: string | null };
export function skipReason(r: AirtableRecord, name: string, rules: SkipRules): string | null {
  const n = name.trim();
  if (!n || n === "(Untitled)") return "no name";
  if (/ZZ_TEST_DELETE_ME/i.test(n)) return "a test row";
  if (/^\[EXAMPLE\]/i.test(n)) return "a template example";
  const status = option(text(r, "template status"));
  if (/^Universal \(keep in template\)/i.test(status)) return "the template's own (Universal)";
  if (/^Danno-Specific/i.test(status)) return "the coach's own (Danno-Specific)";
  if (/^Example Only/i.test(status)) return "a template example";
  if (rules.createdSince && r.createdTime.slice(0, 10) < rules.createdSince) return `created ${r.createdTime.slice(0, 10)}, before ${rules.createdSince}`;
  return null;
}

/* ───────────────────────── The plan ───────────────────────── */

export type Area = "pathways" | "offers" | "archived offers" | "lead magnets" | "brand" | "stories" | "beliefs" | "revenue goals" | "frameworks" | "journey" | "tasks" | "groups";
export const AREAS: Area[] = ["pathways", "offers", "archived offers", "lead magnets", "brand", "stories", "beliefs", "revenue goals", "frameworks", "journey", "tasks", "groups"];
/** One line of the dry run: what an Airtable row becomes, or why it is skipped. */
export type PlanLine = { area: Area | "skipped"; table: string; sourceRef: string; label: string; action: "create" | "update" | "skip"; note: string };

export type PathwayRow = { sourceRef: string; name: string; tierPrefix: string | null; order: number; founderStory: string | null; tagline: string | null; audiencePromise: string | null; promiseEvidence: string | null };
export type OfferRow = {
  sourceRef: string;
  name: string;
  tierCode: string | null;
  tierOrder: number;
  pathway: string | null;
  status: "live" | "draft" | "retired";
  price: number;
  /** An archived offer: the current offer that replaced it, by its Airtable id. */
  replacedBy: string | null;
  arcStage: string | null;
  headline: string | null;
  promise: string | null;
  coreProblem: string | null;
  oneBelief: string | null;
  currentSituation: string | null;
  desiredSituation: string | null;
  coreComponents: string | null;
  deliverables: string | null;
  oneLiners: string | null;
  guarantee: string | null;
  trust: string | null;
  getStarted: string | null;
  purpose: string | null;
  objMoney: string | null;
  objTime: string | null;
  objTriedBefore: string | null;
  objPartner: string | null;
  objWrongTime: string | null;
};
export type MagnetRow = { sourceRef: string; title: string; mergedWith: string | null; link: string | null; status: string | null };
export type AssetRow = { sourceRef: string; type: "story" | "belief" | "framework" | "journey_stage"; name: string; body: string; summary: string | null; useWhen: string | null; tag: string | null; extra: Record<string, string | null> };
export type GoalRow = { sourceRef: string; title: string; target: number; unit: string; period: string };
export type TaskRow = { sourceRef: string; title: string; details: string | null; status: "upcoming" | "today" | "in_progress" | "done"; urgency: "top3" | "high" | "medium" | "low"; category: "sales" | "content" | "community" | "system" | "admin" | "fulfillment"; dueDate: string | null; completedAt: string | null; assignee: string | null; refs: { v1: string | null; goals: string[]; initiatives: string[] } };
export type GroupRow = { sourceRef: string; name: string; url: string | null; notes: string | null };
/** Essence sections, each field the text or list that goes in; keys the Essence page already knows, plus the Brand section. */
export type EssencePatch = Record<string, Record<string, string | string[]>>;

export type ImportPlan = {
  lines: PlanLine[];
  pathways: PathwayRow[];
  offers: OfferRow[];
  magnets: MagnetRow[];
  assets: AssetRow[];
  goals: GoalRow[];
  tasks: TaskRow[];
  groups: GroupRow[];
  essence: EssencePatch;
  /** What was read and not used, by table, with the count: the tables Phase 1 doesn't cover. */
  notInPhase1: { table: string; rows: number }[];
  /** What only the fallback (first) base holds, left as this base has it because none was given or the row isn't there. */
  unfilled: string[];
};

/** Tables Phase 1 reads, by their key. */
const PHASE1 = ["vision", "offersos", "methodologies", "buyer readiness", "tasksos", "groups", "lead magnet"];

const none = (s: string): string | null => (s ? s : null);
/** "🗺️ B1 — True North Business Blueprint" → B1 and the name; "01 True North Leadership Core Diagnostic" → 01 and the name. */
export function offerName(raw: string): { current: boolean; code: string | null; name: string } {
  const s = raw.trim();
  const current = /^[^\p{L}\p{N}]/u.test(s);
  const body = s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const m = body.match(/^([A-Z]?\d{1,2})\s+(?:[—–-]\s+)?(.+)$/u);
  return m ? { current, code: m[1], name: m[2].trim() } : { current, code: null, name: body };
}
/** The name two generations of an offer share: no mark, no pathway in brackets, no doorway suffix, lowercased. */
export const sameOffer = (name: string): string =>
  name
    .replace(/[™®]/g, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+[—–]\s+.*$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
/** The order a tier code sorts in its pathway: T00 → 0, B3 → 3, 05 → 5. No code sorts first (the doorway). */
export const tierOrder = (code: string | null): number => (code ? Number(code.replace(/\D/g, "")) || 0 : -1);

const STATUS_TASK: Record<string, TaskRow["status"]> = { Complete: "done", Today: "today", "In Progress": "in_progress" };
const URGENCY: Record<string, TaskRow["urgency"]> = { "Top 3": "top3", "Very High": "high", High: "high", Medium: "medium", Low: "low", "Very Low": "low" };
const CATEGORY: Record<string, TaskRow["category"]> = { Sales: "sales", Marketing: "content", Operations: "system", Fulfillment: "fulfillment", Finances: "admin", "Human Resources": "admin", Admin: "admin", Vision: "admin" };

/**
 * Year targets from a free-text note, one per line that starts with its year: "Y1: NZD 412,000 to 462,000", or a client's own
 * "YEAR 1 - 2026 — System Validation: $412,000–$462,000 NZD". A calendar year or span on the line (2026, 2028-2029) is the
 * period, never an amount: it is lifted out before the amounts are read. A year line with no amount on it is no target.
 */
export function revenueTargets(note: string): { year: number; low: number; high: number | null; calendar: string | null; line: string }[] {
  const out: { year: number; low: number; high: number | null; calendar: string | null; line: string }[] = [];
  for (const raw of note.split(/\n+/)) {
    const line = raw.trim();
    const label = line.match(/^\W*(?:Y|Year)\s*([1-9])\b/i);
    if (!label) continue;
    const year = Number(label[1]);
    if (out.some((o) => o.year === year)) continue;
    const rest = line.slice(label[0].length);
    const CALENDAR = /(?<![\d,.])(?:19|20)\d{2}(?:\s*(?:-|–|to)\s*(?:19|20)\d{2})?(?![\d,.])/i;
    const calendar = rest.match(CALENDAR)?.[0].replace(/\s+/g, "") ?? null;
    const amounts = [...rest.replace(new RegExp(CALENDAR.source, "gi"), " ").matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
    if (!amounts.length) continue;
    out.push({ year, low: amounts[0], high: amounts[1] ?? null, calendar, line });
  }
  return out;
}

/**
 * The dry run: every row of every Phase 1 table, as what it becomes or why it is skipped. `existing` holds "area:sourceRef" for
 * what the client already has from an earlier run, so a line says update rather than create.
 */
export function buildPlan(src: ImportSource, rules: SkipRules, existing: Set<string>): ImportPlan {
  const lines: PlanLine[] = [];
  const plan: ImportPlan = { lines, pathways: [], offers: [], magnets: [], assets: [], goals: [], tasks: [], groups: [], essence: {}, notInPhase1: [], unfilled: [] };
  // Brand lines land in one Essence section: an update once the client has one ("brand:*").
  const act = (area: Area, ref: string) => (existing.has(`${area}:${ref}`) || (area === "brand" && existing.has("brand:*")) ? "update" : "create") as "create" | "update";
  const add = (area: Area, table: string, ref: string, label: string, note = "") => lines.push({ area, table, sourceRef: ref, label, action: act(area, ref), note });
  const skip = (table: string, ref: string, label: string, note: string) => lines.push({ area: "skipped", table, sourceRef: ref, label, action: "skip", note });
  const t = (k: string) => src.v2[k];
  const v1ById = new Map<string, AirtableRecord>();
  for (const tb of Object.values(src.v1)) for (const r of tb?.records ?? []) v1ById.set(r.id, r);
  const hers = (tb: SourceTable | undefined, nameKeys: string[]) =>
    (tb?.records ?? []).filter((r) => {
      const name = text(r, ...nameKeys);
      const why = skipReason(r, name, rules);
      if (why) skip(tb!.name, r.id, name || "(no name)", why);
      return !why;
    });

  /* ── Offers first: the pathways come from them. ── */
  const offersT = t("offersos");
  const offerRows = hers(offersT, ["name"]);
  const current = offerRows.filter((r) => offerName(text(r, "name")).current);
  const old = offerRows.filter((r) => !offerName(text(r, "name")).current);
  const pathwayOf = (r: AirtableRecord) => list(r, "pathway (true north)", "pathway")[0] ?? null;
  const pathwayNames: string[] = [];
  for (const r of [...current].sort((a, b) => tierOrder(offerName(text(a, "name")).code) - tierOrder(offerName(text(b, "name")).code))) {
    const p = pathwayOf(r);
    if (p && !pathwayNames.includes(p)) pathwayNames.push(p);
  }
  const offerCopy = (r: AirtableRecord) => ({
    headline: none(text(r, "headline")),
    promise: none(text(r, "big promise")),
    coreProblem: none(text(r, "pain")),
    oneBelief: none(text(r, "one belief")),
    currentSituation: none(text(r, "problems (current situation)")),
    desiredSituation: none(text(r, "promises (desired situation)")),
    coreComponents: none(text(r, "core components")),
    deliverables: none(text(r, "deliverables")),
    oneLiners: none(text(r, "one-liners")),
    guarantee: none(text(r, "guarantee")),
    trust: none(text(r, "trust")),
    getStarted: none(text(r, "get started")),
    purpose: none(text(r, "purpose")),
    objMoney: none(text(r, "money objection")),
    objTime: none(text(r, "enough time objection")),
    objTriedBefore: none(text(r, "same thing objection")),
    objPartner: none(text(r, "decision maker objection")),
    objWrongTime: none(text(r, "wrong time objection")),
  });
  const price = (r: AirtableRecord) => num(r, "pif price") ?? num(r, "pif") ?? 0;
  for (const r of current) {
    const n = offerName(text(r, "name"));
    const status = option(text(r, "status"));
    plan.offers.push({ sourceRef: r.id, name: n.name, tierCode: n.code, tierOrder: tierOrder(n.code), pathway: pathwayOf(r), status: /Launched/i.test(status) ? "live" : "draft", price: price(r), replacedBy: null, arcStage: none(list(r, "transformation arc").join(", ")), ...offerCopy(r) });
    add("offers", offersT!.name, r.id, `${n.code ?? "—"} ${n.name}`, `${price(r).toLocaleString("en-US")} · ${pathwayOf(r) ?? "no pathway"} · ${/Launched/i.test(status) ? "live" : "draft"}`);
  }
  // The older generation: paid offers archived and linked to the current one of the same name (the pathway settles a tie); the
  // lead-magnet offers become lead magnets (Danno, 27 Sep).
  const currentPlanned = plan.offers.slice();
  for (const r of old) {
    const n = offerName(text(r, "name"));
    if (/lead magnet/i.test(text(r, "value ladder tier"))) {
      plan.magnets.push({ sourceRef: r.id, title: n.name, mergedWith: null, link: null, status: null });
      continue;
    }
    const same = currentPlanned.filter((c) => sameOffer(c.name) === sameOffer(n.name));
    const match = same.length > 1 ? (same.find((c) => c.pathway && c.pathway === pathwayOf(r)) ?? null) : (same[0] ?? null);
    plan.offers.push({ sourceRef: r.id, name: n.name, tierCode: n.code, tierOrder: tierOrder(n.code), pathway: match?.pathway ?? pathwayOf(r), status: "retired", price: price(r), replacedBy: match?.sourceRef ?? null, arcStage: none(list(r, "transformation arc").join(", ")), ...offerCopy(r) });
    const note = match ? `archived, replaced by ${match.tierCode ?? ""} ${match.name}${match.price !== price(r) ? ` (price ${price(r).toLocaleString("en-US")} → ${match.price.toLocaleString("en-US")}; the current one stands)` : ""}` : "archived; no current offer by this name";
    add("archived offers", offersT!.name, r.id, `${n.code ?? "—"} ${n.name}`, note);
  }

  /* ── Lead magnets: the old lead-magnet offers, merged by name with the Lead Magnet table where one matches. ── */
  const lmT = t("lead magnet");
  const lmRows = hers(lmT, ["lead magnet name", "name"]);
  for (const m of plan.magnets) {
    const hit = lmRows.find((r) => sameOffer(text(r, "lead magnet name", "name")) === sameOffer(m.title));
    if (hit) {
      m.mergedWith = hit.id;
      m.link = none(text(hit, "asset link"));
      m.status = none(option(text(hit, "status")));
    }
    add("lead magnets", offersT!.name, m.sourceRef, m.title, hit ? `merged with "${text(hit, "lead magnet name", "name")}" in Lead Magnet` : "no Lead Magnet row by this name");
  }
  if (lmT) plan.notInPhase1.push({ table: `${lmT.name} (the rest: Phase 2 delivery tools)`, rows: lmRows.filter((r) => !plan.magnets.some((m) => m.mergedWith === r.id)).length });

  /* ── Vision: brand into Essence, values and principles as lists, beliefs into the bank, founder stories, revenue targets. ── */
  const visionT = t("vision");
  const visionRows = hers(visionT, ["name"]);
  const typeOf = (r: AirtableRecord) => option(text(r, "type"));
  const brand: Record<string, string | string[]> = {};
  const mission: Record<string, string> = {};
  const set = (k: string, v: string) => {
    if (v && !brand[k]) brand[k] = v;
  };
  // Which pathway a Vision row's "For Business" names: the offers' pathway that starts or ends with it ("For Coaches" → "Certification – Coaches").
  const pathwayFor = (label: string): string | null => {
    const bare = label.replace(/^For\s+/i, "").trim().toLowerCase();
    return pathwayNames.find((p) => p.toLowerCase() === bare || p.toLowerCase().endsWith(bare) || p.toLowerCase().startsWith(bare)) ?? null;
  };
  const pathwayStory = new Map<string, { story: string; row: AirtableRecord }>();
  for (const r of visionRows) {
    const name = text(r, "name");
    const type = typeOf(r);
    if (type === "Values") {
      brand.values = [...((brand.values as string[]) ?? []), [name, text(r, "description")].filter(Boolean).join(": ")];
      add("brand", visionT!.name, r.id, name, `a value${text(r, "value type") ? ` (${option(text(r, "value type"))})` : ""}, in Essence → Brand`);
    } else if (type === "Principles") {
      brand.principles = [...((brand.principles as string[]) ?? []), [name, text(r, "description")].filter(Boolean).join(": ")];
      add("brand", visionT!.name, r.id, name, `a principle${text(r, "principle type") ? ` (${option(text(r, "principle type"))})` : ""}, in Essence → Brand`);
    } else if (type === "Belief") {
      plan.assets.push({ sourceRef: r.id, type: "belief", name, body: text(r, "description") || name, summary: null, useWhen: null, tag: none(option(text(r, "belief type"))), extra: {} });
      add("beliefs", visionT!.name, r.id, name, option(text(r, "belief type")) || "");
    } else if (type === "Vision") {
      set("purpose", text(r, "purpose"));
      set("tagline", text(r, "tagline"));
      set("slogan", text(r, "slogan"));
      set("master_positioning", text(r, "master positioning"));
      set("competitive_advantage", text(r, "competitive advantage"));
      set("brand_promise", text(r, "brand promise"));
      set("three_year_snapshot", text(r, "3-year vision snapshot"));
      set("culture", text(r, "our culture"));
      set("standards", text(r, "standards"));
      set("operating_spine", text(r, "operating spine"));
      if (text(r, "mission statement") && !mission.mission_statement) mission.mission_statement = text(r, "mission statement");
      if (text(r, "vision statement") && !mission.vision_statement) mission.vision_statement = text(r, "vision statement");
      const pillars = [1, 2, 3, 4, 5].map((i) => text(r, `content pillar ${i}`)).filter(Boolean);
      if (pillars.length && !brand.content_pillars) brand.content_pillars = pillars;
      const partners = list(r, "strategic partners");
      if (partners.length && !brand.strategic_partners) brand.strategic_partners = partners;
      const story = text(r, "founders story");
      const pw = pathwayFor(text(r, "specialist pathway"));
      if (story && /\(master\)/i.test(name)) {
        plan.assets.push({ sourceRef: r.id, type: "story", name: "Founder story (master)", body: story, summary: null, useWhen: null, tag: "founder", extra: { pathway: null } });
        add("stories", visionT!.name, r.id, "Founder story (master)", `from "${name}"`);
      } else if (story && pw) {
        pathwayStory.set(pw, { story, row: r });
        plan.assets.push({ sourceRef: r.id, type: "story", name: `Founder story: ${pw}`, body: story, summary: null, useWhen: null, tag: "founder", extra: { pathway: pw } });
        add("stories", visionT!.name, r.id, `Founder story: ${pw}`, `from "${name}", on the ${pw} pathway`);
      } else add("brand", visionT!.name, r.id, name, "vision fields, in Essence → Brand and Mission and vision");
    } else if (/revenue target/i.test(name)) {
      const note = text(r, "description");
      brand.revenue_targets = note;
      const years = revenueTargets(note);
      for (const y of years) {
        const title = `Year ${y.year} revenue: ${y.line.replace(/^\W+/, "")}`;
        const unit = /NZD/i.test(y.line) || (!/\$/.test(y.line) && /NZD/i.test(note)) ? "NZD" : "$";
        const period = y.calendar ? `Year ${y.year} (${y.calendar})` : `Year ${y.year}`;
        plan.goals.push({ sourceRef: `${r.id}:Y${y.year}`, title, target: y.low, unit, period });
        add("revenue goals", visionT!.name, `${r.id}:Y${y.year}`, period, `target ${unit} ${y.low.toLocaleString("en-US")}${y.high ? ` to ${y.high.toLocaleString("en-US")}` : ""}`);
      }
      if (!years.length) add("brand", visionT!.name, r.id, name, "no year targets could be read from it; the note goes into Essence → Brand as written");
      else add("brand", visionT!.name, r.id, name, "the note also goes into Essence → Brand as written");
    } else {
      // "Brand Values + Tone of Voice" and anything else untyped: its note, as written, into Brand.
      const note = text(r, "description");
      if (note) brand[/tone/i.test(name) ? "tone_and_values" : "notes"] = [brand[/tone/i.test(name) ? "tone_and_values" : "notes"], note].filter(Boolean).join("\n\n");
      add("brand", visionT!.name, r.id, name, note ? "its note, into Essence → Brand" : "empty");
    }
  }
  if (Object.keys(brand).length) plan.essence.brand = brand;
  if (Object.keys(mission).length) plan.essence.mission_and_vision = mission;

  /* ── Pathways: one per pathway the current offers use, in ladder order, each with its founder story and promise. ── */
  pathwayNames.forEach((p, i) => {
    const codes = plan.offers.filter((o) => o.pathway === p && o.status !== "retired" && o.tierCode).map((o) => o.tierCode!.replace(/\d+$/, ""));
    const prefix = codes.length && codes.every((c) => c === codes[0]) ? codes[0] || null : null;
    const v = pathwayStory.get(p)?.row;
    plan.pathways.push({ sourceRef: `pathway:${p}`, name: p, tierPrefix: prefix, order: i, founderStory: pathwayStory.get(p)?.story ?? null, tagline: v ? none(text(v, "tagline")) : null, audiencePromise: v ? none(text(v, "audience promise")) : null, promiseEvidence: v ? none(text(v, "why this promise is credible")) : null });
    add("pathways", offersT!.name, `pathway:${p}`, p, `${plan.offers.filter((o) => o.pathway === p && o.status !== "retired").length} current offers${prefix ? `, codes ${prefix}…` : ""}${pathwayStory.has(p) ? ", with its founder story" : ""}`);
  });

  /* ── Methodologies: her frameworks, into her bank. ── */
  const methT = t("methodologies");
  for (const r of hers(methT, ["methodology", "name"])) {
    const name = text(r, "methodology", "name");
    plan.assets.push({
      sourceRef: r.id,
      type: "framework",
      name,
      body: text(r, "description") || text(r, "overview") || name,
      summary: none(text(r, "core insight")),
      useWhen: none(option(text(r, "application"))),
      tag: none(option(text(r, "type"))),
      extra: { overview: none(text(r, "overview")), phrase: none(text(r, "memorable phrase")), spine_element: none(option(text(r, "spine element"))), delivery_format: none(list(r, "delivery format").join(", ")), architecture_domain: none(list(r, "architecture domain").join(", ")), maturity: none(option(text(r, "maturity level"))), research_backing: none(text(r, "research backing")), source_doc: none(text(r, "source doc url")) },
    });
    add("frameworks", methT!.name, r.id, name);
  }

  /* ── Buyer readiness: the stages with their words; the fragment rows kept verbatim, together, for review. ── */
  const brT = t("buyer readiness");
  const fragments: AirtableRecord[] = [];
  let order = 0;
  for (const r of hers(brT, ["stage", "name"])) {
    const name = text(r, "stage", "name");
    const desc = text(r, "description");
    const outcome = text(r, "outcome");
    if (!desc && !outcome && !list(r, "strategic message").length) {
      fragments.push(r);
      continue;
    }
    const review = /^MIGRATION NOTE/i.test(desc) || /\(review\)/i.test(name);
    // Links to old offers point at the current offer each maps to (Danno, 27 Sep); a link to anything else is dropped.
    const offerRefs = [...new Set(list(r, "offers").map((id) => plan.offers.find((o) => o.sourceRef === id)?.replacedBy ?? id).filter((id) => plan.offers.some((o) => o.sourceRef === id && o.status !== "retired")))];
    const v1 = v1ById.get(text(r, "v1 record id"));
    const body = review ? (v1 ? text(v1, "value ladder stage") : "") || desc : desc;
    if (review && !v1) plan.unfilled.push(`${brT!.name} "${name}": its full text is in the fallback base${Object.keys(src.v1).length ? ", but its row isn't there" : ""}; kept as this base has it, with its migration note`);
    plan.assets.push({
      sourceRef: r.id,
      type: "journey_stage",
      name,
      body,
      summary: none(outcome),
      useWhen: null,
      tag: review ? "review" : null,
      extra: { order: String(order++), offer_refs: none(offerRefs.join(",")), readiness_need: none(list(r, "readiness need").join("; ")), strategic_message: none(list(r, "strategic message").join("; ")), status: none(option(text(r, "status"))), review: review ? "yes" : null },
    });
    add("journey", brT!.name, r.id, name, review ? `for review: its text from the first base${v1 ? "" : " (not found there; kept as in this base)"}` : outcome ? "stage, with its outcome" : "stage");
  }
  if (fragments.length) {
    const ref = `fragments:${brT!.name}`;
    const pieces = fragments.map((r) => `- ${text(r, "stage", "name")}`).join("\n");
    const why = "Split into pieces when the base was first migrated, with no order kept in either base. Kept word for word, for re-joining by hand.";
    plan.assets.push({ sourceRef: ref, type: "journey_stage", name: "Pieces to re-join (review)", body: pieces, summary: null, useWhen: null, tag: "review", extra: { order: String(order++), review: "yes", why } });
    add("journey", brT!.name, ref, "Pieces to re-join (review)", `${fragments.length} rows with a name and nothing else, kept word for word in one entry: neither base keeps their order, so they aren't re-joined by guesswork`);
  }

  /* ── Tasks: all of them, status kept, the Airtable links kept for Phase 2. ── */
  const taskT = t("tasksos");
  for (const r of hers(taskT, ["tasks", "name"])) {
    const title = text(r, "tasks", "name");
    const status = option(text(r, "status"));
    const urgency = option(text(r, "urgency"));
    const kind = option(text(r, "tasks type"));
    const responsible = field(r, "responsible") as { name?: string } | undefined;
    plan.tasks.push({
      sourceRef: r.id,
      title,
      details: none(text(r, "details")),
      status: STATUS_TASK[status] ?? "upcoming",
      urgency: URGENCY[urgency] ?? "medium",
      // A type with no match (or none) is admin: the category is required, and admin is the least presumptuous.
      category: CATEGORY[kind] ?? "admin",
      dueDate: none(text(r, "due date")),
      completedAt: none(text(r, "complete date")),
      assignee: none(text(r, "responsible (v1 text)") || responsible?.name || ""),
      refs: { v1: none(text(r, "v1 record id")), goals: list(r, "goals"), initiatives: list(r, "initiatives") },
    });
    add("tasks", taskT!.name, r.id, title, status || "no status");
  }

  /* ── Groups. ── */
  const groupT = t("groups");
  for (const r of hers(groupT, ["group name", "name"])) {
    const name = text(r, "group name", "name");
    const notes = [["Type", option(text(r, "type"))], ["Freedom", text(r, "freedom")], ["Engagement", option(text(r, "engagement"))], ["Quality", option(text(r, "quality"))], ["Buy-in", option(text(r, "buy-in"))]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ");
    plan.groups.push({ sourceRef: r.id, name, url: none(text(r, "link")), notes: none(notes) });
    add("groups", groupT!.name, r.id, name);
  }

  /* ── Everything else in the base: counted, not read into anything (Phase 2, or not hers). ── */
  for (const [k, tb] of Object.entries(src.v2)) if (tb && !PHASE1.includes(k)) plan.notInPhase1.push({ table: tb.name, rows: tb.records.length });
  return plan;
}

/** The dry run's counts: per area, created and updated; skipped by reason. */
export function planSummary(plan: ImportPlan): { area: string; create: number; update: number }[] {
  return AREAS.map((a) => ({ area: a, create: plan.lines.filter((l) => l.area === a && l.action === "create").length, update: plan.lines.filter((l) => l.area === a && l.action === "update").length })).filter((x) => x.create + x.update);
}
