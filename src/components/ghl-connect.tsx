import type { SocialConnection } from "@/db/schema";
import { connectGhlAction, disconnectGhlAction, refreshGhlAccountsAction, setGhlMappingAction } from "@/lib/actions/social";
import { PUBLISHABLE, candidates, readiness } from "@/lib/engine/ghl-map";
import { CHANNEL_SPECS, type Channel } from "@/lib/engine/repurpose";
import { formatDateTime } from "@/lib/dates";
import { Badge, Field } from "./ui";

/** Connect a member's GoHighLevel sub-account and map channels to its pages. Used on Settings (self) and Integrations (coach, per member). */
export function GhlConnect({ conn, forUserId, tz, compact = false }: { conn: SocialConnection | null; forUserId?: string; tz: string; compact?: boolean }) {
  const ready = conn ? readiness(conn.mapping) : { mapped: 0, total: 5 };
  const hidden = forUserId ? <input type="hidden" name="forUserId" value={forUserId} /> : null;
  return (
    <div className="space-y-3">
      <form action={connectGhlAction} className={`grid gap-2 ${compact ? "sm:grid-cols-[1fr_1fr_1fr_auto]" : "sm:grid-cols-2"}`}>
        {hidden}
        <Field label="Sub-account (location) ID" hint={compact ? undefined : conn?.coachAssigned && !forUserId ? "Assigned by your coach. To use a different sub-account, paste its private integration token." : "Settings → Business Profile in the client's sub-account"}>
          <input className="field" name="locationId" defaultValue={conn?.locationId ?? ""} required placeholder="ve9EPM428h8vShlRW1KT" readOnly={Boolean(conn?.coachAssigned && !forUserId && !conn?.manualToken)} />
        </Field>
        <Field label="GHL user ID" hint={compact ? undefined : "The sub-account user posts are created as (Settings → My Staff → the user's ID)"}>
          <input className="field" name="ghlUserId" defaultValue={conn?.ghlUserId ?? ""} placeholder="Lx1EI6YIgQYMQi0ytFXv" />
        </Field>
        <Field label="Private integration token (optional)" hint={compact ? undefined : "Leave blank to let the agency token mint one automatically"}>
          <input className="field" name="manualToken" type="password" autoComplete="off" placeholder={conn?.manualToken ? "•••••••• saved" : "pit-…"} />
        </Field>
        <div className="flex items-end gap-2">
          <button className="btn btn-primary btn-sm" type="submit">{conn ? "Save and refresh" : "Connect"}</button>
        </div>
      </form>
      {conn ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={conn.lastError ? "danger" : conn.accounts.length ? "good" : "neutral"}>{conn.lastError ? "error" : conn.accounts.length ? `${conn.accounts.length} accounts` : "no accounts yet"}</Badge>
            {conn.coachAssigned ? <span className="text-ink-3">· assigned by coach</span> : conn.manualToken ? <span className="text-ink-3">· own token</span> : null}
            <span className="text-ink-3">{ready.mapped}/{ready.total} channels will auto-publish</span>
            {conn.lastSyncAt ? <span className="text-ink-3">· checked {formatDateTime(conn.lastSyncAt, tz)}</span> : null}
            {conn.lastError ? <span className="text-danger">· {conn.lastError}</span> : null}
            <form action={refreshGhlAccountsAction} className="ml-auto">
              {hidden}
              <button className="btn btn-ghost btn-xs" type="submit">Refresh accounts</button>
            </form>
            <form action={disconnectGhlAction}>
              {hidden}
              <button className="text-ink-3 underline" type="submit">Disconnect</button>
            </form>
          </div>
          {conn.accounts.length ? (
            <form action={setGhlMappingAction} className="space-y-2">
              {hidden}
              <div className={`grid gap-2 ${compact ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-2"}`}>
                {(Object.keys(PUBLISHABLE) as Channel[])
                  .filter((c) => PUBLISHABLE[c].via)
                  .map((c) => {
                    const spec = CHANNEL_SPECS.find((s) => s.key === c)!;
                    const opts = candidates(c, conn.accounts);
                    return (
                      <label key={c} className="block">
                        <span className="label">{spec.icon} {spec.label}</span>
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
                <button className="btn btn-soft btn-xs" type="submit">Save channel map</button>
                <span className="text-[11px] text-ink-3">Personal profile, other people&apos;s groups, Threads, Skool and email stay copy-and-paste. That&apos;s a platform limit, not ours.</span>
              </div>
            </form>
          ) : (
            <p className="text-xs text-ink-3">No pages or profiles found. Connect Facebook, Instagram and LinkedIn inside the sub-account&apos;s Social Planner, then refresh.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
