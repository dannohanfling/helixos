import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addPaymentAction, addTouchAction, saveRestaurantAction } from "@/lib/actions/partner";
import { CANCEL_REASONS, PAYMENT_PLANS, RESTAURANT_PLANS, RESTAURANT_SOURCES, RESTAURANT_STAGES, RESTAURANT_TYPES, RISKS, TOUCH_CHANNELS, TOUCH_WHO, WALLETPUSH_STATUSES } from "@/lib/engine/partner";
import { PARTNER_PAYMENT_STATUSES } from "@/db/schema";
import { paymentsFor, restaurantById, touchesFor } from "@/lib/partner";

export const metadata = { title: "Partner Program" };

const DATES: [string, string][] = [["firstContactAt", "First contact"], ["demoAt", "Demo"], ["signedAt", "Signed"], ["paidAt", "Paid"], ["formCompleteAt", "Form complete"], ["handedToWalletpushAt", "Handed to WalletPush"], ["liveAt", "Live"], ["featuredInGroupAt", "Featured in the group"], ["setupApprovedAt", "Setup approved by Danno"], ["cancelledAt", "Cancelled"], ["resultsAsOf", "Results as of"], ["termsAcceptedAt", "Terms accepted"]];
const TEXTS: [string, string][] = [["address", "Address"], ["businessPhone", "Business phone"], ["website", "Website"], ["facebookPage", "Facebook page"], ["instagram", "Instagram"], ["ownerContact", "Owner contact (private)"], ["brandColors", "Brand colors"], ["hours", "Hours"], ["menuLink", "Menu link"], ["googleBusinessProfile", "Google Business Profile"], ["reservationLink", "Reservation link"], ["reward", "Reward"], ["welcomeReward", "Welcome reward"], ["restaurantContactForMessages", "Contact for messages"]];
const AREAS: [string, string][] = [["conciergeVoice", "Concierge voice"], ["topCustomerQuestions", "Top customer questions"], ["directoryCard", "Directory card"], ["walletpushNote", "WalletPush note"], ["notes", "Notes"]];
const money = (n: number) => `$${n.toFixed(2)}`;

