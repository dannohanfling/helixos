import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { assemble, callSheet, callSheetHtml, callSheetText } from "@/lib/engine/socrates";
import { fillsFor, ownScript, visibleQuestions } from "@/lib/queries/socrates";
import { CallSheetView } from "@/components/call-sheet";
import { CopyButton } from "@/components/copy-button";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Call sheet" };

/** The call sheet on its own: live on a screen beside the call, or printed. */
export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const s = await ownScript(id, v.user.id);
  if (!s) notFound();
  const assembled = assemble(s.beats, await visibleQuestions(v.user.id));
  const sheet = callSheet(s.name, s.scriptType, assembled, (await fillsFor(assembled, s.fills, v.user.id)).fills);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/socrates/scripts/${s.id}`} className="btn btn-ghost btn-sm">← Back to the builder</Link>
        <CopyButton text={callSheetText(sheet)} html={callSheetHtml(sheet)} label="Copy the call sheet" className="btn btn-soft btn-sm" />
        <PrintButton />
      </div>
      <CallSheetView sheet={sheet} />
    </>
  );
}
