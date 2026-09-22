import Link from "next/link";

/** Any address that matches nothing, and a sheet whose item is gone: one plain line and a way back in, never a bare 404. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center" data-testid="item-gone">
      <p className="text-lg font-semibold">This page isn&apos;t here anymore.</p>
      <Link href="/today" className="btn btn-soft btn-sm mt-4" data-testid="item-gone-back">
        Back to HelixOS
      </Link>
    </div>
  );
}
