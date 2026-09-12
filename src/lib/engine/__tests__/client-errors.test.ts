/**
 * The rule: an error a client can see says what happened to them and what to do next. It never names a variable, a host, a
 * vendor's raw reply, a stack trace or a person; the detail goes to the server log. Naming an outside service is fine when the
 * client has their own relationship with it and the next action is theirs to take there (their own AI key, their own
 * GoHighLevel token).
 *
 * Two mechanical checks over every source file, so the next feature that talks to an outside service cannot bring the
 * pattern back without failing here:
 *   1. No string literal, template text or JSX text carries the name of an environment variable the code reads.
 *   2. No error, note or thrown message interpolates an upstream body or message.
 * Exceptions are listed by file and snippet with the reason, never worked around, and each is checked to still exist.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f) && !p.includes("__tests__")) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

/** Every environment variable the code reads, by name: the only names the first check is about. */
function envNames(): Set<string> {
  const names = new Set<string>();
  const sources = walk(SRC).concat(walk(join(ROOT, "scripts")), [join(ROOT, "next.config.ts")]);
  for (const f of sources) for (const m of readFileSync(f, "utf8").matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g)) names.add(m[1] ?? m[2]);
  try {
    for (const line of readFileSync(join(ROOT, ".env.example"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
      if (m) names.add(m[1]);
    }
  } catch {
    /* no example file */
  }
  return names;
}

/**
 * Every piece of text a screen could show, from the file's own syntax tree: string literals, the fixed parts of template
 * literals, and JSX text. Anything inside a console.* call or one of our log helpers is the log's, not a screen's.
 */
function clientFacingText(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node, inLog: boolean) => {
    let log = inLog;
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (/^console\.(error|warn|log|info|debug)$/.test(callee) || /^log[A-Z]\w*$/.test(callee)) log = true;
    }
    if (!log) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
      else if (ts.isTemplateExpression(node)) out.push([node.head.text, ...node.templateSpans.map((sp) => sp.literal.text)].join(" "));
      else if (ts.isJsxText(node) && node.text.trim()) out.push(node.text);
    }
    ts.forEachChild(node, (c) => visit(c, log));
  };
  visit(sf, false);
  return out;
}

/** Comments out, for the line-based second check. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/(?![^"'`]*["'`][^"'`]*$).*$/, "$1"))
    .join("\n");
}

const NAME_SHAPE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\b/g;

/** Legitimate exceptions, each with why: the screen is the operator's, or the message is a process's output, never a client's page. */
const ENV_ALLOW: { file: string; token: string; why: string }[] = [
  { file: "src/lib/integrations.ts", token: "INTEGRATION_URL_ALLOWLIST", why: "the coach's Integrations page (Danno and operators, role 'coach'): naming the variable to the person who can set it is the useful message; a member's push gets a sentence instead (src/lib/ghl.ts credentials)" },
  { file: "src/lib/email.ts", token: "EMAIL_FROM", why: "thrown server-side at send time and caught by every caller (reminders, coach nudge, password reset), which log it; never returned to a screen" },
  { file: "src/lib/crypto.ts", token: "ENCRYPTION_KEY", why: "thrown when the server cannot seal a secret at all: a deployment configuration failure for the operator's log, not a client's state" },
  { file: "src/lib/crypto.ts", token: "SESSION_SECRET", why: "same throw" },
  { file: "src/db/seed.ts", token: "NODE_ENV", why: "the seed script's own terminal output (npm run db:seed), never a page" },
  { file: "src/db/seed.ts", token: "ALLOW_DEMO_SEED", why: "same terminal output" },
  { file: "src/db/seed.ts", token: "DATABASE_URL", why: "same terminal output" },
  { file: "src/lib/session.ts", token: "SESSION_SECRET", why: "thrown at boot in production before any page can render: the operator's deployment error" },
  { file: "src/lib/webhooks.ts", token: "GHL_WEBHOOK_PUBLIC_KEY", why: "a 401 body returned to the webhook's sender (GoHighLevel's or Community Loyalty's server), read by the operator in that vendor's delivery log while configuring the marketplace app; never a page" },
  { file: "src/app/(app)/integrations/page.tsx", token: "GHL_WEBHOOK_PUBLIC_KEY", why: "the coach's Integrations page (Danno and operators): the setup note for the person who sets the variable" },
];

