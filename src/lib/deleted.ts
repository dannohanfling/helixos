/**
 * After a delete, the person lands on the list the item came from with one short line saying what went ("Post deleted."), never
 * on the deleted item's own address. The action redirects with `?deleted=<kind>`; the notice in the app shell reads it, says the
 * line, and takes the parameter back off the address so a reload does not say it again. One table, so the words are the same
 * wherever a thing is deleted.
 */
export const DELETED_MESSAGES = {
  post: "Post deleted.",
  ladder: "Comment ladder deleted.",
  task: "Task deleted.",
  offer: "Offer deleted.",
  webinar: "Webinar deleted.",
  proof: "Proof deleted.",
  attachment: "File removed from this proof.",
  group: "Group deleted.",
  client: "Client removed. Their data is kept, and you can reinstate them from the Removed clients list.",
  record: "Client record deleted.",
  question: "Question deleted.",
  script: "Script deleted.",
  objection: "Objection deleted.",
  study: "Study removed from your shelf.",
  answer: "Answer removed from your Brief.",
  magnet: "Lead magnet deleted.",
  file: "File removed from this lead magnet.",
  image: "Image deleted.",
  library: "Library post deleted.",
  contact: "Conversation deleted.",
  key: "Key removed.",
  member: "Their account and everything they made in this workspace were deleted. The deletion is on the audit record, with no content.",
} as const;
export type DeletedKind = keyof typeof DELETED_MESSAGES;
export const isDeletedKind = (k: string | null | undefined): k is DeletedKind => Boolean(k && Object.hasOwn(DELETED_MESSAGES, k));

/** The list's address with the notice on it, before any #fragment: `/evidence#shelf` becomes `/evidence?deleted=study#shelf`. */
export function deletedTo(path: string, kind: DeletedKind): string {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}deleted=${kind}${hash ? `#${hash}` : ""}`;
}
