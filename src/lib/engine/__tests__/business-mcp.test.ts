import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Task } from "@/db/schema";
import { isToolName } from "@/lib/engine/mcp";
import { allTools } from "@/lib/mcp/registry";
import { ENERGY_WORDS, energyFrom, energyWord } from "@/lib/daily-core";
import { byTitle } from "@/lib/tasks-core";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** One function's body, from its signature to the next top-level export. */
const fn = (src: string, name: string) => {
  const at = src.indexOf(`export async function ${name}(`);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next < 0 ? undefined : next);
};

describe("the connector's business tools, steps 1 to 3 (rev 380, Danno's order at rev 418)", () => {
  it("eight tools on the tasks and today scopes, named without dots, three reads and five writes", async () => {
    await import("@/lib/mcp/tools/index");
    const mine = allTools().filter((t) => t.scope === "tasks" || t.scope === "today");
    expect(mine.map((t) => t.name).sort()).toEqual(["tasks_add", "tasks_complete", "tasks_list", "tasks_reschedule", "tasks_uncomplete", "today_close", "today_lock_in", "today_lockin"]);
    for (const t of mine) {
      expect(isToolName(t.name), t.name).toBe(true);
      expect(t.description.length, t.name).toBeGreaterThan(60);
      expect(t.scope, t.name).toBe(t.name.startsWith("tasks_") ? "tasks" : "today");
    }
    expect(mine.filter((t) => t.kind === "read").map((t) => t.name).sort()).toEqual(["tasks_list", "today_lockin"]);
    const index = read("src/lib/mcp/tools/index.ts");
    expect(index).toMatch(/import "\.\/tasks";/);
    expect(index).toMatch(/import "\.\/today";/);
  });

  it("one copy of the rules: the page's actions and the tools call the same cores, and neither writes tasks or the day's log itself", () => {
    const tasks = read("src/lib/actions/tasks.ts");
    expect(fn(tasks, "createTaskAction")).toMatch(/await addTask\(v, /);
    expect(fn(tasks, "toggleTaskAction")).toMatch(/await toggleTask\(v, task\)/);
    expect(fn(tasks, "rescheduleTaskAction")).toMatch(/await rescheduleTask\(v, /);
    for (const n of ["createTaskAction", "toggleTaskAction", "rescheduleTaskAction"]) expect(fn(tasks, n), n).not.toMatch(/schema\.tasks|award\(/);
    const daily = read("src/lib/actions/daily.ts");
    expect(fn(daily, "morningCheckinAction")).toMatch(/await lockIn\(v, /);
    expect(fn(daily, "eveningCloseAction")).toMatch(/await closeDay\(v, input\)/);
    for (const n of ["morningCheckinAction", "eveningCloseAction"]) {
      expect(fn(daily, n), n).toMatch(/whileSwitched: "refuse"/);
      expect(fn(daily, n), n).not.toMatch(/schema\.(tasks|dailyLogs)|award\(/);
    }
    const tools = read("src/lib/mcp/tools/tasks.ts") + read("src/lib/mcp/tools/today.ts");
    expect(tools).not.toMatch(/from "@\/db"|schema\.\w+\)|\.insert\(|\.update\(|\.delete\(/);
  });

  it("the energy words: five, from a word in any case or a number 1 to 5, and back", () => {
    expect([...ENERGY_WORDS]).toEqual(["Dragging", "Slow", "Steady", "Bright", "On fire"]);
    expect(energyFrom("on fire")).toBe(5);
    expect(energyFrom("Steady")).toBe(3);
    expect(energyFrom(2)).toBe(2);
    expect(energyFrom("4")).toBe(4);
    expect(energyFrom("great")).toBeNull();
    expect(energyFrom(6)).toBeNull();
    expect(energyWord(1)).toBe("Dragging");
    expect(energyWord(null)).toBeNull();
  });

  it("a task by its title: exact first, then the one that contains the words, else the titles to pick from", () => {
    const t = (title: string) => ({ id: title, title }) as Task;
    const tasks = [t("Call Jess about the offer"), t("Post the comment ladder"), t("Post the replay"), t("Call")];
    expect(byTitle(tasks, "call").title).toBe("Call");
    expect(byTitle(tasks, "ladder").title).toBe("Post the comment ladder");
    expect(() => byTitle(tasks, "post the")).toThrow(/2 match it.*Post the comment ladder, Post the replay/);
    expect(() => byTitle(tasks, "nothing like it")).toThrow(/Pick from: Call Jess about the offer/);
    expect(() => byTitle([], "anything")).toThrow(/no open task to pick from/);
  });
});
