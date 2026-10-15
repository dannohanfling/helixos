import type { SocialConnection } from "@/db/schema";
import { connectGhlAction, disconnectGhlAction, refreshGhlAccountsAction, setGhlMappingAction } from "@/lib/actions/social";
import { PUBLISHABLE, candidates, manualChannelsSentence, readiness } from "@/lib/engine/ghl-map";
import { GHL_SCOPES } from "@/lib/engine/ghl-scopes";
import { CHANNEL_SPECS, type Channel } from "@/lib/engine/repurpose";
import { formatDateTime } from "@/lib/dates";
import { Field } from "./ui";
import { ConfirmButton } from "./confirm-button";
import { DISCONNECT_MESSAGE } from "@/lib/engine/ghl-scopes";
import { SubmitButton } from "@/components/submit-button";
import { GhlScopeRows } from "@/components/ghl-scope-rows";
import { ConnectBox } from "@/components/connect-box";
import { GHL_COPY, GHL_HELP } from "@/lib/engine/connect-copy";
import { GhlConnectForm } from "@/components/ghl-connect-form";

/**
 * The GoHighLevel connect card as a client sees it (rev 333): two states and nothing else. Not connected: one sentence and a
 * Connect button that opens the steps, one at a time, in plain words. The permission list is rows (H-233): GoHighLevel's picker
 * takes permissions one at a time, so each row has the picker's name, the text to search for, its own Copy and a tick. Connected: a green check and "Connected", how many
 * pages and profiles answered, how many channels will auto-publish, when it was last checked, and Check again and
 * Disconnect; the token and the IDs never show again, and Reconnect replaces the token from inside this state. The GHL user
 * ID is read off GoHighLevel's answer when it carries one and asked for only when it cannot be found. The same card serves
 * the coach's Settings and a client's. Open to every member from the start (Danno, 12 Oct; H-226): the "Open Publishing setup
 * to clients" switch of rev 333 is gone, so no client ever reads "isn't open yet" while the coach waits to find it.
 */
export function GhlConnect({ conn, tz, users = [] }: { conn: SocialConnection | null; tz: string; users?: { id: string; name: string }[] }) {
  const connected = Boolean(conn && conn.accounts.length && !conn.lastError);
  const hasUser = Boolean(conn?.ghlUserId?.trim());
  // Nothing publishes without the user id, whatever the map says.
  const ready = conn && hasUser ? readiness(conn.mapping) : { ...readiness({}), mapped: 0 };

  if (connected && conn) {
    return (
      <div className="space-y-3" data-testid="ghl-connected">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="flex items-center gap-1 font-semibold text-good" data-testid="ghl-connected-badge">
            <span aria-hidden="true">✓</span> Connected
          </span>
          {conn.locationName ? (
            <span className="font-medium" data-testid="ghl-location-name">
              to {conn.locationName}
            </span>
          ) : null}
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
            <p className="font-medium">One more thing: which user are you?</p>
            <p className="mt-1 text-ink-2">The Social Planner posts as the user who owns your connected pages, so nothing publishes until you pick one.</p>
            <input type="hidden" name="locationId" value={conn.locationId} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <UserField users={users} current="" testId="ghl-user" />
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
            <Field label="Which user are you?" hint={users.length ? "The user who owns your connected pages. The Social Planner refuses a post from any other." : GHL_HELP.user}>
              <UserField users={users} current={conn.ghlUserId ?? ""} testId="ghl-reconnect-user" required={false} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton className="btn btn-soft btn-sm" pendingText="Connecting…">Reconnect</SubmitButton>
            </div>
          </form>
        </details>
      </div>
    );
  }

  // Connected to GoHighLevel but no page or profile answered: the token works, the Social Planner is empty.
  const noPages = Boolean(conn && !conn.lastError && conn.connectedAt && !conn.accounts.length);

  // Rev 850: the AI key card's layout, Danno's words (src/lib/engine/connect-copy.ts), open from the start.
  return (
    <div className="space-y-3" data-testid="ghl-not-connected">
      <p className="text-sm text-ink-2">{GHL_COPY.intro}</p>
      {noPages ? (
        <div className="rounded-lg bg-warn-soft p-3 text-sm" data-testid="ghl-no-pages">
          {GHL_HELP.noPages}{" "}
          <form action={refreshGhlAccountsAction} className="inline">
            <SubmitButton className="underline" pendingText="Checking…">Check again</SubmitButton>
          </form>
        </div>
      ) : null}
      {conn?.lastError ? (
        // H-237: one state, never both. The last check failed, so the card says Not connected yet and why; Integrations says the same.
        <p className="rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="ghl-error">
          <span className="font-semibold" data-testid="ghl-status">Not connected yet.</span> {conn.lastError}
        </p>
      ) : null}
      <details open data-testid="ghl-steps">
        <summary className="sr-only" data-testid="ghl-connect-open">Connect GoHighLevel</summary>
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <ConnectBox copy={GHL_COPY} testId="ghl-howto">
            <GhlScopeRows scopes={GHL_SCOPES} />
            <p className="mt-3 text-xs text-ink-3">{GHL_COPY.after}</p>
          </ConnectBox>
          <GhlConnectForm action={connectGhlAction} locationId={conn?.locationId ?? ""} hasToken={Boolean(conn?.manualToken)} ghlUserId={conn?.ghlUserId ?? ""} />
        </div>
      </details>
    </div>
  );
}

/**
 * "Which user are you?" (rev 850): a pick from the account's users when the key can read them (users.readonly), else the typed
 * User ID with where to find it. Keys made before users.readonly was on the list get the typed field.
 */
function UserField({ users, current, testId, required = true }: { users: { id: string; name: string }[]; current: string; testId: string; required?: boolean }) {
  if (users.length) {
    const known = users.some((u) => u.id === current);
    return (
      <select className="field max-w-xs" name="ghlUserId" defaultValue={current} required={required} data-testid={testId}>
        <option value="">Pick yourself</option>
        {!known && current ? <option value={current}>The saved user ({current})</option> : null}
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <span className="block">
      <input className="field max-w-xs" name="ghlUserId" defaultValue={current} placeholder="Your GHL user ID" required={required} data-testid={testId} />
      <span className="mt-0.5 block text-xs text-ink-3">{GHL_HELP.user}</span>
    </span>
  );
}
