/** The shape of Tasks while it loads (H-1674): see src/components/page-skeleton.tsx. */
import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton shape="list" />;
}
