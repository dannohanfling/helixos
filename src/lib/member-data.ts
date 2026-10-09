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
  plan_records: schema.planRecords,
  plan_links: schema.planLinks,
  kpis: schema.kpis,
  kpi_values: schema.kpiValues,
  daily_logs: schema.dailyLogs,
  weekly_intentions: schema.weeklyIntentions,
  monthly_intentions: schema.monthlyIntentions,
  office_hours_requests: schema.officeHoursRequests,
  monthly_feedback: schema.monthlyFeedback,
  points: schema.pointsLedger,
  reward_claims: schema.rewardClaims,
  pathway_progress: schema.pathwayProgress,
  curriculum_progress: schema.curriculumProgress,
  lesson_progress: schema.lessonProgress,
  certification_submissions: schema.certSubmissions,
  offers: schema.offers,
  // Buyer avatars and which offers each is for (rev 501, built by Body): the member's own, in their export and erased with them.
  avatars: schema.avatars,
  avatar_offers: schema.avatarOffers,
  pathways: schema.pathways,
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
  // The brand kit is the member's (rev 568): in their export, erased with them.
  brand_kits: schema.brandKits,
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
  community_shares: schema.communityShares,
  // Body (rev 179): health data, private to the member. The member's own export has it; a coach's export of a client never
  // does (BODY_LABELS below). Deletion on request removes it with everything else.
  body_settings: schema.bodySettings,
  body_day_types: schema.bodyDayTypes,
  body_foods: schema.bodyFoods,
  body_meals: schema.bodyMeals,
  body_entries: schema.bodyEntries,
  body_days: schema.bodyDays,
  body_comments: schema.bodyComments,
  body_share_events: schema.bodyShareEvents,
  // B2 (rev 182): workouts.
  body_exercises: schema.bodyExercises,
  body_routines: schema.bodyRoutines,
  body_sessions: schema.bodySessions,
  body_sets: schema.bodySets,
  // Body composition (rev 237 phase 2): every reading, and the goals.
  body_daily: schema.bodyDaily,
  body_goals: schema.bodyGoals,
  // Pantry (rev 237 phase 5).
  body_pantry: schema.bodyPantry,
  body_yields: schema.bodyYields,
  // Habits and the health log (rev 237 phase 8). The health log is the member's alone even while sharing is on (rev 251).
  body_habits: schema.bodyHabits,
  body_habit_logs: schema.bodyHabitLogs,
  body_health: schema.bodyHealth,
  // Shopping and Instacart (rev 237 phase 10): the week's plan and the log of every push.
  body_plan: schema.bodyPlan,
  body_orders: schema.bodyOrders,
  // WHOOP (rev 237 phase 11): the connection (tokens sealed) and every recorded workout.
  body_devices: schema.bodyDevices,
  body_activities: schema.bodyActivities,
  // B9 (rev 237): templates a coach sent this member, and the member's weekly check-ins. The member's export has both; a coach's never.
  body_template_sends: schema.bodyTemplateSends,
  body_checkins: schema.bodyCheckins,
  // Supplements, vitamins and prescriptions (rev 424): the member's own, never a coach's export.
  body_meds: schema.bodyMeds,
  body_med_logs: schema.bodyMedLogs,
  body_exercise_merges: schema.bodyExerciseMerges,
  // Apple Health (rev 508 §4): the member's Shortcut key, its hash stripped from the export.
  body_ingest_tokens: schema.bodyIngestTokens,
  // What a coach changed while working in this member's HelixOS, and their switches in and out (rev 216).
  coach_changes: schema.coachChanges,
  // Team access (Danno, 6 Oct): who the member let into their HelixOS, the invites they made, and what the team did. Theirs.
  team_members: schema.teamMembers,
  team_invites: schema.teamInvites,
  team_changes: schema.teamChanges,
  chat_links: schema.chatLinks,
  connected_apps: schema.connectedApps,
  oauth_codes: schema.oauthCodes,
  mcp_calls: schema.mcpCalls,
  // Recordings R1: a step from a recorded call on this member's plate (suggested, accepted as their task, or dismissed).
  recording_steps: schema.recordingSteps,
  // Rev 498: when the member first saw a published recording (opened it, or pressed Watch in Fathom).
  recording_views: schema.recordingViews,
  // Rev 432: what the member sent from "I have an issue or a suggestion" (their words; the screenshot goes with the row).
  member_reports: schema.memberReports,
  // Rev 444: a form's unsent draft, kept so it follows the member to another device.
  form_drafts: schema.formDrafts,
} as const;
export type MemberLabel = keyof typeof MEMBER_TABLES;

