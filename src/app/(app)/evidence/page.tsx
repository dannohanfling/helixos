import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { addEvidenceAction, confirmEvidenceAction, hideSharedAction, proposeTermsAction, removeEvidenceAction, restoreSharedAction, searchEvidenceAction } from "@/lib/actions/evidence";
import { evidenceShelf } from "@/lib/queries/evidence";
import { EVIDENCE_DAILY_LIMIT, byCitations, flagsFor, insertText, isVerified, sharedAsEvidence } from "@/lib/engine/evidence";
import { CopyButton } from "@/components/copy-button";
import { AiFormStatus } from "@/components/ai-status";
import { AiPromise } from "@/components/ai-promise";
import { Badge, Card, Field, PageHeader } from "@/components/ui";

export const metadata = { title: "Evidence" };

/** The two studies under things HelixOS already does, named as the brief names them. */
const FEATURED: Record<string, string> = { s09: "Behind the pre-webinar activation videos", s13: "Behind the comment ladder" };

const cited = (n: number) => `cited ${n.toLocaleString()} times`;

/**
 * Evidence: published research, each client's own. The flow starts from the claim, not the query; OpenAlex answers server-side
 * on Danno's one key; nothing is citable until the client has seen what they asked for beside what came back and confirmed it.
 */
export default async function EvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const ai = await hasAiKey();
  const shelf = await evidenceShelf(v.user.id);
  const search = sp.search ? await db.query.evidenceSearches.findFirst({ where: and(eq(schema.evidenceSearches.id, sp.search), eq(schema.evidenceSearches.userId, v.user.id)) }) : null;
  const claim = sp.claim ?? search?.askedFor.claim ?? "";
  const terms = sp.terms ?? search?.query ?? "";
  const showTerms = Boolean(sp.terms);
  const verified = shelf.own.filter(isVerified).length;
  return (
    <>
      <PageHeader
        title="Evidence"
        subtitle={
          <span>
            Published research. {shelf.own.length} of your own ({verified} confirmed and citable) plus {shelf.shared.length} on the shared starter shelf. Your clients&apos; results live in the <Link href="/proof" className="underline">Proof Bank</Link>.
          </span>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" data-testid="evidence-error" role="alert">
          {sp.error}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Card title="Find research for a claim">
            <form action={proposeTermsAction} className="space-y-3" data-testid="claim-form">
              <Field label="The claim you want to support" hint="Plain words. The search starts from the claim, not from keywords.">
                <textarea className="field" name="claim" rows={2} defaultValue={claim} placeholder="Hypnotherapy helps people quit smoking." required />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Author, if you have a study in mind" hint="Optional. Used to flag a result that does not match.">
                  <input className="field" name="author" defaultValue={sp.author ?? ""} />
                </Field>
                <Field label="Year, if you have a study in mind" hint="Optional.">
                  <input className="field" name="year" inputMode="numeric" defaultValue={sp.year ?? ""} />
                </Field>
              </div>
              <AiPromise enabled={ai} needs="the search terms">Turns your claim into the terms a researcher would search, and names the effect and the field. Without a key, the claim&apos;s own words are used.</AiPromise>
              <div className="flex items-center gap-2">
                <button className="btn btn-accent" type="submit">{ai ? "✨ Propose search terms" : "Propose search terms"}</button>
                <AiFormStatus feature="evidence_terms" />
              </div>
            </form>
          </Card>
          {showTerms ? (
            <Card title="Search terms">
              <form action={searchEvidenceAction} className="space-y-3" data-testid="terms-form">
                <input type="hidden" name="claim" value={claim} />
                <input type="hidden" name="author" value={sp.author ?? ""} />
                <input type="hidden" name="year" value={sp.year ?? ""} />
                <input type="hidden" name="note" value={sp.note ?? ""} />
                <input type="hidden" name="proposed" value={sp.proposed ?? ""} />
                {sp.note ? <p className="text-sm" data-testid="terms-note">Look for: <span className="font-medium">{sp.note}</span></p> : null}
                {sp.proposed === "words" ? <p className="rounded-lg bg-warn-soft p-2 text-xs" data-testid="terms-fallback">No AI key is connected, so these are the claim&apos;s own words. Edit them into what a researcher would search before you run it.</p> : null}
                <Field label="Search terms" hint="Words that would appear in a study's title or abstract. Separate them with commas.">
                  <input className="field" name="terms" defaultValue={terms} data-testid="terms-input" />
                </Field>
                <p className="text-xs text-ink-3">{EVIDENCE_DAILY_LIMIT} searches a day per person; the key is shared by everyone here. The same terms searched again this week come from the cache.</p>
                <button className="btn btn-accent" type="submit">Find studies</button>
              </form>
            </Card>
          ) : null}
          {search ? (
            <Card title={`Results for “${search.askedFor.claim || search.query}”`} action={search.fromCache ? <Badge tone="neutral">from this week&apos;s cache</Badge> : null}>
              <p className="mb-2 text-xs text-ink-3">Terms: {search.query}. Most cited first. Citation count is the quality signal you can read; a flag means look closer, not no.</p>
              {search.results.length ? (
                <>
                <ul className="divide-y" data-testid="results">
                  {byCitations(search.results).map((r) => {
                    const added = shelf.own.find((e) => e.openalexId === r.openalexId);
                    const flags = flagsFor(search.askedFor, r);
                    return (
                      <li key={r.openalexId} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm" data-testid="result" data-cited={r.citedByCount} data-flagged={flags.length ? "1" : "0"}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{r.title}</div>
                          <div className="text-xs text-ink-2">
                            {r.authors || "Unknown authors"}{r.year ? ` · ${r.year}` : ""} · <span data-testid="cited">{cited(r.citedByCount)}</span>
                            {r.url ? (
                              <>
                                {" · "}
                                <a href={r.url} target="_blank" rel="noreferrer" className="underline">{r.doi}</a>
                              </>
                            ) : null}
                          </div>
                          {flags.map((f) => (
                            <div key={f} className="mt-1 text-xs text-warn" data-testid="result-flag">⚑ {f}</div>
                          ))}
                        </div>
                        {added ? (
                          <Badge tone={isVerified(added) ? "good" : "neutral"}>{isVerified(added) ? "on your shelf" : "on your shelf, unconfirmed"}</Badge>
                        ) : (
                          <form action={addEvidenceAction}>
                            <input type="hidden" name="searchId" value={search.id} />
                            <input type="hidden" name="openalexId" value={r.openalexId} />
                            <button className="btn btn-soft btn-sm" type="submit">Add to my shelf</button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-xs text-ink-3" data-testid="none-fitting">
                  {"None of these fitting is an answer too. A study that is close but not about your claim is worse than no study at all — it holds up right until someone reads it."}
                </p>
                </>
              ) : (
                <div className="space-y-2 text-sm text-ink-3" data-testid="no-results">
                  <p>Nothing came back for these terms.</p>
                  <p>{'That is a result, not a failure. Try the words a researcher would use rather than the words you would say to a client — "self-efficacy" rather than "confidence", "adherence" rather than "sticking with it".'}</p>
                </div>
              )}
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card title="My shelf" action={<Badge tone={verified ? "good" : "neutral"}>{verified} citable</Badge>}>
            <div id="shelf" />
            {shelf.own.length ? (
              <ul className="space-y-3" data-testid="own-shelf">
                {shelf.own.map((e) => (
                  <li key={e.id} className={`rounded-lg border p-3 text-sm ${isVerified(e) ? "" : "border-warn bg-warn-soft"}`} data-testid="own-study" data-quality={e.citationQuality} data-id={e.id}>
                    {isVerified(e) ? (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium">{e.claim}</div>
                            <div className="text-xs text-ink-2">
                              {e.authors}{e.year ? ` (${e.year})` : ""}. {e.title}. {cited(e.citedByCount)}.
                              {e.url ? (
                                <>
                                  {" "}
                                  <a href={e.url} target="_blank" rel="noreferrer" className="underline">{e.doi}</a>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <Badge tone="good">verified · citable</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <CopyButton text={insertText(e)} label="Copy claim + citation" className="btn btn-soft btn-xs" />
                          <form action={removeEvidenceAction}>
                            <input type="hidden" name="id" value={e.id} />
                            <button className="btn btn-ghost btn-xs" type="submit">Remove</button>
                          </form>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="mb-2 text-xs font-semibold">Not citable until you confirm this is the study you meant.</div>
                        <table className="w-full text-xs" data-testid="side-by-side">
                          <tbody>
                            <tr className="align-top">
                              <th className="w-24 pr-2 text-left font-semibold">You asked for</th>
                              <td>
                                {e.askedFor.claim}
                                {e.askedFor.author || e.askedFor.year ? <span className="block text-ink-2">{[e.askedFor.author, e.askedFor.year].filter(Boolean).join(", ")}</span> : null}
                                <span className="block text-ink-3">Terms: {e.askedFor.terms.join(", ")}</span>
                              </td>
                            </tr>
                            <tr className="align-top">
                              <th className="pr-2 text-left font-semibold">Found</th>
                              <td>
                                “{e.title}”{e.year ? ` — ${e.year}` : ""} — {cited(e.citedByCount)}
                                <span className="block text-ink-2">
                                  {e.authors}
                                  {e.url ? (
                                    <>
                                      {" · "}
                                      <a href={e.url} target="_blank" rel="noreferrer" className="underline">{e.doi}</a>
                                    </>
                                  ) : null}
                                </span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        {e.flags.map((f) => (
                          <div key={f} className="mt-1 text-xs text-warn" data-testid="study-flag">⚑ {f}</div>
                        ))}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <form action={confirmEvidenceAction}>
                            <input type="hidden" name="id" value={e.id} />
                            <button className="btn btn-accent btn-xs" type="submit" data-testid="confirm-study">Confirm: this is the study I meant</button>
                          </form>
                          <form action={removeEvidenceAction}>
                            <input type="hidden" name="id" value={e.id} />
                            <button className="btn btn-ghost btn-xs" type="submit">Not it, remove</button>
                          </form>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-2 text-sm text-ink-3" data-testid="shelf-empty">
                <p>Nothing here yet.</p>
                <p>
                  Write the claim you want to make, then search for the research behind it.
                  <br />
                  What you pick and confirm lands here.
                </p>
              </div>
            )}
          </Card>
          <Card title="Shared starter shelf" action={<Badge tone="neutral">shared · sourced by Evolve Omega</Badge>}>
            <div id="shared" />
            <p className="mb-2 text-xs text-ink-3">Not your evidence: Evolve Omega&apos;s, shared with every client and verified by DOI. Remove any of it from your shelf; nobody else&apos;s changes.</p>
            <ul className="space-y-2" data-testid="shared-shelf">
              {shelf.shared.map((s) => {
                const e = sharedAsEvidence(s);
                return (
                  <li key={s.id} className="rounded-lg border border-dashed bg-surface-2 p-3 text-sm" data-testid="shared-study" data-id={s.id}>
                    <div className="font-medium">
                      {s.name} {FEATURED[s.id] ? <Badge tone="accent">{FEATURED[s.id]}</Badge> : null}
                    </div>
                    <div className="text-ink-2">{s.shortSummary}</div>
                    <div className="text-xs text-ink-3">
                      {s.authorsSource} · “{s.verifiedTitle}” ({s.verifiedYear}) · {cited(s.citedByCount)} · <a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.doi}</a>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <CopyButton text={insertText(e)} label="Copy claim + citation" className="btn btn-soft btn-xs" />
                      <form action={hideSharedAction}>
                        <input type="hidden" name="sharedId" value={s.id} />
                        <button className="btn btn-ghost btn-xs" type="submit" data-testid="hide-shared">Remove from my shelf</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
            {shelf.removed.length ? (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-ink-3">{shelf.removed.length} removed from your shelf</summary>
                <ul className="mt-1 space-y-1">
                  {shelf.removed.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <span>{s.name}</span>
                      <form action={restoreSharedAction}>
                        <input type="hidden" name="sharedId" value={s.id} />
                        <button className="btn btn-ghost btn-xs" type="submit">Put back</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
        </div>
      </div>
      {/* The one place the source is named on a client's page: a quiet credit, the same principle as the Socrates attribution line. */}
      <p className="mt-6 text-xs text-ink-3" data-testid="evidence-credit">Results come from <a href="https://openalex.org" target="_blank" rel="noreferrer" className="underline">OpenAlex</a>, an open catalogue of scholarly work.</p>
    </>
  );
}
