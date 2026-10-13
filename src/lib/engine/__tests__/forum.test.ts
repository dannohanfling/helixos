import { describe, expect, it } from "vitest";
import { FORUM_PLOTS } from "@/db/schema";
import { formatDateTime } from "@/lib/dates";
import { markGlossary } from "@/lib/engine/glossary";
import {
  FORUM_BUILDINGS,
  FORUM_SEED,
  FORUM_MAX,
  FORUM_PLOT_XY,
  ROSTRA_XY,
  builtInCard,
  cleanLink,
  composeForum,
  forumAgo,
  looksLikeSecret,
  parseForumReport,
  plotFor,
  reportTime,
  streetPath,
  type ComposeInput,
} from "@/lib/engine/forum";

const NOW = new Date("2026-10-12T18:00:00.000Z");
const agent = (over: Partial<ComposeInput["agents"][number]> = {}): ComposeInput["agents"][number] => ({ id: "a1", name: "Main", platform: null, role: null, link: null, plotId: "p06", builtIn: null, status: "working", now: "Building", last: null, next: null, flowTo: null, flowLabel: null, flowAt: null, queue: [], confirmed: true, reportedAt: "2026-10-12T17:50:00.000Z", createdAt: "2026-10-01 00:00:00", ...over });
const base = (over: Partial<ComposeInput> = {}): ComposeInput => ({ agents: [], builtIns: {}, needs: [], events: [], headline: null, headlineAt: null, now: NOW, ...over });

