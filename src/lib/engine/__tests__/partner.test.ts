import { describe, expect, it } from "vitest";
import { addMonths, buildStatement, derive, pick, pickOrNull, restaurantLine, RESTAURANT_STAGES, shareOf, statementTotal } from "../partner";

describe("the fixed lists", () => {
  it("keep a known value, whatever its case, and fall back otherwise", () => {
    expect(pick(RESTAURANT_STAGES, "Demo Booked", "talking")).toBe("demo booked");
    expect(pick(RESTAURANT_STAGES, "nonsense", "talking")).toBe("talking");
    expect(pickOrNull(RESTAURANT_STAGES, "")).toBeNull();
    expect(pickOrNull(RESTAURANT_STAGES, "live")).toBe("live");
  });
});

describe("the setup promise and the check-in", () => {
  const base = { handedToWalletpushAt: null, liveAt: null, resultsAsOf: null };
  it("is not handed until the hand-off", () => {
    expect(derive(base, "2026-11-20")).toMatchObject({ setupDue: null, setupDays: null, setupPromise: "not handed", checkinDue: null, checkinOverdue: false });
  });
  it("counts seven days from the hand-off: in window, the day 5 flag, overdue", () => {
    const handed = { ...base, handedToWalletpushAt: "2026-11-23T18:00:00.000Z" };
    expect(derive(handed, "2026-11-25")).toMatchObject({ setupDue: "2026-11-30", setupDays: 2, setupPromise: "in window" });
    expect(derive(handed, "2026-11-28")).toMatchObject({ setupPromise: "day 5 flag" });
    expect(derive(handed, "2026-11-30")).toMatchObject({ setupPromise: "day 5 flag" });
    expect(derive(handed, "2026-12-01")).toMatchObject({ setupDays: 8, setupPromise: "OVERDUE" });
  });
  it("is kept or late once live, and the 30-day check-in follows the live date", () => {
    expect(derive({ ...base, handedToWalletpushAt: "2026-11-23", liveAt: "2026-11-29" }, "2027-01-15")).toMatchObject({ setupPromise: "kept", setupDays: 6, checkinDue: "2026-12-29", checkinOverdue: true });
    expect(derive({ ...base, handedToWalletpushAt: "2026-11-23", liveAt: "2026-12-05", resultsAsOf: "2026-12-30" }, "2027-01-15")).toMatchObject({ setupPromise: "late", checkinOverdue: false });
    expect(derive({ ...base, handedToWalletpushAt: "2026-11-23", liveAt: "2026-11-29" }, "2026-12-20")).toMatchObject({ checkinOverdue: false });
  });
});

describe("the monthly statement (H-1356)", () => {
  const pay = (over: Partial<Parameters<typeof buildStatement>[1][number]>) => ({ id: "p1", restaurantId: "r1", plan: "monthly", amount: 100, tax: 0, feesDeducted: 3, promo: false, status: "paid", month: "2026-12", ...over });
  const rest = [{ id: "r1", setupApprovedAt: null }, { id: "r2", setupApprovedAt: "2027-01-10T00:00:00.000Z" }];
  it("pays 50% of a monthly payment in the month collected, tax off, fees only when the switch is on", () => {
    expect(buildStatement("2026-12", [pay({ tax: 8 })], rest, [], { feesOffFirst: false }).lines).toEqual([expect.objectContaining({ kind: "monthly", amount: 46, paymentId: "p1" })]);
    expect(buildStatement("2026-12", [pay({ tax: 8 })], rest, [], { feesOffFirst: true }).lines[0].amount).toBe(44.5);
    expect(buildStatement("2027-01", [pay({})], rest, [], { feesOffFirst: false }).lines).toEqual([]);
    expect(shareOf({ amount: 100, tax: 0, feesDeducted: 0 }, false)).toBe(50);
  });
  it("earns nothing on refunds, chargebacks, failures and promo months", () => {
    for (const status of ["refunded", "chargeback", "failed"]) expect(buildStatement("2026-12", [pay({ status })], rest, [], { feesOffFirst: false }).lines).toEqual([]);
    expect(buildStatement("2026-12", [pay({ promo: true })], rest, [], { feesOffFirst: false }).lines).toEqual([]);
  });
  it("puts the setup fee's share in the month the setup was approved, not the month it was paid", () => {
    const setup = pay({ id: "s1", restaurantId: "r2", plan: "setup fee", amount: 500, month: "2026-12" });
    expect(buildStatement("2026-12", [setup], rest, [], { feesOffFirst: false }).lines).toEqual([]);
    expect(buildStatement("2027-01", [setup], rest, [], { feesOffFirst: false }).lines).toEqual([expect.objectContaining({ kind: "setup", amount: 250 })]);
    const unapproved = pay({ id: "s2", restaurantId: "r1", plan: "setup fee", amount: 500 });
    expect(buildStatement("2026-12", [unapproved], rest, [], { feesOffFirst: false }).lines).toEqual([]);
  });
  it("spreads a yearly payment over twelve months from the month collected, the last installment taking the rounding", () => {
    const yearly = pay({ id: "y1", plan: "annual", amount: 1000, month: "2026-12" });
    const first = buildStatement("2026-12", [yearly], rest, [], { feesOffFirst: false }).lines;
    expect(first).toEqual([expect.objectContaining({ kind: "yearly_installment", installment: 1, amount: 41.67 })]);
    expect(buildStatement("2027-06", [yearly], rest, [], { feesOffFirst: false }).lines[0]).toMatchObject({ installment: 7 });
    const last = buildStatement("2027-11", [yearly], rest, [], { feesOffFirst: false }).lines[0];
    expect(last).toMatchObject({ installment: 12, amount: 41.63 });
    expect(buildStatement("2027-12", [yearly], rest, [], { feesOffFirst: false }).lines).toEqual([]);
    const months = Array.from({ length: 12 }, (_, i) => addMonths("2026-12", i));
    expect(statementTotal(months.flatMap((m) => buildStatement(m, [yearly], rest, [], { feesOffFirst: false }).lines))).toBe(500);
  });
  it("keeps lines Danno approved, drops the rest of the month's built lines, and leaves adjustments alone", () => {
    const existing = [
      { restaurantId: "r1", month: "2026-12", kind: "monthly", paymentId: "p1", installment: null, approvedByDannoAt: "2027-01-02" },
      { restaurantId: "r1", month: "2026-12", kind: "monthly", paymentId: "p9", installment: null, approvedByDannoAt: null },
      { restaurantId: "r1", month: "2026-12", kind: "adjustment", paymentId: null, installment: null, approvedByDannoAt: null },
    ];
    const r = buildStatement("2026-12", [pay({})], rest, existing, { feesOffFirst: false });
    expect(r.lines).toEqual([]);
    expect(r.keep).toHaveLength(1);
    expect(r.drop.map((d) => d.paymentId)).toEqual(["p9"]);
  });
  it("addMonths crosses the year", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", 11)).toBe("2026-12");
  });
  it("a restaurant's line never carries the owner's contact", () => {
    expect(restaurantLine({ business: "Luigi's", stage: "live", city: "Boise", plan: "monthly" })).toBe("Luigi's · live · Boise · monthly");
  });
});
