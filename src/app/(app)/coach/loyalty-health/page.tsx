import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { healthRows } from "@/lib/loyalty-health";
import { checkAllAction, saveCertAction } from "@/lib/actions/loyalty-health";
import { agoWords, boardStale, certLevel, certWords, rateLimitsShown } from "@/lib/engine/loyalty-health";
import { Badge, Card, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Loyalty health" };

const CERT_TONE = { none: "neutral", ok: "good", amber: "warn", red: "danger", expired: "danger" } as const;
const ERRORS: Record<string, string> = {
  pass: "That Pass Type ID doesn't look right. It starts with pass., like pass.com.evolveomega.",
  date: "That date doesn't look right. Use the calendar, or type it as 2027-01-03.",
};

function checkedWords(raw: string): string | null {
  const m = /^(\d+)-(\d+)-(\d+)(-busy)?$/.exec(raw);
  if (!m) return null;
  const [, passed, failed, total, busy] = m;
  const tried = Number(passed) + Number(failed);
  return `Checked ${tried} of ${total}: ${passed} passed, ${failed} did not.${busy ? " eLoyalty said it was busy, so the check stopped there. Try again in a minute." : ""}`;
}

/**
 * Coach → Loyalty health (H-622 §2, plan H-734): one card per loyalty program on this account, the coach's own first. Every
 * number comes from HelixOS. The only call to eLoyalty is "Check all now", which runs the existing read-only check.
 */
export default async function LoyaltyHealthPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; checked?: string }> }) {
  const coach = await requireCoach();
  const sp = await searchParams;
  if (coach.switchedInto) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Loyalty health" />
        <Card>
          <p className="text-sm" data-testid="lh-switched">Switch back to your own HelixOS to see the loyalty programs.</p>
        </Card>
      </div>
    );
  }
  const now = new Date();
  const rows = await healthRows(coach.workspace.id, coach.membership.id, now);
  const checked = sp.checked ? checkedWords(sp.checked) : null;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Loyalty health"
        subtitle="Each loyalty program on your account: the connection, the board, the points outbox and the certificate."
        action={
          rows.length ? (
            <form action={checkAllAction}>
              <SubmitButton className="btn btn-ghost btn-sm" pendingText="Checking each one…" data-testid="lh-check-all">
                Check all now
              </SubmitButton>
            </form>
          ) : null
        }
      />
      {sp.saved === "cert" ? <p className="text-sm text-good" data-testid="lh-saved">Saved.</p> : null}
      {sp.error && ERRORS[sp.error] ? <p className="text-sm text-danger" data-testid="lh-error">{ERRORS[sp.error]}</p> : null}
      {checked ? <p className="text-sm" data-testid="lh-checked">{checked}</p> : null}
      {!rows.length ? (
        <Card>
          <p className="text-sm" data-testid="lh-empty">
            No program is connected yet. Connect one on a client&apos;s row on <Link href="/coach" className="underline">Coach</Link>, or your own under Your own program.
          </p>
        </Card>
      ) : null}
      {rows.map(({ feed, name, own, onBoard, outbox }) => {
        const level = certLevel(feed.certExpiresAt, now);
        const limits = rateLimitsShown(feed.rateLimitedCount, feed.rateLimitedAt, now);
        const backingOff = Boolean(feed.refreshAfter && Date.parse(feed.refreshAfter) > now.getTime());
        const stale = boardStale(feed.cachedAt, now);
        return (
          <Card key={feed.id} title={<span data-testid="lh-name">{name}{own ? " (your own program)" : ""}</span>} action={<span className="text-xs opacity-70">{feed.host.replace(/^https?:\/\//, "")}</span>}>
            <div className="space-y-2 text-sm" data-testid="lh-row">
              <p data-testid="lh-check">
                <span className="opacity-70">Key</span> ending {feed.keyLast4 ?? "?"} ·{" "}
                {feed.lastCheckOk ? <Badge tone="good">Check passed</Badge> : feed.lastCheckAt ? <Badge tone="danger">Check failed</Badge> : <Badge>Not checked yet</Badge>}{" "}
                <span className="opacity-70">{agoWords(feed.lastCheckAt, now)}</span>
                {feed.lastCheckNote ? <span className="block text-xs opacity-70">{feed.lastCheckNote}</span> : null}
              </p>
              <p data-testid="lh-board">
                <span className="opacity-70">Board</span> refreshed {agoWords(feed.cachedAt, now)}
                {stale ? <> <Badge tone="warn">Older than 30 minutes</Badge></> : null}
                {onBoard !== null ? <> · {onBoard} on it</> : null}
              </p>
              <p data-testid="lh-429">
                <span className="opacity-70">Busy answers (429) in 24 hours:</span> {limits}
                {backingOff ? <> <Badge tone="warn">Waiting a minute now</Badge></> : null}
              </p>
              <p data-testid="lh-outbox">
                <span className="opacity-70">Points outbox:</span> {outbox.waiting} waiting · {outbox.failed7} failed and {outbox.sent7} sent in 7 days
                {feed.movesPaused ? <> <Badge tone="warn">Paused</Badge></> : null}
                {outbox.last ? <span className="block text-xs opacity-70">Last move {agoWords(outbox.last.at, now)}: {outbox.last.status}{outbox.last.note ? `, ${outbox.last.note}` : ""}</span> : null}
              </p>
              <div data-testid="lh-cert">
                <p>
                  <span className="opacity-70">Certificate:</span> {feed.passTypeId ?? "no Pass Type ID yet"} · <Badge tone={CERT_TONE[level]}>{certWords(feed.certExpiresAt, now)}</Badge>
                </p>
                <form action={saveCertAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={feed.id} />
                  <input className="field min-w-40 flex-1 py-1 text-xs" name="passTypeId" defaultValue={feed.passTypeId ?? ""} placeholder="pass.com.example" aria-label="Pass Type ID" data-testid="lh-pass" />
                  <input className="field w-40 py-1 text-xs" type="date" name="certExpiresAt" defaultValue={feed.certExpiresAt ?? ""} aria-label="Certificate expires" data-testid="lh-expiry" />
                  <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…" data-testid="lh-cert-save">
                    Save
                  </SubmitButton>
                </form>
                <p className="mt-1 text-xs opacity-70">From the eLoyalty portal&apos;s Certificates page. Amber under 60 days, red under 14.</p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
