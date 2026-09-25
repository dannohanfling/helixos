/**
 * Every row that is one member's own, in one list, read by the offboarding export and by deletion on request, so the two can
 * never cover different tables. src/lib/engine/__tests__/member-data.test.ts walks the schema and fails when a table is in none
 * of the lists below and not excluded with its reason: a table added later has to be placed here before anything ships.
 *
 * Three kinds of owned rows:
 * - member tables, keyed by (workspace, user): everything the member made in this workspace;
 * - child tables, which carry no owner of their own and hang off a member row (or another child) by id;
 * - user tables, keyed by the user alone, which follow the account: they go only when the user row goes, which is only when
 *   no membership in any other workspace remains.
 * Workspace tables belong to the workspace and go only with it, when its last member is deleted.
 */
import { getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "@/db/schema";

/** Keyed by (workspace, user). The label is the export's section name, kept from the export's first version where it had one. */
export const MEMBER_TABLES = {
  leads: schema.contacts,
  content: schema.contentItems,
  library_posts: schema.libraryPosts,
  library_entries: schema.libraryAssets,
  tasks: schema.tasks,
  goals: schema.goals,
  daily_logs: schema.dailyLogs,
  weekly_intentions: schema.weeklyIntentions,
  points: schema.pointsLedger,
  reward_claims: schema.rewardClaims,
  pathway_progress: schema.pathwayProgress,
  curriculum_progress: schema.curriculumProgress,
  lesson_progress: schema.lessonProgress,
  certification_submissions: schema.certSubmissions,
  offers: schema.offers,
  webinars: schema.webinars,
  client_records: schema.clientRecords,
  proofs: schema.proofs,
  groups: schema.groups,
  targets: schema.targets,
  sync_events: schema.syncEvents,
  // The eighteen the export missed until 24 Sep, less the three keyed by user alone (below).
  ai_credentials: schema.aiCredentials,
  ai_usage: schema.aiUsage,
  deck_images: schema.deckImages,
  drip_handoffs: schema.dripHandoffs,
  essences: schema.essences,
  evidence: schema.evidence,
  faq_entries: schema.faqEntries,
  faq_syncs: schema.faqSyncs,
  fathom_connections: schema.fathomConnections,
  ladder_profiles: schema.ladderProfiles,
  ladders: schema.ladders,
  lead_magnets: schema.leadMagnets,
  review_confirms: schema.reviewConfirms,
  socrates_questions: schema.socratesQuestions,
  socrates_scripts: schema.socratesScripts,
  social_connections: schema.socialConnections,
} as const;
export type MemberLabel = keyof typeof MEMBER_TABLES;

/** No owner column of their own: each row belongs to whoever owns its parent. Listed parents before children. */
export const CHILD_TABLES = [
  { label: "messages", table: schema.messages, fk: "contactId", parent: "leads" },
  { label: "content_versions", table: schema.contentVariants, fk: "contentItemId", parent: "content" },
  { label: "offer_components", table: schema.offerComponents, fk: "offerId", parent: "offers" },
  { label: "webinar_beliefs", table: schema.webinarBeliefs, fk: "webinarId", parent: "webinars" },
  { label: "webinar_sections", table: schema.webinarSections, fk: "webinarId", parent: "webinars" },
  { label: "deck_slots", table: schema.deckSlots, fk: "webinarId", parent: "webinars" },
  { label: "readiness_reviews", table: schema.readinessReviews, fk: "webinarId", parent: "webinars" },
  { label: "client_checkins", table: schema.clientCheckins, fk: "clientRecordId", parent: "client_records" },
  { label: "community_pass_points", table: schema.memberPoints, fk: "clientRecordId", parent: "client_records" },
  { label: "proof_attachments", table: schema.proofAttachments, fk: "proofId", parent: "proofs" },
  { label: "proof_attachment_reads", table: schema.proofAttachmentReads, fk: "attachmentId", parent: "proof_attachments" },
  { label: "lead_magnet_hits", table: schema.leadMagnetHits, fk: "magnetId", parent: "lead_magnets" },
  { label: "coach_notes", table: schema.coachNotes, fk: "membershipId", parent: "membership" },
  { label: "bot_approvals", table: schema.botApprovals, fk: "membershipId", parent: "membership" },
] as const;
export type ChildLabel = (typeof CHILD_TABLES)[number]["label"];

/** Keyed by the user alone: they follow the account, so they go only with the user row. */
export const USER_TABLES = {
  password_resets: schema.passwordResets,
  evidence_hidden: schema.evidenceHidden,
  evidence_searches: schema.evidenceSearches,
} as const;

/** Keyed by the workspace alone: they go only with the workspace, when its last member is deleted. */
export const WORKSPACE_TABLES = {
  brand_kits: schema.brandKits,
  integrations: schema.integrations,
  dm_templates: schema.dmTemplates,
  courses: schema.courses,
  files: schema.files,
} as const;

/** Tables that are no member's data, each with the reason; the coverage test needs every table placed somewhere. */
export const NOT_MEMBER_DATA: Record<string, string> = {
  users: "the account itself: removed last, and only when no membership in another workspace remains",
  memberships: "the membership itself: removed after everything that hangs off it (the export shows it as the profile)",
  workspaces: "removed only when its last member is deleted",
  pathway_stages: "the shared Success Pathway, the same for everyone",
  library_tasks: "the shared task library, the same for everyone",
  curriculum_days: "the shared curriculum, the same for everyone",
  principles: "the shared doctrine, the same for everyone",
  cert_modules: "the shared certification modules",
  cert_deliverables: "the shared certification deliverables; a member's own work is in certification_submissions",
  lessons: "a workspace course's lessons, which go with the course",
  evidence_shared: "the shared evidence library, published for every member, with no owner",
  rate_limits: "throttle counters keyed by address and window, holding no content",
  deletion_audits: "the record that a deletion happened: kept by design, with no content",
};

/** Columns that never leave the database in an export: credentials, sealed or not, and hashes that exist only to be matched. */
export const STRIP_COLUMNS = new Set(["passwordHash", "manualToken", "sessionVersion", "inboundSecretHash", "keyEncrypted", "tokenHash", "clApiToken", "passWebhookUrl", "clDripWebhookUrl", "textHash"]);

export const tableName = (t: SQLiteTable): string => getTableName(t);
