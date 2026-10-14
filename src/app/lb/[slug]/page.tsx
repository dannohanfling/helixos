import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Board } from "@/components/leaderboard/board";
import { pageFor } from "@/lib/leaderboard";

/**
 * A client's hosted leaderboard by its feed address (H-28): the held board, else their pasted export, else the design's sample
 * people marked Sample, rendered on the server so the first paint carries the numbers. Never a call to eLoyalty from here.
 */
export const dynamic = "force-dynamic";

const okSlug = (s: string) => /^[a-z0-9-]{3,60}$/.test(s);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const model = okSlug(slug) ? await pageFor(slug) : null;
  return { title: { absolute: model?.config.headline || "Leaderboard" }, description: model?.config.intro || undefined };
}

export default async function LeaderboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const model = okSlug(slug) ? await pageFor(slug) : null;
  if (!model) notFound();
  return <Board model={model} />;
}
