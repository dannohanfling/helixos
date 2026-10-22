/**
 * What a member sees the instant they tap a link, while the next page renders: the shape of a page with a moving gleam, not a
 * blank (H-1674). The shell (nav, bars) stays put; only the content area shows this. Pages with their own shape have their own
 * loading.tsx next to them.
 */
import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton shape="cards" />;
}
