/**
 * The eLoyalty (WalletPush) addressing rule, read off every External Request node in the live Community Loyalty Mini-App
 * on 15 Sep 2026. Pure: nothing here calls anything.
 *
 * Two API generations are live at once and they address people differently:
 *   v3 "public admin"  /api/public/admin/…            addressed by the CUSTOMER ID (a UUID): moving points, reading the customer
 *   v1 "external"      /api/external/v1/passes/{passTypeId}/{serial}/values/{Field}   addressed by PASS TYPE ID + SERIAL: writing onto the pass
 *   v1 "external"      /api/external/v1/templates/{templateId}/pass                   creation, addressed by the template
 * So a member record holds all three identifiers, keyed on the customer id. The serial is a cache: it changes when a pass is
 * reinstalled, so a 404 from any v1 call means "refresh the serial, then retry", not "the member is gone". There are no
 * idempotency keys on any endpoint, so a points call whose outcome is unknown is retried only after the customer's events
 * have been read and the award is confirmed absent. Update Loyalty Points (PUT …/values/Points) SETS a balance and is not in
 * this table on purpose: check-ins and redemptions inside the bot also move points, and a set would erase them.
 *
 * The first-live-call checklist, once the Evolve Omega program exists on the platform:
 *   1. One v3 points/add returns 2xx: that promotes the host to a built-in constant and verifies { success, eventId, newBalance }.
 *   2. Open the pass on a phone and confirm the DISPLAYED balance moved. The guard above assumes a v3 add flows through to
 *      the pass display; that is the Mini-App's migration note, not an observation. If it did not move, the display is a v1
 *      field v3 does not touch, and the balance would be right at eLoyalty and stale on the phone.
 *   3. One createPass: confirm customerId, serialNumber and passTypeIdentifier are in the response as parseCreatedPass expects.
 *   4. One v1 pushNotification with a stale serial: confirm the 404, then refresh-then-retry.
 */
export type Generation = "v1" | "v3";
export type Needs = "customerId" | "passTypeId+serial" | "templateId";
export type PassIdentity = { customerId?: string | null; serial?: string | null; passTypeId?: string | null };

export type CallKey = "pointsAdd" | "pointsDeduct" | "customer" | "customerEvents" | "pushNotification" | "passField" | "createPass";
export type CallSpec = { generation: Generation; method: "GET" | "POST" | "PUT"; needs: Needs; note: string };

export const ELOYALTY_CALLS: Record<CallKey, CallSpec> = {
  pointsAdd: { generation: "v3", method: "POST", needs: "customerId", note: "POST /api/public/admin/points/add { customerId, points, reason } → { success, eventId, newBalance }; confirmed by live test in the Mini-App" },
  pointsDeduct: { generation: "v3", method: "POST", needs: "customerId", note: "POST /api/public/admin/points/deduct { customerId, points, reason }; negatives go here, never to a set" },
  customer: { generation: "v3", method: "GET", needs: "customerId", note: "GET /api/public/admin/customers/{id}" },
  customerEvents: { generation: "v3", method: "GET", needs: "customerId", note: "GET /api/public/admin/customers/{id}/events: the read that makes a retry safe" },
  pushNotification: { generation: "v1", method: "PUT", needs: "passTypeId+serial", note: "PUT /api/external/v1/passes/{passTypeId}/{serial}/values/Push_Notification { value }" },
  passField: { generation: "v1", method: "PUT", needs: "passTypeId+serial", note: "PUT /api/external/v1/passes/{passTypeId}/{serial}/values/{Field} { value }; never the field Points" },
  createPass: { generation: "v1", method: "POST", needs: "templateId", note: "POST /api/external/v1/templates/{templateId}/pass { Email, First_Name, Last_Name, Id }; the response carries customerId, serialNumber, passTypeIdentifier" },
};

export type Addressed = { ok: true; generation: Generation; method: CallSpec["method"]; path: string; body?: Record<string, unknown> } | { ok: false; missing: "customerId" | "serial" | "passTypeId" | "templateId" };

type Args = { points?: number; reason?: string; field?: string; value?: string; templateId?: string; email?: string; firstName?: string; lastName?: string; externalId?: string };

const enc = encodeURIComponent;

