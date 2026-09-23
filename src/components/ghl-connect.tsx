import type { SocialConnection } from "@/db/schema";
import { connectGhlAction, disconnectGhlAction, refreshGhlAccountsAction, setGhlMappingAction } from "@/lib/actions/social";
import { PUBLISHABLE, candidates, manualChannelsSentence, readiness } from "@/lib/engine/ghl-map";
import { GHL_SCOPES, REQUIRED_SCOPES } from "@/lib/engine/ghl-scopes";
import { CHANNEL_SPECS, type Channel } from "@/lib/engine/repurpose";
import { formatDateTime } from "@/lib/dates";
import { Badge, Field } from "./ui";
import { ConfirmButton } from "./confirm-button";
import { DISCONNECT_MESSAGE } from "@/lib/engine/ghl-scopes";
import { SubmitButton } from "@/components/submit-button";

/** A member connects their own GoHighLevel sub-account with a location-level Private Integration token. Used on Settings. */
export function GhlConnect({ conn, tz, role, open }: { conn: SocialConnection | null; tz: string; role: string; open: boolean }) {
  // Scopes are granted once, so no client is walked through creating a Private Integration until the coach opens the setup.
  if (role !== "coach" && !open && !conn) {
    return (
      <p className="rounded-lg bg-surface-2 p-3 text-sm text-ink-2" data-testid="ghl-not-open">
        Publishing setup isn&apos;t open yet. Your coach will tell you when to connect your GoHighLevel sub-account; until then, posts you schedule are ready to copy and paste.
      </p>
    );
  }
  const connected = Boolean(conn && conn.accounts.length && !conn.lastError);
  const hasUser = Boolean(conn?.ghlUserId?.trim());
  // Nothing publishes without the user id, whatever the map says.
  const ready = conn && hasUser ? readiness(conn.mapping) : { ...readiness({}), mapped: 0 };
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-surface-2 p-3 text-sm">
        <div className="font-semibold">Get your token from GoHighLevel (once, about two minutes)</div>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-2">
          <li>Log in to your GoHighLevel sub-account (the one with your Facebook, Instagram and LinkedIn connected in Social Planner).</li>
          <li>
            Open <b>Settings → Private Integrations → Create new integration</b>. Name it <b>HelixOS</b>.
          </li>
          <li>
            Tick these {REQUIRED_SCOPES.length} scopes and nothing else:
            <ul className="mt-1 grid gap-x-4 sm:grid-cols-2" data-testid="ghl-scope-list">
              {GHL_SCOPES.map((sc) => (
                <li key={sc.scope}>
                  <code className="text-xs">{sc.scope}</code>
                </li>
              ))}
            </ul>
          </li>
          <li>
            Copy the token that appears. <b>It is shown only once.</b> Paste it below.
          </li>
          <li>
            Your <b>Location ID</b> is under <b>Settings → Business Profile</b> in the same sub-account.
          </li>
        </ol>
      </div>
      <form action={connectGhlAction} className="grid gap-3 sm:grid-cols-2">
        <Field label="Location ID" hint="Settings → Business Profile">
          <input className="field" name="locationId" defaultValue={conn?.locationId ?? ""} required placeholder="ve9EPM428h8vShlRW1KT" />
        </Field>
        <Field label="Your GHL user ID (required)" hint="The Social Planner refuses a post without it. Settings → My Staff → your profile, or the user who owns the connected accounts.">
          <input className="field" name="ghlUserId" defaultValue={conn?.ghlUserId ?? ""} placeholder="Lx1EI6YIgQYMQi0ytFXv" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Private Integration token" hint={conn?.manualToken ? "A token is saved. Paste a new one only to replace it." : "Starts with pit-. Stored encrypted; never shown again here."}>
            <input className="field" name="manualToken" type="password" autoComplete="off" placeholder={conn?.manualToken ? "•••••••• saved" : "pit-…"} />
          </Field>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <SubmitButton className="btn btn-primary btn-sm" pendingText="Checking…">
            {conn ? "Save and check" : "Connect and check"}
          </SubmitButton>
          <span className="text-xs text-ink-3">Saving asks GoHighLevel for your connected pages, so you&apos;ll know right away if the token or location is wrong.</span>
        </div>
      </form>
      {role === "coach" && !open ? (
        <p className="text-xs text-ink-3" data-testid="ghl-coach-gate-note">Clients don&apos;t see this setup yet. Open it on Integrations once the scope list is final.</p>
      ) : null}
      {conn ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={conn.lastError ? "danger" : connected ? "good" : "neutral"}>{conn.lastError ? "not connected" : connected ? `connected · ${conn.accounts.length} accounts` : "no accounts yet"}</Badge>
            {connected ? <span className="text-ink-3">{ready.mapped}/{ready.total} channels will auto-publish</span> : null}
            {conn.lastSyncAt && !conn.lastError ? <span className="text-ink-3">· checked {formatDateTime(conn.lastSyncAt, tz)}</span> : null}
            <form action={refreshGhlAccountsAction} className="ml-auto">
              <SubmitButton className="btn btn-ghost btn-xs" pendingText="Checking…">
                Check again
              </SubmitButton>
            </form>
            <form action={disconnectGhlAction}>
              <ConfirmButton className="text-ink-3 underline" message={DISCONNECT_MESSAGE} pendingText="Disconnecting…">
                Disconnect
              </ConfirmButton>
            </form>
          </div>
          {conn.lastError ? (
            <p className="rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="ghl-error">
              {conn.lastError}
            </p>
          ) : null}
          {connected && !hasUser ? (
            <p className="rounded-lg bg-warn-soft p-3 text-sm" data-testid="ghl-no-user">
              Add your GHL user ID above. The Social Planner refuses a post without it, so nothing publishes until it is filled in.
            </p>
          ) : null}
          {conn.accounts.length ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-3">What GoHighLevel returned ({conn.accounts.length} accounts)</summary>
              <ul className="mt-1 divide-y rounded-lg border" data-testid="ghl-accounts">
                {conn.accounts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-2 py-1" data-platform={a.platform} data-type={a.type}>
                    <span className="font-medium">{a.name}</span>
                    <span className="text-ink-3">{a.platform} {a.type}{a.isExpired ? " · expired" : ""}</span>
                    <code className="ml-auto break-all text-[10px] text-ink-3">{a.id}</code>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {connected ? (
            <form action={setGhlMappingAction} className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(PUBLISHABLE) as Channel[])
                  .filter((c) => PUBLISHABLE[c].via)
                  .map((c) => {
                    const spec = CHANNEL_SPECS.find((s) => s.key === c)!;
                    const opts = candidates(c, conn.accounts);
                    return (
                      <label key={c} className="block">
                        <span className="label">
                          {spec.icon} {spec.label}
                        </span>
                        <select className="field py-1 text-sm" name={`map_${c}`} defaultValue={conn.mapping[c] ?? ""}>
                          <option value="">Don&apos;t auto-publish</option>
                          {opts.map((a) => (
                            <option key={a.id} value={a.id} disabled={a.isExpired}>
                              {a.name} ({a.platform} {a.type}){a.isExpired ? " · reconnect in GHL" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
              </div>
              <div className="flex items-center gap-3">
                <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…">
                  Save channel map
                </SubmitButton>
                <span className="text-[11px] text-ink-3">{manualChannelsSentence()}</span>
              </div>
            </form>
          ) : !conn.lastError ? (
            <p className="text-xs text-ink-3">The token works but no pages or profiles are connected yet. Connect Facebook, Instagram and LinkedIn inside your sub-account&apos;s Social Planner, then &quot;Check again&quot;.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
