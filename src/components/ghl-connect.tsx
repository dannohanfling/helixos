import type { SocialConnection } from "@/db/schema";
import { connectGhlAction, disconnectGhlAction, refreshGhlAccountsAction, setGhlMappingAction } from "@/lib/actions/social";
import { PUBLISHABLE, candidates, readiness } from "@/lib/engine/ghl-map";
import { REQUIRED_SCOPES } from "@/lib/ghl";
import { CHANNEL_SPECS, type Channel } from "@/lib/engine/repurpose";
import { formatDateTime } from "@/lib/dates";
import { Badge, Field } from "./ui";

/** A member connects their own GoHighLevel sub-account with a location-level Private Integration token. Used on Settings. */
export function GhlConnect({ conn, tz }: { conn: SocialConnection | null; tz: string }) {
  const ready = conn ? readiness(conn.mapping) : { mapped: 0, total: 5 };
  const connected = Boolean(conn && conn.accounts.length && !conn.lastError);
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
            Tick these six scopes and nothing else: <code className="text-xs">{REQUIRED_SCOPES.join(", ")}</code>.
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
        <Field label="Your GHL user ID (optional)" hint="Posts show as created by this user. Settings → My Staff → your profile.">
          <input className="field" name="ghlUserId" defaultValue={conn?.ghlUserId ?? ""} placeholder="Lx1EI6YIgQYMQi0ytFXv" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Private Integration token" hint={conn?.manualToken ? "A token is saved. Paste a new one only to replace it." : "Starts with pit-. Stored encrypted; never shown again here."}>
            <input className="field" name="manualToken" type="password" autoComplete="off" placeholder={conn?.manualToken ? "•••••••• saved" : "pit-…"} />
          </Field>
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <button className="btn btn-primary btn-sm" type="submit">
            {conn ? "Save and check" : "Connect and check"}
          </button>
          <span className="text-xs text-ink-3">Saving asks GoHighLevel for your connected pages, so you&apos;ll know right away if the token or location is wrong.</span>
        </div>
      </form>
      {conn ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={conn.lastError ? "danger" : connected ? "good" : "neutral"}>{conn.lastError ? "not connected" : connected ? `connected · ${conn.accounts.length} accounts` : "no accounts yet"}</Badge>
            {connected ? <span className="text-ink-3">{ready.mapped}/{ready.total} channels will auto-publish</span> : null}
            {conn.lastSyncAt && !conn.lastError ? <span className="text-ink-3">· checked {formatDateTime(conn.lastSyncAt, tz)}</span> : null}
            <form action={refreshGhlAccountsAction} className="ml-auto">
              <button className="btn btn-ghost btn-xs" type="submit">
                Check again
              </button>
            </form>
            <form action={disconnectGhlAction}>
              <button className="text-ink-3 underline" type="submit">
                Disconnect
              </button>
            </form>
          </div>
          {conn.lastError ? (
            <p className="rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="ghl-error">
              {conn.lastError}
            </p>
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
                <button className="btn btn-soft btn-xs" type="submit">
                  Save channel map
                </button>
                <span className="text-[11px] text-ink-3">Personal profile, other people&apos;s groups, Threads, Skool and email stay copy-and-paste. That&apos;s a platform limit, not ours.</span>
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
