import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * delete-bot-field and delete-bot-field-by-name remove the field itself, not its value (read off the spec, 23 Sep): on ai_faq_cbf
 * they would destroy the field and the chip in the agent's prompt. HelixOS never calls either. The client refuses them before
 * anything leaves, and no code path can reach Community Loyalty except through the client's one fetch.
 */
const SRC = join(process.cwd(), "src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? (f === "__tests__" ? [] : files(join(dir, f))) : /\.(ts|tsx)$/.test(f) ? [join(dir, f)] : []));

describe("HelixOS never deletes a bot field", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the client refuses both delete calls, and any DELETE, before a request leaves", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { NEVER_CALLED, withTimeout } = await import("@/lib/community-loyalty");
    expect([...NEVER_CALLED]).toEqual(["/flow/delete-bot-field", "/flow/delete-bot-field-by-name"]);
    const base = "https://www.uchat.com.au/api";
    for (const path of NEVER_CALLED) for (const method of ["DELETE", "POST", "PUT", "GET"]) await expect(withTimeout(`${base}${path}`, { method, body: method === "GET" ? undefined : JSON.stringify({ name: "ai_faq_cbf" }) })).rejects.toThrow(/never called/);
    await expect(withTimeout(`${base}/flow/delete-bot-field-by-name/`, { method: "DELETE" })).rejects.toThrow(/never called/);
    await expect(withTimeout(`${base}/flow/bot-fields`, { method: "DELETE" })).rejects.toThrow(/never deletes/);
    expect(fetch).not.toHaveBeenCalled();
    // The calls HelixOS does make still go.
    await withTimeout(`${base}/flow/bot-fields?limit=100&page=1`, { method: "GET" });
    expect(fetch).toHaveBeenCalledTimes(1);
    // The first import of the client loads the database module cold; under the full suite that once ran past the 5s default.
  }, 30000);

  it("no code path reaches Community Loyalty except through that one guarded fetch", () => {
    const client = readFileSync(join(SRC, "lib/community-loyalty.ts"), "utf8");
    // One fetch in the client, inside withTimeout, after the guard.
    expect(client.match(/\bfetch\(/g)).toHaveLength(1);
    const body = client.slice(client.indexOf("export async function withTimeout"));
    expect(body.indexOf("assertCallable(input, init.method)")).toBeGreaterThan(-1);
    expect(body.indexOf("assertCallable(input, init.method)")).toBeLessThan(body.indexOf("fetch("));
    // Nothing else in the app builds a Community Loyalty address or names the delete calls.
    const all = files(SRC);
    expect(all.length).toBeGreaterThan(100);
    const others = all.filter((f) => !f.endsWith("community-loyalty.ts"));
    expect(others.filter((f) => /uchatBase\(|uchat\.com\.au/.test(readFileSync(f, "utf8")))).toEqual([]);
    // Anywhere in the app, the delete calls are named only in comments and in the list itself: never in a request.
    const naming = all.flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => l.includes("delete-bot-field")).map((l) => ({ f: f.slice(SRC.length), l: l.trim() })));
    expect(naming.length).toBeGreaterThan(0);
    expect(naming.filter(({ l }) => !/^(\*|\/\/)/.test(l))).toEqual([{ f: "/lib/community-loyalty.ts", l: 'export const NEVER_CALLED = ["/flow/delete-bot-field", "/flow/delete-bot-field-by-name"] as const;' }]);
  });
});

describe("every send shows that it is working", () => {
  it("no plain submit button is left: each is the shared pending button, except the two filters that only change the address", () => {
    const tsx = files(SRC).filter((f) => f.endsWith(".tsx") && !f.endsWith("components/submit-button.tsx"));
    const plain = tsx.flatMap((f) => (readFileSync(f, "utf8").match(/<button\b[^>]*type="submit"/g) ?? []).map((b) => `${f.slice(SRC.length)}: ${b.slice(0, 60)}`));
    expect(plain.map((p) => p.split(":")[0]).sort()).toEqual(["/app/(app)/library/page.tsx", "/app/(app)/socrates/questions/page.tsx"]);
    for (const f of ["app/(app)/library/page.tsx", "app/(app)/socrates/questions/page.tsx"]) expect(readFileSync(join(SRC, f), "utf8")).toMatch(/<form[^>]*method="get"/);
    const pending = tsx.reduce((n, f) => n + (readFileSync(f, "utf8").match(/<SubmitButton\b/g) ?? []).length, 0);
    expect(pending).toBeGreaterThan(150);
  });
});