/** The one place that knows which identifier a call takes. Call sites never pick a path or an id themselves. */
export function address(call: CallKey, id: PassIdentity, args: Args = {}): Addressed {
  const spec = ELOYALTY_CALLS[call];
  if (spec.needs === "customerId") {
    const c = (id.customerId ?? "").trim();
    if (!c) return { ok: false, missing: "customerId" };
    switch (call) {
      case "pointsAdd":
      case "pointsDeduct":
        return { ok: true, generation: "v3", method: "POST", path: `/api/public/admin/points/${call === "pointsAdd" ? "add" : "deduct"}`, body: { customerId: c, points: Math.abs(Math.round(args.points ?? 0)), reason: args.reason ?? "" } };
      case "customer":
        return { ok: true, generation: "v3", method: "GET", path: `/api/public/admin/customers/${enc(c)}` };
      default:
        return { ok: true, generation: "v3", method: "GET", path: `/api/public/admin/customers/${enc(c)}/events` };
    }
  }
  if (spec.needs === "templateId") {
    const t = (args.templateId ?? "").trim();
    if (!t) return { ok: false, missing: "templateId" };
    return { ok: true, generation: "v1", method: "POST", path: `/api/external/v1/templates/${enc(t)}/pass`, body: { Email: args.email ?? "", First_Name: args.firstName ?? "", Last_Name: args.lastName ?? "", Id: args.externalId ?? "" } };
  }
  const p = (id.passTypeId ?? "").trim();
  const s = (id.serial ?? "").trim();
  if (!p) return { ok: false, missing: "passTypeId" };
  if (!s) return { ok: false, missing: "serial" };
  const field = call === "pushNotification" ? "Push_Notification" : (args.field ?? "").trim();
  if (!field || field === "Points") throw new Error(field ? "Points is set through this field: refused, add or deduct instead" : "a pass field needs a field name");
  return { ok: true, generation: "v1", method: "PUT", path: `/api/external/v1/passes/${enc(p)}/${enc(s)}/values/${enc(field)}`, body: { value: args.value ?? "" } };
}

/** A signed ledger amount becomes an add or a deduct. Zero is nothing. */
export function pointsDelta(points: number): { call: "pointsAdd" | "pointsDeduct"; points: number } | null {
  const n = Math.round(points);
  if (!n) return null;
  return { call: n > 0 ? "pointsAdd" : "pointsDeduct", points: Math.abs(n) };
}

export type FailurePolicy = "refresh-serial-then-retry" | "check-events-before-retry" | "wait-60s-then-retry" | "give-up";

/**
 * What to do after a call did not clearly succeed. A v1 404 is the expected failure for a stale serial. A v3 points call
 * with an unknown outcome (timeout, 5xx) is not retried blind: there are no idempotency keys, so the customer's events are
 * read first. 429 means wait sixty seconds. Everything else is a real refusal.
 */
export function onFailure(call: CallKey, status: number | null): FailurePolicy {
  const spec = ELOYALTY_CALLS[call];
  if (status === 429) return "wait-60s-then-retry";
  if (spec.generation === "v1" && status === 404) return "refresh-serial-then-retry";
  if ((call === "pointsAdd" || call === "pointsDeduct") && (status === null || status >= 500)) return "check-events-before-retry";
  return "give-up";
}

export type CreatedPass = { customerId: string; serial: string; passTypeId: string; downloadUrl: string | null };

/**
 * The creation response, mapped so the customer id is kept. The Mini-App's own Create Pass maps the serial and drops the
 * customer id, which is why its chain cannot move points later; the WalletPush docs list customerId in this response. A
 * response without it is an error here, not a pass with a blank.
 */
export function parseCreatedPass(json: unknown): { ok: true; pass: CreatedPass } | { ok: false; error: string } {
  const r = (json ?? {}) as Record<string, unknown>;
  const err = r.error as { message?: string } | string | undefined;
  if (err) return { ok: false, error: typeof err === "string" ? err : (err.message ?? "pass not created") };
  const customerId = typeof r.customerId === "string" ? r.customerId.trim() : "";
  const serial = typeof r.serialNumber === "string" ? r.serialNumber.trim() : "";
  const passTypeId = typeof r.passTypeIdentifier === "string" ? r.passTypeIdentifier.trim() : "";
  if (!customerId) return { ok: false, error: "the response carried no customerId: the pass may exist but cannot be addressed for points" };
  if (!serial || !passTypeId) return { ok: false, error: "the response carried no serialNumber or passTypeIdentifier" };
  const apple = r.apple as { downloadUrl?: string } | undefined;
  return { ok: true, pass: { customerId, serial, passTypeId, downloadUrl: typeof apple?.downloadUrl === "string" ? apple.downloadUrl : null } };
}
