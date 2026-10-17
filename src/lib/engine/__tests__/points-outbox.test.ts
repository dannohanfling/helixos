import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, afterEventsRead, afterSend, checkVerdict, customerForRef, deskAccess, memberRef, deskRefusal, eventsHaveTag, patchRows, readAnswer, readBalance, tagFor, taggedReason } from "../points-outbox";

/** The points outbox (H-404, H-493): deltas only, one move per source, a lost answer settled from the events, the desk for two people. */
const now = new Date("2026-10-17T16:00:00.000Z");

describe("a move's tag and reason", () => {
  it("tags each move so its event can be found, and keeps the reason to one short line", () => {
    expect(tagFor("0b9c-41f2-aa77-123456")).toBe("HX-0b9c41f2aa");
    const r = taggedReason("  Redeemed:\n 1-on-1   with the founder ", "HX-0b9c41f2aa");
    expect(r).toBe("Redeemed: 1-on-1 with the founder [HX-0b9c41f2aa]");
    expect(taggedReason("x".repeat(300), "HX-1")).toHaveLength(100 + " [HX-1]".length);
  });
});

describe("eLoyalty's answer", () => {
  it("reads a yes with its event id and new balance, at the top or under data", () => {
    expect(readAnswer(200, { success: true, eventId: "ev_1", newBalance: 475 })).toEqual({ kind: "sent", eventId: "ev_1", newBalance: 475 });
    expect(readAnswer(201, { data: { event_id: "ev_2", new_balance: "20" } })).toEqual({ kind: "sent", eventId: "ev_2", newBalance: 20 });
  });
  it("a 2xx that says no is a refusal; a 4xx is refused in plain words; nothing eLoyalty wrote back is repeated", () => {
    expect(readAnswer(200, { success: false, error: "Insufficient points for maria@example.com" })).toEqual({ kind: "refused", note: "eLoyalty said no to it" });
    const r = readAnswer(422, { message: "key sk_live_abcd rejected" });
    expect(r).toEqual({ kind: "refused", note: "eLoyalty refused it (422)" });
    expect(readAnswer(401, {})).toMatchObject({ kind: "refused", note: "eLoyalty refused the key (401)" });
    expect(readAnswer(404, {})).toMatchObject({ kind: "refused", note: "eLoyalty does not know that customer (404)" });
  });
  it("a 429 waits a minute; no answer or a 5xx is unknown", () => {
    expect(readAnswer(429, null)).toEqual({ kind: "wait", ms: 60_000 });
    expect(readAnswer(0, null)).toMatchObject({ kind: "unknown" });
    expect(readAnswer(502, null)).toMatchObject({ kind: "unknown" });
  });
});

