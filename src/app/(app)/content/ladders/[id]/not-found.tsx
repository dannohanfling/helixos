import { ItemGone } from "@/components/item-gone";

/** Deleted, or never this person's: the same plain line either way, inside the app, with the way back to the list. */
export default function NotFound() {
  return <ItemGone what="This comment ladder" href="/content/ladders" list="your comment ladders" />;
}
