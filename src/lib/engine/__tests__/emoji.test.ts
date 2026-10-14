import { describe, expect, it } from "vitest";
import { ALL_EMOJI, EMOJI_GROUPS, emojiName, isOneEmoji, searchEmoji } from "@/lib/engine/emoji";

describe("the emoji picker (H-94)", () => {
  it("has about sixty emojis in five groups, each named once", () => {
    expect(EMOJI_GROUPS.map((g) => g.name)).toEqual(["People", "Symbols", "Nature", "Objects", "Animals"]);
    expect(ALL_EMOJI.length).toBe(60);
    expect(new Set(ALL_EMOJI.map((i) => i.e)).size).toBe(60);
    for (const i of ALL_EMOJI) expect(isOneEmoji(i.e), i.name).toBe(true);
    expect(emojiName("🔱")).toBe("trident");
    expect(emojiName("🫠")).toBe("your own");
  });
  it("Other… takes exactly one emoji", () => {
    expect(isOneEmoji("🫠")).toBe(true);
    expect(isOneEmoji("👩‍💻")).toBe(true);
    expect(isOneEmoji("🔥🔥")).toBe(false);
    expect(isOneEmoji("a")).toBe(false);
    expect(isOneEmoji("fire")).toBe(false);
    expect(isOneEmoji("")).toBe(false);
    expect(isOneEmoji(" ⚡ ")).toBe(true);
  });
  it("search matches names by word", () => {
    expect(searchEmoji("trident").map((i) => i.e)).toEqual(["🔱"]);
    expect(searchEmoji("fire").map((i) => i.e)).toEqual(["🔥"]);
    expect(searchEmoji("face").length).toBe(5);
    expect(searchEmoji("").length).toBe(60);
    expect(searchEmoji("zzz")).toEqual([]);
  });
});
