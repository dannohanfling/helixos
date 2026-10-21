import { describe, expect, it } from "vitest";
import { tabFor, tabOfAnchor, tabsFor } from "../settings-tabs";

describe("Settings in tabs (H-164 §16)", () => {
  it("gives a member six tabs in Danno's order and the coach a seventh", () => {
    expect(tabsFor("client").map((t) => t.label)).toEqual(["You", "Connections", "Your bot", "Brand and team", "Programs", "Data and privacy"]);
    expect(tabsFor("coach").at(-1)?.label).toBe("Coach");
  });
  it("opens You unless a tab this viewer has is asked for", () => {
    expect(tabFor(undefined, "client")).toBe("you");
    expect(tabFor("brand", "client")).toBe("brand");
    expect(tabFor("coach", "client")).toBe("you");
    expect(tabFor("coach", "coach")).toBe("coach");
    expect(tabFor("nonsense", "coach")).toBe("you");
  });
  it("sends an old anchor to its tab", () => {
    expect(tabOfAnchor("brand-kit")).toBe("brand");
    expect(tabOfAnchor("publishing")).toBe("connections");
    expect(tabOfAnchor("your-bot")).toBe("bot");
    expect(tabOfAnchor("account")).toBe("data");
    expect(tabOfAnchor("you")).toBeNull();
    expect(tabOfAnchor("not-a-card")).toBeNull();
  });
});
