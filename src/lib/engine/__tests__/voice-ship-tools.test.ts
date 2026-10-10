import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isToolName } from "@/lib/engine/mcp";
import { allTools, toolsFor } from "@/lib/mcp/registry";
import "@/lib/mcp/tools";

/** Voice to Ship (rev 638): which scope lists which tool, publishing refused to a team member, one writer and one Ship. */
describe("Voice to Ship tools", () => {
  const names = (scopes: Parameters<typeof toolsFor>[0]) => toolsFor(scopes).map((t) => t.name);
  it("read, write and publish are three ticks", () => {
    expect(names(["content"])).toEqual(expect.arrayContaining(["ladders_list", "ladder_read", "images_find"]));
    expect(names(["content"])).not.toEqual(expect.arrayContaining(["ladder_create"]));
    expect(names(["content", "content:write"])).toEqual(expect.arrayContaining(["ladder_create", "ladder_update", "ladder_make_graphic"]));
    for (const n of ["ladder_ship_preview", "ladder_ship"]) {
      expect(names(["content", "content:write"])).not.toContain(n);
      expect(names(["content:publish"])).toContain(n);
    }
    for (const t of allTools()) expect(isToolName(t.name), t.name).toBe(true);
  });

  it("refuses a team member on publish before anything is read", async () => {
    const team = { team: { id: "tm" }, user: { id: "u" }, workspace: { id: "w" } } as never;
    for (const n of ["ladder_ship_preview", "ladder_ship"]) await expect(allTools().find((t) => t.name === n)!.handler(team, { ladder: "x", preview_token: "t", confirm: true })).rejects.toThrow(/team member can't publish/);
  });

  it("tells Claude to read back and hear yes first, and calls the one Ship", () => {
    const ship = allTools().find((t) => t.name === "ladder_ship")!;
    expect(ship.description).toMatch(/ONLY after: \(1\) calling ladder_ship_preview, \(2\) reading the preview back/);
    expect(ship.description).toMatch(/"Ship it" in their first request means go to the preview/);
    const src = readFileSync(join(process.cwd(), "src/lib/mcp/tools/ship.ts"), "utf8");
    expect(src).toMatch(/await shipLadder\(v, l, null, p\.channels\)/);
    // The page's Ship button calls the same function.
    expect(readFileSync(join(process.cwd(), "src/lib/actions/ladders.ts"), "utf8")).toMatch(/await shipLadder\(v, l, postAt\)/);
  });
});
