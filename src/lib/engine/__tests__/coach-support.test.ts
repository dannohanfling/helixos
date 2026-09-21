/**
 * The two beta blockers, pinned at the source so a regression fails the gate: a removed client loses access on the next
 * request, reminders skip them, and the coach's reset link rides the same single-use machinery as the client's own /forgot.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("removal ends access and stops reminders", () => {
  it("getViewer denies a removed membership and requireViewer sends it to the access-ended page", () => {
    const auth = read("src/lib/auth.ts");
    expect(auth).toMatch(/if \(membership\.removedAt\) return null;/);
    expect(auth).toMatch(/if \(m\?\.removedAt\) redirect\("\/removed"\);/);
  });
  it("the removed page is public and carries no app data", () => {
    expect(read("src/proxy.ts")).toMatch(/"\/removed"/);
    const page = read("src/app/removed/page.tsx");
    expect(page).toMatch(/access has ended/i);
    // No client data is loaded on this page: it neither reads the session nor the database.
    expect(page).not.toMatch(/requireViewer|getViewer|db\.query/);
  });
  it("the reminder run selects only active memberships", () => {
    expect(read("src/lib/reminders.ts")).toMatch(/eq\(schema\.memberships\.role, "client"\), isNull\(schema\.memberships\.removedAt\)\)/);
  });
  it("remove and reinstate set and clear both columns, and log who did it without a secret", () => {
    const coach = read("src/lib/actions/coach.ts");
    expect(coach).toMatch(/removeClientAction[\s\S]*removedAt: nowIso\(\), removedBy: coach\.user\.id/);
    expect(coach).toMatch(/reinstateClientAction[\s\S]*removedAt: null, removedBy: null/);
    expect(coach).toMatch(/event: "client\.removed"/);
  });
});

describe("the coach's reset link is the client's own", () => {
  it("both /forgot and the coach action issue the token through the one shared helper, never a second copy", () => {
    const shared = read("src/lib/reset-link.ts");
    expect(shared).toMatch(/export async function issueResetToken/);
    expect(read("src/lib/actions/account.ts")).toMatch(/issueResetToken\(user\.id\)/);
    expect(read("src/lib/actions/coach.ts")).toMatch(/issueResetToken\(user\.id\)/);
    // account.ts no longer defines its own token machinery: one source of truth.
    expect(read("src/lib/actions/account.ts")).not.toMatch(/function hashToken|const RESET_TTL_MS/);
  });
  it("the coach send logs who and when, and never writes the token", () => {
    const coach = read("src/lib/actions/coach.ts");
    expect(coach).toMatch(/event: "password_reset\.sent"/);
    expect(coach).toMatch(/note: `Reset link issued by \$\{coach\.user\.name\}`/);
    // The token goes into a cookie/email, never into the log payload.
    expect(coach).not.toMatch(/payload:[^}]*token/);
  });
});
