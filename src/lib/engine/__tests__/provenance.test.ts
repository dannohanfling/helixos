import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORIGINS, contentItems, contentVariants, leadMagnets, webinarSections } from "@/db/schema";
import { ACCEPT_LABEL, CONTINUE_LABEL, REVIEW_LABEL, UNREVIEWED_LABEL, carriesUnreviewed, gateFor, gateLine, originAfterAccept, originAfterSave, sameItems, sectionGate, variantName } from "../provenance";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : []; });

describe("the provenance mark", () => {
  it("the four tables that store AI drafts carry origin with the four states, nullable", () => {
    for (const t of [webinarSections, contentItems, leadMagnets, contentVariants]) {
      const col = t.origin;
      expect(col.name).toBe("origin");
      expect(col.notNull).toBe(false);
      expect(col.enumValues).toEqual([...ORIGINS]);
    }
    expect(ORIGINS).toEqual(["ai_unreviewed", "ai_accepted", "edited", "coach", "rule"]);
  });

  it("an edit is a review; an unchanged save is not; coach text is coach; a row with no origin is never guessed", () => {
    // Unchanged text keeps whatever mark it had, including none. A browser submits a textarea with CRLF line breaks: the walk found a
    // plain save of a multi-line draft counting as an edit, so the same words with different line endings are the same words.
    expect(originAfterSave("ai_unreviewed", "draft", "draft")).toBe("ai_unreviewed");
    expect(originAfterSave("ai_unreviewed", "one\ntwo\nthree", "one\r\ntwo\r\nthree")).toBe("ai_unreviewed");
    expect(carriesUnreviewed("ai_unreviewed", "one\ntwo", "one\r\ntwo\r\n")).toBe(true);
    expect(originAfterSave(null, "old", "old")).toBeNull();
    expect(originAfterSave(undefined, null, "")).toBeNull();
    // Changed AI text is edited, whichever AI state it was in.
    expect(originAfterSave("ai_unreviewed", "draft", "draft, reworded")).toBe("edited");
    expect(originAfterSave("ai_accepted", "draft", "draft, reworded")).toBe("edited");
    expect(originAfterSave("edited", "a", "b")).toBe("edited");
    // Text the coach wrote, or changed on a row with no known origin, is the coach's.
    expect(originAfterSave("coach", "a", "b")).toBe("coach");
    expect(originAfterSave(null, null, "my words")).toBe("coach");
    expect(originAfterSave(null, "old", "new")).toBe("coach");
  });

  it("Accept moves one unreviewed draft to accepted and touches nothing else", () => {
    expect(originAfterAccept("ai_unreviewed")).toBe("ai_accepted");
    expect(originAfterAccept("ai_accepted")).toBe("ai_accepted");
    expect(originAfterAccept("edited")).toBe("edited");
    expect(originAfterAccept("coach")).toBe("coach");
    expect(originAfterAccept(null)).toBeNull();
  });

  it("the gate names only unreviewed drafts, in order, and is nothing when every one has been read", () => {
    expect(gateLine(1)).toBe("1 item is an AI draft you haven't reviewed");
    expect(gateLine(3)).toBe("3 items are AI drafts you haven't reviewed");
    const gate = gateFor([{ name: "Hook", origin: "ai_unreviewed" }, { name: "Vehicle", origin: "edited" }, { name: "Proof", origin: null }, { name: "Close", origin: "ai_unreviewed" }]);
    expect(gate).toEqual({ line: "2 items are AI drafts you haven't reviewed", items: ["Hook", "Close"] });
    expect(gateFor([{ name: "Hook", origin: "ai_accepted" }, { name: "Close", origin: "coach" }])).toBeNull();
    // Rule-composed text is never gated: its words are Danno's doctrine the coach picked, or a reshaping of the coach's own.
    expect(gateFor([{ name: "Post", origin: "rule" }])).toBeNull();
    expect(carriesUnreviewed("rule", "draft", "draft")).toBe(false);
    // A coach's edit of rule text is the coach's; an accept on it is a no-op.
    expect(originAfterSave("rule", "a", "b")).toBe("coach");
    expect(originAfterSave("rule", "a", "a")).toBe("rule");
    expect(originAfterAccept("rule")).toBe("rule");
    expect(gateFor([])).toBeNull();
    // A section left out on purpose goes nowhere, so it is not gated.
    expect(sectionGate([{ name: "Hook", status: "omitted", origin: "ai_unreviewed" }, { name: "Close", status: "drafted", origin: "ai_unreviewed" }])).toEqual({ line: "1 item is an AI draft you haven't reviewed", items: ["Close"] });
  });

  it("a draft going out as it was stored is unreviewed; one rewritten on the way was reviewed by the rewrite", () => {
    expect(carriesUnreviewed("ai_unreviewed", "draft", "draft")).toBe(true);
    expect(carriesUnreviewed("ai_unreviewed", "draft", " draft \n")).toBe(true);
    expect(carriesUnreviewed("ai_unreviewed", "draft", "draft, reworded")).toBe(false);
    expect(carriesUnreviewed("ai_accepted", "draft", "draft")).toBe(false);
    expect(carriesUnreviewed(null, "draft", "draft")).toBe(false);
  });

  it("a confirm covers exactly the drafts it named; a variant is named by its group or its channel", () => {
    expect(sameItems(["Hook", "Close"], ["Close", "Hook"])).toBe(true);
    expect(sameItems(["Hook"], ["Hook", "Close"])).toBe(false);
    expect(sameItems([], [])).toBe(true);
    expect(variantName({ channel: "fb_group", groupId: "g1" }, "Coaches Who Post")).toBe("Coaches Who Post");
    expect(variantName({ channel: "linkedin", groupId: "" })).toBe("LinkedIn");
  });

  it("the labels are the ruling's words", () => {
    expect(UNREVIEWED_LABEL).toBe("AI draft, not reviewed");
    expect(ACCEPT_LABEL).toBe("Accept");
    expect(REVIEW_LABEL).toBe("Review");
    expect(CONTINUE_LABEL).toBe("Continue anyway");
  });
});

