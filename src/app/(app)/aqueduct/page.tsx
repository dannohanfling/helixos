import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { aqueductFor } from "@/lib/aqueduct";
import { aqueductRepairFor } from "@/lib/aqueduct-repair";
import { setAqueductPeriodAction } from "@/lib/actions/aqueduct";
import { pct, count, PERIODS } from "@/lib/engine/aqueduct";
import { AqueductScene } from "@/components/aqueduct-scene";
import { SubmitButton } from "@/components/submit-button";
import "@/components/aqueduct.css";

export const metadata = { title: "The Aqueduct" };

/**
 * The Aqueduct (rev 711): the member's lead pipeline as a Roman aqueduct, the leak at their weakest step. The picture and the
 * live water on top, then the leak panel (or "holding"), then every stage with now, before and its step rate. Calm throughout.
 */
export default async function AqueductPage() {
  const v = await requireViewer();
  const a = await aqueductFor(v);
  const p = a.panel;
  const r = aqueductRepairFor(v, a);
  return (
    <div className="aq-page" data-testid="aqueduct">
      <header className="aq-head">
        <div>
          <p className="aq-eyebrow">Grow</p>
          <h1 className="aq-title">The Aqueduct</h1>
          <p className="aq-sub">Where your leads flow, and where they leak. The last {a.period} days against the {a.period} before.</p>
        </div>
        <form action={setAqueductPeriodAction} className="aq-period" aria-label="Period">
          <span>Compare</span>
          {PERIODS.map((d) => (
            <SubmitButton key={d} name="period" value={String(d)} className={`btn btn-sm ${a.period === d ? "btn-primary" : "btn-soft"}`} pendingText="…" aria-pressed={a.period === d} data-testid={`aqueduct-period-${d}`}>
              {d} days
            </SubmitButton>
          ))}
        </form>
      </header>
      <AqueductScene initialLook={a.look} initialPaused={a.paused} ownLook={!v.switchedInto} now={a.now} leak={a.leak} stepRates={a.stepRates} repair={r.repair} stamp={r.stamp} />
      {p ? (
        <section className="aq-panel" data-testid="aqueduct-leak" data-step={a.leak!.step}>
          <p className="aq-eyebrow">Where your water is leaking</p>
          <h2 data-testid="aqueduct-headline">About {p.n.toLocaleString()} {p.n === 1 ? "person" : "people"} slipped through this arch</h2>
          <p className="aq-detail" data-testid="aqueduct-detail">
            At {p.from} → {p.to}: {p.made.toLocaleString()} of {p.of.toLocaleString()} made it through ({p.nowPct}%). At your usual {p.wasPct}%, about {p.expected.toLocaleString()} would have.
          </p>
          <div className="aq-actions">
            <Link href={p.tool.href} className="btn btn-primary btn-sm" data-testid="aqueduct-repair">
              Repair this arch: {p.tool.name}
            </Link>
            <Link href={`/my-board?ask=${encodeURIComponent(p.question)}`} className="text-sm underline" data-testid="aqueduct-ask-board">
              Ask My Board how to fix it
            </Link>
          </div>
        </section>
      ) : (
        <section className="aq-panel" data-testid="aqueduct-holding">
          <p className="aq-eyebrow">Your aqueduct is holding</p>
          <h2>Every step held up against last period, and the fountain is full.</h2>
        </section>
      )}
      {a.missing ? (
        <p className="aq-quiet" data-testid="aqueduct-missing">
          {a.missing}
        </p>
      ) : null}
      <table id="aqueduct-table" className="aq-table" data-testid="aqueduct-table">
        <caption className="sr-only">Every stage</caption>
        <thead>
          <tr>
            <th>Stage</th>
            <th className="aq-num">Now</th>
            <th className="aq-num">Before</th>
            <th>Step rate</th>
          </tr>
        </thead>
        <tbody>
          {a.rows.map((r) => (
            <tr key={r.stage} className={r.leak ? "aq-leak" : undefined} data-testid="aqueduct-row" data-leak={r.leak ? "1" : "0"}>
              <td>{r.stage}</td>
              <td className="aq-num">{count(r.now)}</td>
              <td className="aq-num">{count(r.before)}</td>
              <td>{r.step === null ? (r.stage === "Comments" ? "per post" : "") : `${pct(r.rate)} (was ${pct(r.wasRate)})`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
