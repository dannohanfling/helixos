/**
 * A stand-in for SendGrid's mail/send endpoint for smoke tests. `npx tsx scripts/mock-sendgrid.ts 4030`, then run with
 * SENDGRID_API_KEY=SG.good EMAIL_API_URL=http://localhost:4030.
 * Keys: SG.good accepts (202); anything else is 401 with SendGrid's own error shape. A recipient at reject.example.com gets a
 * 400 "unverified sender" error, to stand in for the one bad send in a batch. GET /_sent lists what was accepted.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4030);
const sent: unknown[] = [];

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const json = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(body === null ? "" : JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/_sent") return json(200, sent);
    if (req.method === "POST" && req.url === "/v3/mail/send") {
      const auth = (req.headers.authorization ?? "").replace("Bearer ", "");
      if (auth !== "SG.good") return json(401, { errors: [{ message: "The provided authorization grant is invalid, expired, or revoked", field: null, help: null }] });
      let body: { personalizations?: { to?: { email: string }[] }[]; from?: { email: string } } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } catch {
        return json(400, { errors: [{ message: "Bad Request", field: null, help: null }] });
      }
      const to = body.personalizations?.[0]?.to?.[0]?.email ?? "";
      if (/@reject\.example\.com$/.test(to)) return json(400, { errors: [{ message: "The from address does not match a verified Sender Identity. Mail cannot be sent until this error is resolved.", field: "from", help: "http://sendgrid.com/docs/sender-identity" }] });
      sent.push(body);
      return json(202, null, { "x-message-id": `mock-${sent.length}` });
    }
    return json(404, { errors: [{ message: "Not found", field: null, help: null }] });
  });
}).listen(port, () => console.log(`mock SendGrid on http://localhost:${port}`));
