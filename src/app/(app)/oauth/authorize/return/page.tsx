import Link from "next/link";
import { verifyValue } from "@/lib/crypto";
import { hostOf } from "@/lib/engine/mcp";
import { Card, PageHeader } from "@/components/ui";
import { GoTo } from "@/components/go-to";

export const metadata = { title: "Back to the app" };

/**
 * After consent: the browser is sent on to the app's registered address with the code (or the decline). It goes through this
 * page, by script, because the page's Content-Security-Policy binds where a form may send the browser and an app's address is
 * not this site. The address is signed by the action that built it, so nothing else can be pasted in here.
 */
export default async function ReturnPage({ searchParams }: { searchParams: Promise<{ to?: string; sig?: string }> }) {
  const { to = "", sig = "" } = await searchParams;
  const ok = Boolean(to && sig && verifyValue(to, sig));
  return (
    <>
      <PageHeader title={ok ? "Back to the app" : "Nothing to return to"} />
      <Card>
        {ok ? (
          <>
            <p className="text-sm">Sending you back to <strong>{hostOf(to)}</strong>. If nothing happens, press the link.</p>
            <a href={to} className="mt-3 inline-block text-sm underline" data-testid="return-link">
              Continue to {hostOf(to)}
            </a>
            <GoTo href={to} />
          </>
        ) : (
          <p className="text-sm" data-testid="return-bad">
            This page needs the app&apos;s own signed address. <Link href="/connect" className="underline">Start again from the app.</Link>
          </p>
        )}
      </Card>
    </>
  );
}
