import { describe, expect, it } from "vitest";
import { LOCATION_SHAPE, isLocationId } from "../ghl-location";

describe("a Location ID's shape (H-240)", () => {
  it("is letters and digits, about 20 of them; an email address or a name is not one", () => {
    expect(isLocationId("ve9EPM428h8vShlRW1KT")).toBe(true);
    expect(isLocationId(" ve9EPM428h8vShlRW1KT ")).toBe(true);
    expect(isLocationId("someone@example.com")).toBe(false);
    expect(isLocationId("Maya Coaching")).toBe(false);
    expect(isLocationId("loc_maya")).toBe(true);
    expect(isLocationId("")).toBe(false);
    expect(isLocationId("abc")).toBe(false);
    expect(isLocationId("https://app.gohighlevel.com/location/ve9EPM428h8vShlRW1KT")).toBe(false);
    expect(LOCATION_SHAPE).toContain("Settings → Business Profile → Location ID");
  });
});