describe("where the mark is set and where the gate stands (read off the source)", () => {
  it("each of the four store-on-return AI paths stores the model's text as ai_unreviewed", () => {
    const paths = [
      ["src/lib/actions/webinars.ts", /status: "drafted", keyPoints: section\?\.keyPoints \?\? null, origin: "ai_unreviewed"/],
      ["src/lib/actions/magnets.ts", /generatedBy: "claude", origin: "ai_unreviewed"/],
      ["src/lib/actions/doctrine.ts", /origin = "ai_unreviewed"/],
      ["src/lib/actions/groups.ts", /by === "claude" \? \("ai_unreviewed" as const\) : \("rule" as const\)/],
    ] as const;
    expect(paths.length).toBe(4);
    for (const [file, re] of paths) expect(read(file), file).toMatch(re);
  });

  it("text a rule composed is stored as rule, so null means only a row from before the mark", () => {
    const sites = [
      ["src/lib/actions/doctrine.ts", /let origin: "ai_unreviewed" \| "rule" = "rule"/],
      ["src/lib/actions/groups.ts", /by === "claude" \? \("ai_unreviewed" as const\) : \("rule" as const\)/],
      ["src/lib/actions/variants.ts", /p \? \("ai_unreviewed" as const\) : \("rule" as const\)/],
      ["src/lib/actions/magnets.ts", /generatedBy: "scaffold", origin: "rule"/],
      ["src/lib/actions/magnets.ts", /generatedBy: text \? "claude-partial" : "scaffold", origin: "rule"/],
      ["src/lib/actions/ladders.ts", /contentType: "Comment Ladder", notes: l\.notes, origin: "rule" as const/],
      ["src/lib/actions/ladders.ts", /generatedBy: "ladder", origin: "rule"/],
      ["src/lib/actions/proofs.ts", /body, origin: "rule", notes/],
      ["src/lib/actions/content.ts", /origin: "coach",\n  \}\);/],
      ["src/lib/actions/compose.ts", /\.\.\.row, origin: "coach" \}\)/],
    ] as const;
    expect(sites.length).toBe(10);
    for (const [file, re] of sites) expect(read(file), `${file} ${re}`).toMatch(re);
    // No write site on the four tables sets origin to null on purpose.
    for (const file of ["doctrine", "groups", "variants", "magnets", "ladders", "proofs", "content", "compose", "webinars"]) expect(read(`src/lib/actions/${file}.ts`), file).not.toMatch(/origin: null/);
  });

  it("every action that sends content out checks the gate and logs Continue anyway with who and when", () => {
    const route = read("src/app/api/webinars/[id]/deck/route.ts");
    expect(route).toMatch(/sectionGate\(/);
    expect(route).toMatch(/confirmFor\(url\.searchParams\.get\("confirmed"\), v\.user\.id, "deck_export", w\.id\)/);
    // The walk found the route taking an older confirm for a draft it never named; the route now needs the same names, as the step does.
    expect(route).toMatch(/if \(gate && !\(confirm && sameItems\(confirm\.items, gate\.items\)\)\)/);
    expect(route).toMatch(/status: 409/);
    const magnets = read("src/lib/actions/magnets.ts");
    expect(magnets).toMatch(/export async function publishMagnetAction/);
    expect(magnets).toMatch(/if \(gate && str\(formData, "confirm"\) !== "1"\) redirect\(`\/magnets\/\$\{m\.id\}\?gate=publish`\)/);
    expect(magnets).toMatch(/recordConfirm\(\{ workspaceId, userId, userName: v\.user\.name \}, "magnet_publish"/);
    const compose = read("src/lib/actions/compose.ts");
    expect(compose).toMatch(/if \(names\.length && !payload\.confirm\) return \{ id: id \?\? "", scheduled: 0, posted: 0, pushed: 0, gate:/);
    expect(compose).toMatch(/recordConfirm\(\{ workspaceId, userId, userName: v\.user\.name \}, payload\.mode === "now" \? "post_now" : "post_schedule"/);
    for (const file of ["src/lib/actions/variants.ts", "src/lib/actions/content.ts"]) {
      const src = read(file);
      expect(src, file).toMatch(/carriesUnreviewed\(/);
      expect(src, file).toMatch(/str\(formData, "confirm"\) !== "1"/);
      expect(src, file).toMatch(/recordConfirm\(/);
    }
    // The public magnet page shows nothing of the mark: its gate was the publish. It serves only a published page.
    const pub = read("src/app/m/[slug]/page.tsx");
    expect(pub).toMatch(/m\.formats\.page && m\.publishedAt \? m : null/);
    expect(pub).not.toMatch(/origin|UnreviewedMark|GateBlock/);
    // The confirm row carries who and when.
    expect(read("src/lib/provenance.ts")).toMatch(/userId: who\.userId, userName: who\.userName, surface, subjectId, items/);
  });

  it("Accept is per item: no accept-all anywhere in the app", () => {
    const files = [...walk(path.join(process.cwd(), "src/app")), ...walk(path.join(process.cwd(), "src/components")), ...walk(path.join(process.cwd(), "src/lib/actions"))];
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/accept[ -]?all|acceptAll|accept every/i);
    // The one Accept form takes exactly one record's fields, never a list of ids.
    const mark = read("src/components/provenance.tsx");
    expect(mark).toMatch(/fields: Record<string, string>/);
    expect(mark).not.toMatch(/getAll|ids\[\]/);
  });

  it("existing rows stay null: the migration adds the column without a default and backfills nothing but the publish state", () => {
    const sql = read("drizzle/0051_provenance.sql");
    for (const t of ["content_items", "content_variants", "lead_magnets", "webinar_sections"]) expect(sql).toContain(`ALTER TABLE \`${t}\` ADD \`origin\` text;`);
    expect(sql).not.toMatch(/`origin` text (DEFAULT|NOT NULL)/);
    expect(sql).not.toMatch(/UPDATE[^;]*`origin`/);
    // The hosted pages that were live stay live: published_at is set from created_at only where the page format was on.
    expect(sql).toMatch(/UPDATE `lead_magnets` SET `published_at` = `created_at` WHERE `published_at` IS NULL AND json_extract\(`formats`, '\$\.page'\) = 1;/);
  });
});
