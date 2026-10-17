import type { schema } from "@/db";
import { FilePicker } from "@/components/file-picker";
import { IdReportButton } from "@/components/leaderboard/id-report-button";
import { SubmitButton } from "@/components/submit-button";
import { clearPointsCheckAction, runPointsCheckAction } from "@/lib/actions/leaderboard";
import { fmt } from "@/lib/engine/leaderboard";
import { countsLine } from "@/lib/engine/points-check";
import { readPointsCheck } from "@/lib/points-check";

/**
 * The points check on a client's /coach row (H-102, H-112): the one-time upload of their Community Loyalty export, and the
 * last result, opened from its sealed copy: counts first, then the table of members as "First L." with the two balances,
 * the difference, the last change eLoyalty recorded and the suggested number with its reason. Coach only; nothing here
 * writes to either system.
 */
export function PointsCheck({ feed, error }: { feed: schema.LeaderboardFeed; error?: string }) {
  const snap = readPointsCheck(feed);
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  return (
    <details className="basis-full mt-1" id={`leaderboard-${feed.id}`} open={Boolean(snap) || Boolean(error)} data-testid="points-check">
      <summary className="cursor-pointer text-ink-3">Points check{snap ? ` · ${when(snap.at)}` : ""}</summary>
      <form action={runPointsCheckAction} className="mt-1 flex flex-wrap items-center gap-1" encType="multipart/form-data">
        <input type="hidden" name="id" value={feed.id} />
        <FilePicker kind="file" name="export" accept=".csv,.tsv,.txt,text/csv,text/plain" testId="points-check-file" labels={{ upload: "Choose the export" }} />
        <SubmitButton className="btn btn-ghost btn-xs" pendingText="Comparing…" data-testid="points-check-run">
          Compare with eLoyalty
        </SubmitButton>
        <IdReportButton />
        {snap ? (
          <SubmitButton className="btn btn-ghost btn-xs" pendingText="Clearing…" formAction={clearPointsCheckAction} data-testid="points-check-clear">
            Clear
          </SubmitButton>
        ) : null}
      </form>
      <p className="mt-1 text-[11px] text-ink-3">The Community Loyalty bot-user export (CSV) is read here once and thrown away; only this table stays, sealed. Reads only: nothing is changed in eLoyalty or Community Loyalty. The id report is the same comparison with customer ids in place of names, downloaded to you and never kept here.</p>
      {error ? (
        <p className="mt-1 text-xs text-danger" data-testid="points-check-error">
          {error.slice(0, 300)}
        </p>
      ) : null}
      {snap ? (
        <div className="mt-2" data-testid="points-check-result">
          <p className="text-xs" data-testid="points-check-counts">
            <strong>{countsLine(snap.counts)}.</strong> Templates read: {snap.templates.join(", ")}. {snap.counts.historyFor} with a last change. {snap.note}
          </p>
          <p className="text-[11px] text-ink-3">
            Export: {snap.clRows} rows, {snap.rows.filter((r) => r.matchedBy).length + snap.clOnly.length} pass-linked; columns found: {Object.entries(snap.columns).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}.
          </p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-[11px]" data-testid="points-check-table">
              <thead>
                <tr className="text-left text-ink-3">
                  <th className="pr-2">Member</th>
                  <th className="pr-2">Matched by</th>
                  <th className="pr-2 text-right">eLoyalty</th>
                  <th className="pr-2 text-right">CL copy</th>
                  <th className="pr-2 text-right">Difference</th>
                  <th className="pr-2 text-right">KK Bank</th>
                  <th className="pr-2">Last change (eLoyalty)</th>
                  <th className="pr-2 text-right">Suggested</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {snap.rows.map((r, i) => (
                  <tr key={i} className={r.hidden ? "text-ink-3" : r.diff ? "text-warn" : ""} data-hidden={r.hidden ? "yes" : undefined}>
                    <td className="pr-2 whitespace-nowrap">
                      {r.name}
                      {r.hidden ? " (test)" : ""}
                    </td>
                    <td className="pr-2">{r.matchedBy ?? "no CL record"}</td>
                    <td className="pr-2 text-right">{fmt(r.eloyalty)}</td>
                    <td className="pr-2 text-right">{r.cl == null ? "—" : fmt(r.cl)}</td>
                    <td className="pr-2 text-right">{r.diff == null ? "—" : r.diff > 0 ? `+${fmt(r.diff)}` : fmt(r.diff)}</td>
                    <td className="pr-2 text-right">{r.kkBank == null ? "—" : fmt(r.kkBank)}</td>
                    <td className="pr-2 whitespace-nowrap">{r.lastChange ? `${when(r.lastChange.at)} · ${r.lastChange.amount == null ? "" : `${r.lastChange.amount > 0 ? "+" : ""}${fmt(r.lastChange.amount)} · `}${r.lastChange.by}` : "unknown"}</td>
                    <td className="pr-2 text-right font-semibold">{fmt(r.suggested)}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {snap.clOnly.length ? (
            <p className="mt-1 text-[11px]" data-testid="points-check-cl-only">
              <strong>In Community Loyalty with a pass field but no eLoyalty match ({snap.clOnly.length}):</strong> {snap.clOnly.map((u) => `${u.name} (CL ${u.cl == null ? "—" : fmt(u.cl)}, Bank ${u.kkBank == null ? "—" : fmt(u.kkBank)}${u.hasCustomerId ? "" : ", no customer id"})`).join("; ")}.
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
