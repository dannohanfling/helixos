import { describe, expect, it } from "vitest";
import { MONEY_HINT, moneyLabel, readMoney } from "../money";

describe("money the way people write it (rev 444)", () => {
  it("reads every way of writing three and a half thousand as 3500", () => {
    for (const t of ["3.5k", "3.5K", "$3,500", "3500 USD", "3,500.00", "3500", " $3.5k "]) expect(readMoney(t), t).toEqual({ value: 3500 });
    expect(readMoney("1.2m")).toEqual({ value: 1_200_000 });
    expect(readMoney("$7,500.50")).toEqual({ value: 7500.5 });
  });
  it("blank is not entered, never 0; anything unreadable is the one plain line, never 0", () => {
    expect(readMoney("")).toEqual({ value: null });
    expect(readMoney("   ")).toEqual({ value: null });
    for (const t of ["abc", "about 3k", "70 kg", "-500", "1.234"]) expect(readMoney(t), t).toEqual({ error: MONEY_HINT });
  });
  it("shows what it understood", () => {
    expect(moneyLabel(3500)).toBe("$3,500");
    expect(moneyLabel(7500.5)).toBe("$7,500.50");
    expect(moneyLabel(1_200_000)).toBe("$1,200,000");
  });
});