describe("The Forum (rev 765): the secret scrub", () => {
  it("catches keys and tokens of every shape the brief names, and leaves ordinary words and short commit codes alone", () => {
    for (const s of ["sk-ant-abc123def456ghi789", "sk-proj-AAAAAAAAAAAAAAAA", "ghp_1234567890abcdefABCDEF", "github_pat_11ABCDEFG0123456789_abc", "xoxb-1234567890-abcdefghij", "hxf_abcdefghijklmnopqrstuv", "0123456789abcdef0123456789abcdef", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9w", "use the key AKIAABCDEFGHIJKLMNOP now"]) expect(looksLikeSecret(s), s).toBe(true);
    for (const s of ["Building the Forum", "pushed 5530bfb to main", "Waiting for the gate on rev 765", "https://github.com/dannohanfling/helixos/pull/12"]) expect(looksLikeSecret(s), s).toBe(false);
  });

  it("a report with a fake sk- value keeps the rest and drops that field whole, counting it as removed", () => {
    const r = parseForumReport({ agent: "Main", status: "working", now: "Testing with sk-live-abcdefghijklmnop123", last: "Pushed" }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.now).toBeNull();
    expect(r.report.has.now).toBe(true);
    expect(r.report.last).toBe("Pushed");
    expect(r.removed).toEqual(["now"]);
    expect(JSON.stringify(r.report)).not.toContain("sk-live");
  });

  it("an agent name that looks like a key saves nothing", () => {
    expect(parseForumReport({ agent: "ghp_1234567890abcdefABCDEF", status: "idle" }).ok).toBe(false);
  });

  it("an agent's saved link is http(s) only, with no credentials", () => {
    expect(cleanLink("https://github.com/x/y")).toBe("https://github.com/x/y");
    expect(cleanLink("javascript:alert(1)")).toBeNull();
    expect(cleanLink("https://user:pass@example.com")).toBeNull();
    expect(cleanLink("https://example.com/?token=ghp_1234567890abcdefABCDEF")).toBeNull();
  });
});

describe("a report, read from untrusted JSON", () => {
  it("now, last and next are capped at 200 characters; control characters and markup stay plain text", () => {
    const long = "x ".repeat(400);
    const r = parseForumReport({ agent: "  Main ", now: long, last: "<b>bold</b>\u0007 done" }, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.agent).toBe("Main");
    expect(r.report.now!.length).toBeLessThanOrEqual(FORUM_MAX.line);
    expect(r.report.last).toBe("<b>bold</b> done");
  });

  it("needs an agent and something to say; a bad status is refused in plain words", () => {
    expect(parseForumReport({ status: "working" }).ok).toBe(false);
    expect(parseForumReport({ agent: "Main" }).ok).toBe(false);
    const bad = parseForumReport({ agent: "Main", status: "busy" });
    expect(bad.ok === false && bad.error).toContain("working, waiting, idle or done");
    expect(parseForumReport(["not", "an", "object"]).ok).toBe(false);
  });

  it("reads a flow, a needs-you item, cleared items, a queue and a headline", () => {
    const r = parseForumReport({ agent: "Cowork", flow: { to: "Main", label: "brief 765" }, needs_you: { what: "Approve the plan", when: "today" }, needs_cleared: ["Old ask"], queue: ["Glossary", { name: "Forum", state: "now", rev: "765" }], headline: "Forum day" }, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.flow).toEqual({ to: "Main", label: "brief 765" });
    expect(r.report.needsYou).toEqual({ what: "Approve the plan", detail: null, when: "today" });
    expect(r.report.needsCleared).toEqual(["Old ask"]);
    expect(r.report.queue).toEqual([{ name: "Glossary", state: "queued" }, { name: "Forum", state: "now", rev: "765" }]);
    expect(r.report.headline).toBe("Forum day");
  });

  it("a report's own time is used when it's a real UTC time from the last day; otherwise it arrives now", () => {
    expect(reportTime("2026-10-12T05:35:00Z", NOW)).toBe("2026-10-12T05:35:00.000Z");
    expect(reportTime("2026-10-12 05:35", NOW)).toBeNull();
    expect(reportTime("2026-10-14T05:35:00Z", NOW)).toBeNull();
    expect(reportTime("2026-10-01T05:35:00Z", NOW)).toBeNull();
  });

  it("rev 779: 05:35 UTC on Oct 12 shows as Oct 11, 10:35 PM PDT for a member in Los Angeles", () => {
    expect(formatDateTime("2026-10-12T05:35:00.000Z", "America/Los_Angeles", { zone: true })).toBe("Oct 11, 10:35 PM PDT");
  });
});

describe("the map (Danno's 12 plots, 13 Oct)", () => {
  it("twelve plots, each with a building, and no two name plates on top of each other", () => {
    expect(Object.keys(FORUM_BUILDINGS).sort()).toEqual([...FORUM_PLOTS].sort());
    const plates = [...Object.values(FORUM_PLOT_XY).map((p) => ({ x: p.px, y: p.py })), { x: ROSTRA_XY.px, y: ROSTRA_XY.py }];
    for (let i = 0; i < plates.length; i++) for (let j = i + 1; j < plates.length; j++) expect(Math.hypot(plates[i].x - plates[j].x, plates[i].y - plates[j].y), `${i}-${j}`).toBeGreaterThan(60);
    for (const p of plates) expect(p.x > 0 && p.x < 1680 && p.y > 0 && p.y < 944).toBe(true);
  });

  it("a new agent takes the lowest free plot, then the Outer districts", () => {
    expect(plotFor([])).toBe("p01");
    expect(plotFor(["p01", "p02", null, "p04"])).toBe("p03");
    expect(plotFor([...FORUM_PLOTS])).toBeNull();
  });

  it("the coach's team stands on the plots the photo suggests, Hermes on p08, p09, p10 and p12 free", () => {
    expect(Object.fromEntries(FORUM_SEED.map((a) => [a.name, a.plot]))).toEqual({ Acta: "p01", Scriba: "p02", Porta: "p03", Medicus: "p04", Orator: "p05", Architectus: "p06", Hospes: "p07", Hermes: "p08", Tabularium: "p11" });
  });

  it("a street runs door to door through the square", () => {
    expect(streetPath("p12", "p06")).toMatch(/^M310,320 L570,417 Q\d+,\d+ 1117,493 L1385,550$/);
    expect(streetPath("p06", "rostra")).toContain("840,465");
  });
});

describe("the composed state, in the mockup's shape", () => {
  it("a flow shows for 30 minutes, to an agent's building or the Rostra, and not after", () => {
    const fresh = composeForum(base({ agents: [agent({ flowTo: "you", flowLabel: "plan ready", flowAt: "2026-10-12T17:45:00.000Z" })] }));
    expect(fresh.flows).toEqual([{ from: "p06", to: "rostra", label: "plan ready", agentId: "a1" }]);
    const old = composeForum(base({ agents: [agent({ flowTo: "you", flowLabel: "plan ready", flowAt: "2026-10-12T17:00:00.000Z" })] }));
    expect(old.flows).toEqual([]);
    const toAgent = composeForum(base({ agents: [agent({ flowTo: "cowork", flowLabel: "question", flowAt: "2026-10-12T17:59:00.000Z" }), agent({ id: "a2", name: "Cowork", plotId: "p02", createdAt: "2026-10-02 00:00:00" })] }));
    expect(toAgent.flows[0]).toMatchObject({ from: "p06", to: "p02" });
  });

  it("built-in agents appear from what HelixOS already recorded, on the lowest free plots, without a row", () => {
    const s = composeForum(base({ builtIns: { booking: [{ at: "2026-10-12T17:55:00.000Z", text: "A call was booked" }], ship: [{ at: "2026-10-11T09:00:00.000Z", text: 'Posted "Hello"' }] } }));
    const booking = s.agents.find((a) => a.builtIn === "booking")!;
    expect(booking).toMatchObject({ id: "builtin:booking", plot: "p01", status: "working", last: "A call was booked" });
    expect(s.agents.find((a) => a.builtIn === "ship")).toMatchObject({ plot: "p02", status: "idle" });
    expect(s.log.map((l) => l.text)).toEqual(["A call was booked", 'Posted "Hello"']);
  });

  it("a built-in with nothing recorded isn't shown", () => {
    expect(builtInCard("ship", [], NOW)).toBeNull();
    expect(composeForum(base()).agents).toEqual([]);
  });

  it("waiting is oldest first with its agent's name; news is newest first, twelve at most; updatedAt is the newest stamp", () => {
    const events = Array.from({ length: 15 }, (_, i) => ({ agentId: "a1", kind: "status", payload: { now: `step ${i}` }, at: `2026-10-12T1${String(i).padStart(1, "0").slice(-1)}:00:00.000Z`.replace("T1", i < 10 ? "T0" : "T1") }));
    const s = composeForum(base({ agents: [agent()], events, needs: [{ id: "n2", agentId: "a1", what: "Second", detail: null, when: null, createdAt: "2026-10-12 12:00:00" }, { id: "n1", agentId: "a1", what: "First", detail: null, when: "today", createdAt: "2026-10-12 10:00:00" }] }));
    expect(s.waiting.map((w) => w.what)).toEqual(["First", "Second"]);
    expect(s.waiting[0].agent).toBe("Main");
    expect(s.log).toHaveLength(12);
    expect(s.log[0].at >= s.log[11].at).toBe(true);
    expect(s.updatedAt).toBe("2026-10-12T17:50:00.000Z");
  });

  it("a removed value shows as news without the value", () => {
    const s = composeForum(base({ agents: [agent()], events: [{ agentId: "a1", kind: "removed", payload: { count: 1 }, at: "2026-10-12T17:00:00.000Z" }] }));
    expect(s.log[0].text).toBe("a value was removed because it looked like a key");
  });

  it("'… ago' in the mockup's words", () => {
    expect(forumAgo("2026-10-12T17:59:40.000Z", NOW)).toBe("just now");
    expect(forumAgo("2026-10-12T17:56:00.000Z", NOW)).toBe("4 min ago");
    expect(forumAgo("2026-10-12T15:00:00.000Z", NOW)).toBe("3 h ago");
    expect(forumAgo("2026-10-09T18:00:00.000Z", NOW)).toBe("3 days ago");
  });
});

describe("glossary words on Forum cards (rev 768)", () => {
  const items = [
    { slug: "rate-limit", term: "Rate limit", meaning: "A cap on requests.", hidden: false },
    { slug: "repository", term: "Repository (repo)", meaning: "The one place all the code is kept.", hidden: false },
    { slug: "branch", term: "Branch", meaning: "A copy.", hidden: true },
  ];
  it("whole words, any case, only the first on a card, and hidden entries never mark", () => {
    const used = new Set<string>();
    const a = markGlossary("Hit the RATE LIMIT pushing to the repo; the repo is fine", items, used);
    expect(a.filter((m) => m.slug).map((m) => m.text)).toEqual(["RATE LIMIT", "repo"]);
    const b = markGlossary("Another repo line on the same card, a branch too", items, used);
    expect(b.some((m) => m.slug)).toBe(false);
    expect(markGlossary("repos and reporting", items).some((m) => m.slug)).toBe(false);
    expect(a.map((m) => m.text).join("")).toBe("Hit the RATE LIMIT pushing to the repo; the repo is fine");
  });
});
