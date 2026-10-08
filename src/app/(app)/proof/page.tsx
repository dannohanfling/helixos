import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { PROOF_TYPES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import {
  createProofAction,
  importProofsFromAirtableAction,
  proofFromCheckinAction,
} from "@/lib/actions/proofs";
import { PROOF_IMPORT, importSummary, tagRank } from "@/lib/engine/proof-import";
import {
  Badge,
  Card,
  Disclosure,
  Empty,
  Field,
  PageHeader,
} from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { fathomKeyFor } from "@/lib/fathom";
import { attachmentsForProofs } from "@/lib/queries/proof-attachments";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Proof Bank" };

const TYPE_LABEL: Record<string, string> = {
  result: "Result",
  testimonial: "Testimonial",
  screenshot: "Screenshot",
  case_study: "Case study",
  stat: "Stat",
  story: "Story",
};

export default async function ProofPage({ searchParams }: { searchParams: Promise<{ tag?: string; imported?: string; skipped?: string; dropped?: string; importError?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const [allRows, checkins, clients] = await Promise.all([
    db.query.proofs.findMany({
      where: eq(schema.proofs.userId, v.user.id),
      orderBy: desc(schema.proofs.createdAt),
    }),
    db.query.clientCheckins.findMany({
      where: eq(schema.clientCheckins.userId, v.user.id),
      orderBy: desc(schema.clientCheckins.date),
      limit: 40,
    }),
    db.query.clientRecords.findMany({
      where: eq(schema.clientRecords.userId, v.user.id),
    }),
  ]);
  const fathom = await fathomKeyFor(v.workspace.id, v.user.id);
  // Tags (Danno's Proof Bank from Airtable, 8 Oct): Results & Revenue, Sales Wins and Transformation first, then the rest by
  // date; one tag filters the list. A bank with no tags reads as before.
  const tagCounts = new Map<string, number>();
  for (const r of allRows) for (const t of r.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tag = sp.tag && tagCounts.has(sp.tag) ? sp.tag : "";
  const rows = allRows.filter((r) => !tag || r.tags.includes(tag)).sort((a, b) => tagRank(a.tags) - tagRank(b.tags));
  const importNote = sp.imported !== undefined ? importSummary(Number(sp.imported) || 0, Number(sp.skipped) || 0, Number(sp.dropped) || 0) : null;
  const thumb = new Map<
    string,
    { id: string; displayKey: string | null; altText: string | null }
  >();
  for (const a of await attachmentsForProofs(rows.map((r) => r.id)))
    if (a.kind === "image" && !thumb.has(a.proofId)) thumb.set(a.proofId, a);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const captured = new Set(rows.map((r) => r.resultAfter));
  const wins = checkins
    .filter((k) => k.wins && !captured.has(k.wins))
    .slice(0, 6);
  const approved = allRows.filter((r) => r.status === "approved").length;
  const grandfathered = allRows.filter(
    (r) => r.status === "approved" && !r.permissionAt,
  ).length;
  return (
    <>
      <PageHeader
        title="Proof Bank"
        subtitle={
          <span>
            Your clients&apos; results. {allRows.length} proofs · {approved}{" "}
            approved to use
            {grandfathered ? (
              <span data-testid="grandfathered-count">
                {" "}
                ({grandfathered} approved before the permission tick; they stay
                approved)
              </span>
            ) : null}
            . Every win your clients get is a post, a webinar slide, and an
            objection answer.
          </span>
        }
      />
      {v.role === "coach" ? (
        <Card id="import" className="mb-4" title="Import from Airtable">
          {importNote ? <p className="mb-3 rounded-lg bg-good-soft p-2 text-sm" role="status" data-testid="proof-import-note">{importNote}</p> : null}
          {sp.importError ? <p className="mb-3 rounded-lg bg-danger-soft p-2 text-sm" role="alert" data-testid="proof-import-error">{sp.importError}</p> : null}
          <Disclosure summary={<span className="btn btn-soft btn-sm" data-testid="proof-import-open">Import from Airtable</span>}>
            <form action={importProofsFromAirtableAction} className="mt-2 grid gap-3 sm:grid-cols-3" data-testid="proof-import-form">
              <Field label="Base">
                <input className="field" name="baseId" defaultValue={PROOF_IMPORT.baseId} data-testid="proof-import-base" />
              </Field>
              <Field label="Table">
                <input className="field" name="tableId" defaultValue={PROOF_IMPORT.tableId} data-testid="proof-import-table" />
              </Field>
              <Field label="Read-only token" hint="Used for this run only. Never stored, never shown back.">
                <input className="field" name="token" type="password" autoComplete="off" required data-testid="proof-import-token" />
              </Field>
              <p className="text-xs text-ink-3 sm:col-span-3">Every clip comes in approved (you hold permission for all of them), off your bot until you put it there, as first name and last initial, with its categories as tags. A row already here is skipped, so run it again when the backfill lands.</p>
              <div className="sm:col-span-3">
                <SubmitButton className="btn btn-primary btn-sm" pendingText="Reading the table…" data-testid="proof-import-run">
                  Import
                </SubmitButton>
              </div>
            </form>
          </Disclosure>
        </Card>
      ) : null}
      {tagCounts.size ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs" data-testid="proof-tag-filter">
          <Link href="/proof" className={`badge ${tag ? "" : "badge-accent"}`}>All · {allRows.length}</Link>
          {[...tagCounts.entries()].sort((a, b) => tagRank([a[0]]) - tagRank([b[0]]) || b[1] - a[1]).map(([t, n]) => (
            <Link key={t} href={`/proof?tag=${encodeURIComponent(t)}`} className={`badge ${tag === t ? "badge-accent" : ""}`}>{t} · {n}</Link>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          {rows.length ? (
            <Card title="Your proof">
              <ul className="divide-y">
                {rows.map((r) => {
                  const t = thumb.get(r.id);
                  return (
                    <li key={r.id} className="py-2.5" data-testid="proof-row">
                      <Link
                        href={`/proof/${r.id}`}
                        className="flex items-start gap-3 hover:underline"
                      >
                        {t ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element -- served by an authenticated route; next/image would fetch it without the session */}
                            <img
                              src={`/api/proofs/attachments/${t.id}${t.displayKey ? "?display=1" : ""}`}
                              alt={t.altText ?? ""}
                              className="mt-0.5 h-10 w-10 shrink-0 rounded object-cover"
                              data-testid="proof-thumb"
                            />
                          </>
                        ) : (
                          <span className="mt-0.5 text-lg">
                            {r.type === "testimonial"
                              ? "💬"
                              : r.type === "screenshot"
                                ? "📸"
                                : r.type === "case_study"
                                  ? "📚"
                                  : r.type === "stat"
                                    ? "📈"
                                    : r.type === "story"
                                      ? "📖"
                                      : "🏆"}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{r.name}</span>
                          <span className="block truncate text-sm text-ink-2">
                            {r.shortVersion ?? r.resultAfter ?? ""}
                          </span>
                          {r.tags.length ? (
                            <span className="mt-0.5 flex flex-wrap gap-1" data-testid="proof-tags">
                              {r.tags.map((t) => (
                                <span key={t} className="badge text-[10px]">{t}</span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex max-w-[45%] shrink-0 flex-col items-end gap-1 text-right">
                          <Badge
                            tone={r.status === "approved" ? "good" : "neutral"}
                          >
                            {r.status}
                          </Badge>
                          <span className="break-words text-[11px] text-ink-3">
                            {TYPE_LABEL[r.type]}
                            {r.beliefBroken !== "none"
                              ? ` · breaks ${r.beliefBroken} belief`
                              : ""}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : (
            <Card>
              <Empty
                icon="🏆"
                title="No proof yet"
                hint="Add a result, a testimonial or a screenshot. Or pull a win straight from a client check-in."
              />
            </Card>
          )}
          {wins.length ? (
            <Card
              title="Wins from client check-ins"
              action={
                <span className="text-xs text-ink-3">one click to capture</span>
              }
            >
              <ul className="space-y-2">
                {wins.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-start gap-3 rounded-lg bg-surface-2 p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-ink-3">
                        {clientName.get(k.clientRecordId) ?? "Client"} ·{" "}
                        {formatDate(k.date)}
                      </div>
                      <div>{k.wins}</div>
                    </div>
                    <form action={proofFromCheckinAction}>
                      <input type="hidden" name="checkinId" value={k.id} />
                      <SubmitButton className="btn btn-soft btn-xs" pendingText="Saving…">
                        Capture
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card
            title="🎙️ Harvest from Fathom"
            action={
              fathom ? (
                <Badge tone="good">connected</Badge>
              ) : (
                <Badge tone="neutral">not connected</Badge>
              )
            }
          >
            {fathom ? (
              <>
                <p className="text-sm text-ink-2">
                  Pick one of your recorded calls and pull your client&apos;s
                  own words out of it, word for word, with a link back to the
                  moment.
                </p>
                <Link
                  href="/proof/harvest"
                  className="btn btn-accent btn-sm mt-3 inline-block"
                  data-testid="harvest-link"
                >
                  Pick a recording →
                </Link>
              </>
            ) : (
              <p className="text-sm" data-testid="harvest-needs-key">
                Not connected.{" "}
                <Link href="/settings#fathom" className="underline">
                  Paste your Fathom API key in Settings
                </Link>{" "}
                to pick a recording and pull quotes from it.
              </p>
            )}
          </Card>
          <Card title="Add proof">
            <form action={createProofAction} className="space-y-3">
              <Field label="Name it">
                <input
                  className="field"
                  name="name"
                  required
                  placeholder="Sarah: 11 lbs by week 6"
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Type">
                  <select className="field" name="type" defaultValue="result">
                    {PROOF_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Who">
                  <input
                    className="field"
                    name="who"
                    placeholder="Sarah, mom of 2"
                  />
                </Field>
              </div>
              <Field label="Before (their words)">
                <input
                  className="field"
                  name="problemBefore"
                  placeholder="I quit every diet by week three."
                />
              </Field>
              <Field label="After">
                <input
                  className="field"
                  name="resultAfter"
                  placeholder="Down 11 lbs. Wine on Saturday. Still going."
                />
              </Field>
              <Disclosure
                summary={
                  <span className="text-xs text-ink-3 underline">
                    More (shift, belief, link, client)
                  </span>
                }
              >
                <div className="mt-2 space-y-3">
                  <Field label="What shifted">
                    <input
                      className="field"
                      name="shift"
                      placeholder="She stopped planning and started picking."
                    />
                  </Field>
                  <Field label="Belief it breaks">
                    <select
                      className="field"
                      name="beliefBroken"
                      defaultValue="none"
                    >
                      <option value="none">None in particular</option>
                      <option value="vehicle">
                        Vehicle: this method works
                      </option>
                      <option value="internal">Internal: I can do this</option>
                      <option value="external">
                        External: my life allows this
                      </option>
                    </select>
                  </Field>
                  <Field label="Link (screenshot, post, video)">
                    <input
                      className="field"
                      name="link"
                      type="url"
                      placeholder="https://…"
                    />
                  </Field>
                  <Field label="Client">
                    <select
                      className="field"
                      name="clientRecordId"
                      defaultValue=""
                    >
                      <option value="">Not linked</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </Disclosure>
              <label className="flex items-start gap-2 text-sm" data-testid="proof-permission">
                <input type="checkbox" name="permission" className="mt-1" />
                <span>This person has given me permission to use what they said here in my marketing. The same tick as on the Beliefs step; approval still happens on the proof&apos;s page.</span>
              </label>
              <SubmitButton className="btn btn-primary" pendingText="Saving…">
                Save proof
              </SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
