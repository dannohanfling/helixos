import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { ItemGone } from "@/components/item-gone";
import { colosseumHref } from "@/components/colosseum-view";
import { TABS, type Tab } from "@/lib/engine/colosseum";

export const metadata = { title: "The Colosseum" };

/** Rewards and the Colosseum are one page with two tabs (H-164 §4): this address sends to the tab, section and filters kept. */
export default async function ColosseumPage({ searchParams }: { searchParams: Promise<{ tab?: string; tier?: string; kind?: string }> }) {
  const v = await requireViewer();
  if (!v.workspace.colosseumOn) return <ItemGone what="The Colosseum" href="/rewards" list="Rewards" />;
  const sp = await searchParams;
  const section: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "arena";
  const extra: Record<string, string> = {};
  if (sp.tier) extra.tier = sp.tier;
  if (sp.kind) extra.kind = sp.kind;
  redirect(colosseumHref(section, extra));
}
