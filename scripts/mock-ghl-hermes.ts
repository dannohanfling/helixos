/**
 * The GoHighLevel calls a HelixOS-hosted Magic funnel page makes on registration (Hermes), for scripts/smoke-hermes.ts:
 * contact upsert, add tags, the custom field list, a contact update. `npx tsx scripts/mock-ghl-hermes.ts 4081`
 * Tokens: `pit-<location>` works; `pit-nofields` may not list custom fields (403). Walk hooks: POST /__fail on|off makes the
 * upsert answer 500; GET /__contacts shows what arrived (tags, the event date field). Nothing here is ever real data.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4081);
type Contact = { id: string; email?: string; phone?: string; firstName?: string; lastName?: string; tags: string[]; customFields: Record<string, string>; source?: string };
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
      contacts.set(id, { id, email: body.email as string | undefined, phone: body.phone as string | undefined, firstName: body.firstName as string | undefined, lastName: body.lastName as string | undefined, source: body.source as string | undefined, tags, customFields: {} });
      return json(201, { new: true, contact: { id } });
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
    if (one && req.method === "PUT") {
      const c = contacts.get(one[1]);
      if (!c) return json(404, { message: "Contact not found" });
      for (const f of (body.customFields as { id: string; field_value: string }[]) ?? []) c.customFields[f.id] = f.field_value;
      return json(200, { contact: { id: c.id } });
    }
    return json(404, { message: `mock-ghl-hermes: no route ${req.method} ${url}` });
  });
}).listen(port, () => console.log(`mock GHL (Hermes) on http://localhost:${port}`));
