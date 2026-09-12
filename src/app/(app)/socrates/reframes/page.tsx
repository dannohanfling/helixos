import { requireViewer } from "@/lib/auth";
import { PRINCIPLES, reframesByGroup } from "@/lib/engine/socrates";
import { ReframeLibrary } from "@/components/reframe-library";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Reframe library" };

/** Grouped by the objection in front of you: at the Diffuse step you choose from the few that fit, not a flat list. The posture principles sit apart. */
export default async function ReframesPage() {
  await requireViewer();
  return (
    <>
      <PageHeader title="Reframe library" subtitle="Clarify → Discuss → Diffuse. At Diffuse, pick from the group that matches the objection." />
      <ReframeLibrary groups={reframesByGroup()} principles={PRINCIPLES} />
    </>
  );
}
