import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The leaderboard on the server (H-29): a visitor never makes HelixOS read eLoyalty, whatever the age of the held board; the
 * cron is the one reader, on a checked host only, and a 429 makes it wait a minute. The key never appears in anything served.
 * The database is a stand-in here: one feed row, read and updated in memory.
 */
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-1234";

type Row = Record<string, unknown>;
/** One feed row, its aliases, and (for the address tests) another board's slug and alias, all in memory. */
const state: { feed: Row; aliases: Row[]; otherSlug: string | null; otherAlias: string | null } = { feed: {}, aliases: [], otherSlug: null, otherAlias: null };
const sets: Row[] = [];
vi.mock("@/db", () => {
  const where = () => Promise.resolve();
  // The real drizzle `eq(column, value)` builds SQL we never run. With the mock schema's string "columns" the chunks are
  // StringChunk glue around two plain strings: the column's name, then the value asked for.
  const params = (cond: unknown): string[] => {
    const q = cond as { queryChunks?: unknown[] } | undefined;
    return (q?.queryChunks ?? []).filter((c): c is string => typeof c === "string");
  };
  const colOf = (cond: unknown): string => params(cond)[0] ?? "";
  const valueOf = (cond: unknown): string => params(cond)[1] ?? "";
  return {
    schema: {
      leaderboardFeeds: { id: "id", slug: "slug", keyEncrypted: "key_encrypted", membershipId: "membership_id", workspaceId: "workspace_id" },
      leaderboardSlugAliases: { id: "alias_id", feedId: "feed_id", slug: "alias_slug" },
    },
    db: {
      query: {
        leaderboardFeeds: {
          findFirst: async ({ where: w }: { where?: unknown } = {}) => {
            if (!w) return state.feed;
            const v = valueOf(w);
            const col = colOf(w);
            if (col === "slug") return v === state.feed.slug ? state.feed : v === state.otherSlug ? { id: "other", slug: v } : undefined;
            if (col === "id") return v === state.feed.id ? state.feed : undefined;
            return state.feed;
          },
          findMany: async () => [state.feed],
        },
        leaderboardSlugAliases: {
          findFirst: async ({ where: w }: { where?: unknown }) => {
            const v = valueOf(w);
            const mine = state.aliases.find((a) => (colOf(w) === "alias_id" ? a.id === v : a.slug === v));
            if (mine) return mine;
            return v === state.otherAlias ? { id: "oa", feedId: "other", slug: v } : undefined;
          },
          findMany: async () => state.aliases,
        },
      },
      update: () => ({
        set: (v: Row) => {
          sets.push(v);
          Object.assign(state.feed, v);
          return { where };
        },
      }),
      insert: () => ({
        values: async (v: Row) => {
          state.aliases.push(v);
        },
      }),
      delete: () => ({
        where: async (w: unknown) => {
          const v = valueOf(w);
          state.aliases = state.aliases.filter((a) => a.id !== v);
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

describe("the page address and its earlier addresses (H-109)", () => {
  beforeEach(() => {
    sets.length = 0;
    state.aliases = [];
    state.otherSlug = null;
    state.otherAlias = null;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a bad shape, a reserved word, another board's address or another board's old address are refused in words; nothing changes", async () => {
    const { setFeedSlug } = await import("@/lib/leaderboard");
    state.feed = fresh();
    state.otherSlug = "passport-diner";
    state.otherAlias = "turas-old";
    const feed = state.feed as unknown as import("@/db").schema.LeaderboardFeed;
    expect(await setFeedSlug(feed, "ab")).toMatch(/3 to 40/);
    expect(await setFeedSlug(feed, "coach")).toMatch(/reserved/);
    expect(await setFeedSlug(feed, "passport-diner")).toBe("That address is taken.");
    expect(await setFeedSlug(feed, "turas-old")).toBe("That address is taken.");
    expect(state.feed.slug).toBe("christian-abc123");
    expect(state.aliases).toEqual([]);
    expect(sets).toEqual([]);
  });

  it("a new address keeps the old one as an alias; the page resolves both and knows which is current; the feed answers on both; taking an own alias back swaps", async () => {
    const { setFeedSlug, resolveFeed, servedFeed, feedAliases } = await import("@/lib/leaderboard");
    state.feed = fresh({ exportJson: JSON.stringify([{ name: "Aisha P.", lifetime: 1105, available: 405 }]), exportAsOf: "9 Oct 2026", hidden: ["cus_004"] });
    const feed = () => state.feed as unknown as import("@/db").schema.LeaderboardFeed;
    expect(await setFeedSlug(feed(), " Compounding-Kindness ")).toBeNull();
    expect(state.feed.slug).toBe("compounding-kindness");
    expect(state.aliases.map((a) => a.slug)).toEqual(["christian-abc123"]);
    expect(await feedAliases("f1")).toEqual(["christian-abc123"]);
    expect((await resolveFeed("compounding-kindness"))?.current).toBe(true);
    const old = await resolveFeed("christian-abc123");
    expect(old?.current).toBe(false);
    expect(old?.feed.slug).toBe("compounding-kindness");
    expect(await resolveFeed("nobody-here")).toBeNull();
    const a = await servedFeed("christian-abc123");
    const b = await servedFeed("compounding-kindness");
    expect(a).toEqual(b);
    expect(a?.members.map((m) => m.name)).toEqual(["Aisha P."]);
    // The hide list and settings sit on the feed row, so they carry over unchanged.
    expect(state.feed.hidden).toEqual(["cus_004"]);
    // Another change: both earlier addresses are aliases now.
    expect(await setFeedSlug(feed(), "kindness-koin")).toBeNull();
    expect(state.aliases.map((a) => a.slug).sort()).toEqual(["christian-abc123", "compounding-kindness"]);
    expect((await resolveFeed("christian-abc123"))?.feed.slug).toBe("kindness-koin");
    // Taking back an own alias swaps the two.
    expect(await setFeedSlug(feed(), "compounding-kindness")).toBeNull();
    expect(state.feed.slug).toBe("compounding-kindness");
    expect(state.aliases.map((a) => a.slug).sort()).toEqual(["christian-abc123", "kindness-koin"]);
    // Setting the same address again is a no-op.
    expect(await setFeedSlug(feed(), "compounding-kindness")).toBeNull();
  });
});
