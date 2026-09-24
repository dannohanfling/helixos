import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Listing a bot's fields is paged with no total to go on, so it must end: at a short page, when a page repeats the one before it
 * (a platform that ignored `page`), and at an overall time budget (24 Sep: Danno's "Your bot" sat on its loading line for over
 * 90 seconds). Never an unbounded wait on a page render.
 */
const full = (prefix: string) => ({ data: Array.from({ length: 100 }, (_, i) => ({ name: `${prefix}_${i}`, value: "v", var_type: "text", var_ns: `ns${i}` })) });
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("reading a bot's fields always ends", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops when a page repeats the one before it, name for name", async () => {
    const fetch = vi.fn(async () => reply(full("same")));
    vi.stubGlobal("fetch", fetch);
    const { listBotFields } = await import("@/lib/community-loyalty");
    const rows = await listBotFields("token-for-a-test");
    expect(rows).toHaveLength(100);
    expect(fetch).toHaveBeenCalledTimes(2);
  }, 30000);

  it("pages while pages come back full, and stops at a short one", async () => {
    const pages = [full("a"), full("b"), { data: [{ name: "last", value: "v", var_type: "text", var_ns: "n" }] }];
    const fetch = vi.fn(async () => reply(pages.shift()));
    vi.stubGlobal("fetch", fetch);
    const { listBotFields } = await import("@/lib/community-loyalty");
    expect(await listBotFields("token-for-a-test")).toHaveLength(201);
    expect(fetch).toHaveBeenCalledTimes(3);
  }, 30000);

  it("stops at the time budget and keeps what it read", async () => {
    const { listBotFields, FIELD_READ_BUDGET_MS } = await import("@/lib/community-loyalty");
    let n = 0;
    const fetch = vi.fn(async () => reply(full(`p${n++}`)));
    vi.stubGlobal("fetch", fetch);
    // Each page seems to take longer than the whole budget allows.
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => (clock += FIELD_READ_BUDGET_MS));
    expect(await listBotFields("token-for-a-test")).toHaveLength(100);
    expect(fetch).toHaveBeenCalledTimes(1);
  }, 30000);
});
