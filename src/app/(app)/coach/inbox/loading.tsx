/** The shape of the Inbox while it loads (H-1674): see src/components/page-skeleton.tsx. */
import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton shape="list" />;
}
