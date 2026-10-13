import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The leaderboard on the server (H-29): a visitor never makes HelixOS read eLoyalty, whatever the age of the held board; the
 * cron is the one reader, on a checked host only, and a 429 makes it wait a minute. The key never appears in anything served.
 * The database is a stand-in here: one feed row, read and updated in memory.
 */
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-1234";

type Row = Record<string, unknown>;
const state: { feed: Row } = { feed: {} };
const sets: Row[] = [];
vi.mock("@/db", () => {
  const where = () => Promise.resolve();
  return {
    schema: { leaderboardFeeds: { id: "id", slug: "slug", keyEncrypted: "key_encrypted", membershipId: "membership_id", workspaceId: "workspace_id" } },
    db: {
      query: { leaderboardFeeds: { findFirst: async () => state.feed, findMany: async () => [state.feed] } },
      update: () => ({
        set: (v: Row) => {
          sets.push(v);
          Object.assign(state.feed, v);
          return { where };
        },
      }),
    },
  };
});

const KEY = "elk_test_admin_key_7f3a9c2e5b1d4f60";
const rows = [
  { id: "cus_001", name: "Maria S.", lifetime: 2450, available: 900 },
  { id: "cus_002", name: "Ben O.", lifetime: 300, available: 300 },
];
const fresh = (over: Row = {}): Row => ({ id: "f1", workspaceId: "w", userId: "u", membershipId: "m", slug: "christian-abc123", keyEncrypted: null, keyLast4: null, host: "https://www.eloyalty.ai", templateId: "89fd70bc", templateIdAlt: null, hidden: [], lastCheckAt: null, lastCheckOk: null, lastCheckNote: null, cacheJson: null, cachedAt: null, pageJson: null, exportJson: null, exportAsOf: null, refreshAfter: null, updatedAt: "2026-10-13T00:00:00.000Z", createdAt: "2026-10-13T00:00:00.000Z", ...over });

