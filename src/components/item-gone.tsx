import Link from "next/link";

/**
 * What a detail page shows for an item that is not there: deleted, or never this person's. One plain line and the way back to
 * its list, inside the app's own layout. It says the same thing in both cases, so it tells nobody that someone else's item exists.
 */
export function ItemGone({ what, href, list }: { what: string; href: string; list: string }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center" data-testid="item-gone">
      <p className="text-lg font-semibold">{what} isn&apos;t here anymore.</p>
      <Link href={href} className="btn btn-soft btn-sm mt-4" data-testid="item-gone-back">
        Back to {list}
      </Link>
    </div>
  );
}
