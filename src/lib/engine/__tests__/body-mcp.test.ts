import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isToolName } from "@/lib/engine/mcp";
import { allTools } from "@/lib/mcp/registry";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("Body's MCP tools (rev 237 phase 4)", () => {
  it("eight tools, every one on the body scope, named without dots, four reads and four draft-writes", async () => {
    await import("@/lib/mcp/tools/index");
    const mine = allTools().filter((t) => t.name.startsWith("body_"));
    expect(mine.map((t) => t.name).sort()).toEqual(["body_foods", "body_log_food", "body_log_meal", "body_log_set", "body_log_weigh_in", "body_today", "body_training", "body_weigh_ins"]);
    for (const t of mine) {
      expect(t.scope, t.name).toBe("body");
      expect(isToolName(t.name)).toBe(true);
      expect(t.description.length, t.name).toBeGreaterThan(40);
    }
    expect(mine.filter((t) => t.kind === "write").map((t) => t.name).sort()).toEqual(["body_log_food", "body_log_meal", "body_log_set", "body_log_weigh_in"]);
  });
  it("wired into the server's index; every handler checks Body's switch first; nothing of a coach's comments, photos or injuries", () => {
    expect(read("src/lib/mcp/tools/index.ts")).toMatch(/import "\.\/body";/);
    const src = read("src/lib/mcp/tools/body.ts");
    const handlers = src.match(/handler: async \(v(?:, input)?\)(?:: Promise<ToolResult>)? => \{\n\s+(?:const settings = )?await ready\(v\);/g) ?? [];
    expect(handlers).toHaveLength(8);
    expect(src).toMatch(/if \(!\(await canAiUseBody\(v, v\.user\.id\)\)\) throw new Error\("Body's AI switch is off/);
    // The code, comments aside (the header says what it leaves out): no comment table, no photo, no injury reaches a tool.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/bodyComments|comments|photo|injur|health_log/i);
    expect(src).not.toMatch(/console\./);
    // The Body registry test lists this module among the ones that may touch a Body table.
    expect(read("src/lib/engine/__tests__/body.test.ts")).toMatch(/"src\/lib\/mcp\/tools\/body\.ts"/);
  });
});
