import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { canEmailMember, emailBlock } from "../email-gate";

const ROOT = join(__dirname, "..", "..", "..", "..");
const SRC = join(ROOT, "src");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== "__tests__") walk(p, out);
    } else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
/** The body of one exported function, from its signature to the next top-level export. */
const body = (text: string, name: string): string => {
  const at = text.indexOf(`export async function ${name}(`);
  if (at < 0) return "";
  const next = text.indexOf("\nexport ", at + 1);
  return text.slice(at, next < 0 ? undefined : next);
};

describe("emails from HelixOS: who may be emailed automatically (29 Sep)", () => {
  const on = { emailsEnabled: true, removedAt: null, firstSignedInAt: "2026-06-01T00:00:00Z" };
  it("only a member with the switch on, who has signed in and isn't removed", () => {
    expect(canEmailMember(on)).toBe(true);
    expect(emailBlock({ ...on, emailsEnabled: false })).toBe("switched_off");
    expect(emailBlock({ ...on, firstSignedInAt: null })).toBe("never_signed_in");
    expect(emailBlock({ ...on, removedAt: "2026-09-01T00:00:00Z" })).toBe("removed");
    // A client the import made: switch off and never signed in. Turning the switch on still sends nothing until they sign in.
    expect(canEmailMember({ emailsEnabled: false, removedAt: null, firstSignedInAt: null })).toBe(false);
    expect(canEmailMember({ emailsEnabled: true, removedAt: null, firstSignedInAt: null })).toBe(false);
  });

  it("every place that sends email is known, and each automated sender (and the Nudge) goes through canEmail", () => {
    const senders = walk(SRC)
      .filter((f) => /\bsendEmail\(/.test(readFileSync(f, "utf8")) && !f.endsWith("lib/email.ts"))
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
      .sort();
    // reminders: the hourly cron (automated). coach: the Nudge (the comeback email, gated) and the reset link (pressed by
    // the coach, not gated). account: the member's own forgotten password (asked for by them, not gated). bot-features: a
    // feature switched on (rev 618), sent when the coach marks it, gated like the Nudge.
    expect(senders).toEqual(["src/lib/actions/account.ts", "src/lib/actions/bot-features.ts", "src/lib/actions/coach.ts", "src/lib/reminders.ts"]);
    const reminders = readFileSync(join(SRC, "lib/reminders.ts"), "utf8");
    expect(body(reminders, "runReminders")).toMatch(/await canEmail\(m\.id\)/);
    const coach = readFileSync(join(SRC, "lib/actions/coach.ts"), "utf8");
    expect(body(coach, "nudgeMemberAction")).toMatch(/await canEmail\(m\.id\)/);
    const features = body(readFileSync(join(SRC, "lib/actions/bot-features.ts"), "utf8"), "setFeatureOnAction");
    expect(features).toMatch(/await canEmail\(m\.id\)/);
    // The gate comes before the send in each.
    for (const b of [body(reminders, "runReminders"), body(coach, "nudgeMemberAction"), features]) expect(b.indexOf("canEmail(")).toBeLessThan(b.search(/deliver\(|sendEmail\(/));
  });

  it("the import creates a client with emails off, and every session write records the first sign-in", () => {
    expect(readFileSync(join(SRC, "lib/actions/import.ts"), "utf8")).toMatch(/role: "client"[^\n]*emailsEnabled: false/);
    for (const f of ["lib/actions/auth.ts", "lib/actions/account.ts"]) {
      const text = readFileSync(join(SRC, f), "utf8");
      const writes = text.match(/await writeSession\(/g)?.length ?? 0;
      expect(writes, f).toBeGreaterThan(0);
      expect(text.match(/await markSignedIn\(/g)?.length ?? 0, f).toBe(writes);
    }
  });
});
