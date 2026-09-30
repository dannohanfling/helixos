import { ItemGone } from "@/components/item-gone";

/**
 * Never this person's (exercises are archived, not deleted), or Body is off for them: a plain line that names nothing of Body,
 * since a member whose Body is off must find none of it (rev 195), and the way back to Today.
 */
export default function NotFound() {
  return <ItemGone what="This page" href="/today" list="Today" />;
}
