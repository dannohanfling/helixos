import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { composerContext } from "@/lib/queries/compose";
import { Composer } from "@/components/composer";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "New post" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ hook?: string; body?: string; title?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const c = await composerContext(v);
  return (
    <>
      <PageHeader title="New post" subtitle={<Link href="/content" className="hover:underline">← Content</Link>} />
      <Composer {...c} initial={{ title: sp.title, hook: sp.hook, body: sp.body }} />
    </>
  );
}
