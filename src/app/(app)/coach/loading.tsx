/** The shape of the coach's pages while they load (H-1674), the client list first: see src/components/page-skeleton.tsx. */
import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton shape="table" />;
}
