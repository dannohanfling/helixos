/**
 * The GoHighLevel calls a HelixOS-hosted Magic funnel page makes on registration (Hermes), for scripts/smoke-hermes.ts:
 * one contact by id, the duplicate search, a new contact, add tags, the custom field list, a contact update.
 * `npx tsx scripts/mock-ghl-hermes.ts 4081`. Tokens: `pit-<location>` works; `pit-nofields` may not list custom fields (403).
 * Walk hooks: POST /__fail on|off makes the lookups answer 500; POST /__seed plants an existing contact (with a locationId,
 * "loc_hermes" unless given); GET /__contacts shows what arrived (tags, the event date field). Nothing here is ever real data.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4081);
type Contact = { id: string; locationId: string; email?: string; phone?: string; firstName?: string; lastName?: string; tags: string[]; customFields: Record<string, string>; source?: string };
const contacts = new Map<string, Contact>();
let failing = false;
let n = 0;

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = req.url ?? "";
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const body = (() => {
      try {
        return JSON.parse(Buffer.concat(chunks).toString() || "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    if (url === "/" && req.method === "GET") return json(200, { ok: true });
    if (url.startsWith("/__contacts")) return json(200, { contacts: [...contacts.values()] });
    if (url.startsWith("/__fail/")) {
      failing = url.endsWith("/on");
      return json(200, { failing });
    }
    // A contact that already exists in the sub-account (H-17's case: someone else's contact with this phone).
    if (url.startsWith("/__seed") && req.method === "POST") {
      const id = `hc_seed_${++n}`;
      contacts.set(id, { id, locationId: (body.locationId as string | undefined) ?? "loc_hermes", email: body.email as string | undefined, phone: body.phone as string | undefined, firstName: body.firstName as string | undefined, tags: [], customFields: {} });
      return json(200, { id });
    }
    if (url.startsWith("/__reset")) {
      contacts.clear();
      failing = false;
      return json(200, { ok: true });
    }
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer pit-") || req.headers.version !== "2021-07-28") return json(401, { message: "Invalid JWT" });
    const token = auth.slice("Bearer ".length);

    if (url === "/contacts/upsert" && req.method === "POST") {
      if (failing) return json(500, { message: "Internal error" });
      const match = [...contacts.values()].find((c) => (body.email && c.email === body.email) || (body.phone && c.phone === body.phone));
      const tags = Array.isArray(body.tags) ? (body.tags as string[]) : [];
      if (match) {
        Object.assign(match, { firstName: body.firstName ?? match.firstName, lastName: body.lastName ?? match.lastName, phone: body.phone ?? match.phone });
        match.tags = [...new Set([...match.tags, ...tags])];
        return json(200, { new: false, contact: { id: match.id } });
      }
      const id = `hc_${++n}`;
      contacts.set(id, { id, locationId: (body.locationId as string | undefined) ?? "loc_hermes", email: body.email as string | undefined, phone: body.phone as string | undefined, firstName: body.firstName as string | undefined, lastName: body.lastName as string | undefined, source: body.source as string | undefined, tags, customFields: {} });
      return json(201, { new: true, contact: { id } });
    }
    // GoHighLevel's duplicate search, one key at a time: ?email= or ?number=, within the sub-account.
    if (url.startsWith("/contacts/search/duplicate") && req.method === "GET") {
      if (failing) return json(500, { message: "Internal error" });
      const q = new URL(url, "http://x").searchParams;
      const email = q.get("email");
      const number = q.get("number");
      const hit = [...contacts.values()].find((c) => c.locationId === q.get("locationId") && ((email && c.email === email) || (number && c.phone === number)));
      return json(200, { contact: hit ? { id: hit.id, email: hit.email ?? null, phone: hit.phone ?? null } : null });
    }
    if (url === "/contacts/" && req.method === "POST") {
      const id = `hc_${++n}`;
      contacts.set(id, { id, locationId: (body.locationId as string | undefined) ?? "loc_hermes", email: body.email as string | undefined, phone: body.phone as string | undefined, firstName: body.firstName as string | undefined, lastName: body.lastName as string | undefined, source: body.source as string | undefined, tags: [], customFields: {} });
      return json(201, { contact: { id } });
    }
    const tagged = url.match(/^\/contacts\/([^/?]+)\/tags$/);
    if (tagged && req.method === "POST") {
      const c = contacts.get(tagged[1]);
      if (!c) return json(404, { message: "Contact not found" });
      c.tags = [...new Set([...c.tags, ...((body.tags as string[]) ?? [])])];
      return json(201, { tags: c.tags });
    }
    if (/^\/locations\/[^/]+\/customFields/.test(url) && req.method === "GET") {
      if (token === "pit-nofields") return json(403, { message: "The token is not authorized for this scope." });
      return json(200, { customFields: [{ id: "cf_other", name: "Other", fieldKey: "contact.other" }, { id: "cf_ic_date", name: "IC Event Date", fieldKey: "contact.ic_event_date" }] });
    }
    const one = url.match(/^\/contacts\/([^/?]+)$/);
    // One contact by id (H-51): what the sign-up's CRM Contact ID points at, with the sub-account it belongs to.
    if (one && req.method === "GET") {
      if (failing) return json(500, { message: "Internal error" });
      const c = contacts.get(one[1]);
      if (!c) return json(404, { message: "Contact not found" });
      return json(200, { contact: { id: c.id, locationId: c.locationId, email: c.email ?? null, phone: c.phone ?? null, firstName: c.firstName ?? null } });
    }
    if (one && req.method === "PUT") {
      const c = contacts.get(one[1]);
      if (!c) return json(404, { message: "Contact not found" });
      for (const f of (body.customFields as { id: string; field_value: string }[]) ?? []) c.customFields[f.id] = f.field_value;
      if (typeof body.email === "string") c.email = body.email;
      if (typeof body.phone === "string") {
        if ([...contacts.values()].some((x) => x.id !== c.id && x.locationId === c.locationId && x.phone === body.phone)) return json(400, { message: "This phone number is already in use" });
        c.phone = body.phone;
      }
      return json(200, { contact: { id: c.id } });
    }
    return json(404, { message: `mock-ghl-hermes: no route ${req.method} ${url}` });
  });
}).listen(port, () => console.log(`mock GHL (Hermes) on http://localhost:${port}`));