function Select({ name, value, options, blank, testId }: { name: string; value: string | null; options: readonly string[]; blank?: string; testId?: string }) {
  return (
    <select className="field w-full" name={name} defaultValue={value ?? ""} data-testid={testId}>
      {blank ? <option value="">{blank}</option> : null}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
const L = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => (
  <label className={`text-sm ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}><span className="block text-xs text-ink-3">{label}</span>{children}</label>
);

/** One restaurant (H-1361): every field editable, its touches and payments, the setup promise and check-in it's under. */
export default async function PartnerRestaurantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; touched?: string; paid?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const coach = await requireCoach();
  const W = coach.workspace.id;
  const r = await restaurantById(W, id, coach.today);
  if (!r) return <Empty icon="🍽️" title="That restaurant isn't in your Partner Program" action={<Link href="/coach/partners" className="btn btn-soft">Back to the program</Link>} />;
  const [touches, payments] = await Promise.all([touchesFor(W, r.id), paymentsFor(W, r.id)]);
  const str = (k: string) => (r as unknown as Record<string, unknown>)[k];
  const v = (k: string) => String(str(k) ?? "");
  return (
    <>
      <PageHeader title={r.business} subtitle={<Link href="/coach/partners" className="hover:underline">← Partner Program</Link>} />
      {sp.error ? <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" data-testid="partner-error">{sp.error}</p> : null}
      {sp.saved ? <p className="mb-4 text-sm text-ink-2" data-testid="partner-saved">Saved.</p> : null}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="partner-standing">
        <Badge tone="accent">{r.stage}</Badge>
        <Badge tone={r.derived.setupPromise === "OVERDUE" ? "danger" : r.derived.setupPromise === "kept" ? "good" : "neutral"}>setup: {r.derived.setupPromise}</Badge>
        {r.derived.checkinDue ? <Badge tone={r.derived.checkinOverdue ? "danger" : "neutral"}>check-in due {r.derived.checkinDue}</Badge> : null}
        {r.risk !== "none" ? <Badge tone="warn">{r.risk}</Badge> : null}
      </div>

      <Card title="The restaurant" className="mb-4" id="edit">
        <form action={saveRestaurantAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="partner-edit-form">
          <input type="hidden" name="id" value={r.id} />
          <L label="Business"><input className="field w-full" name="business" defaultValue={r.business} required maxLength={120} data-testid="partner-business" /></L>
          <L label="Type"><Select name="type" value={r.type} options={RESTAURANT_TYPES} /></L>
          <L label="City"><input className="field w-full" name="city" defaultValue={r.city ?? ""} maxLength={80} /></L>
          <L label="Source"><Select name="source" value={r.source} options={RESTAURANT_SOURCES} blank="(not set)" /></L>
          <L label="Referred by"><input className="field w-full" name="referredBy" defaultValue={r.referredBy ?? ""} maxLength={120} /></L>
          <L label="Stage"><Select name="stage" value={r.stage} options={RESTAURANT_STAGES} testId="partner-stage" /></L>
          <L label="Plan"><Select name="plan" value={r.plan} options={RESTAURANT_PLANS} blank="(not set)" /></L>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="foundingPartner" value="1" defaultChecked={r.foundingPartner} /> Founding partner</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="featureConsent" value="1" defaultChecked={r.featureConsent} /> Consent to be featured</label>
          {DATES.map(([k, label]) => <L key={k} label={label}><input className="field w-full" type="date" name={k} defaultValue={v(k)} data-testid={`partner-${k}`} /></L>)}
          <L label="WalletPush status"><Select name="walletpushStatus" value={r.walletpushStatus} options={WALLETPUSH_STATUSES} testId="partner-walletpush" /></L>
          <L label="Risk"><Select name="risk" value={r.risk} options={RISKS} testId="partner-risk" /></L>
          <L label="Cancel reason"><Select name="cancelReason" value={r.cancelReason} options={CANCEL_REASONS} blank="(none)" /></L>
          <L label="Google reviews at start"><input className="field w-full" name="googleReviewsAtStart" inputMode="numeric" defaultValue={v("googleReviewsAtStart")} /></L>
          <L label="Google rating at start"><input className="field w-full" name="googleRatingAtStart" inputMode="decimal" defaultValue={v("googleRatingAtStart")} /></L>
          <L label="Pass holders"><input className="field w-full" name="passHolders" inputMode="numeric" defaultValue={v("passHolders")} data-testid="partner-pass-holders" /></L>
          <L label="Reviews gained"><input className="field w-full" name="reviewsGained" inputMode="numeric" defaultValue={v("reviewsGained")} /></L>
          <L label="Concierge chats"><input className="field w-full" name="conciergeChats" inputMode="numeric" defaultValue={v("conciergeChats")} /></L>
          <L label="Next step"><input className="field w-full" name="nextStep" defaultValue={r.nextStep ?? ""} maxLength={300} data-testid="partner-next-step" /></L>
          <L label="Next step date"><input className="field w-full" type="date" name="nextStepDate" defaultValue={r.nextStepDate ?? ""} /></L>
          {TEXTS.map(([k, label]) => <L key={k} label={label}><input className="field w-full" name={k} defaultValue={v(k)} maxLength={300} data-testid={`partner-${k}`} /></L>)}
          {AREAS.map(([k, label]) => <L key={k} label={label} wide><textarea className="field w-full" name={k} rows={3} defaultValue={v(k)} /></L>)}
          <div className="sm:col-span-2 lg:col-span-3"><SubmitButton className="btn btn-primary" pendingText="Saving…" data-testid="partner-save">Save</SubmitButton></div>
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Touches" id="touches">
          <form action={addTouchAction} className="mb-3 grid gap-2 sm:grid-cols-2" data-testid="touch-form">
            <input type="hidden" name="restaurantId" value={r.id} />
            <L label="Date"><input className="field w-full" type="date" name="date" defaultValue={coach.today} /></L>
            <L label="Who"><Select name="who" value="Danno" options={TOUCH_WHO} /></L>
            <L label="Channel"><Select name="channel" value="DM" options={TOUCH_CHANNELS} testId="touch-channel" /></L>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="firstConversation" value="1" /> First conversation</label>
            <L label="Note" wide><textarea className="field w-full" name="note" rows={2} maxLength={2000} data-testid="touch-note" /></L>
            <L label="Next step"><input className="field w-full" name="nextStep" maxLength={300} data-testid="touch-next-step" /></L>
            <L label="Next step date"><input className="field w-full" type="date" name="nextStepDate" /></L>
            <div className="sm:col-span-2"><SubmitButton className="btn btn-soft" pendingText="Logging…" data-testid="touch-add">Log the touch</SubmitButton>{sp.touched ? <span className="ml-2 text-sm text-ink-2">Logged.</span> : null}</div>
          </form>
          {touches.length ? (
            <ul className="divide-y text-sm" data-testid="touch-list">
              {touches.map((t) => (
                <li key={t.id} className="py-2" data-testid="touch-row">
                  <div className="text-xs text-ink-3">{t.date} · {t.who} · {t.channel}{t.firstConversation ? " · first conversation" : ""}</div>
                  {t.note ? <div>{t.note}</div> : null}
                  {t.nextStep ? <div className="text-ink-2">Next: {t.nextStep}{t.nextStepDate ? ` (${t.nextStepDate})` : ""}</div> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">No touches logged yet.</p>
          )}
        </Card>
        <Card title="Payments" id="payments">
          <form action={addPaymentAction} className="mb-3 grid gap-2 sm:grid-cols-2" data-testid="payment-form">
            <input type="hidden" name="restaurantId" value={r.id} />
            <L label="Date"><input className="field w-full" type="date" name="date" defaultValue={coach.today} data-testid="payment-date" /></L>
            <L label="Plan"><Select name="plan" value="monthly" options={PAYMENT_PLANS} testId="payment-plan" /></L>
            <L label="Amount"><input className="field w-full" name="amount" inputMode="decimal" required data-testid="payment-amount" /></L>
            <L label="Tax"><input className="field w-full" name="tax" inputMode="decimal" /></L>
            <L label="Fees deducted"><input className="field w-full" name="feesDeducted" inputMode="decimal" data-testid="payment-fees" /></L>
            <L label="Status"><Select name="status" value="paid" options={PARTNER_PAYMENT_STATUSES} testId="payment-status" /></L>
            <L label="Processor"><input className="field w-full" name="processor" maxLength={60} /></L>
            <L label="Month (YYYY-MM)"><input className="field w-full" type="month" name="month" data-testid="payment-month" /></L>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="promo" value="1" data-testid="payment-promo" /> Promo (earns no payout)</label>
            <L label="Note"><input className="field w-full" name="note" maxLength={500} /></L>
            <div className="sm:col-span-2"><SubmitButton className="btn btn-soft" pendingText="Recording…" data-testid="payment-add">Record the payment</SubmitButton>{sp.paid ? <span className="ml-2 text-sm text-ink-2">Recorded. Nothing is charged from here.</span> : null}</div>
          </form>
          {payments.length ? (
            <table className="w-full text-sm" data-testid="payment-list">
              <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">Date</th><th>Plan</th><th className="text-right">Amount</th><th>Status</th><th>Month</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t" data-testid="payment-row" data-status={p.status}>
                    <td className="py-1">{p.date}</td><td>{p.plan}{p.promo ? " (promo)" : ""}</td><td className="text-right tabular-nums">{money(p.amount)}</td><td>{p.status}</td><td>{p.month}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-ink-3">No payments on file.</p>
          )}
        </Card>
      </div>
    </>
  );
}
