import { Closed } from "@/components/hermes/closed";
import { coldView } from "@/lib/hermes/data";
import { isWebinarId } from "@/lib/hermes/rules";
import { formError, render, withinLimits } from "@/lib/hermes/view";

/** The cold page for ads: the webinar's default copy and an empty form. A past or closed webinar shows the member's next one. */
export const dynamic = "force-dynamic";

export default async function ColdPage({ params, searchParams }: { params: Promise<{ webinarId: string }>; searchParams: Promise<{ error?: string | string[] }> }) {
  const [{ webinarId }, { error }] = await Promise.all([params, searchParams]);
  if (!(await withinLimits(null))) return <Closed line="Too many visits just now. Please wait a minute and try again." />;
  if (!isWebinarId(webinarId)) return <Closed />;
  return render(await coldView(webinarId), { error: formError(error) });
}
