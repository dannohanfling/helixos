import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addAdjustmentAction, approvePayoutsAction, buildPayoutsAction, saveRestaurantAction } from "@/lib/actions/partner";
import { CHECKIN_DAYS, RESTAURANT_PLANS, RESTAURANT_SOURCES, RESTAURANT_STAGES, RESTAURANT_TYPES, SETUP_DAYS, statementTotal, type SetupPromise } from "@/lib/engine/partner";
import { payoutLinesFor, restaurantsFor } from "@/lib/partner";

export const metadata = { title: "Partner Program" };

const PROMISE_TONE: Record<SetupPromise, "neutral" | "accent" | "good" | "warn" | "danger"> = { "not handed": "neutral", "in window": "accent", "day 5 flag": "warn", late: "warn", OVERDUE: "danger", kept: "good" };
const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Coach → Partner Program (H-1307, plan H-1361): the restaurants by stage, the 7-day setup promise, the 30-day check-ins,
 * the ones at risk, and the month's statement that Danno builds from the payments on file and approves here. Business
 * names everywhere on this page; the owner's contact lives on the restaurant's own page.
 */
export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ month?: string; built?: string; kept?: string; approved?: string; error?: string; fees?: string }> }) {
  const sp = await searchParams;
  const coach = await requireCoach();
  const W = coach.workspace.id;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : coach.today.slice(0, 7);
  const [rows, lines] = await Promise.all([restaurantsFor(W, coach.today), payoutLinesFor(W, month)]);
  const names = new Map(rows.map((r) => [r.id, r.business]));
  const byStage = RESTAURANT_STAGES.map((s) => ({ stage: s, rows: rows.filter((r) => r.stage === s) })).filter((g) => g.rows.length);
  const promises = rows.filter((r) => r.handedToWalletpushAt && !r.liveAt && r.stage !== "cancelled");
  const checkins = rows.filter((r) => r.derived.checkinDue && r.stage !== "cancelled").sort((a, b) => (a.derived.checkinDue! < b.derived.checkinDue! ? -1 : 1));
  const atRisk = rows.filter((r) => r.risk !== "none" || r.stage === "at risk" || r.derived.setupPromise === "OVERDUE" || r.derived.checkinOverdue);
  const live = rows.filter((r) => r.stage === "live").length;
  const open = lines.filter((l) => !l.approvedByDannoAt);
  const total = statementTotal(lines);
  return (
    <>
      <PageHeader title="Partner Program" subtitle={<span>{rows.length} restaurant{rows.length === 1 ? "" : "s"}, {live} live</span>} />
      {sp.error ? <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" data-testid="partner-error">{sp.error}</p> : null}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="partner-stats">
        <Stat label="Restaurants" value={rows.length} />
        <Stat label="Live" value={live} />
        <Stat label="Setup promises open" value={promises.length} sub={`${SETUP_DAYS} days from handover`} />
        <Stat label="At risk" value={atRisk.length} />
      </div>

      <Card title="Pipeline" className="mb-4" id="pipeline">
        {rows.length ? (
          <div className="space-y-3" data-testid="partner-pipeline">
            {byStage.map((g) => (
              <div key={g.stage} data-testid="partner-stage" data-stage={g.stage}>
                <h3 className="mb-1 text-sm font-medium text-ink-2">{g.stage} <span className="text-ink-3">· {g.rows.length}</span></h3>
                <ul className="divide-y rounded-lg border">
                  {g.rows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-testid="partner-row" data-business={r.business}>
                      <Link href={`/coach/partners/${r.id}`} className="font-medium hover:underline">{r.business}</Link>
                      <span className="text-ink-3">{[r.type, r.city, r.plan, r.foundingPartner ? "founding partner" : null].filter(Boolean).join(" · ")}</span>
                      {r.nextStep ? <span className="text-ink-2">Next: {r.nextStep}{r.nextStepDate ? ` (${r.nextStepDate})` : ""}</span> : null}
                      {r.risk !== "none" ? <Badge tone="warn">{r.risk}</Badge> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="🍽️" title="No restaurants yet" hint="Add the first one below, or let Mercator add them through his token once you tick Partner Program tools on Coach → Agents." />
        )}
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title={`Setup promise (${SETUP_DAYS} days)`} id="setup">
          {promises.length ? (
            <ul className="divide-y text-sm" data-testid="partner-promises">
              {promises.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 py-2" data-testid="partner-promise" data-business={r.business} data-promise={r.derived.setupPromise}>
                  <Link href={`/coach/partners/${r.id}`} className="font-medium hover:underline">{r.business}</Link>
                  <Badge tone={PROMISE_TONE[r.derived.setupPromise]}>{r.derived.setupPromise}</Badge>
                  <span className="text-ink-3">handed {r.handedToWalletpushAt}, due {r.derived.setupDue}{r.derived.setupDays !== null ? `, day ${r.derived.setupDays}` : ""} · WalletPush: {r.walletpushStatus}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Nothing handed to WalletPush and waiting to go live.</p>
          )}
        </Card>
        <Card title={`${CHECKIN_DAYS}-day check-ins`} id="checkins">
          {checkins.length ? (
            <ul className="divide-y text-sm" data-testid="partner-checkins">
              {checkins.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 py-2" data-testid="partner-checkin" data-business={r.business} data-overdue={r.derived.checkinOverdue ? "1" : "0"}>
                  <Link href={`/coach/partners/${r.id}`} className="font-medium hover:underline">{r.business}</Link>
                  <span className="text-ink-3">due {r.derived.checkinDue}{r.resultsAsOf ? `, results as of ${r.resultsAsOf}` : ", no results logged yet"}</span>
                  {r.derived.checkinOverdue ? <Badge tone="danger">overdue</Badge> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">No live restaurant has a check-in due.</p>
          )}
        </Card>
      </div>

      <Card title="At risk" className="mb-4" id="risk">
        {atRisk.length ? (
          <ul className="divide-y text-sm" data-testid="partner-risk">
            {atRisk.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 py-2" data-business={r.business}>
                <Link href={`/coach/partners/${r.id}`} className="font-medium hover:underline">{r.business}</Link>
                <span className="text-ink-3">{[r.risk !== "none" ? r.risk : null, r.derived.setupPromise === "OVERDUE" ? "setup overdue" : null, r.derived.checkinOverdue ? "check-in overdue" : null, r.stage === "at risk" ? "stage: at risk" : null].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Nobody at risk.</p>
        )}
      </Card>

      <Card title="Monthly statement" className="mb-4" id="statement">
        <form action={buildPayoutsAction} className="mb-3 flex flex-wrap items-end gap-3" data-testid="statement-build-form">
          <label className="text-sm">
            <span className="block text-xs text-ink-3">Month</span>
            <input className="field" type="month" name="month" defaultValue={month} data-testid="statement-month" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="feesOffFirst" value="1" defaultChecked={sp.fees === "1"} data-testid="statement-fees" />
            Take processor fees off before the share
          </label>
          <SubmitButton className="btn btn-soft" pendingText="Building…" data-testid="statement-build">Build the statement</SubmitButton>
          {sp.built ? <span className="text-sm text-ink-2" data-testid="statement-built">{sp.built} line{sp.built === "1" ? "" : "s"} built, {sp.kept ?? 0} approved kept.</span> : null}
          {sp.approved ? <span className="text-sm text-ink-2" data-testid="statement-approved-note">{sp.approved} line{sp.approved === "1" ? "" : "s"} approved.</span> : null}
        </form>
        {lines.length ? (
          <>
            <table className="w-full text-sm" data-testid="statement-lines">
              <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">Restaurant</th><th>Kind</th><th className="text-right">Amount</th><th>Note</th><th>Approved</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t" data-testid="statement-line" data-kind={l.kind} data-approved={l.approvedByDannoAt ? "1" : "0"}>
                    <td className="py-1">{names.get(l.restaurantId) ?? "(removed)"}</td>
                    <td>{l.kind}{l.installment ? ` ${l.installment}/12` : ""}</td>
                    <td className="text-right tabular-nums">{money(l.amount)}</td>
                    <td className="text-ink-3">{l.note}</td>
                    <td>{l.approvedByDannoAt ? "✓" : ""}</td>
                  </tr>
                ))}
                <tr className="border-t font-medium"><td className="py-1">Total {month}</td><td /><td className="text-right tabular-nums" data-testid="statement-total">{money(total)}</td><td /><td /></tr>
              </tbody>
            </table>
            {open.length ? (
              <form action={approvePayoutsAction} className="mt-3">
                <input type="hidden" name="month" value={month} />
                <SubmitButton className="btn btn-primary" pendingText="Approving…" data-testid="statement-approve">Approve {open.length} line{open.length === 1 ? "" : "s"} for {month}</SubmitButton>
                <span className="ml-2 text-xs text-ink-3">Approving stamps the lines; nothing is paid from here.</span>
              </form>
            ) : (
              <p className="mt-3 text-sm text-ink-3" data-testid="statement-all-approved">Every line of {month} is approved.</p>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-3" data-testid="statement-empty">No lines for {month} yet. Build it from the payments on file.</p>
        )}
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-2">Add an adjustment line</summary>
          <form action={addAdjustmentAction} className="mt-2 flex flex-wrap items-end gap-3" data-testid="adjustment-form">
            <input type="hidden" name="month" value={month} />
            <label><span className="block text-xs text-ink-3">Restaurant</span>
              <select className="field" name="restaurantId" data-testid="adjustment-restaurant">{rows.map((r) => <option key={r.id} value={r.id}>{r.business}</option>)}</select>
            </label>
            <label><span className="block text-xs text-ink-3">Amount (negative takes back)</span><input className="field w-32" name="amount" inputMode="decimal" data-testid="adjustment-amount" /></label>
            <label className="grow"><span className="block text-xs text-ink-3">Note</span><input className="field w-full" name="note" maxLength={300} data-testid="adjustment-note" /></label>
            <SubmitButton className="btn btn-soft" pendingText="Adding…" data-testid="adjustment-add">Add the line</SubmitButton>
          </form>
        </details>
      </Card>

      <Card title="Add a restaurant" id="add">
        <form action={saveRestaurantAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="partner-add-form">
          <label className="text-sm sm:col-span-2 lg:col-span-1"><span className="block text-xs text-ink-3">Business</span><input className="field w-full" name="business" required maxLength={120} data-testid="partner-add-business" /></label>
          <label className="text-sm"><span className="block text-xs text-ink-3">Type</span><select className="field w-full" name="type" defaultValue="restaurant">{RESTAURANT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="text-sm"><span className="block text-xs text-ink-3">City</span><input className="field w-full" name="city" maxLength={80} /></label>
          <label className="text-sm"><span className="block text-xs text-ink-3">Source</span><select className="field w-full" name="source" defaultValue=""><option value="">(not set)</option>{RESTAURANT_SOURCES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="text-sm"><span className="block text-xs text-ink-3">Stage</span><select className="field w-full" name="stage" defaultValue="talking" data-testid="partner-add-stage">{RESTAURANT_STAGES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="text-sm"><span className="block text-xs text-ink-3">Plan</span><select className="field w-full" name="plan" defaultValue=""><option value="">(not set)</option>{RESTAURANT_PLANS.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="text-sm"><span className="block text-xs text-ink-3">First contact</span><input className="field w-full" type="date" name="firstContactAt" /></label>
          <label className="text-sm sm:col-span-2"><span className="block text-xs text-ink-3">Next step</span><input className="field w-full" name="nextStep" maxLength={300} /></label>
          <div className="sm:col-span-2 lg:col-span-3"><SubmitButton className="btn btn-primary" pendingText="Adding…" data-testid="partner-add">Add the restaurant</SubmitButton></div>
        </form>
      </Card>
    </>
  );
}