// An error, a note, a persisted lastError or a thrown message that interpolates what came back from outside; and, inside a
// function that explains or describes an upstream reply, any returned template. A prompt built from a client's own draft is
// neither, so a bare `return \`` outside such a function is not a context.
const CONTEXT = /\b(error|note|lastError|externalError|refusal|reason)\s*:|new Error\(|\bthrow\s+`/;
// A component's state setter fed an error object's own words (setError(e.message)) is a screen too; a setter fed the client's
// own text (setBody(text)) is not, so only the error-object forms count here.
const SETTER = /\bset[A-Z]\w*\(/;
const SETTER_UPSTREAM = /\.message\b|String\((e|err|error)\)/;
const EXPLAINER_RETURN = /\breturn\s+`/;
const UPSTREAM_TOKENS = "msg|message|body|text|statusText|detail|reply";
const UPSTREAM = new RegExp(`\\$\\{[^}]*(\\b(${UPSTREAM_TOKENS})\\b|\\.message\\b|String\\((e|err|error)\\)|res\\.text\\(\\))[^}]*\\}|\\+\\s*(${UPSTREAM_TOKENS})\\b|\\b(error|note|lastError|externalError|refusal|reason)\\s*:\\s*(e instanceof Error \\? e\\.message|\\(e as Error\\)\\.message|(e|err|error)\\.message|String\\((e|err|error)\\)|${UPSTREAM_TOKENS})\\b(?!\\s*\\()`);
const UPSTREAM_ALLOW: { file: string; snippet: string; why: string }[] = [
  { file: "src/lib/integrations.ts", snippet: "note: `${res.status} ${text}`", why: "a sync note on the coach's Integrations page (operators only): the upstream body is the diagnosis of a bad webhook URL or key" },
  { file: "src/lib/integrations.ts", snippet: "note: e instanceof Error ? e.message : String(e)", why: "the same coach-only sync note, network failure" },
  { file: "src/lib/actions/integrations.ts", snippet: "note: `${res.status} ${res.statusText}`", why: "the coach's own ping on the Integrations page; a status line, not a body" },
  { file: "src/lib/actions/integrations.ts", snippet: "lastError: `${res.status} ${res.statusText}`", why: "the same ping, persisted for the coach" },
  { file: "src/lib/email.ts", snippet: '`SendGrid failed: ${status} ${errors.join("; ")}`', why: "thrown server-side and caught by every caller, which log it; the only way to diagnose an unverified sender" },
  { file: "src/lib/email.ts", snippet: "`SendGrid failed: ${status} ${body.slice(0, 500)}`", why: "same" },
  { file: "src/lib/email.ts", snippet: "`EMAIL_FROM is not a valid sender: ${JSON.stringify(value)}", why: "configuration, thrown server-side; the value is ours, not upstream" },
];

describe("client-facing errors: what happened and what to do next, never our internals", () => {
  const files = walk(SRC);
  const env = envNames();

  it("the set of variable names the code reads is known and includes the ones that have leaked before", () => {
    for (const n of ["BLOB_READ_WRITE_TOKEN", "OPENALEX_API_KEY", "SENDGRID_API_KEY", "INTEGRATION_URL_ALLOWLIST", "EMAIL_FROM"]) expect(env.has(n), n).toBe(true);
  });

  it("no string a client can see carries an environment-variable name", () => {
    const hits: string[] = [];
    for (const f of files) {
      const r = rel(f);
      for (const s of clientFacingText(f, readFileSync(f, "utf8"))) {
        for (const m of s.match(NAME_SHAPE) ?? []) {
          if (!env.has(m)) continue;
          if (ENV_ALLOW.some((a) => a.file === r && a.token === m)) continue;
          hits.push(`${r}: "${s.trim().replace(/\s+/g, " ").slice(0, 100)}" names ${m}`);
        }
      }
    }
    expect(hits, `an environment-variable name reached a string a client can see:\n${hits.join("\n")}`).toEqual([]);
  });

  it("every allowlisted variable exception still exists, so a stale entry cannot hide a future leak", () => {
    for (const a of ENV_ALLOW) expect(readFileSync(join(ROOT, a.file), "utf8"), `${a.file} no longer mentions ${a.token}; drop the allowlist entry`).toContain(a.token);
  });

  it("no error, note or thrown message interpolates an upstream body or message", () => {
    const hits: string[] = [];
    for (const f of files) {
      const r = rel(f);
      let fn = "";
      stripComments(readFileSync(f, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          const decl = line.match(/\bfunction\s+(\w+)|\bconst\s+(\w+)\s*=\s*(?:async\s*)?\(/);
          if (decl) fn = decl[1] ?? decl[2] ?? "";
          if (/console\.(error|warn|log|info|debug)\(|\blog[A-Z]\w*\(/.test(line)) return;
          const context = CONTEXT.test(line) || (/^(explain|describe)/.test(fn) && EXPLAINER_RETURN.test(line));
          const setter = SETTER.test(line) && SETTER_UPSTREAM.test(line);
          if (!(context && UPSTREAM.test(line)) && !setter) return;
          if (UPSTREAM_ALLOW.some((a) => a.file === r && line.includes(a.snippet))) return;
          hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 140)}`);
        });
    }
    expect(hits, `an upstream reply reached an error a client can see or a note that persists:\n${hits.join("\n")}`).toEqual([]);
  });

  it("every allowlisted upstream exception still exists, so a stale entry cannot hide a future leak", () => {
    for (const a of UPSTREAM_ALLOW) expect(readFileSync(join(ROOT, a.file), "utf8"), `${a.file} no longer contains ${a.snippet}; drop the allowlist entry`).toContain(a.snippet);
  });
});
