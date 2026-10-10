import { ItemGone } from "@/components/item-gone";

/** A feature key that isn't one of the eight: the same plain line as any missing record, with the way back to the cards. */
export default function NotFound() {
  return <ItemGone what="This feature" href="/bot-features" list="Bot Features" />;
}
