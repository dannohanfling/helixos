import { headers } from "next/headers";
import { requireViewer } from "@/lib/auth";
import { appDevice, appLinks } from "@/lib/app-links";
import { hasAppFor } from "@/lib/queries/app-devices";
import { PageHeader, Card } from "@/components/ui";
import { GetAppSteps } from "@/components/pwa/get-app-steps";

export const metadata = { title: "Get the app" };

/**
 * Get the app (H-655): the steps for this phone to install HelixOS, from the links Danno sets (src/lib/app-links.ts). Every
 * member's own page, clients and coaches; not a team member's (they work in someone else's HelixOS). Coming soon until a link is set (H-731).
 */
export default async function GetTheAppPage() {
  const v = await requireViewer();
  const ua = (await headers()).get("user-agent") ?? "";
  const hasApp = v.switchedInto ? null : await hasAppFor(v.membership.id);
  return (
    <>
      <PageHeader title="Get the app" subtitle="HelixOS on your iPhone or Android" />
      <Card className="max-w-xl">
        <div data-testid="get-the-app">
          <GetAppSteps links={appLinks()} device={appDevice(ua)} hasApp={hasApp} />
        </div>
      </Card>
    </>
  );
}
