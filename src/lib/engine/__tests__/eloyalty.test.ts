import { describe, expect, it } from "vitest";
import { ELOYALTY_CALLS, address, onFailure, parseCreatedPass, pointsDelta } from "../eloyalty";

const id = { customerId: "8c6bb6dc-8898-42d8-9f52-0ac14f4942c5", serial: "wp-1757900000000-abc123", passTypeId: "pass.com.example" };

describe("eLoyalty addressing: two generations, two identifiers, one helper", () => {
  it("points move through v3 by customer id, and a serial alone cannot move them", () => {
    const a = address("pointsAdd", id, { points: 10, reason: "Closed the day" });
    expect(a).toEqual({ ok: true, generation: "v3", method: "POST", path: "/api/public/admin/points/add", body: { customerId: id.customerId, points: 10, reason: "Closed the day" } });
    expect(address("pointsDeduct", id, { points: 5, reason: "Correction" })).toMatchObject({ path: "/api/public/admin/points/deduct", body: { points: 5 } });
    expect(address("pointsAdd", { serial: id.serial, passTypeId: id.passTypeId }, { points: 10 })).toEqual({ ok: false, missing: "customerId" });
  });
  it("writing onto the pass goes through v1 by pass type id plus serial, and a customer id alone cannot", () => {
    expect(address("pushNotification", id, { value: "Call in 30" })).toEqual({ ok: true, generation: "v1", method: "PUT", path: `/api/external/v1/passes/pass.com.example/${id.serial}/values/Push_Notification`, body: { value: "Call in 30" } });
    expect(address("pushNotification", { customerId: id.customerId, passTypeId: id.passTypeId }, { value: "x" })).toEqual({ ok: false, missing: "serial" });
    expect(address("pushNotification", { customerId: id.customerId, serial: id.serial }, { value: "x" })).toEqual({ ok: false, missing: "passTypeId" });
  });
  it("never sets a balance: no call in the table ends in values/Points, and asking for that field is refused", () => {
    for (const spec of Object.values(ELOYALTY_CALLS)) expect(spec.note).not.toMatch(/values\/Points/);
    expect(() => address("passField", id, { field: "Points", value: "100" })).toThrow(/refused/);
  });
  it("a negative ledger amount is a deduct, not a skip", () => {
    expect(pointsDelta(-15)).toEqual({ call: "pointsDeduct", points: 15 });
    expect(pointsDelta(20)).toEqual({ call: "pointsAdd", points: 20 });
    expect(pointsDelta(0)).toBeNull();
  });
  it("a 404 on a v1 call means a stale serial; a v3 points call with an unknown outcome reads events before any retry; 429 waits", () => {
    expect(onFailure("pushNotification", 404)).toBe("refresh-serial-then-retry");
    expect(onFailure("pointsAdd", 404)).toBe("give-up");
    expect(onFailure("pointsAdd", null)).toBe("check-events-before-retry");
    expect(onFailure("pointsAdd", 503)).toBe("check-events-before-retry");
    expect(onFailure("pointsAdd", 429)).toBe("wait-60s-then-retry");
    expect(onFailure("pointsAdd", 403)).toBe("give-up");
  });
  it("creation keeps the customer id; a response without one is an error, not a pass with a blank", () => {
    const ok = parseCreatedPass({ customerId: id.customerId, serialNumber: id.serial, passTypeIdentifier: id.passTypeId, apple: { downloadUrl: "https://example/pass.pkpass" } });
    expect(ok).toEqual({ ok: true, pass: { ...id, downloadUrl: "https://example/pass.pkpass" } });
    expect(parseCreatedPass({ serialNumber: id.serial, passTypeIdentifier: id.passTypeId })).toMatchObject({ ok: false, error: expect.stringContaining("customerId") });
    expect(parseCreatedPass({ error: { message: "template not found" } })).toEqual({ ok: false, error: "template not found" });
  });
});