describe("serving a leaderboard never reaches eLoyalty", () => {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: [], pagination: { has_more: false } }), { status: 200 }));
  beforeEach(() => {
    sets.length = 0;
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a stale held board is served as it is, with the hide list and zero rule applied now, and no call goes out", async () => {
    const { seal } = await import("@/lib/crypto");
    const { servedFeed, pageFor } = await import("@/lib/leaderboard");
    state.feed = fresh({ keyEncrypted: seal(KEY), keyLast4: KEY.slice(-4), lastCheckOk: true, cacheJson: JSON.stringify([...rows, { id: "cus_003", name: "Zero P.", lifetime: 0, available: 0 }]), cachedAt: "2000-01-01T00:00:00.000Z", hidden: ["cus_002"], pageJson: JSON.stringify({ tiers: [{ name: "Seed", min: 0 }, { name: "Tree", min: 1000 }], showZero: false }) });
    const feed = await servedFeed("christian-abc123");
    expect(feed).toEqual({ updated_at: "2000-01-01T00:00:00.000Z", members: [{ name: "Maria S.", lifetime: 2450, available: 900, tier: "Tree" }] });
    const page = await pageFor("christian-abc123");
    expect(page?.members.map((m) => m.name)).toEqual(["Maria S."]);
    expect(page?.source).toEqual({ kind: "live", at: "2000-01-01T00:00:00.000Z" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sets).toEqual([]);
    const text = JSON.stringify(feed) + JSON.stringify(page);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY.slice(-8));
    expect(text).not.toContain("cus_");
  });

  it("without a key the pasted export is served; with nothing at all the feed is 503 and the page shows the samples", async () => {
    const { servedFeed, pageFor } = await import("@/lib/leaderboard");
    state.feed = fresh({ exportJson: JSON.stringify([{ name: "Aisha P.", lifetime: 1105, available: 405 }]), exportAsOf: "9 Oct 2026" });
    expect(await servedFeed("christian-abc123")).toEqual({ updated_at: "9 Oct 2026", members: [{ name: "Aisha P.", lifetime: 1105, available: 405, tier: "Gate 5" }] });
    expect((await pageFor("christian-abc123"))?.source).toEqual({ kind: "export", at: "9 Oct 2026" });
    state.feed = fresh();
    expect(await servedFeed("christian-abc123")).toBeNull();
    const page = await pageFor("christian-abc123");
    expect(page?.source).toEqual({ kind: "sample" });
    expect(page?.members).toHaveLength(15);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the cron is the one reader", () => {
  const calls: string[] = [];
  let status = 200;
  beforeEach(() => {
    sets.length = 0;
    calls.length = 0;
    status = 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
        if (status !== 200) return new Response("{}", { status });
        const tpl = new URL(url).searchParams.get("template_id");
        const data = tpl === "second" ? [{ id: "cus_002", first_name: "Ben", last_name: "Okafor", points_earned: 300, points_balance: 300, is_active: true }, { id: "cus_009", first_name: "Nina", last_name: "Brooks", points_earned: 310, points_balance: 110, is_active: true }] : [{ id: "cus_001", first_name: "Maria", last_name: "Santos", email: "m@example.com", points_earned: 2450, points_balance: 900, is_active: true }, { id: "cus_002", first_name: "Ben", last_name: "Okafor", points_earned: 300, points_balance: 300, is_active: true }];
        return new Response(JSON.stringify({ data, pagination: { has_more: false, next_cursor: null } }), { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("skips an unchecked feed and a fresh one, reads a stale checked one across both templates (nobody twice), and keeps a clean board", async () => {
    const { seal } = await import("@/lib/crypto");
    const { refreshFeeds, FRESH_MS } = await import("@/lib/leaderboard");
    const now = new Date("2026-10-13T12:00:00.000Z");
    state.feed = fresh({ keyEncrypted: seal(KEY), lastCheckOk: null });
    expect(await refreshFeeds(now)).toEqual([{ slug: "christian-abc123", outcome: "unchecked" }]);
    state.feed = fresh({ keyEncrypted: seal(KEY), lastCheckOk: true, cachedAt: new Date(now.getTime() - FRESH_MS + 1000).toISOString() });
    expect(await refreshFeeds(now)).toEqual([{ slug: "christian-abc123", outcome: "fresh" }]);
    expect(calls).toEqual([]);
    state.feed = fresh({ keyEncrypted: seal(KEY), lastCheckOk: true, templateIdAlt: "second", cachedAt: "2000-01-01T00:00:00.000Z" });
    expect(await refreshFeeds(now)).toEqual([{ slug: "christian-abc123", outcome: "refreshed" }]);
    expect(calls.map((u) => new URL(u).searchParams.get("template_id"))).toEqual(["89fd70bc", "second"]);
    const held = JSON.parse(String(state.feed.cacheJson)) as { name: string }[];
    expect(held.map((r) => r.name)).toEqual(["Maria S.", "Nina B.", "Ben O."]);
    expect(String(state.feed.cacheJson)).not.toContain("@");
    expect(state.feed.cachedAt).toBe(now.toISOString());
  });

  it("a 429 (or no answer) sets a minute's wait and keeps the last good board; another error keeps the board and says so in the note", async () => {
    const { seal } = await import("@/lib/crypto");
    const { refreshFeeds, BACKOFF_MS } = await import("@/lib/leaderboard");
    const now = new Date("2026-10-13T12:00:00.000Z");
    const held = JSON.stringify(rows);
    status = 429;
    state.feed = fresh({ keyEncrypted: seal(KEY), lastCheckOk: true, cacheJson: held, cachedAt: "2000-01-01T00:00:00.000Z" });
    expect(await refreshFeeds(now)).toEqual([{ slug: "christian-abc123", outcome: "busy" }]);
    expect(state.feed.refreshAfter).toBe(new Date(now.getTime() + BACKOFF_MS).toISOString());
    expect(state.feed.cacheJson).toBe(held);
    expect(await refreshFeeds(new Date(now.getTime() + 30_000))).toEqual([{ slug: "christian-abc123", outcome: "waiting" }]);
    expect(calls).toHaveLength(1);
    status = 500;
    state.feed = fresh({ keyEncrypted: seal(KEY), lastCheckOk: true, cacheJson: held, cachedAt: "2000-01-01T00:00:00.000Z" });
    expect(await refreshFeeds(now)).toEqual([{ slug: "christian-abc123", outcome: "failed" }]);
    expect(state.feed.cacheJson).toBe(held);
    expect(String(state.feed.lastCheckNote)).toMatch(/answered 500 .* last good board/);
    expect(JSON.stringify(sets)).not.toContain(KEY);
  });
});
