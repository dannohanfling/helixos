import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { dismissHeadshotAction, importHeadshotsAction, pickHeadshotAction } from "@/lib/actions/headshots";
import { HEADSHOT_IMPORT, REASON_WORDS } from "@/lib/engine/headshots";
import { hasHeadshot } from "@/lib/headshots";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { MemberAvatar } from "@/components/member-avatar";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Client headshots" };

/**
 * Client headshots from Airtable (Danno, 8 Oct): the coach's import, dry run first, then apply; and the review list of photos
 * that matched no client, or more than one, or had no email, each with its photo and a pick. Never a guess.
 */
export default async function HeadshotsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await requireCoach();
  const sp = await searchParams;
  const [members, reviews] = await Promise.all([
    db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), isNull(schema.memberships.removedAt)) }),
    db.query.headshotReviews.findMany({ where: and(eq(schema.headshotReviews.workspaceId, v.workspace.id), eq(schema.headshotReviews.status, "open")), orderBy: [desc(schema.headshotReviews.createdAt)] }),
  ]);
  const users = members.length ? await db.query.users.findMany({ where: inArray(schema.users.id, members.map((m) => m.userId)), columns: { id: true, name: true, avatarEmoji: true } }) : [];
  const userOf = new Map(users.map((u) => [u.id, u]));
  const clients = members.map((m) => ({ m, u: userOf.get(m.userId) })).sort((a, b) => (a.u?.name ?? "").localeCompare(b.u?.name ?? ""));
  const withPhoto = clients.filter((c) => hasHeadshot(c.m)).length;
  return (
    <>
      <PageHeader title="Client headshots" subtitle={`${withPhoto} of ${clients.length} clients have a photo. A client's own upload always wins over the import.`} action={<Link href="/coach" className="btn btn-ghost btn-sm">← Coach view</Link>} />
      <Card id="import" className="mb-4" title="From Airtable" action={<span className="text-xs text-ink-3">read-only; the token is used for this run only</span>}>
        {sp.error ? <p className="mb-3 rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="headshots-error">{sp.error}</p> : null}
        {sp.dry ? <p className="mb-3 rounded-lg bg-surface-2 p-2 text-sm" role="status" data-testid="headshots-dry">Dry run, nothing written: {sp.line}{Number(sp.reviewNew) ? ` ${sp.reviewNew} of those to review are new.` : ""}</p> : null}
        {sp.applied ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="headshots-applied">Applied: {sp.matched} matched ({sp.stored} stored, {sp.unchanged} unchanged, {sp.kept} kept the client&apos;s own), {sp.review} new to review, {sp.noHeadshot} no headshot{Number(sp.failed) ? `, ${sp.failed} could not be downloaded (run it again)` : ""}.</p> : null}
        {sp.picked ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="headshots-picked">Photo set for that client.</p> : null}
        <form action={importHeadshotsAction} className="grid gap-3 sm:grid-cols-3" data-testid="headshots-form">
          <Field label="Base">
            <input className="field" name="baseId" defaultValue={HEADSHOT_IMPORT.baseId} data-testid="headshots-base" />
          </Field>
          <Field label="Table">
            <input className="field" name="tableId" defaultValue={HEADSHOT_IMPORT.tableId} data-testid="headshots-table" />
          </Field>
          <Field label="Airtable token" hint="Read-only. Used for this run, never stored or shown again.">
            <input className="field" name="token" type="password" autoComplete="off" required data-testid="headshots-token" />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <SubmitButton className="btn btn-soft btn-sm" name="mode" value="dry" pendingText="Reading…" data-testid="headshots-dry-run">Dry run</SubmitButton>
            <SubmitButton className="btn btn-primary btn-sm" name="mode" value="apply" pendingText="Downloading and storing…" data-testid="headshots-apply">Apply</SubmitButton>
          </div>
        </form>
        <p className="mt-2 text-xs text-ink-3">Fulfillment: the first Headshot attachment, the Name, and the Email matched to each client&apos;s sign-in email. A photo inside HelixOS is not consent to publish it: proof cards, ads and graphics keep their own gate.</p>
      </Card>
      <Card title={`To review · ${reviews.length}`} action={<span className="text-xs text-ink-3">pick the client, or dismiss</span>}>
        {reviews.length ? (
          <ul className="divide-y" data-testid="headshots-review">
            {reviews.map((r) => {
              const candidates = r.candidates.length ? clients.filter((c) => r.candidates.includes(c.m.id)) : clients;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="headshots-review-row" data-reason={r.reason}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private, coach-only route */}
                  <img src={`/api/headshots/review/${r.id}`} alt={r.name || "Headshot"} width={56} height={56} className="h-14 w-14 rounded-full object-cover" />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium" data-testid="headshots-review-name">{r.name || "No name in Airtable"}</div>
                    <div className="text-xs text-ink-3"><Badge tone="warn">{REASON_WORDS[r.reason]}</Badge></div>
                  </div>
                  <form action={pickHeadshotAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <select className="field w-56 py-1 text-xs" name="membershipId" defaultValue="" required aria-label="Pick the client" data-testid="headshots-review-pick">
                      <option value="">Pick the client…</option>
                      {candidates.map((c) => (
                        <option key={c.m.id} value={c.m.id}>{c.u?.name ?? "Member"}{c.m.headshotSource === "upload" ? " (has their own photo)" : ""}</option>
                      ))}
                    </select>
                    <SubmitButton className="btn btn-soft btn-xs" pendingText="Setting…" data-testid="headshots-review-set">Set</SubmitButton>
                  </form>
                  <form action={dismissHeadshotAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="…" data-testid="headshots-review-dismiss">Dismiss</SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">Nothing waiting.</p>
        )}
      </Card>
      <Card className="mt-4" title="Clients">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="headshots-clients">
          {clients.map((c) => (
            <li key={c.m.id} className="flex items-center gap-2 text-sm" data-testid="headshots-client" data-member={c.m.id} data-source={c.m.headshotSource ?? ""}>
              <MemberAvatar membershipId={c.m.id} hasPhoto={hasHeadshot(c.m)} emoji={c.u?.avatarEmoji} size={36} version={c.m.headshotUpdatedAt} name={c.u?.name} />
              <span className="truncate">{c.u?.name}</span>
              <span className="text-xs text-ink-3">{c.m.headshotSource === "upload" ? "their own" : c.m.headshotSource === "import" ? "from Airtable" : c.m.headshotSource === "removed" ? "removed by them" : "no photo"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
