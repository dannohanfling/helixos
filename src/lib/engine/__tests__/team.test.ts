/**
 * Team access (Danno, 6 Oct), checked at the source: what is open to a team member is a short, named list, and everything
 * else is closed by default. A page opens with `requireViewer({ team: "allow" })`, a route handler with
 * `apiViewer({ team: "allow" })`, an action with `ctx({ team: "allow" })`; this test derives every such opening from the files
 * and asserts the exact set, so a page or action opened by accident fails here before it ships. The runtime proof is
 * scripts/smoke-team.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, navVisible } from "@/components/nav-groups";
import { inviteExpiry, inviteState, lastActiveWords, readCap, seatsLine, TEAM_CAP_DEFAULT, TEAM_INVITE_DAYS } from "@/lib/engine/team";

const root = process.cwd();
function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) walk(full, keep, out);
    else if (keep(e)) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(root, f).replaceAll("\\", "/");
const read = (f: string) => readFileSync(f, "utf8");

/** What a team member may reach: content, DMs, tasks, webinars, contacts and the business plan (BG1: a VA works its tasks), the shell's own pages, and nothing else. */
const OPEN_PAGES = [
  "src/app/(app)/bot-features/[key]/page.tsx",
  "src/app/(app)/bot-features/page.tsx",
  "src/app/(app)/clients/[id]/page.tsx",
  "src/app/(app)/clients/page.tsx",
  "src/app/(app)/content/[id]/compose/page.tsx",
  "src/app/(app)/content/[id]/page.tsx",
  "src/app/(app)/content/[id]/repurpose/page.tsx",
  "src/app/(app)/content/compose/page.tsx",
  "src/app/(app)/content/ladders/[id]/page.tsx",
  "src/app/(app)/content/ladders/page.tsx",
  "src/app/(app)/content/ladders/profile/page.tsx",
  "src/app/(app)/content/page.tsx",
  "src/app/(app)/conversations/[id]/page.tsx",
  "src/app/(app)/conversations/page.tsx",
  "src/app/(app)/conversations/playbook/page.tsx",
  "src/app/(app)/goals/[id]/page.tsx",
  "src/app/(app)/goals/page.tsx",
  "src/app/(app)/images/page.tsx",
  "src/app/(app)/layout.tsx",
  "src/app/(app)/library/[id]/page.tsx",
  "src/app/(app)/library/page.tsx",
  "src/app/(app)/more/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/app/(app)/tasks/page.tsx",
  "src/app/(app)/today/page.tsx",
  "src/app/(app)/webinars/[id]/page.tsx",
  "src/app/(app)/webinars/page.tsx",
  "src/app/(app)/whats-new/page.tsx",
];
const OPEN_ROUTES = ["src/app/api/deck-images/[id]/route.ts", "src/app/api/deck-images/upload/route.ts", "src/app/api/drafts/route.ts", "src/app/api/webinars/[id]/deck/route.ts"];
const OPEN_ACTION_FILES = ["clients.ts", "compose.ts", "contacts.ts", "content.ts", "deck-images.ts", "drip.ts", "kpi.ts", "ladders.ts", "library.ts", "outcomes.ts", "plan.ts", "social.ts", "tasks.ts", "tiers.ts", "variants.ts", "webinars.ts", "whats-new.ts"];
/** In an open action file, the actions that stay closed: the owner's own settings, and the connections. */
const CLOSED_IN_OPEN_FILES = ["clients.ts:updatePassAction", "ladders.ts:pushKeywordsAction", "social.ts:connectGhlAction", "social.ts:refreshGhlAccountsAction", "social.ts:setGhlMappingAction", "social.ts:disconnectGhlAction", "social.ts:coachDisconnectGhlAction", "social.ts:replayContactSyncAction"];

