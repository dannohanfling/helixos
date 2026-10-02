import { ItemGone } from "@/components/item-gone";

/** Unpublished, or never published for this person: the same plain line either way, inside the app, with the way back to the list. */
export default function NotFound() {
  return <ItemGone what="This recording" href="/recordings" list="your recordings" />;
}
