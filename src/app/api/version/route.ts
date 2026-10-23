/**
 * The build this deploy runs (Speed 2): a tab left open across a deploy asks on its return, and moves to the new build with a
 * full page load on its next click instead of hanging on "Loading…". The short commit is already shown on What's new. Signed
 * in only (the proxy sends anyone else to the sign-in page), never cached.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ sha: process.env.HELIX_BUILD_SHA ?? "dev" }, { headers: { "cache-control": "no-store" } });
}
