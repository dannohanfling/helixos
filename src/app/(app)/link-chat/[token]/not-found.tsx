import { ItemGone } from "@/components/item-gone";

/** A link that never existed, or a malformed one: the same plain line as every missing item, with the way to Settings, where linked chats live. */
export default function NotFound() {
  return <ItemGone what="This link" href="/settings" list="your settings" />;
}
