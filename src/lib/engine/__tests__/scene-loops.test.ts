import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENE_LOOPS, loopFor } from "@/lib/engine/scene-loops";

describe("the filmed scene loops (H-1180, H-1253)", () => {
  it("lists the Aqueduct's water and the Forum's and Colosseum's golden hour, each with a version in its addresses", () => {
    expect(Object.keys(SCENE_LOOPS).sort()).toEqual(["/aqueduct/aqueduct-day-none", "/colosseum/colosseum-day", "/forum/forum-day"]);
    expect(loopFor("/forum/forum-day")).toEqual({ mp4: "/forum/forum-day-loop.mp4?v=1", webm: "/forum/forum-day-loop.webm?v=1", poster: "/forum/forum-day-loop-poster.jpg?v=1" });
    expect(loopFor("/colosseum/colosseum-day")?.mp4).toBe("/colosseum/colosseum-day-loop.mp4?v=1");
    expect(loopFor("/forum/forum-night")).toBeNull();
    expect(loopFor("/colosseum/colosseum-night")).toBeNull();
  });
  it("every listed loop has its three files in public/, and the config caches them as immutable", () => {
    for (const p of Object.keys(SCENE_LOOPS)) for (const end of ["-loop.mp4", "-loop.webm", "-loop-poster.jpg"]) expect(readFileSync(`public${p}${end}`).length, `${p}${end}`).toBeGreaterThan(1000);
    const cfg = readFileSync("next.config.ts", "utf8");
    for (const dir of ["aqueduct", "forum", "colosseum"]) expect(cfg).toMatch(new RegExp(`source: "/${dir}/:file\\(\\.\\*-loop\\.\\*\\)"`));
  });
});
