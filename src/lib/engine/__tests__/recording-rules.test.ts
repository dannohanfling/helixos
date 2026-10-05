import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, matchSeries, matchSlot, readRules, ruleMatch, rulesFromForm, slotTitle, timeLabel } from "../recording-rules";

describe("Danno's publishing rules (rev 491)", () => {
  it("matches a series on the title, ignoring case and punctuation, as whole words", () => {
    expect(matchSeries("Evolve Omega: Automation Accelerator", DEFAULT_RULES)?.audience).toBe("accelerator_academy");
    expect(matchSeries("OPEN OFFICE-HOURS (Friday)", DEFAULT_RULES)?.name).toBe("Open Office Hours");
    expect(matchSeries("Business Strategy", DEFAULT_RULES)?.audience).toBe("academy");
    expect(matchSeries("Evolve Omega Accelerator", DEFAULT_RULES)).toBeNull();
    expect(matchSeries("Community Buildings", DEFAULT_RULES)).toBeNull();
  });
  it("places a call by its start in Los Angeles, within fifteen minutes either side", () => {
    expect(matchSlot("2026-10-05T16:07:00Z", DEFAULT_RULES)?.name).toBe("Evolve Omega Accelerator"); // Mon 9:07 AM
    expect(matchSlot("2026-10-05T15:45:00Z", DEFAULT_RULES)?.name).toBe("Evolve Omega Accelerator"); // Mon 8:45 AM
    expect(matchSlot("2026-10-05T15:44:00Z", DEFAULT_RULES)).toBeNull(); // Mon 8:44 AM
    expect(matchSlot("2026-10-05T17:00:00Z", DEFAULT_RULES)?.name).toBe("Evolve Omega Academy"); // Mon 10 AM
    expect(matchSlot("2026-10-09T20:10:00Z", DEFAULT_RULES)?.audience).toBe("academy"); // Fri 1:10 PM
    expect(matchSlot("2026-10-09T01:05:00Z", DEFAULT_RULES)?.audience).toBe("accelerator_academy"); // Thu 6:05 PM
    expect(matchSlot("2026-12-07T17:00:00Z", DEFAULT_RULES)?.name).toBe("Evolve Omega Accelerator"); // Mon 9 AM in winter time
    expect(matchSlot(null, DEFAULT_RULES)).toBeNull();
  });
  it("the series wins over the slot; the slot gives the clear title", () => {
    expect(ruleMatch("Evolve Omega: Community Building", "2026-10-05T16:00:00Z", DEFAULT_RULES)).toMatchObject({ by: "series", audience: "academy", clearTitle: null });
    expect(ruleMatch("Impromptu Zoom Meeting", "2026-10-09T20:00:00Z", DEFAULT_RULES)).toMatchObject({ by: "slot", audience: "academy", clearTitle: "Evolve Omega Academy · Fri 1 PM" });
    expect(ruleMatch("Impromptu Zoom Meeting", "2026-10-07T23:00:00Z", DEFAULT_RULES)).toBeNull();
    expect(timeLabel("18:00")).toBe("6 PM");
    expect(timeLabel("10:30")).toBe("10:30 AM");
    expect(timeLabel("00:00")).toBe("12 AM");
    expect(slotTitle({ name: "Evolve Omega Accelerator", day: 4, time: "18:00", audience: "accelerator_academy" })).toBe("Evolve Omega Accelerator · Thu 6 PM");
  });
  it("reads what is stored safely, and takes the form's rows with each refusal naming its field", () => {
    expect(readRules(null)).toBe(DEFAULT_RULES);
    expect(readRules({ timezone: "Mars/Base", series: [{ name: "X Y Z", audience: "members" }, { name: "Live", audience: "academy" }], slots: [{ name: "A", day: 9, time: "09:00", audience: "academy" }] })).toEqual({ timezone: "America/Los_Angeles", series: [{ name: "Live", audience: "academy" }], slots: [] });
    const ok = rulesFromForm({ timezone: "America/Los_Angeles", series: [{ name: " Hot  Seat ", audience: "academy" }, { name: "", audience: "academy" }, { name: "Gone", audience: "academy", remove: true }], slots: [{ name: "Late show", day: "5", time: "9:30", audience: "accelerator_academy" }, { name: "Early", day: "1", time: "07:00", audience: "academy" }] });
    expect(ok).toEqual({ ok: true, rules: { timezone: "America/Los_Angeles", series: [{ name: "Hot Seat", audience: "academy" }], slots: [{ name: "Early", day: 1, time: "07:00", audience: "academy" }, { name: "Late show", day: 5, time: "09:30", audience: "accelerator_academy" }] } });
    expect(rulesFromForm({ timezone: "Nowhere/City", series: [], slots: [] })).toMatchObject({ ok: false, field: "timezone" });
    expect(rulesFromForm({ timezone: "UTC", series: [{ name: "ok", audience: "academy" }], slots: [] })).toMatchObject({ ok: false, field: "series_name_0" });
    expect(rulesFromForm({ timezone: "UTC", series: [{ name: "Same", audience: "academy" }, { name: "same!", audience: "academy" }], slots: [] })).toMatchObject({ ok: false, field: "series_name_1" });
    expect(rulesFromForm({ timezone: "UTC", series: [], slots: [{ name: "A", day: "2", time: "", audience: "academy" }] })).toMatchObject({ ok: false, field: "slot_time_0" });
    expect(rulesFromForm({ timezone: "UTC", series: [{ name: "Fine", audience: "members" }], slots: [] })).toMatchObject({ ok: false, field: "series_audience_0" });
  });
});
