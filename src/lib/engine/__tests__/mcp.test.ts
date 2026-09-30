import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_SCOPES } from "@/db/schema";
import { ACCESS_TTL_MS, CODE_TTL_MS, REFRESH_TTL_MS, SCOPE_WORDS, backToApp, hostOf, isChallenge, isToolName, parseScopes, pkceOk, redirectMatches, redirectUriOk } from "../mcp";
import { defineTool, toolsFor } from "@/lib/mcp/registry";

const SRC = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("MCP server (rev 224): the pure parts", () => {
  it("PKCE is S256 only, with RFC 7636's own vector, and a verifier of the right shape", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(pkceOk(verifier, challenge)).toBe(true);
    expect(pkceOk(verifier + "x", challenge)).toBe(false);
    expect(pkceOk("short", challenge)).toBe(false);
    // plain: the challenge equal to the verifier is never accepted.
    expect(pkceOk(verifier, verifier)).toBe(false);
    expect(isChallenge(challenge)).toBe(true);
    expect(isChallenge("nope")).toBe(false);
  });

  it("redirect URIs: https only, no fragment, localhost over http in development only, and an exact match", () => {
    expect(redirectUriOk("https://claude.ai/api/mcp/auth_callback", false)).toBe(true);
    expect(redirectUriOk("http://claude.ai/cb", false)).toBe(false);
    expect(redirectUriOk("https://claude.ai/cb#frag", false)).toBe(false);
    expect(redirectUriOk("http://localhost:4090/cb", true)).toBe(true);
    expect(redirectUriOk("http://localhost:4090/cb", false)).toBe(false);
    expect(redirectUriOk("http://evil.example/cb", true)).toBe(false);
    expect(redirectUriOk("not a url", true)).toBe(false);
    expect(redirectMatches(["https://a.example/cb"], "https://a.example/cb")).toBe(true);
    expect(redirectMatches(["https://a.example/cb"], "https://a.example/cb?x=1")).toBe(false);
    expect(redirectMatches(["https://a.example/cb"], "https://a.example/cb/")).toBe(false);
  });

  it("scopes: one per area, Body among them, unknown ones named, and words for each", () => {
    expect([...MCP_SCOPES]).toEqual(["today", "tasks", "goals", "offers", "content", "library", "webinars", "essence", "body"]);
    expect(parseScopes("today tasks body")).toEqual({ scopes: ["today", "tasks", "body"], unknown: [] });
    expect(parseScopes("today admin")).toEqual({ scopes: ["today"], unknown: ["admin"] });
    expect(parseScopes(null)).toEqual({ scopes: [], unknown: [] });
    for (const s of MCP_SCOPES) expect(SCOPE_WORDS[s].line.length).toBeGreaterThan(10);
    expect(SCOPE_WORDS.body.line).toMatch(/never pre-ticked/);
  });

  it("the lifetimes: a code ten minutes, access an hour, refresh thirty days", () => {
    expect(CODE_TTL_MS).toBe(600_000);
    expect(ACCESS_TTL_MS).toBe(3_600_000);
    expect(REFRESH_TTL_MS).toBe(30 * 86_400_000);
  });

  it("tool names are letters, digits, underscores and hyphens: no dots, since Claude's API rejects them", () => {
    expect(isToolName("today_get")).toBe(true);
    expect(isToolName("today.get")).toBe(false);
    expect(isToolName("")).toBe(false);
    expect(() => defineTool({ name: "bad.name", scope: null, kind: "read", description: "x", input: {}, handler: async () => ({ text: "" }) })).toThrow(/no dots/);
  });

  it("the way back to the app keeps the state untouched and adds only what's given", () => {
    expect(backToApp("https://a.example/cb?keep=1", { code: "abc", state: "s t", error: null })).toBe("https://a.example/cb?keep=1&code=abc&state=s+t");
    expect(hostOf("https://claude.ai/api/cb")).toBe("claude.ai");
  });

  it("the registry lists scope-less tools for every grant and the rest by scope", () => {
    defineTool({ name: "test_free", scope: null, kind: "read", description: "x", input: {}, handler: async () => ({ text: "" }) });
    defineTool({ name: "test_tasks", scope: "tasks", kind: "write", description: "x", input: {}, handler: async () => ({ text: "" }) });
    defineTool({ name: "test_body", scope: "body", kind: "read", description: "x", input: {}, handler: async () => ({ text: "" }) });
    const names = (scopes: ("tasks" | "body")[]) => toolsFor(scopes).map((t) => t.name).filter((n) => n.startsWith("test_"));
    expect(names([])).toEqual(["test_free"]);
    expect(names(["tasks"])).toEqual(["test_free", "test_tasks"]);
    expect(names(["body"])).toEqual(["test_free", "test_body"]);
    expect(() => defineTool({ name: "test_free", scope: null, kind: "read", description: "x", input: {}, handler: async () => ({ text: "" }) })).toThrow(/twice/);
  });
});