describe("after a send", () => {
  it("a yes is sent, with eLoyalty's own numbers kept", () => {
    expect(afterSend({ attempts: 0 }, 200, { kind: "sent", eventId: "ev_1", newBalance: 475 }, now)).toMatchObject({ status: "sent", attempts: 1, eventId: "ev_1", newBalance: 475, sentAt: now.toISOString() });
  });
  it("a refusal is failed at once and never tried again", () => {
    expect(afterSend({ attempts: 0 }, 422, { kind: "refused", note: "eLoyalty refused it (422)" }, now)).toMatchObject({ status: "failed", checkFirst: false });
  });
  it("a 429 waits a minute without using up a try", () => {
    expect(afterSend({ attempts: 2 }, 429, { kind: "wait", ms: 60_000 }, now)).toMatchObject({ status: "pending", attempts: 2, nextTryAt: "2026-10-17T16:01:00.000Z", checkFirst: false });
  });
  it("an unknown outcome waits longer each time, reads the events before any resend, and stops after the last try", () => {
    const first = afterSend({ attempts: 0 }, 0, { kind: "unknown", note: "no answer from eLoyalty" }, now);
    expect(first).toMatchObject({ status: "pending", checkFirst: true, attempts: 1, nextTryAt: "2026-10-17T16:01:00.000Z" });
    expect(afterSend({ attempts: 2 }, 503, { kind: "unknown", note: "eLoyalty answered 503" }, now).nextTryAt).toBe("2026-10-17T16:04:00.000Z");
    const last = afterSend({ attempts: MAX_ATTEMPTS - 1 }, 503, { kind: "unknown", note: "eLoyalty answered 503" }, now);
    expect(last.status).toBe("failed");
    expect(last.lastNote).toMatch(/read the member's events/);
  });
  it("the events settle a lost answer: the tag found means it landed, so it is never sent twice", () => {
    const events = { data: [{ type: "points_deducted", points: 25, reason: "Redeemed [HX-0b9c41f2aa]" }, { type: "points_added", reason: "other" }] };
    expect(eventsHaveTag(events, "HX-0b9c41f2aa")).toBe(true);
    expect(eventsHaveTag(events, "HX-ffffffffff")).toBe(false);
    expect(eventsHaveTag(null, "HX-1")).toBe(false);
    expect(afterEventsRead(true, now)).toMatchObject({ status: "sent", checkFirst: false });
    expect(afterEventsRead(false, now)).toMatchObject({ status: "pending", checkFirst: false });
  });
});

describe("the Points desk", () => {
  it("is for the coach working here and the team members named for it; nobody else", () => {
    expect(deskAccess({ switchedMode: "work", teamUserId: null }, [])).toEqual({ ok: true, as: "coach" });
    expect(deskAccess({ switchedMode: "view", teamUserId: null }, [])).toMatchObject({ ok: false, why: "Switch to Work to move points." });
    expect(deskAccess({ switchedMode: null, teamUserId: "u_cm" }, ["u_cm"])).toEqual({ ok: true, as: "team" });
    expect(deskAccess({ switchedMode: null, teamUserId: "u_other" }, ["u_cm"]).ok).toBe(false);
    // The owner (no switch, not on a team) is kept out too: the desk is for two people only (H-429).
    expect(deskAccess({ switchedMode: null, teamUserId: null }, ["u_cm"]).ok).toBe(false);
  });
  it("refuses in words before anything is queued; a deduct never goes below 0 and needs a live balance", () => {
    const ok = { direction: "deduct", amount: 25, reason: "Redeemed the vault", available: 500 };
    expect(deskRefusal(ok)).toBeNull();
    expect(deskRefusal({ ...ok, direction: "set" })).toBe("Choose add or deduct.");
    expect(deskRefusal({ ...ok, amount: 0 })).toMatch(/whole number from 1/);
    expect(deskRefusal({ ...ok, amount: 2.5 })).toMatch(/whole number from 1/);
    expect(deskRefusal({ ...ok, amount: 100_001 })).toMatch(/at most 100,000/);
    expect(deskRefusal({ ...ok, reason: " " })).toMatch(/Say why/);
    expect(deskRefusal({ ...ok, amount: 501 })).toBe("Only 500 are available, so nothing was deducted. A deduct never goes below 0.");
    expect(deskRefusal({ ...ok, available: null })).toMatch(/could not be read/);
    expect(deskRefusal({ ...ok, direction: "add", available: null, amount: 900 })).toBeNull();
  });
  it("picks a member by a reference that carries no id and finds the same member however the list changes", () => {
    const ref = memberRef("feed_1", "cus_002");
    expect(ref).toMatch(/^m[0-9a-f]{16}$/);
    expect(ref).not.toContain("cus");
    expect(memberRef("feed_1", "cus_002")).toBe(ref);
    expect(memberRef("feed_2", "cus_002")).not.toBe(ref);
    expect(customerForRef("feed_1", ref, ["cus_001", "cus_002", "cus_003"])).toBe("cus_002");
    expect(customerForRef("feed_1", ref, ["cus_003", "cus_002"])).toBe("cus_002");
    expect(customerForRef("feed_1", ref, ["cus_001"])).toBeNull();
    const ids = Array.from({ length: 500 }, (_, i) => `11111111-aaaa-4bbb-8ccc-${String(i).padStart(12, "0")}`);
    expect(new Set(ids.map((id) => memberRef("feed_1", id))).size).toBe(500);
  });
  it("the held board takes the new balance at once; an add raises lifetime, a deduct never lowers it", () => {
    const rows = [
      { id: "a", name: "Maria S.", lifetime: 900, available: 700 },
      { id: "b", name: "Ben O.", lifetime: 650, available: 650 },
    ];
    expect(patchRows(rows, "a", -25, 675)).toEqual([{ ...rows[0], available: 675 }, rows[1]]);
    expect(patchRows(rows, "b", 50, null)).toEqual([rows[0], { ...rows[1], available: 700, lifetime: 700 }]);
  });
});

describe("the add-and-deduct check", () => {
  const sent = (n: number) => ({ status: "sent", newBalance: n });
  it("passes when 1 came off available with lifetime left alone, and the add put it back", () => {
    const v = checkVerdict({ balance: 40, earned: 120 }, sent(39), { balance: 39, earned: 120 }, sent(40), { balance: 40, earned: 121 });
    expect(v.ok).toBe(true);
    expect(v.note).toBe("Passed: deduct 1: available 40 → 39, lifetime unchanged; add 1 back: available 40, lifetime 121 (an add counts as earned).");
  });
  it("does not pass when the deduct lowered lifetime, or took the wrong amount, or did not land", () => {
    expect(checkVerdict({ balance: 40, earned: 120 }, sent(39), { balance: 39, earned: 119 }, sent(40), { balance: 40, earned: 120 }).ok).toBe(false);
    expect(checkVerdict({ balance: 40, earned: 120 }, sent(40), { balance: 40, earned: 120 }, sent(41), { balance: 41, earned: 121 }).ok).toBe(false);
    expect(checkVerdict({ balance: 40, earned: 120 }, { status: "failed", newBalance: null }, null, { status: "not tried", newBalance: null }, null)).toEqual({ ok: false, note: "The deduct did not land (failed). Nothing else was tried." });
    expect(checkVerdict({ balance: 40, earned: 120 }, sent(39), { balance: 39, earned: 120 }, { status: "failed", newBalance: null }, null).note).toMatch(/1 is still owed to the test pass/);
  });
  it("reads a customer's balance and lifetime from the customer read", () => {
    expect(readBalance({ data: { id: "c", points_balance: 40, points_earned: 120 } })).toEqual({ balance: 40, earned: 120 });
    expect(readBalance({ points_balance: "7", points_earned: "9" })).toEqual({ balance: 7, earned: 9 });
    expect(readBalance({ data: {} })).toBeNull();
  });
});
