/**
 * Tenancy, checked at the source: a client can never read or write another client's record. Every server action derives the
 * owner (user and workspace) from the session, never from the request body, and every action that reads a record by an id
 * taken from the request scopes that read to the session's user or workspace. This test derives its subjects from the files
 * in src/lib/actions, never a hand-written list (second rule), so a new action that forgets the scope fails here before it
 * ships. The runtime proof that the whole request path honours this is scripts/smoke-tenancy.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.join(process.cwd(), "src/lib/actions");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

/** Each exported server action and its body, sliced by brace-matching from the file. */
function actionsOf(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  for (const m of src.matchAll(/export async function (\w+)\(/g)) {
    // Balance the parameter parens, then find the body's opening brace: the first "{" at angle-bracket depth 0, so an object
    // return type like Promise<{ ok: true }> is skipped and the slice is the real body, not the return type.
    let i = m.index! + m[0].length;
    let paren = 1;
    while (paren && i < src.length) {
      if (src[i] === "(") paren++;
      else if (src[i] === ")") paren--;
      i++;
    }
    let angle = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "<") angle++;
      else if (ch === ">") angle = Math.max(0, angle - 1);
      else if (ch === "{" && angle === 0) break;
      i++;
    }
    const bodyStart = i + 1;
    let depth = 1;
    i = bodyStart;
    while (depth && i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    out.push({ name: m[1], body: src.slice(bodyStart, i) });
  }
  return out;
}

const all = files.flatMap((f) => actionsOf(readFileSync(path.join(dir, f), "utf8")).map((a) => ({ ...a, file: f })));

// Reads a record id from the request: a form field named id/…Id, an …Ids list, or a payload id.
const takesId = (b: string) => /str\(formData, "\w*[iI]d"\)|opt\(formData, "\w*[iI]d"\)|formData\.(?:get|getAll|has)\("\w*[iI]ds?"\)|payload\.id\b|: string\)/.test(b);
const mutates = (b: string) => /\.(update|delete|insert)\(schema\./.test(b);
// Derives the caller from the session: ctx() or a require* guard. Never trusts the body for who is calling.
const sessionScoped = (b: string) => /await ctx\(\)|requireViewer\(\)|requireCoach\(\)|getViewer\(\)/.test(b);

describe("tenancy: no action trusts the request for who owns the data", () => {
  it("only the auth lifecycle runs without a session; everything else derives the caller from ctx()", () => {
    // These seven establish or end a session, so they have none to read yet. Named, not skipped; anything else session-less fails here.
    const noSession = all.filter((a) => !sessionScoped(a.body)).map((a) => `${a.file}:${a.name}`).sort();
    expect(noSession).toEqual(["account.ts:forgotAction", "account.ts:resetAction", "account.ts:setupAction", "auth.ts:demoLoginAction", "auth.ts:joinAction", "auth.ts:loginAction", "auth.ts:logoutAction"]);
    // The surface is large and derived from the files: a floor guards against the glob silently returning nothing (first rule).
    expect(all.length).toBeGreaterThanOrEqual(150);
  });

  it("no action ever ties an owner column to a request value (userId/workspaceId come from the session only)", () => {
    const offenders = all.filter((a) => /eq\(schema\.\w+\.(userId|workspaceId),\s*(?:str|opt|num)\(formData/.test(a.body)).map((a) => `${a.file}:${a.name}`);
    expect(offenders).toEqual([]);
  });

  it("every id-taking mutating action scopes its write to the caller, by a column filter, an own() guard, a coach guard, or a visibility check", () => {
    const idMutators = all.filter((a) => takesId(a.body) && mutates(a.body));
    // Derived count, asserted so a drop is caught (first rule): the sweep found 102.
    expect(idMutators.length).toBeGreaterThanOrEqual(95);
    // Three scope the write by a shape the pattern below doesn't match, each read and verified by hand:
    //  - useLibraryPostAction: a `visible` check (own row, or shared in the workspace) gates the update.
    //  - updateWorkspaceAction: requireCoach, and it writes only coach.workspace.
    //  - connectGhlAction: ctx(), and the connection it writes is keyed to the caller's userId.
    const verifiedElsewhere = ["library.ts:useLibraryPostAction", "settings.ts:updateWorkspaceAction", "social.ts:connectGhlAction"];
    const unscoped: string[] = [];
    for (const a of idMutators) {
      const key = `${a.file}:${a.name}`;
      if (verifiedElsewhere.includes(key)) continue;
      const columnScoped = /\b(userId|workspaceId)\b/.test(a.body) && /(eq\(schema\.\w+\.(userId|workspaceId)|\bown\w*\(|requireCoach|editable\()/.test(a.body);
      // A create writes a new row owned by the session; a join-table write is the caller's own row from a shared catalog id.
      const ownedByConstruction = /^create/.test(a.name) || /insert\(schema\.(lessonProgress|evidenceHidden|pathwayProgress|curriculumProgress)\)/.test(a.body);
      if (!columnScoped && !ownedByConstruction) unscoped.push(key);
    }
    expect(unscoped).toEqual([]);
  });
});