describe("team access: what is open is named, and everything else is closed by default", () => {
  it("exactly these pages admit a team member", () => {
    const files = walk(path.join(root, "src/app"), (f) => f === "page.tsx" || f === "layout.tsx");
    const open = files.filter((f) => /requireViewer\(\{ team: "allow" \}\)/.test(read(f))).map(rel).sort();
    expect(open).toEqual(OPEN_PAGES);
    // Every other page under the app either closes by default or is a coach's.
    for (const f of files.filter((f) => rel(f).startsWith("src/app/(app)/") && !OPEN_PAGES.includes(rel(f)))) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(/team: "allow"/);
    }
  });
  it("exactly these route handlers admit a team member, and none reads the viewer without the gate", () => {
    const files = walk(path.join(root, "src/app"), (f) => f === "route.ts");
    const open = files.filter((f) => /apiViewer\(\{ team: "allow" \}\)/.test(read(f))).map(rel).sort();
    expect(open).toEqual(OPEN_ROUTES);
    expect(files.filter((f) => /getViewer\(\)/.test(read(f))).map(rel)).toEqual([]);
  });
  it("exactly these action files open actions to a team member, and the closed ones in them stay closed", () => {
    const dir = path.join(root, "src/lib/actions");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    const open = files.filter((f) => /team: "allow"|team: "noop"/.test(read(path.join(dir, f)))).sort();
    expect(open).toEqual(OPEN_ACTION_FILES);
    for (const key of CLOSED_IN_OPEN_FILES) {
      const [file, name] = key.split(":");
      const src = read(path.join(dir, file));
      const start = src.indexOf(`export async function ${name}(`);
      expect(start, key).toBeGreaterThan(-1);
      const end = src.indexOf("export async function", start + 1);
      const body = src.slice(start, end === -1 ? undefined : end);
      expect(body, key).not.toMatch(/team: "allow"/);
    }
  });
  it("the gate refuses by default and logs every allowed write; points never score for a team member", () => {
    expect(read(path.join(root, "src/lib/action-helpers.ts"))).toMatch(/if \(v\.team\) await teamWrite\(v, opts\.team \?\? "refuse"\)/);
    const gate = read(path.join(root, "src/lib/team.ts"));
    expect(gate).toMatch(/if \(how === "refuse"\) await refuseTeam\(\)/);
    expect(gate).toMatch(/insert\(schema\.teamChanges\)/);
    expect(read(path.join(root, "src/lib/queries/points.ts"))).toMatch(/v\?\.switchedInto \|\| v\?\.team/);
    const auth = read(path.join(root, "src/lib/auth.ts"));
    expect(auth).toMatch(/if \(v\.team && opts\.team !== "allow"\) notFound\(\)/);
    expect(auth).toMatch(/membership: \{ \.\.\.owner, bodyEnabled: false \}/);
    expect(read(path.join(root, "src/lib/chat.ts"))).toMatch(/if \(v\.switchedInto \|\| v\.team\) return null/);
  });
  it("the menu shows a team member only the open sections", () => {
    const m = { role: "client" as const, passEnabled: true, bodyEnabled: true, recordingsEnabled: true, team: true };
    // The Platforms links (Danno, 7 Oct) are outbound and open no HelixOS data: a team member sees them too.
    expect(NAV.filter((n) => navVisible(n, m)).map((n) => n.href).sort()).toEqual(["/bot-features", "/clients", "/content", "/conversations", "/goals", "/images", "/library", "/tasks", "/today", "/webinars", "/whats-new", "https://academy.evolveomega.com", "https://app.evolveomega.com", "https://communityloyalty.io"]);
    // Without the team flag the same member sees Body, Rewards and the rest.
    expect(NAV.filter((n) => navVisible(n, { ...m, team: false })).some((n) => n.href === "/body")).toBe(true);
  });
});

describe("team access: the plain rules", () => {
  it("an invite is open for a week, then expired; used and cancelled read as such", () => {
    const made = new Date("2026-10-07T12:00:00Z");
    const expiresAt = inviteExpiry(made);
    expect(expiresAt).toBe("2026-10-14T12:00:00.000Z");
    expect(TEAM_INVITE_DAYS).toBe(7);
    const i = { usedAt: null, revokedAt: null, expiresAt };
    expect(inviteState(i, new Date("2026-10-14T11:59:00Z"))).toBe("open");
    expect(inviteState(i, new Date("2026-10-14T12:00:00Z"))).toBe("expired");
    expect(inviteState({ ...i, usedAt: "2026-10-08T00:00:00Z" }, made)).toBe("used");
    expect(inviteState({ ...i, revokedAt: "2026-10-08T00:00:00Z" }, made)).toBe("revoked");
  });
  it("the cap is five by default and the coach's number is kept only when it is a whole number in range", () => {
    expect(TEAM_CAP_DEFAULT).toBe(5);
    expect(readCap("8", 5)).toBe(8);
    expect(readCap("0", 5)).toBe(0);
    expect(readCap("51", 5)).toBe(5);
    expect(readCap("-1", 5)).toBe(5);
    expect(readCap("2.5", 5)).toBe(5);
    expect(readCap("", 5)).toBe(5);
  });
  it("seats and last active read in plain words", () => {
    expect(seatsLine({ cap: 5, members: 3, invites: 0 })).toBe("3 of 5 seats used");
    expect(seatsLine({ cap: 1, members: 0, invites: 1 })).toBe("0 of 1 seat used (1 invite open)");
    const now = new Date("2026-10-07T12:00:00Z");
    expect(lastActiveWords(null, now)).toBe("never");
    expect(lastActiveWords("2026-10-07T09:00:00Z", now)).toBe("today");
    expect(lastActiveWords("2026-10-06T09:00:00Z", now)).toBe("yesterday");
    expect(lastActiveWords("2026-10-01T09:00:00Z", now)).toBe("6 days ago");
  });
});
