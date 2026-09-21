import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { deleteDeckImageAction, updateDeckImageCaptionAction } from "@/lib/actions/deck-images";
import { DeckImageUpload } from "@/components/deck-image-upload";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Images" };

const KIND_LABEL: Record<string, string> = { photo: "Photo", screenshot: "Screenshot", proof: "Proof", logo: "Logo" };

/**
 * The coach's own image library for their decks: photos, screenshots, proof images and logos, uploaded once and reused across
 * webinars. Every image here is the coach's own upload; nothing is generated or fetched. A screenshot or proof image carries a
 * recorded consent tick with who is in it and when, the same promise the proof store already keeps. The pictures fill the
 * suggested slots on the Deck step; a slot left empty exports as the slide's text.
 */
export default async function ImagesPage() {
  const v = await requireViewer();
  const images = await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id)), orderBy: (t, { desc }) => [desc(t.createdAt)] });
  return (
    <>
      <PageHeader title="Images" subtitle="Your own photos, screenshots, proof images and logos, uploaded once and reused across every deck. A picture fills a suggested slot on the Deck step; a slot left empty exports as text." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <Card title="Add an image">
          <DeckImageUpload workspaceId={v.workspace.id} userId={v.user.id} />
          <p className="mt-3 text-xs text-ink-3">A screenshot or a proof image needs one tick: that you&apos;ve hidden anyone&apos;s name, email or number who hasn&apos;t agreed to be shown. It&apos;s stored with who and when.</p>
        </Card>
        <Card title={`Your library · ${images.length}`}>
          {images.length === 0 ? (
            <Empty title="Nothing here yet" hint="Add a photo, a screenshot, a proof image or your logo." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="image-library">
              {images.map((img) => (
                <div key={img.id} className="rounded-lg border border-line p-2 text-sm" data-testid="library-image" data-kind={img.kind}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/deck-images/${img.id}`} alt={img.caption ?? KIND_LABEL[img.kind]} className="mb-2 h-32 w-full rounded object-cover" data-testid="library-image-thumb" />
                  <div className="flex items-center justify-between">
                    <Badge>{KIND_LABEL[img.kind] ?? img.kind}</Badge>
                    <span className="text-[11px] text-ink-3">{formatDate(img.createdAt.slice(0, 10))}</span>
                  </div>
                  <form action={updateDeckImageCaptionAction} className="mt-2 flex gap-1">
                    <input type="hidden" name="id" value={img.id} />
                    <input className="field flex-1" name="caption" defaultValue={img.caption ?? ""} placeholder="Caption" data-testid="library-image-caption" />
                    <button className="btn btn-ghost btn-xs" type="submit">Save</button>
                  </form>
                  {img.consentTick ? (
                    <p className="mt-1 text-[11px] text-ink-3" data-testid="library-image-consent">
                      Consent recorded: {img.consentName}{img.consentAt ? `, ${formatDate(img.consentAt.slice(0, 10))}` : ""}.
                    </p>
                  ) : null}
                  <form action={deleteDeckImageAction} className="mt-2 text-right">
                    <input type="hidden" name="id" value={img.id} />
                    <button className="btn btn-ghost btn-xs text-danger" type="submit" data-testid="library-image-delete">Delete</button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
