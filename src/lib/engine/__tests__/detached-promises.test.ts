/**
 * A promise started inside a request and not awaited is frozen with the serverless function the moment the response goes:
 * the work never happens and nothing is written down. That lost the publishing pushes and the contact pushes before anyone
 * noticed. The rule: in request code, a promise is awaited, returned, or handed to background() (which hands it to after()).
 * No bare `.catch(...)`, no `.then(...)` chain, no `void call()`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");
const REQUEST_CODE = ["src/lib/actions", "src/app/api", "src/lib/webhooks.ts", "src/lib/queries", "src/lib/integrations.ts", "src/lib/ghl.ts", "src/lib/proof-storage.ts", "src/app/(app)", "src/app/(sheet)", "src/app/(auth)"];

function files(p: string, out: string[] = []): string[] {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) files(join(p, f), out);
  else if (/\.tsx?$/.test(p) && !p.includes("__tests__")) out.push(p);
  return out;
}

describe("no detached promise in request code", () => {
  const all = REQUEST_CODE.flatMap((p) => files(join(ROOT, p)));
  it("background() hands its promise to after(), so the invocation lives until the push settles", () => {
    const src = readFileSync(join(ROOT, "src/lib/integrations.ts"), "utf8");
    expect(src).toMatch(/export function background\([\s\S]*?after\(settled\)/);
  });
  it("no request-code file starts a promise it does not await, return or hand to background()", () => {
    const hits: string[] = [];
    for (const f of all) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*")) return;
        // A statement that is only `void somethingAsync(...)`, or a call chained straight into .catch/.then without await/return/assignment.
        if (/^void\s+[A-Za-z_$][\w$.]*\(/.test(t)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${t.slice(0, 120)}`);
        // An element of an awaited Promise.all ends with a comma; a detached statement ends with the call.
        if (/^[A-Za-z_$][\w$.]*\([^;]*\)\s*\.(catch|then)\(/.test(t) && !/^(await|return)\b/.test(t) && !/,\s*$/.test(t)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${t.slice(0, 120)}`);
      });
    }
    expect(hits, `a detached promise in request code:\n${hits.join("\n")}`).toEqual([]);
  });
});
