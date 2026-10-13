import { requireViewer } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ScrollToHash } from "@/components/scroll-to-hash";
import { GlossaryList } from "@/components/glossary-list";
import { glossaryFor } from "@/lib/glossary";
import { glossarySections } from "@/lib/engine/glossary";

export const metadata = { title: "Building with AI: the words" };

/** Building with AI: the words (rev 768): what the agents you build with mean, in plain English. Every member. */
export default async function GlossaryPage() {
  const v = await requireViewer();
  const sections = glossarySections(await glossaryFor(v.workspace.id)).map((s) => ({ heading: s.heading, entries: s.entries.map((e) => ({ slug: e.slug, term: e.term, meaning: e.meaning })) }));
  return (
    <>
      <ScrollToHash />
      <PageHeader title="Building with AI: the words" subtitle="What the agents you build with mean when they say these, in plain English." />
      <GlossaryList sections={sections} />
    </>
  );
}
