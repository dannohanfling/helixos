/**
 * A stand-in for the Vercel Blob API for local walks: the SDK is pointed here with VERCEL_BLOB_API_URL (server) and
 * NEXT_PUBLIC_VERCEL_BLOB_API_URL (browser). Implements what the app uses: PUT /?pathname= (an upload, from a server put or a
 * browser upload on a client token), GET /?url= (head), POST /delete, and serving a public object at its URL. A private
 * object answers 403 at its URL, as the real store does without a token. Objects live in memory. /__reset clears.
 *
 *   npx tsx scripts/mock-blob.ts 4050
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const port = Number(process.argv[2] ?? 4050);
type Obj = { bytes: Buffer; contentType: string; access: "public" | "private"; uploadedAt: string };
const objects = new Map<string, Obj>();
const urlOf = (pathname: string) => `http://localhost:${port}/${pathname}`;
// The real store infers a type from the extension when the upload names none.
const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain", zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const typeOf = (pathname: string, header: string | string[] | undefined) => (header ? String(header) : TYPES[pathname.split(".").pop()?.toLowerCase() ?? ""]) ?? "application/octet-stream";
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT, POST, OPTIONS", "access-control-allow-headers": "*", "access-control-expose-headers": "*" };
const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
};
const describe = (pathname: string, o: Obj) => ({ url: urlOf(pathname), downloadUrl: `${urlOf(pathname)}?download=1`, pathname, size: o.bytes.length, contentType: o.contentType, contentDisposition: `inline; filename="${pathname.split("/").pop()}"`, cacheControl: "public, max-age=2592000", uploadedAt: o.uploadedAt, etag: createHash("md5").update(o.bytes).digest("hex") });

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (url.pathname === "/__reset") {
    objects.clear();
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/__list") return json(res, 200, { objects: Array.from(objects.entries()).map(([k, o]) => ({ pathname: k, access: o.access, size: o.bytes.length })) });
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const authed = /^Bearer vercel_blob_(rw|client)_/.test(req.headers.authorization ?? "");
    // The API: an upload
    if (req.method === "PUT" && url.pathname === "/") {
      if (!authed) return json(res, 403, { error: { code: "forbidden", message: "no token" } });
      let pathname = url.searchParams.get("pathname") ?? "";
      if (!pathname) return json(res, 400, { error: { code: "bad_request", message: "pathname required" } });
      if (req.headers["x-add-random-suffix"] === "1") pathname = pathname.replace(/(\.[^.]+)?$/, `-${Math.random().toString(36).slice(2, 8)}$1`);
      if (objects.has(pathname) && req.headers["x-allow-overwrite"] !== "1") return json(res, 409, { error: { code: "blob_already_exists", message: "exists" } });
      const access = req.headers["x-vercel-blob-access"] === "private" ? "private" : "public";
      const o: Obj = { bytes: body, contentType: typeOf(pathname, req.headers["x-content-type"]), access, uploadedAt: new Date().toISOString() };
      objects.set(pathname, o);
      return json(res, 200, describe(pathname, o));
    }
    // The API: head
    if (req.method === "GET" && url.pathname === "/" && url.searchParams.has("url")) {
      if (!authed) return json(res, 403, { error: { code: "forbidden", message: "no token" } });
      const asked = url.searchParams.get("url")!;
      const pathname = asked.startsWith("http") ? new URL(asked).pathname.slice(1) : asked;
      const o = objects.get(pathname);
      return o ? json(res, 200, describe(pathname, o)) : json(res, 404, { error: { code: "not_found", message: "no such blob" } });
    }
    // The API: delete
    if (req.method === "POST" && url.pathname === "/delete") {
      if (!authed) return json(res, 403, { error: { code: "forbidden", message: "no token" } });
      const { urls } = JSON.parse(body.toString() || "{}") as { urls?: string[] };
      for (const u of urls ?? []) objects.delete(u.startsWith("http") ? new URL(u).pathname.slice(1) : u);
      return json(res, 200, null);
    }
    // The CDN: a public object at its URL; a private one needs the token, as the real store does
    if (req.method === "GET") {
      const o = objects.get(url.pathname.slice(1));
      if (!o) return json(res, 404, { error: { code: "not_found", message: "no such blob" } });
      if (o.access === "private" && !authed) return json(res, 403, { error: { code: "forbidden", message: "private" } });
      res.writeHead(200, { "content-type": o.contentType, "content-length": String(o.bytes.length), "cache-control": "public, max-age=2592000", ...cors });
      return res.end(o.bytes);
    }
    json(res, 404, { error: { code: "not_found", message: "unknown route" } });
  });
}).listen(port, () => console.log(`mock blob on :${port}`));
