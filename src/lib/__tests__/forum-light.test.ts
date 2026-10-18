import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// H-561: the Forum hook picks its token on purpose. A stub curl records what would be sent; no real token is used.
const script = path.join(process.cwd(), "scripts", "forum-light.sh");

function run(env: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "forum-light-"));
  const out = path.join(dir, "sent");
  const curl = path.join(dir, "curl");
  writeFileSync(curl, `#!/bin/bash\nprintf '%s\\n' "$@" > "${out}"\n`);
  chmodSync(curl, 0o755);
  const r = spawnSync("bash", [script, "working", "testing the hook"], {
    env: { PATH: `${dir}:/usr/bin:/bin`, HELIXOS_URL: "http://stub.invalid", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  const sent = existsSync(out) ? readFileSync(out, "utf8") : null;
  return { code: r.status, stdout: r.stdout, sent };
}

describe("forum-light.sh token choice (H-561)", () => {
  it("uses HELIXOS_TOKEN_<NAME> when HELIXOS_AGENT_NAME is set, even beside other agents' tokens", () => {
    const r = run({ HELIXOS_AGENT_NAME: "Viator", HELIXOS_TOKEN_ARCHITECTUS: "tok-a", HELIXOS_TOKEN_VIATOR: "tok-v" });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.sent).toContain("Authorization: Bearer tok-v");
    expect(r.sent).toContain('"agent":"Viator"');
    expect(r.sent).not.toContain("tok-a");
  });

  it("sends nothing when the named agent has no token, rather than borrowing another's", () => {
    const r = run({ HELIXOS_AGENT_NAME: "Viator", HELIXOS_TOKEN_ARCHITECTUS: "tok-a" });
    expect(r.code).toBe(0);
    expect(r.sent).toBeNull();
  });

  it("uses the only HELIXOS_TOKEN_* there is, named after it", () => {
    const r = run({ HELIXOS_TOKEN_MEDICUS: "tok-m" });
    expect(r.sent).toContain("Authorization: Bearer tok-m");
    expect(r.sent).toContain('"agent":"Medicus"');
  });

  it("sends nothing when several tokens are present and no name is set", () => {
    const r = run({ HELIXOS_TOKEN_ARCHITECTUS: "tok-a", HELIXOS_TOKEN_VIATOR: "tok-v" });
    expect(r.code).toBe(0);
    expect(r.sent).toBeNull();
  });

  it("prefers HELIXOS_AGENT_TOKEN with HELIXOS_AGENT_NAME", () => {
    const r = run({ HELIXOS_AGENT_TOKEN: "tok-x", HELIXOS_AGENT_NAME: "Hospes", HELIXOS_TOKEN_HOSPES: "tok-h" });
    expect(r.sent).toContain("Authorization: Bearer tok-x");
    expect(r.sent).toContain('"agent":"Hospes"');
  });
});
