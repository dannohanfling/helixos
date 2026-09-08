import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { composerContext } from "@/lib/queries/compose";
import { Composer } from "@/components/composer";
import { PageHeader } from "@/components/ui";
import { libraryPostFor } from "@/lib/queries/library-posts";

export const metadata = { title: "New post" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ hook?: string; body?: string; title?: string; from?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const [c, from] = await Promise.all([composerContext(v), sp.from ? libraryPostFor(sp.from, v.workspace.id, v.user.id) : null]);
  // A library entry's CTA lands in the CTA field, never folded into the body: each channel version places it once at render.
  const initial = from
    ? { title: from.kind === "post" || from.kind === "pattern" ? from.title : "", hook: from.hook ?? "", body: from.kind === "cta" ? "" : from.body, cta: from.cta ?? (from.kind === "cta" ? from.body : ""), hasCta: from.hasCta, contentType: from.contentType ?? undefined }
    : { title: sp.title, hook: sp.hook, body: sp.body };
  return (
    <>
      <PageHeader title="New post" subtitle={<span className="flex gap-2"><Link href="/content" className="hover:underline">← Content</Link>{from ? <span className="text-ink-3">· starting from “{from.title}”</span> : null}</span>} />
      <Composer {...c} initial={initial} />
    </>
  );
}
