import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isToolName } from "@/lib/engine/mcp";
import { allTools } from "@/lib/mcp/registry";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("Body's MCP tools (rev 237 phase 4)", () => {
  it("nineteen tools, every one on the body scope, named without dots, twelve reads and seven draft-writes", async () => {
    await import("@/lib/mcp/tools/index");
    const mine = allTools().filter((t) => t.scope === "body");
    expect(mine.map((t) => t.name).sort()).toEqual(["body_correlation", "body_find_food", "body_foods", "body_habits", "body_log_food", "body_log_habit", "body_log_meal", "body_log_set", "body_log_sleep", "body_log_weigh_in", "body_pantry", "body_shopping_list", "body_sleep", "body_today", "body_training", "body_update_pantry", "body_week", "body_weigh_ins", "push_to_instacart_cart"]);
    for (const t of mine) {
      expect(t.scope, t.name).toBe("body");
      expect(isToolName(t.name)).toBe(true);
      expect(t.description.length, t.name).toBeGreaterThan(40);
    }
    expect(mine.filter((t) => t.kind === "write").map((t) => t.name).sort()).toEqual(["body_log_food", "body_log_habit", "body_log_meal", "body_log_set", "body_log_sleep", "body_log_weigh_in", "body_update_pantry", "push_to_instacart_cart"]);
  });
  it("wired into the server's index; every handler checks Body's switch first; nothing of a coach's comments, photos or injuries", () => {
    expect(read("src/lib/mcp/tools/index.ts")).toMatch(/import "\.\/body";/);
    const src = read("src/lib/mcp/tools/body.ts");
    const handlers = src.match(/handler: async \(v(?:, input)?\)(?:: Promise<ToolResult>)? => \{\n\s+(?:const settings = )?await ready\(v\);/g) ?? [];
    expect(handlers).toHaveLength(19);
    expect(src).toMatch(/if \(!\(await canAiUseBody\(v, v\.user\.id\)\)\) throw new Error\("HumanOS's AI switch is off/);
    // The code, comments aside (the header says what it leaves out): no comment table, no photo, no injury reaches a tool.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/bodyComments|comments|photo|injur|health_log|bodyHealth|healthLog|restrictedNow/i);
    expect(src).not.toMatch(/console\./);
    // The Body registry test lists this module among the ones that may touch a Body table.
    expect(read("src/lib/engine/__tests__/body.test.ts")).toMatch(/"src\/lib\/mcp\/tools\/body\.ts"/);
  });
});
