import { ItemGone } from "@/components/item-gone";

/** Not in this workspace, or never there: the same plain line either way, with the way back to the coach's Recordings. */
export default function NotFound() {
  return <ItemGone what="This recording" href="/coach/recordings" list="Recordings" />;
}
