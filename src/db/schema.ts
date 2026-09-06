import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () => text("created_at").notNull().default(sql`(datetime('now'))`);

/** A workspace is one coach deployment (one HelixOS base). */
export const workspaces = sqliteTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  brandVoice: text("brand_voice"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  clientInviteCode: text("client_invite_code").notNull().unique(),
  coachInviteCode: text("coach_invite_code").notNull().unique(),
  airtableBaseId: text("airtable_base_id"),
  createdAt: createdAt(),
});

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  avatarEmoji: text("avatar_emoji").notNull().default("🧭"),
  createdAt: createdAt(),
});

export const memberships = sqliteTable(
  "memberships",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["coach", "client"] }).notNull(),
    programTier: text("program_tier").notNull().default("Academy"),
    businessName: text("business_name"),
    bigPromise: text("big_promise"),
    reminderHour: integer("reminder_hour").notNull().default(8),
    eveningReminderHour: integer("evening_reminder_hour").notNull().default(17),
    leaderboardOptIn: integer("leaderboard_opt_in", { mode: "boolean" }).notNull().default(true),
    startedAt: text("started_at").notNull().default(sql`(date('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_ws_user").on(t.workspaceId, t.userId)],
);

export const goals = sqliteTable("goals", {
  id: id(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  target: real("target").notNull(),
  actual: real("actual").notNull().default(0),
  unit: text("unit").notNull().default("$"),
  period: text("period").notNull().default("This month"),
  dueDate: text("due_date"),
  primary: integer("primary", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    details: text("details"),
    status: text("status", { enum: ["upcoming", "today", "in_progress", "done"] }).notNull().default("upcoming"),
    urgency: text("urgency", { enum: ["top3", "high", "medium", "low"] }).notNull().default("medium"),
    category: text("category", { enum: ["sales", "content", "community", "system", "admin", "fulfillment"] })
      .notNull()
      .default("sales"),
    dueDate: text("due_date"),
    focusDate: text("focus_date"),
    completedAt: text("completed_at"),
    points: integer("points").notNull().default(5),
    source: text("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    repeatEveryDays: integer("repeat_every_days"),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_user_status").on(t.userId, t.status), index("tasks_user_due").on(t.userId, t.dueDate)],
);

export const CONTENT_STATUSES = ["idea", "creating", "ready", "scheduled", "posted"] as const;
export const CONTENT_TYPES = [
  "CTA Post",
  "Client Win",
  "Story Post",
  "Belief Shifting Post",
  "Quick Win / Pro-Tip",
  "Question Post",
  "Hype Post",
  "LIVE Video",
  "Email",
  "Short Form Video",
  "Long Form Video",
] as const;
export const PLATFORMS = [
  "FB Personal",
  "FB Group",
  "Instagram",
  "IG Reels",
  "Stories",
  "LinkedIn",
  "YouTube",
  "YT Short",
  "TikTok",
  "Email",
  "Skool",
  "Podcast",
] as const;

export const contentItems = sqliteTable(
  "content_items",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: CONTENT_STATUSES }).notNull().default("idea"),
    contentType: text("content_type").notNull().default("CTA Post"),
    platform: text("platform").notNull().default("FB Group"),
    hasCta: integer("has_cta", { mode: "boolean" }).notNull().default(false),
    hook: text("hook"),
    body: text("body"),
    postAt: text("post_at"),
    postedAt: text("posted_at"),
    postLink: text("post_link"),
    engagements: integer("engagements").notNull().default(0),
    views: integer("views").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("content_user_status").on(t.userId, t.status), index("content_user_post_at").on(t.userId, t.postAt)],
);

export const CONTACT_STAGES = ["new", "replied", "conversation", "call_booked", "client", "cold"] as const;
export const CONTACT_PLATFORMS = ["Facebook", "Instagram", "LinkedIn", "Skool", "Email", "SMS", "Other"] as const;

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull().default("Facebook"),
    profileUrl: text("profile_url"),
    stage: text("stage", { enum: CONTACT_STAGES }).notNull().default("new"),
    warmth: text("warmth", { enum: ["cold", "warm", "hot"] }).notNull().default("warm"),
    source: text("source"),
    whatTheyreBuilding: text("what_theyre_building"),
    notes: text("notes"),
    lastOutboundAt: text("last_outbound_at"),
    lastInboundAt: text("last_inbound_at"),
    nextFollowUpAt: text("next_follow_up_at"),
    callAt: text("call_at"),
    createdAt: createdAt(),
  },
  (t) => [index("contacts_user_stage").on(t.userId, t.stage), index("contacts_user_followup").on(t.userId, t.nextFollowUpAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: id(),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    direction: text("direction", { enum: ["out", "in"] }).notNull(),
    body: text("body").notNull(),
    templateId: text("template_id"),
    sentAt: text("sent_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("messages_contact").on(t.contactId, t.sentAt)],
);

export const dmTemplates = sqliteTable("dm_templates", {
  id: id(),
  workspaceId: text("workspace_id"),
  name: text("name").notNull(),
  sequence: text("sequence").notNull(),
  step: integer("step").notNull().default(1),
  branch: text("branch"),
  purpose: text("purpose"),
  body: text("body").notNull(),
  whyItWorks: text("why_it_works"),
  whenToSend: text("when_to_send"),
  tokens: text("tokens", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

/** One row per user per day. Morning lock-in and evening close both write here. */
export const dailyLogs = sqliteTable(
  "daily_logs",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    morningDoneAt: text("morning_done_at"),
    eveningDoneAt: text("evening_done_at"),
    energy: integer("energy"),
    intention: text("intention"),
    dmsStarted: integer("dms_started").notNull().default(0),
    conversations: integer("conversations").notNull().default(0),
    callsBooked: integer("calls_booked").notNull().default(0),
    callsHeld: integer("calls_held").notNull().default(0),
    posts: integer("posts").notNull().default(0),
    offersMade: integer("offers_made").notNull().default(0),
    newLeads: integer("new_leads").notNull().default(0),
    cashCollected: real("cash_collected").notNull().default(0),
    start: text("start"),
    stop: text("stop"),
    keep: text("keep"),
    win: text("win"),
    gratitude: text("gratitude"),
    streakDay: integer("streak_day").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("daily_logs_user_date").on(t.userId, t.date)],
);

export const POINT_TYPES = [
  "checkin",
  "close",
  "streak",
  "task",
  "content",
  "dm",
  "call",
  "pathway",
  "curriculum",
  "bonus",
  "redeem",
] as const;

export const pointsLedger = sqliteTable(
  "points_ledger",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    points: integer("points").notNull(),
    type: text("type", { enum: POINT_TYPES }).notNull(),
    reason: text("reason").notNull(),
    refId: text("ref_id"),
    createdAt: createdAt(),
  },
  (t) => [index("points_user").on(t.userId, t.createdAt), uniqueIndex("points_ref").on(t.userId, t.type, t.refId)],
);

export const pathwayStages = sqliteTable("pathway_stages", {
  key: text("key").primaryKey(),
  order: integer("order").notNull(),
  icon: text("icon").notNull().default(""),
  name: text("name").notNull(),
  track: text("track").notNull(),
  tagline: text("tagline"),
  description: text("description"),
  entryCriteria: text("entry_criteria"),
  exitCriteria: text("exit_criteria"),
  pointsAvailable: integer("points_available"),
  expectedDuration: text("expected_duration"),
  runsInParallel: integer("runs_in_parallel", { mode: "boolean" }).notNull().default(false),
});

export const libraryTasks = sqliteTable(
  "library_tasks",
  {
    key: text("key").primaryKey(),
    stageKey: text("stage_key")
      .notNull()
      .references(() => pathwayStages.key),
    order: integer("order").notNull(),
    name: text("name").notNull(),
    teaching: text("teaching"),
    howTo: text("how_to"),
    submissionType: text("submission_type", { enum: ["checkbox", "written", "link", "screenshot", "video"] })
      .notNull()
      .default("written"),
    points: integer("points").notNull().default(10),
    effort: text("effort", { enum: ["quick", "medium", "heavy", "deep"] }).notNull().default("medium"),
    priority: text("priority", { enum: ["must", "should", "nice", "optional"] }).notNull().default("should"),
    unlocks: text("unlocks"),
    trainingUrl: text("training_url"),
  },
  (t) => [index("library_stage").on(t.stageKey, t.order)],
);

export const pathwayProgress = sqliteTable(
  "pathway_progress",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    libraryTaskKey: text("library_task_key")
      .notNull()
      .references(() => libraryTasks.key),
    status: text("status", { enum: ["todo", "submitted", "revision", "verified"] }).notNull().default("todo"),
    submissionUrl: text("submission_url"),
    submissionText: text("submission_text"),
    coachFeedback: text("coach_feedback"),
    submittedAt: text("submitted_at"),
    verifiedAt: text("verified_at"),
    verifiedBy: text("verified_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pathway_user_task").on(t.userId, t.libraryTaskKey)],
);

export const curriculumDays = sqliteTable("curriculum_days", {
  day: integer("day").primaryKey(),
  week: text("week").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  instructions: text("instructions").notNull(),
  estTime: text("est_time"),
  points: integer("points").notNull().default(10),
  why: text("why"),
});

export const curriculumProgress = sqliteTable(
  "curriculum_progress",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    day: integer("day").notNull(),
    completedAt: text("completed_at").notNull().default(sql`(datetime('now'))`),
    note: text("note"),
  },
  (t) => [uniqueIndex("curriculum_user_day").on(t.userId, t.day)],
);

export const rewardClaims = sqliteTable("reward_claims", {
  id: id(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  rewardName: text("reward_name").notNull(),
  pointsSpent: integer("points_spent").notNull().default(0),
  status: text("status", { enum: ["requested", "fulfilled"] }).notNull().default("requested"),
  createdAt: createdAt(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type ContentItem = typeof contentItems.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DmTemplate = typeof dmTemplates.$inferSelect;
export type DailyLog = typeof dailyLogs.$inferSelect;
export type PointsEntry = typeof pointsLedger.$inferSelect;
export type PathwayStage = typeof pathwayStages.$inferSelect;
export type LibraryTask = typeof libraryTasks.$inferSelect;
export type PathwayProgress = typeof pathwayProgress.$inferSelect;
export type CurriculumDay = typeof curriculumDays.$inferSelect;
export type Goal = typeof goals.$inferSelect;
