import type { SocialConnection } from "@/db/schema";
import { connectGhlAction, disconnectGhlAction, refreshGhlAccountsAction, setGhlMappingAction } from "@/lib/actions/social";
import { PUBLISHABLE, candidates, manualChannelsSentence, readiness } from "@/lib/engine/ghl-map";
import { GHL_SCOPES, REQUIRED_SCOPES } from "@/lib/engine/ghl-scopes";
import { CHANNEL_SPECS, type Channel } from "@/lib/engine/repurpose";
import { formatDateTime } from "@/lib/dates";
import { Field } from "./ui";
import { ConfirmButton } from "./confirm-button";
import { DISCONNECT_MESSAGE } from "@/lib/engine/ghl-scopes";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";

/**
 * The GoHighLevel connect card as a client sees it (rev 333): two states and nothing else. Not connected: one sentence and a
 * Connect button that opens the steps, one at a time, in plain words, with no scope name on screen (Copy the list puts the
 * names on the clipboard; a fold reads them for anyone who wants to). Connected: a green check and "Connected", how many
 * pages and profiles answered, how many channels will auto-publish, when it was last checked, and Check again and
 * Disconnect; the token and the IDs never show again, and Reconnect replaces the token from inside this state. The GHL user
 * ID is read off GoHighLevel's answer when it carries one and asked for only when it cannot be found. The same card serves
 * the coach's Settings and a client's; the setup opens to clients on Integrations.
 */
