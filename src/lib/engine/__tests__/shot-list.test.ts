import { describe, expect, it } from "vitest";
import { shotCountLine, shotGroupOf, shotList } from "../shot-list";

const slot = (key: string, kind: Parameters<typeof shotGroupOf>[0], what = `A ${kind}.`) => ({ key, kind, what });

describe("§6.3: pictures to gather", () => {
  it("groups the slots by the kind of picture, names the slide each serves, and counts the logo as one more line", () => {
    const list = shotList(
      [
        { slide: 1, section: "cover", slot: slot("cover:photo", "photo"), image: null, dropped: false },
        { slide: 4, section: "Keys", slot: slot("k1", "screenshot_callout"), image: { url: "x" }, dropped: false },
        { slide: 7, section: "Keys", slot: slot("k2", "diagram"), image: null, dropped: false },
        { slide: 9, section: "Stories", slot: slot("s1", "testimonial"), image: null, dropped: false },
      ],
      false,
    );
    expect(list.groups.map((g) => g.label)).toEqual(["Photos of you", "Screenshots of results", "Proof", "Diagrams"]);
    expect(list.items.map((i) => i.state)).toEqual(["missing", "gathered", "missing", "missing"]);
    expect(list.items[3].testimonial).toBe(true);
    expect(list.total).toBe(5);
    expect(list.gathered).toBe(1);
    expect(shotCountLine(list)).toBe("1 of 5 gathered");
    expect(list.done).toBe(false);
  });

  it("a dropped slot leaves the count; a logo counts as gathered; done when nothing is missing", () => {
    const list = shotList(
      [
        { slide: 1, section: "cover", slot: slot("cover:photo", "photo"), image: { url: "x" }, dropped: false },
        { slide: 4, section: "Keys", slot: slot("k1", "screenshot"), image: null, dropped: true },
      ],
      true,
    );
    expect(list.dropped).toBe(1);
    expect(list.total).toBe(2);
    expect(list.gathered).toBe(2);
    expect(list.done).toBe(true);
    expect(list.items[1].state).toBe("dropped");
  });

  it("maps every slot kind to its group", () => {
    expect(shotGroupOf("photo")).toBe("photos");
    expect(shotGroupOf("photo_pair")).toBe("photos");
    expect(shotGroupOf("screenshot")).toBe("screenshots");
    expect(shotGroupOf("screenshot_callout")).toBe("screenshots");
    expect(shotGroupOf("proof_wall")).toBe("proof");
    expect(shotGroupOf("testimonial")).toBe("proof");
    expect(shotGroupOf("diagram")).toBe("diagrams");
  });
});
