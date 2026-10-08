import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ConfirmDelete } from "@/components/confirm-delete";
import { requireViewer } from "@/lib/auth";
import { deleteDeckImageAction, updateDeckImageCaptionAction } from "@/lib/actions/deck-images";
import { DeckImageUpload } from "@/components/deck-image-upload";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { NO_PEOPLE } from "@/lib/engine/deck-image";
import { SubmitButton } from "@/components/submit-button";

export const metadata = { title: "Images" };

const KIND_LABEL: Record<string, string> = { photo: "Photo", screenshot: "Screenshot", proof: "Proof", logo: "Logo", graphic: "Graphic", diagram: "Diagram" };
/** Cards per page (friction walk IM1, 7 Oct: 607 thumbnails at once froze the browser for 45 seconds). */
const IMAGES_PAGE_SIZE = 48;

/**
 * The coach's own image library for their decks: photos, screenshots, proof images, logos, graphics and diagrams, uploaded once
 * and reused across webinars. Every image here is the coach's own upload; nothing is generated or fetched. A screenshot or proof
 * image carries a recorded consent tick with who is in it (or that no people are) and when, the same promise the proof store
 * already keeps. The pictures fill the suggested slots on the Deck step; a slot left empty exports with a red placeholder. The
 * list is server-rendered and the upload refreshes the route after its record is written, so a new card appears without a
 * reload (deck visuals brief §5). A photo's thumbnail is cropped to the card; every other kind is shown whole.
 */
export default async function ImagesPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; page?: string }> }) {
  const v = await requireViewer({ team: "allow" });
  const sp = await searchParams;
  const all = await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id)), orderBy: (t, { desc }) => [desc(t.createdAt)] });
  // Search by caption or who is in it, one kind at a time, a page of 48 (friction walk IM1 step 2).
  const q = (sp.q ?? "").trim().toLowerCase();
  const kind = sp.kind && sp.kind in KIND_LABEL ? sp.kind : "";
  const matching = all.filter((img) => (!kind || img.kind === kind) && (!q || `${img.caption ?? ""} ${img.consentName ?? ""} ${KIND_LABEL[img.kind]}`.toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(matching.length / IMAGES_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const images = matching.slice((page - 1) * IMAGES_PAGE_SIZE, page * IMAGES_PAGE_SIZE);
  const pageHref = (n: number) => `/images?${new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(n > 1 ? { page: String(n) } : {}) }).toString()}`;
  return (
    <>
      <PageHeader title="Images" subtitle="Your own photos, screenshots, proof images, logos, graphics and diagrams, uploaded once and reused across every deck. A picture fills a suggested slot on the Deck step; a slot left empty exports with a red placeholder." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <Card title="Add an image">
          <DeckImageUpload workspaceId={v.workspace.id} userId={v.user.id} />
          <p className="mt-3 text-xs text-ink-3">A screenshot or a proof image needs one tick: that you&apos;ve hidden anyone&apos;s name, email or number who hasn&apos;t agreed to be shown, or that no people are in it. It&apos;s stored with who and when. A photo is cropped to fill its frame; a screenshot, proof, logo, graphic or diagram is shown whole.</p>
        </Card>
        <Card title={`Your library · ${all.length}`}>
          {all.length ? (
            <form className="mb-3 flex flex-wrap items-center gap-2" data-testid="images-filter">
              <input className="field w-auto flex-1 py-1 text-sm" name="q" defaultValue={q} placeholder="Search captions" aria-label="Search captions" data-testid="images-search" />
              <select className="field w-auto py-1 text-sm" name="kind" defaultValue={kind} aria-label="Kind" data-testid="images-kind">
                <option value="">Every kind</option>
                {Object.entries(KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <SubmitButton className="btn btn-soft btn-sm" pendingText="Looking…">Find</SubmitButton>
              {q || kind ? <Link href="/images" className="text-xs underline" data-testid="images-clear">Clear</Link> : null}
              <span className="text-xs text-ink-3" data-testid="images-count">{matching.length === all.length ? `${all.length} in all` : `${matching.length} of ${all.length}`}</span>
            </form>
          ) : null}
          {all.length === 0 ? (
            <Empty title="Nothing here yet" hint="Add a photo, a screenshot, a proof image, your logo, a graphic or a diagram." />
          ) : images.length === 0 ? (
            <Empty title="Nothing matches" hint="Try another word, or every kind." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="image-library">
              {images.map((img) => (
                <div key={img.id} className="rounded-lg border border-line p-2 text-sm" data-testid="library-image" data-kind={img.kind}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/deck-images/${img.id}`} alt={img.caption ?? KIND_LABEL[img.kind]} className={`mb-2 h-32 w-full rounded ${img.kind === "photo" ? "object-cover" : "object-contain bg-surface-2"}`} loading="lazy" decoding="async" data-testid="library-image-thumb" />
                  <div className="flex items-center justify-between">
                    <Badge>{KIND_LABEL[img.kind] ?? img.kind}</Badge>
                    <span className="text-[11px] text-ink-3">{formatDate(img.createdAt.slice(0, 10))}</span>
                  </div>
                  <form action={updateDeckImageCaptionAction} className="mt-2 flex gap-1">
                    <input type="hidden" name="id" value={img.id} />
                    <input className="field flex-1" name="caption" defaultValue={img.caption ?? ""} placeholder="Caption" data-testid="library-image-caption" />
                    <SubmitButton className="btn btn-ghost btn-xs" pendingText="Saving…">Save</SubmitButton>
                  </form>
                  {img.consentTick ? (
                    <p className="mt-1 text-[11px] text-ink-3" data-testid="library-image-consent">
                      {img.consentName === NO_PEOPLE ? "No people in it, confirmed" : `Consent recorded: ${img.consentName},`}{img.consentAt ? ` ${formatDate(img.consentAt.slice(0, 10))}` : ""}.
                    </p>
                  ) : null}
                  <form action={deleteDeckImageAction} className="mt-2 text-right">
                    <input type="hidden" name="id" value={img.id} />
                    <ConfirmDelete what="this image" undo="It comes off every slide that uses it. This can't be undone." label="Delete" className="btn btn-ghost btn-xs text-danger" testId="library-image-delete" />
                  </form>
                </div>
              ))}
            </div>
          )}
          {pages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-sm" data-testid="images-pager">
              {page > 1 ? <Link href={pageHref(page - 1)} className="btn btn-ghost btn-sm" data-testid="images-prev">← Newer</Link> : <span />}
              <span className="text-xs text-ink-3">Page {page} of {pages}</span>
              {page < pages ? <Link href={pageHref(page + 1)} className="btn btn-ghost btn-sm" data-testid="images-next">Older →</Link> : <span />}
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