export function GhlConnect({ conn, tz, role, open }: { conn: SocialConnection | null; tz: string; role: string; open: boolean }) {
  // Scopes are granted once, so no client is walked through creating a Private Integration until the coach opens the setup.
  if (role !== "coach" && !open && !conn) {
    return (
      <p className="rounded-lg bg-surface-2 p-3 text-sm text-ink-2" data-testid="ghl-not-open">
        Publishing setup isn&apos;t open yet. Your coach will tell you when to connect your GoHighLevel account; until then, posts you schedule are ready to copy and paste.
      </p>
    );
  }
  const connected = Boolean(conn && conn.accounts.length && !conn.lastError);
  const hasUser = Boolean(conn?.ghlUserId?.trim());
  // Nothing publishes without the user id, whatever the map says.
  const ready = conn && hasUser ? readiness(conn.mapping) : { ...readiness({}), mapped: 0 };
  const scopeList = REQUIRED_SCOPES.join("\n");

  if (connected && conn) {
    return (
      <div className="space-y-3" data-testid="ghl-connected">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="flex items-center gap-1 font-semibold text-good" data-testid="ghl-connected-badge">
            <span aria-hidden="true">✓</span> Connected
          </span>
          <span className="text-ink-2">{conn.accounts.length} connected {conn.accounts.length === 1 ? "page or profile" : "pages and profiles"}</span>
          <span className="text-ink-2" data-testid="ghl-ready">
            · {ready.mapped}/{ready.total} channels will auto-publish
          </span>
          {conn.lastSyncAt ? <span className="text-ink-3">· checked {formatDateTime(conn.lastSyncAt, tz)}</span> : null}
          <span className="ml-auto flex items-center gap-3 text-xs">
            <form action={refreshGhlAccountsAction}>
              <SubmitButton className="text-ink-3 underline" pendingText="Checking…">
                Check again
              </SubmitButton>
            </form>
            <form action={disconnectGhlAction}>
              <ConfirmButton className="text-ink-3 underline" message={DISCONNECT_MESSAGE} pendingText="Disconnecting…">
                Disconnect
              </ConfirmButton>
            </form>
          </span>
        </div>
        {!hasUser ? (
          <form action={connectGhlAction} className="rounded-lg bg-warn-soft p-3 text-sm" data-testid="ghl-no-user">
            <p className="font-medium">One more thing: your GoHighLevel user ID.</p>
            <p className="mt-1 text-ink-2">GoHighLevel&apos;s answer didn&apos;t say which user owns the connected pages, and the Social Planner refuses a post without it, so nothing publishes until it is filled in. In GoHighLevel open Settings → My Staff → your profile and copy the ID from the address bar.</p>
            <input type="hidden" name="locationId" value={conn.locationId} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input className="field max-w-xs" name="ghlUserId" defaultValue="" placeholder="Your GHL user ID" required />
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">Save</SubmitButton>
            </div>
          </form>
        ) : null}
        <details className="text-sm" data-testid="ghl-channels">
          <summary className="cursor-pointer text-accent">Choose which pages get which posts</summary>
          <form action={setGhlMappingAction} className="mt-2 space-y-2">
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
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…">
                Save channel map
              </SubmitButton>
              <span className="text-[11px] text-ink-3">{manualChannelsSentence()}</span>
            </div>
          </form>
          <details className="mt-2 text-xs">
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
        </details>
        <details className="text-sm" data-testid="ghl-reconnect">
          <summary className="cursor-pointer text-ink-3">Reconnect: a new token, or a different user ID</summary>
          <form action={connectGhlAction} className="mt-2 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="locationId" value={conn.locationId} />
            <Field label="New token (optional)" hint="Paste the token from a new Private Integration in GoHighLevel; leave it empty to keep the saved one. Stored encrypted; never shown again here.">
              <input className="field" name="manualToken" type="password" autoComplete="off" placeholder="pit-…" data-testid="ghl-reconnect-token" />
            </Field>
            <Field label="Your GHL user ID" hint="The user who owns the connected pages (Settings → My Staff in GoHighLevel). The Social Planner refuses a post from any other.">
              <input className="field" name="ghlUserId" defaultValue={conn.ghlUserId ?? ""} data-testid="ghl-reconnect-user" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton className="btn btn-soft btn-sm" pendingText="Connecting…">Reconnect</SubmitButton>
            </div>
          </form>
        </details>
      </div>
    );
  }

  const stepsOpen = Boolean(conn); // a saved attempt that failed keeps the steps open, with the reason under them
  return (
    <div className="space-y-3" data-testid="ghl-not-connected">
      <p className="text-sm text-ink-2">Connect your GoHighLevel account so HelixOS can post for you.</p>
      {conn?.lastError ? (
        <p className="rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="ghl-error">
          {conn.lastError}
          {/missing permissions/i.test(conn.lastError) ? (
            <>
              {" "}
              <CopyButton text={scopeList} label="Copy the list" className="btn btn-ghost btn-xs" />
            </>
          ) : null}
        </p>
      ) : null}
      <details open={stepsOpen} data-testid="ghl-steps">
        <summary className="btn btn-primary btn-sm inline-flex cursor-pointer list-none" data-testid="ghl-connect-open">Connect</summary>
        <form action={connectGhlAction} className="mt-3 space-y-3 text-sm">
          <ol className="space-y-3 pl-5 text-ink-2 [&>li]:list-decimal">
            <li>
              <span className="font-medium text-ink">Open GoHighLevel</span> and go to <b>Settings → Private Integrations</b>.
            </li>
            <li>
              <span className="font-medium text-ink">Create a new integration</span> and name it <b>HelixOS</b>.
            </li>
            <li>
              <span className="font-medium text-ink">Tick the permissions.</span> Copy the list and paste each name into GoHighLevel&apos;s search box, one at a time.
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <CopyButton text={scopeList} label="Copy the list" className="btn btn-soft btn-xs" />
                <span className="text-xs text-ink-3">{REQUIRED_SCOPES.length} permissions, nothing else.</span>
              </div>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-ink-3">Read the list instead</summary>
                <ul className="mt-1 grid gap-x-4 sm:grid-cols-2" data-testid="ghl-scope-list">
                  {GHL_SCOPES.map((sc) => (
                    <li key={sc.scope}>
                      <code className="text-xs">{sc.scope}</code>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
            <li>
              <span className="font-medium text-ink">Copy the token GoHighLevel shows you and paste it here.</span> It is shown only once.
              <input className="field mt-1" name="manualToken" type="password" autoComplete="off" placeholder="pit-…" required={!conn?.manualToken} data-testid="ghl-token" />
            </li>
            <li>
              <span className="font-medium text-ink">Paste your Location ID.</span> It is under Settings → Business Profile in the same sub-account.
              <input className="field mt-1" name="locationId" defaultValue={conn?.locationId ?? ""} required placeholder="ve9EPM428h8vShlRW1KT" data-testid="ghl-location" />
            </li>
          </ol>
          <input type="hidden" name="ghlUserId" value={conn?.ghlUserId ?? ""} />
          <div className="flex items-center gap-2">
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Connecting…">
              Connect
            </SubmitButton>
            <span className="text-xs text-ink-3">HelixOS checks the token with GoHighLevel right away.</span>
          </div>
        </form>
      </details>
      {role === "coach" && !open ? (
        <p className="text-xs text-ink-3" data-testid="ghl-coach-gate-note">Clients don&apos;t see this setup yet. Open it on Integrations once the scope list is final.</p>
      ) : null}
    </div>
  );
}
