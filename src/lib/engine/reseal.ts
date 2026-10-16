/**
 * Rotating ENCRYPTION_KEY without asking members for their keys again (H-349 §5): every sealed column, and what the re-seal
 * finds in each value. Pure; scripts/reseal.ts walks the database with it.
 */

/** Every column that holds a sealed value, by table and column, with the kind of value for the count lines. */
export const RESEAL_COLUMNS: { table: string; column: string; what: string; json?: boolean }[] = [
  { table: "memberships", column: "clApiToken", what: "Community Loyalty API tokens" },
  { table: "memberships", column: "clDripWebhookUrl", what: "Community Loyalty drip webhook addresses" },
  { table: "memberships", column: "clRungsWebhookUrl", what: "Community Loyalty rungs webhook addresses" },
  { table: "memberships", column: "passWebhookUrl", what: "pass webhook addresses" },
  { table: "aiCredentials", column: "keyEncrypted", what: "members' AI keys" },
  { table: "fathomConnections", column: "keyEncrypted", what: "members' Fathom keys" },
  { table: "fathomWorkspaceConnections", column: "keyEncrypted", what: "the coach's Fathom key" },
  { table: "fathomWorkspaceConnections", column: "webhookSecretEncrypted", what: "the Fathom webhook secret" },
  { table: "leaderboardFeeds", column: "keyEncrypted", what: "leaderboard feed keys" },
  { table: "leaderboardFeeds", column: "pointsCheckSealed", what: "points-check snapshots" },
  { table: "socialConnections", column: "manualToken", what: "GoHighLevel private integration tokens" },
  { table: "bodyDevices", column: "accessToken", what: "WHOOP access tokens" },
  { table: "bodyDevices", column: "refreshToken", what: "WHOOP refresh tokens" },
  { table: "integrations", column: "config", what: "integration secrets inside config", json: true },
];

export type SealState = "plain" | "old" | "new" | "unreadable";

/**
 * What one stored value is: not sealed at all (left alone), sealed under the old key (to re-seal), already under the new key
 * (nothing to do), or readable under neither (reported, never touched; the member is asked to paste it again).
 */
export function classifySealed(value: string | null | undefined, opensWithOld: boolean, opensWithNew: boolean): SealState {
  if (!value || !value.startsWith("enc:v1:")) return "plain";
  if (opensWithNew) return "new";
  if (opensWithOld) return "old";
  return "unreadable";
}

export type ResealCount = Record<SealState, number>;
export const emptyCount = (): ResealCount => ({ plain: 0, old: 0, new: 0, unreadable: 0 });

/** The one-line report for a column: "members' AI keys: 12 under the old key, 0 already new, 1 unreadable, 3 plain". */
export function countLine(what: string, c: ResealCount): string {
  return `${what}: ${c.old} under the old key, ${c.new} already new, ${c.unreadable} unreadable, ${c.plain} plain`;
}
