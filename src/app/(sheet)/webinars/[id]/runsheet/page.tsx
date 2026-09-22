import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { contextFor } from "@/lib/queries/webinar";
import { runSheetText } from "@/lib/engine/webinar-context";
import { deckSlides, offSlidePlaceholders } from "@/lib/engine/deck";
import { RunSheetView } from "@/components/run-sheet";
import { CopyButton } from "@/components/copy-button";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Run sheet" };

/** The whole webinar in running order, read-only, with the clock: read off a second screen or a phone while presenting, or printed. */
export default async function RunSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.userId, v.user.id)) });
  if (!w) notFound();
  const c = await contextFor(w);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/webinars/${w.id}?step=run`} className="btn btn-ghost btn-sm">← Back to the builder</Link>
        <CopyButton text={runSheetText(c)} label="Copy the run sheet" className="btn btn-soft btn-sm" />
        <PrintButton />
      </div>
      <RunSheetView c={c} unfilled={offSlidePlaceholders(c, deckSlides(c, null))} />
    </>
  );
}