describe("MCP server: the auth holds where it must", () => {
  it("Body's scope is gated by canAiUseBody, live, and its tools can only come through the registry", () => {
    expect(read("lib/mcp/tools/whoami.ts")).toMatch(/defineScope\("body", \{ gate: \(v\) => canAiUseBody\(v, v\.user\.id\) \}\)/);
    const server = read("lib/mcp/server.ts");
    expect(server).toMatch(/const gate = def\.scope \? gateFor\(def\.scope\) : undefined;/);
    expect(server).toMatch(/toolsFor\(grant\.scopes\)/);
    // The audit row never carries the arguments.
    expect(server).toMatch(/values\(\{ id: newId\(\), workspaceId: grant\.viewer\.workspace\.id, userId: grant\.viewer\.user\.id, appId: grant\.app\.id, tool: def\.name, ok, error, ms \}\)/);
    expect(server).not.toMatch(/args/.source + /.*insert/.source);
  });

  it("tokens and codes are stored hashed, a refresh token is single use, and a password change keeps connected apps", () => {
    const oauth = read("lib/mcp/oauth.ts");
    expect(oauth).toMatch(/tokenHash: hashSecret\(access\)/);
    expect(oauth).toMatch(/tokenHash: hashSecret\(refresh\)/);
    expect(oauth).toMatch(/codeHash: hashSecret\(code\)/);
    expect(oauth).toMatch(/if \(row\.usedAt \|\| row\.revokedAt\) \{\n\s+await revokeApp\(app\.id\);/);
    expect(oauth).not.toMatch(/sessionVersion/);
    const auth = read("lib/auth.ts");
    expect(auth).toMatch(/export async function viewerFor\(userId: string, workspaceId: string\)/);
    // The cookie path still checks the session version; the token path does not.
    expect(auth).toMatch(/if \(\(session\.sv \?\? 0\) !== user\.sessionVersion\) return null;/);
    expect(oauth).toMatch(/if \(viewer\.role === "client" && !viewer\.workspace\.connectedAppsOpen\) return null;/);
  });

  it("the OAuth routes are public, the consent screen is not, and the login carries the whole address back", () => {
    const proxy = read("proxy.ts");
    for (const p of ['"/api/mcp"', '"/oauth/register"', '"/oauth/token"', '"/oauth/revoke"', '"/.well-known"']) expect(proxy).toContain(p);
    expect(proxy).not.toContain('"/oauth/authorize"');
    expect(proxy).toMatch(/url\.searchParams\.set\("next", pathname \+ request\.nextUrl\.search\);/);
  });

  it("the consent form is signed for this member and this request, and Body is never pre-ticked", () => {
    const page = read("app/(app)/oauth/authorize/page.tsx");
    expect(page).toMatch(/defaultChecked=\{!isBody\}/);
    expect(page).toMatch(/if \(isBody && !v\.membership\.bodyEnabled\) return null;/);
    expect(page).toMatch(/data-testid="consent-host"/);
    const actions = read("lib/actions/mcp.ts");
    expect(actions).toMatch(/safeEqual\(consentSignature\(fields\), str\(formData, "sig"\)\)/);
    expect(actions).toMatch(/s !== "body" \|\| v\.membership\.bodyEnabled/);
    // Codes and challenges never leave the app in an export.
    const md = read("lib/member-data.ts");
    expect(md).toMatch(/"codeHash", "codeChallenge"/);
  });

  it("the token endpoint never caches, and the 401 points at the resource metadata", () => {
    expect(read("lib/mcp/metadata.ts")).toMatch(/"cache-control": "no-store"/);
    expect(read("app/oauth/token/route.ts")).toMatch(/headers: jsonHeaders/);
    expect(read("lib/mcp/server.ts")).toMatch(/resource_metadata="\$\{iss\}\/\.well-known\/oauth-protected-resource"/);
  });
});
