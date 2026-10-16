import { describe, expect, it } from "vitest";
import { CHAIR_CLIP_NAMES, CHAIR_KEYS, CLIP_FILE, clipFor } from "@/lib/engine/board-view";

const files = ["council-night-danno.mp4", "council-night-danno.webm", "council-night-alex.mp4", "council-night-riley.mp4", "council-night-riley.webm", "council-day.jpg", "danno-seat.svg"];

describe("the Council Chamber's speaking clips (H-150)", () => {
  it("maps the five chairs to the statues in the default order", () => {
    expect(CHAIR_KEYS.map((c) => CHAIR_CLIP_NAMES[c])).toEqual(["danno", "alex", "jordan", "riley", "morgan"]);
  });
  it("finds a chair's clip for a look only among the files present: WebM beside the MP4 when there is one, null without an MP4", () => {
    expect(clipFor(files, "night", "head")).toEqual({ name: "danno", mp4: "/board/council-night-danno.mp4?v=1", webm: "/board/council-night-danno.webm?v=1" });
    expect(clipFor(files, "night", "left")).toEqual({ name: "alex", mp4: "/board/council-night-alex.mp4?v=1", webm: null });
    // H-304: a remade clip keeps its name and bumps its version, so the old file is never served from a browser's cache.
    expect(clipFor([...files, "council-night-riley.mp4", "council-night-riley.webm"], "night", "front-left")).toEqual({ name: "riley", mp4: "/board/council-night-riley.mp4?v=2", webm: "/board/council-night-riley.webm?v=2" });
    expect(clipFor(files, "night", "right")).toBeNull();
    expect(clipFor(files, "day", "head")).toBeNull();
    expect(clipFor(files, "night", null)).toBeNull();
    expect(clipFor([], "night", "head")).toBeNull();
  });
  it("recognises a clip file by name and nothing else in the folder", () => {
    expect(files.filter((f) => CLIP_FILE.test(f))).toEqual(["council-night-danno.mp4", "council-night-danno.webm", "council-night-alex.mp4", "council-night-riley.mp4", "council-night-riley.webm"]);
    expect(CLIP_FILE.test("council-night.jpg")).toBe(false);
  });
});
