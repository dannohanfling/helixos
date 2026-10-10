import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { approveConnectionAction, denyConnectionAction } from "@/lib/actions/mcp";
import { OPT_IN_SCOPES, SCOPE_WORDS, backToApp, hostOf, isChallenge, parseScopes, redirectMatches, type Scope } from "@/lib/engine/mcp";
import { clientById, consentSignature, issuerFor, resourceFor } from "@/lib/mcp/oauth";
import { Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Connect an app" };

type Params = { client_id?: string; redirect_uri?: string; response_type?: string; scope?: string; state?: string; code_challenge?: string; code_challenge_method?: string; resource?: string };

/**
 * The consent screen (rev 224): an app (Claude's connector) asks to act as this member. It shows the app's name and, in
 * larger type, the domain it will send the code to (a name can be spoofed, the domain can't), the scopes in plain words with
 * a tick each, Body never pre-ticked. Consent is asked on every connection (rev 247, B3). An unknown app or an unregistered
 * redirect shows an error here and never redirects anywhere.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const v = await requireViewer();
  const p = await searchParams;
  const h = await headers();
  const iss = issuerFor(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`);
  const client = p.client_id ? await clientById(p.client_id) : null;
  const redirectUri = p.redirect_uri ?? "";
  const problem = !client ? "This app isn't registered with HelixOS." : !redirectMatches(client.redirectUris, redirectUri) ? "This app asked to send you to an address it didn't register. Nothing was sent." : null;
  if (problem) return <Refused title="Can't connect this app" line={problem} />;
  const back = (error: string, error_description: string) => redirect(backToApp(redirectUri, { error, error_description, state: p.state }));
  if (p.response_type !== "code") back("unsupported_response_type", "response_type must be code");
  if (!p.code_challenge || p.code_challenge_method !== "S256" || !isChallenge(p.code_challenge)) back("invalid_request", "PKCE with S256 is required");
  if (p.resource && p.resource !== resourceFor(iss)) back("invalid_target", `resource must be ${resourceFor(iss)}`);
  const parsed = parseScopes(p.scope);
  if (parsed.unknown.length) back("invalid_scope", `unknown scope: ${parsed.unknown.join(", ")}`);
  // No scope asked means everything but Body; Body is only ever an explicit ask.
  const asked: Scope[] = parsed.scopes.length ? parsed.scopes : (Object.keys(SCOPE_WORDS) as Scope[]).filter((s) => s !== "body");
  if (v.switchedInto) return <Refused title="Not from here" line={`Connected apps are ${v.switchedInto.clientName.split(" ")[0]}'s own. They connect from their own HelixOS.`} state="switched" />;
  if (v.role === "client" && !v.workspace.connectedAppsOpen) return <Refused title="Not open yet" line="Your coach hasn't opened connected apps to clients. Ask them, and try again." state="closed" />;
  const sig = consentSignature({ clientId: client!.id, redirectUri, state: p.state ?? "", codeChallenge: p.code_challenge!, resource: p.resource ?? "", scope: asked.join(" "), userId: v.user.id });
  const hidden = { client_id: client!.id, redirect_uri: redirectUri, state: p.state ?? "", code_challenge: p.code_challenge!, resource: p.resource ?? "", scope: asked.join(" "), sig };
  return (
    <>
      <PageHeader title="Connect an app to your HelixOS" subtitle="It will act as you, with only what you tick, until you disconnect it in Settings." />
      <Card>
        <form className="space-y-4" data-testid="consent" data-client={client!.id}>
          {Object.entries(hidden).map(([k, val]) => (
            <input key={k} type="hidden" name={k} value={val} />
          ))}
          <div>
            <div className="text-lg font-semibold" data-testid="consent-app">{client!.name}</div>
            <div className="mt-1 text-sm text-ink-2">
              wants to connect, and will send its key to <strong className="text-base" data-testid="consent-host">{hostOf(redirectUri)}</strong>
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="label">What it may do</legend>
            {asked.map((s) => {
              const isBody = s === "body";
              if (isBody && !v.membership.bodyEnabled) return null;
              return (
                <label key={s} className="flex items-start gap-2 text-sm" data-testid={`consent-scope-${s}`}>
                  <input type="checkbox" name="scopes" value={s} defaultChecked={!OPT_IN_SCOPES.includes(s)} className="mt-1" />
                  <span>
                    <span className="font-medium">{SCOPE_WORDS[s].label}</span>
                    <span className="block text-xs text-ink-3">{SCOPE_WORDS[s].line}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className="text-xs text-ink-3">{asked.includes("content:publish") ? "It never sends or deletes anything, and publishes only with Content: publish ticked, after reading back what will post and hearing your yes. It never reaches another member." : "It never sends, publishes or deletes anything, and never reaches another member."} Every change it makes is marked as made by this app. You can disconnect it any time in Settings.</p>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton formAction={approveConnectionAction} className="btn btn-primary btn-sm" pendingText="Connecting…" data-testid="consent-approve">
              Connect
            </SubmitButton>
            <SubmitButton formAction={denyConnectionAction} className="btn btn-ghost btn-sm" pendingText="Declining…" data-testid="consent-deny">
              Not now
            </SubmitButton>
          </div>
        </form>
      </Card>
    </>
  );
}

function Refused({ title, line, state = "refused" }: { title: string; line: string; state?: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p className="text-sm" data-testid="consent-refused" data-state={state}>
          {line}
        </p>
        <Link href="/connect" className="mt-3 inline-block text-sm underline">
          About connecting apps
        </Link>
      </Card>
    </>
  );
}