/** The Body tables: in the member's own export and in deletion, never in a coach's export of a client, shared or not. */
export const BODY_LABELS = new Set<MemberLabel>(["body_settings", "body_day_types", "body_foods", "body_meals", "body_entries", "body_days", "body_comments", "body_share_events", "body_exercises", "body_routines", "body_sessions", "body_sets", "body_daily", "body_goals", "body_pantry", "body_yields", "body_habits", "body_habit_logs", "body_health", "body_plan", "body_orders", "body_devices", "body_activities", "body_template_sends", "body_checkins", "body_meds", "body_med_logs", "body_exercise_merges", "body_ingest_tokens"]);

/** No owner column of their own: each row belongs to whoever owns its parent. Listed parents before children. */
export const CHILD_TABLES = [
  { label: "messages", table: schema.messages, fk: "contactId", parent: "leads" },
  { label: "oauth_tokens", table: schema.oauthTokens, fk: "appId", parent: "connected_apps" },
  { label: "content_versions", table: schema.contentVariants, fk: "contentItemId", parent: "content" },
  { label: "offer_components", table: schema.offerComponents, fk: "offerId", parent: "offers" },
  { label: "webinar_beliefs", table: schema.webinarBeliefs, fk: "webinarId", parent: "webinars" },
  { label: "webinar_sections", table: schema.webinarSections, fk: "webinarId", parent: "webinars" },
  { label: "deck_slots", table: schema.deckSlots, fk: "webinarId", parent: "webinars" },
  { label: "deck_slide_choices", table: schema.deckSlideChoices, fk: "webinarId", parent: "webinars" },
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
  integrations: schema.integrations,
  dm_templates: schema.dmTemplates,
  courses: schema.courses,
  files: schema.files,
  community_settings: schema.communitySettings,
  community_posts: schema.communityPosts,
  // Recordings R1: the coach's calls, shown to an audience, and the workspace's Fathom connection (the coach's key).
  recordings: schema.recordings,
  fathom_workspace_connections: schema.fathomWorkspaceConnections,
  // Client headshots: the coach's review list of imported photos no member was matched to; its photos go with it.
  headshot_reviews: schema.headshotReviews,
} as const;

/** Tables that are no member's data, each with the reason; the coverage test needs every table placed somewhere. */
export const NOT_MEMBER_DATA: Record<string, string> = {
  users: "the account itself: removed last, and only when no membership in another workspace remains",
  oauth_clients: "an app that registered itself with the MCP server (Claude's connector): nobody's data, the same row for every member who connects it",
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

/**
 * Columns that are the coach's working notes on a member's own row, left out of that member's export the way coach_notes is: the
 * coach's, not theirs. Deletion still removes them with the row.
 */
export const COACH_ONLY_COLUMNS = new Set(["coachNotes"]);

/** Columns that never leave the database in an export: credentials, sealed or not, and hashes that exist only to be matched. */
export const STRIP_COLUMNS = new Set(["passwordHash", "manualToken", "accessToken", "refreshToken", "sessionVersion", "inboundSecretHash", "keyEncrypted", "tokenHash", "codeHash", "codeChallenge", "clApiToken", "passWebhookUrl", "clDripWebhookUrl", "clRungsWebhookUrl", "textHash", "webhookSecretEncrypted", "screenshotUrl", "graphicPublicToken", "headshotUrl", "headshotDisplayUrl"]);

export const tableName = (t: SQLiteTable): string => getTableName(t);
