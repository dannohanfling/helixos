import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () => text("created_at").notNull().default(sql`(datetime('now'))`);

/** A workspace is one coach deployment (one HelixOS base). */
export const workspaces = sqliteTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  clientInviteCode: text("client_invite_code").notNull().unique(),
  coachInviteCode: text("coach_invite_code").notNull().unique(),
  airtableBaseId: text("airtable_base_id"),
  /** Soft cap on AI calls per member per day, on the member's own key. A runaway loop on a client's money gets blamed on HelixOS. */
  aiDailyCap: integer("ai_daily_cap").notNull().default(40),
  createdAt: createdAt(),
});

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** Bumped on password change or reset; sessions carrying an older number are rejected. */
  sessionVersion: integer("session_version").notNull().default(0),
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
    /** Who the Big Promise is for. One field for the whole business; offers and webinars refine it, nothing else copies it. */
    audience: text("audience"),
    reminderHour: integer("reminder_hour").notNull().default(8),
    eveningReminderHour: integer("evening_reminder_hour").notNull().default(17),
    leaderboardOptIn: integer("leaderboard_opt_in", { mode: "boolean" }).notNull().default(true),
    startedAt: text("started_at").notNull().default(sql`(date('now'))`),
    passEnabled: integer("pass_enabled", { mode: "boolean" }).notNull().default(false),
    passName: text("pass_name"),
    passUrl: text("pass_url"),
    passWebhookUrl: text("pass_webhook_url"),
    passHashtag: text("pass_hashtag"),
    passCommunityUrl: text("pass_community_url"),
    certEnabled: integer("cert_enabled", { mode: "boolean" }).notNull().default(false),
    eoPassUrl: text("eo_pass_url"),
    eoPassSerial: text("eo_pass_serial"),
    eoPassInstalledAt: text("eo_pass_installed_at"),
    eoPassLastPushAt: text("eo_pass_last_push_at"),
    /** Coach override of the workspace's daily AI cap for this member. */
    aiCapExempt: integer("ai_cap_exempt", { mode: "boolean" }).notNull().default(false),
    /** Highest tier level the member has seen the celebration for. Null until first seen: then stamped silently. */
    celebratedTierLevel: integer("celebrated_tier_level"),
    /** The member's own timezone. Null means the workspace's. "Today", reminder hours and streak boundaries all follow it. */
    timezone: text("timezone"),
    lastNudgedAt: text("last_nudged_at"),
    /** Tick one: at connection the member acknowledged that anything harvested from a recording is someone else's words. Date of the tick. */
    fathomConsentAt: text("fathom_consent_at"),
    lastComebackAt: text("last_comeback_at"),
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
  "Comment Ladder",
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
    /** The call to action, kept apart from the body and composed onto each channel version at render. */
    cta: text("cta"),
    postAt: text("post_at"),
    postedAt: text("posted_at"),
    postLink: text("post_link"),
    mediaUrl: text("media_url"),
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
    /** Set when the day was closed after the fact to mend a broken streak. Counts for the running streak, not the weekly bonus. */
    repairedAt: text("repaired_at"),
    webinarRegs: integer("webinar_regs").notNull().default(0),
    webinarShows: integer("webinar_shows").notNull().default(0),
    replayViews: integer("replay_views").notNull().default(0),
    applications: integer("applications").notNull().default(0),
    revContent: real("rev_content").notNull().default(0),
    revWebinar: real("rev_webinar").notNull().default(0),
    revDm: real("rev_dm").notNull().default(0),
    proofPosts: integer("proof_posts").notNull().default(0),
    ctaPosts: integer("cta_posts").notNull().default(0),
    beliefPosts: integer("belief_posts").notNull().default(0),
    storiesCreated: integer("stories_created").notNull().default(0),
    referralAsks: integer("referral_asks").notNull().default(0),
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
    /** Set only on a coach's manual adjustment: the coach's user id. The reason line stays the client's to read. */
    adjustedBy: text("adjusted_by"),
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
  /** First time the client followed the booking link. */
  bookingOpenedAt: text("booking_opened_at"),
  /** Set when an inbound GoHighLevel appointment is matched to this claim: the call is actually on the calendar. */
  bookedAt: text("booked_at"),
  bookedRef: text("booked_ref"),
  createdAt: createdAt(),
});

/**
 * What the coach wrote after a call with one client, keyed to the membership (the client's seat in this workspace, not the
 * client's own CRM). Tasks created from a note carry source "coach_call" and sourceRef = the note id.
 */
export const coachNotes = sqliteTable(
  "coach_notes",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    membershipId: text("membership_id").notNull(),
    authorUserId: text("author_user_id").notNull(),
    date: text("date").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("coach_notes_membership").on(t.membershipId, t.date)],
);
export type CoachNote = typeof coachNotes.$inferSelect;

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

/* ───────────────────────── Offers ───────────────────────── */

export const OFFER_CONTAINERS = ["1:1 coaching", "Group program", "Course", "Workshop", "Membership", "Done-for-you", "Hybrid"] as const;

export const offers = sqliteTable(
  "offers",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["draft", "live", "retired"] }).notNull().default("draft"),
    avatar: text("avatar"),
    coreProblem: text("core_problem"),
    promise: text("promise"),
    mechanismName: text("mechanism_name"),
    pathSteps: text("path_steps", { mode: "json" }).$type<string[]>().notNull().default([]),
    container: text("container").notNull().default("Group program"),
    length: text("length"),
    price: real("price").notNull().default(0),
    paymentPlan: text("payment_plan"),
    guarantee: text("guarantee"),
    scarcity: text("scarcity"),
    urgency: text("urgency"),
    oneBelief: text("one_belief"),
    difference: text("difference"),
    whyNow: text("why_now"),
    whyTrust: text("why_trust"),
    howItWorks: text("how_it_works"),
    forYouIf: text("for_you_if"),
    notForYouIf: text("not_for_you_if"),
    objTime: text("obj_time"),
    objMoney: text("obj_money"),
    objPartner: text("obj_partner"),
    objTriedBefore: text("obj_tried_before"),
    objDiy: text("obj_diy"),
    salesPageUrl: text("sales_page_url"),
    paymentLink: text("payment_link"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("offers_user").on(t.userId)],
);

export const offerComponents = sqliteTable(
  "offer_components",
  {
    id: id(),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: ["core", "bonus", "guarantee"] }).notNull().default("core"),
    description: text("description"),
    perceivedValue: real("perceived_value").notNull().default(0),
    order: integer("order").notNull().default(1),
    problemItSolves: text("problem_it_solves"),
    beliefBreak: text("belief_break", { enum: ["vehicle", "internal", "external", "none"] }).notNull().default("none"),
    oneLiner: text("one_liner"),
  },
  (t) => [index("offer_components_offer").on(t.offerId, t.order)],
);

/* ───────────────────────── Webinars ───────────────────────── */

export const ACT_KEYS = ["opening", "vehicle", "internal", "external", "closing"] as const;
export const WEBINAR_STATUSES = ["draft", "building", "ready", "scheduled", "delivered"] as const;

export const webinars = sqliteTable(
  "webinars",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: WEBINAR_STATUSES }).notNull().default("draft"),
    category: text("category").notNull().default("Live"),
    isExample: integer("is_example", { mode: "boolean" }).notNull().default(false),
    audience: text("audience"),
    coreProblem: text("core_problem"),
    desiredResult: text("desired_result"),
    promise: text("promise"),
    mechanismName: text("mechanism_name"),
    offerId: text("offer_id"),
    ctaType: text("cta_type").notNull().default("Book a call"),
    scheduledAt: text("scheduled_at"),
    registrationUrl: text("registration_url"),
    replayUrl: text("replay_url"),
    deckUrl: text("deck_url"),
    registered: integer("registered").notNull().default(0),
    showed: integer("showed").notNull().default(0),
    offersMade: integer("offers_made").notNull().default(0),
    callsBooked: integer("calls_booked").notNull().default(0),
    sales: integer("sales").notNull().default(0),
    revenue: real("revenue").notNull().default(0),
    debriefLeak: text("debrief_leak"),
    debriefFix: text("debrief_fix"),
    debriefWins: text("debrief_wins"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("webinars_user").on(t.userId, t.status)],
);

export const webinarBeliefs = sqliteTable(
  "webinar_beliefs",
  {
    id: id(),
    webinarId: text("webinar_id")
      .notNull()
      .references(() => webinars.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["vehicle", "internal", "external"] }).notNull(),
    fromBelief: text("from_belief"),
    toBelief: text("to_belief"),
    proof: text("proof"),
    /** An approved row of the proof bank, the same rows the ladder reads; the free text above is the fallback for proof that isn't there. */
    proofId: text("proof_id"),
    storyAssetId: text("story_asset_id"),
  },
  (t) => [uniqueIndex("webinar_beliefs_type").on(t.webinarId, t.type)],
);

export const webinarSections = sqliteTable(
  "webinar_sections",
  {
    id: id(),
    webinarId: text("webinar_id")
      .notNull()
      .references(() => webinars.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    act: text("act", { enum: ACT_KEYS }).notNull(),
    order: integer("order").notNull(),
    name: text("name").notNull(),
    keyPoints: text("key_points"),
    script: text("script"),
    transitionIn: text("transition_in"),
    transitionOut: text("transition_out"),
    assetId: text("asset_id"),
    durationMin: integer("duration_min").notNull().default(4),
    status: text("status", { enum: ["todo", "drafted", "final"] }).notNull().default("todo"),
  },
  (t) => [uniqueIndex("webinar_sections_key").on(t.webinarId, t.sectionKey)],
);

export const readinessReviews = sqliteTable("readiness_reviews", {
  id: id(),
  webinarId: text("webinar_id")
    .notNull()
    .references(() => webinars.id, { onDelete: "cascade" }),
  ratings: text("ratings", { mode: "json" }).$type<Record<string, number>>().notNull().default({}),
  score: integer("score").notNull().default(0),
  verdict: text("verdict", { enum: ["ready", "needs_work", "not_ready"] }).notNull().default("not_ready"),
  biggestGaps: text("biggest_gaps"),
  nextActions: text("next_actions"),
  createdAt: createdAt(),
});

/** Story / analogy / objection / belief bank. workspaceId null = ships with the template. */
export const ASSET_TYPES = ["story", "analogy", "objection", "belief", "framework"] as const;

export const libraryAssets = sqliteTable(
  "library_assets",
  {
    id: id(),
    workspaceId: text("workspace_id"),
    userId: text("user_id"),
    type: text("type", { enum: ASSET_TYPES }).notNull(),
    name: text("name").notNull(),
    body: text("body").notNull(),
    summary: text("summary"),
    useWhen: text("use_when"),
    tag: text("tag"),
    reframe: text("reframe"),
    proof: text("proof"),
    isExample: integer("is_example", { mode: "boolean" }).notNull().default(false),
    extra: text("extra", { mode: "json" }).$type<Record<string, string | null>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("assets_type").on(t.type, t.workspaceId)],
);

/* ───────────────────────── Content repurposing ───────────────────────── */

export const CHANNELS = [
  "fb_personal",
  "fb_page",
  "fb_group",
  "other_groups",
  "stories",
  "instagram",
  "threads",
  "linkedin",
  "email",
  "skool",
] as const;

export const contentVariants = sqliteTable(
  "content_variants",
  {
    id: id(),
    contentItemId: text("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    groupId: text("group_id").notNull().default(""),
    body: text("body").notNull(),
    subject: text("subject"),
    status: text("status", { enum: ["draft", "scheduled", "posted", "skipped"] }).notNull().default("draft"),
    postAt: text("post_at"),
    postedAt: text("posted_at"),
    postUrl: text("post_url"),
    reactions: integer("reactions").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    dms: integer("dms").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    generatedBy: text("generated_by").notNull().default("rules"),
    /** What the generator removed from this draft and why (a fabricated statistic, with what to say instead). Shown beside the draft. */
    notes: text("notes"),
    externalId: text("external_id"),
    externalStatus: text("external_status"),
    externalError: text("external_error"),
    externalSyncedAt: text("external_synced_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("variants_item_channel_group").on(t.contentItemId, t.channel, t.groupId)],
);

/* ───────────────────────── Socrates Domain: the question library and the scripts built from it ───────────────────────── */

export const SOCRATES_SCRIPT_TYPES = ["High-Ticket Sales Call", "Cold Call", "DM", "Follow-Up", "Objection", "Presentation Close", "Community Reachout", "Referral"] as const;

/** Library rows (key set, no owner) are upserted from the seed on every migrate; a client's own rows (owner set, no key) are never touched by that. */
export const socratesQuestions = sqliteTable(
  "socrates_questions",
  {
    id: id(),
    key: text("key"),
    workspaceId: text("workspace_id"),
    userId: text("user_id"),
    question: text("question").notNull(),
    clarityStage: text("clarity_stage").notNull(),
    nepqCategory: text("nepq_category"),
    source: text("source").notNull().default("Mine"),
    scriptTypes: text("script_types", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("socrates_questions_key").on(t.key), index("socrates_questions_owner").on(t.userId)],
);
export type SocratesQuestion = typeof socratesQuestions.$inferSelect;

export type SocratesBeat = { questionIds: string[]; reframeIds: string[]; override: string | null };

export const socratesScripts = sqliteTable(
  "socrates_scripts",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    scriptType: text("script_type", { enum: SOCRATES_SCRIPT_TYPES }).notNull().default("High-Ticket Sales Call"),
    beats: text("beats", { mode: "json" }).$type<Record<string, SocratesBeat>>().notNull().default({}),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [index("socrates_scripts_owner").on(t.userId, t.updatedAt)],
);
export type SocratesScript = typeof socratesScripts.$inferSelect;

/* ───────────────────────── The client's own clients ───────────────────────── */

export const CLIENT_STATUSES = ["lead", "active", "paused", "completed", "alumni"] as const;

export const clientRecords = sqliteTable(
  "client_records",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    avatarEmoji: text("avatar_emoji").notNull().default("🙂"),
    status: text("status", { enum: CLIENT_STATUSES }).notNull().default("active"),
    offerId: text("offer_id"),
    programName: text("program_name"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    goal90: text("goal_90"),
    fear: text("fear"),
    roadblock: text("roadblock"),
    phase: text("phase"),
    checkinCadenceDays: integer("checkin_cadence_days").notNull().default(7),
    nextCallAt: text("next_call_at"),
    lastCheckinAt: text("last_checkin_at"),
    notes: text("notes"),
    contactId: text("contact_id"),
    passSerial: text("pass_serial"),
    createdAt: createdAt(),
  },
  (t) => [index("client_records_user").on(t.userId, t.status)],
);

export const clientCheckins = sqliteTable(
  "client_checkins",
  {
    id: id(),
    clientRecordId: text("client_record_id")
      .notNull()
      .references(() => clientRecords.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    kind: text("kind", { enum: ["checkin", "call", "note"] }).notNull().default("checkin"),
    wins: text("wins"),
    blockers: text("blockers"),
    supportNeeded: text("support_needed"),
    nextStep: text("next_step"),
    mindset: integer("mindset"),
    energy: integer("energy"),
    business: integer("business"),
    cashCollected: real("cash_collected").notNull().default(0),
    nps: integer("nps"),
    createdAt: createdAt(),
  },
  (t) => [index("client_checkins_client").on(t.clientRecordId, t.date)],
);

/** Points the client awards to their own clients / community members (Community Pass). */
export const memberPoints = sqliteTable(
  "member_points",
  {
    id: id(),
    clientRecordId: text("client_record_id")
      .notNull()
      .references(() => clientRecords.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    syncStatus: text("sync_status", { enum: ["local", "sent", "failed"] }).notNull().default("local"),
    syncNote: text("sync_note"),
    createdAt: createdAt(),
  },
  (t) => [index("member_points_client").on(t.clientRecordId, t.createdAt)],
);

export type Offer = typeof offers.$inferSelect;
export type OfferComponent = typeof offerComponents.$inferSelect;
export type Webinar = typeof webinars.$inferSelect;
export type WebinarSection = typeof webinarSections.$inferSelect;
export type WebinarBelief = typeof webinarBeliefs.$inferSelect;
export type ReadinessReview = typeof readinessReviews.$inferSelect;
export type LibraryAsset = typeof libraryAssets.$inferSelect;
export type ContentVariant = typeof contentVariants.$inferSelect;
export type ClientRecord = typeof clientRecords.$inferSelect;
export type ClientCheckin = typeof clientCheckins.$inferSelect;
export type MemberPoint = typeof memberPoints.$inferSelect;

/* ───────────────────────── Doctrine, proof, groups, targets ───────────────────────── */

export const principles = sqliteTable("principles", {
  code: text("code").primaryKey(),
  order: integer("order").notNull().default(0),
  symbol: text("symbol"),
  greekName: text("greek_name"),
  name: text("name").notNull(),
  summary: text("summary"),
  doctrine: text("doctrine"),
  greekStory: text("greek_story"),
  stoicStory: text("stoic_story"),
  businessCase: text("business_case"),
  publicFigureStory: text("public_figure_story"),
  scienceAnchor: text("science_anchor"),
  personalStory: text("personal_story"),
  clientStory: text("client_story"),
  reelScript: text("reel_script"),
  trainingOutline: text("training_outline"),
  salesPositioning: text("sales_positioning"),
  layer: text("layer"),
  phase: text("phase"),
  pillar: text("pillar"),
  hookAngle: text("hook_angle"),
});

export const PROOF_TYPES = ["result", "testimonial", "screenshot", "case_study", "stat", "story"] as const;

export const proofs = sqliteTable(
  "proofs",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: PROOF_TYPES }).notNull().default("result"),
    who: text("who"),
    problemBefore: text("problem_before"),
    shift: text("shift"),
    resultAfter: text("result_after"),
    beliefBroken: text("belief_broken", { enum: ["vehicle", "internal", "external", "none"] }).notNull().default("none"),
    shortVersion: text("short_version"),
    longVersion: text("long_version"),
    hook: text("hook"),
    punchline: text("punchline"),
    link: text("link"),
    clientRecordId: text("client_record_id"),
    status: text("status", { enum: ["draft", "approved"] }).notNull().default("draft"),
    /** Harvested from a Fathom recording: the verbatim quote as the transcript has it. Every shorter shape must be a trim of this. */
    quote: text("quote"),
    sourceRecordingId: text("source_recording_id"),
    sourceUrl: text("source_url"),
    sourceTimestamp: text("source_timestamp"),
    sourceRecordedAt: text("source_recorded_at"),
    contextBefore: text("context_before"),
    contextAfter: text("context_after"),
    /** The speaker label exactly as the transcript had it (a name, a first name, or an email); `who` is the name shown and may be corrected before approval. */
    speakerLabel: text("speaker_label"),
    /** Tick two: "[Name] has given me permission to use what they said here in my marketing." Who ticked it and when. */
    permissionAt: text("permission_at"),
    permissionBy: text("permission_by"),
    createdAt: createdAt(),
  },
  (t) => [index("proofs_user").on(t.userId, t.status)],
);

export const GROUP_KINDS = ["own", "member", "prospect"] as const;

export const groups = sqliteTable(
  "groups",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    kind: text("kind", { enum: GROUP_KINDS }).notNull().default("member"),
    rank: integer("rank").notNull().default(0),
    mission: text("mission"),
    description: text("description"),
    audience: text("audience"),
    adminName: text("admin_name"),
    adminValues: text("admin_values"),
    rules: text("rules"),
    postingNorms: text("posting_norms"),
    whatWorks: text("what_works"),
    memberCount: integer("member_count"),
    postsPerDay: integer("posts_per_day"),
    rating: integer("rating"),
    lastPostedAt: text("last_posted_at"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("groups_user_kind").on(t.userId, t.kind, t.rank)],
);

export const targets = sqliteTable(
  "targets",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    month: text("month").notNull(),
    metric: text("metric").notNull(),
    target: real("target").notNull().default(0),
  },
  (t) => [uniqueIndex("targets_user_month_metric").on(t.userId, t.month, t.metric)],
);

/* ───────────────────────── Courses & certification ───────────────────────── */

export const courses = sqliteTable("courses", {
  id: id(),
  workspaceId: text("workspace_id"),
  program: text("program").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  order: integer("order").notNull().default(0),
  tier: text("tier"),
});

export const lessons = sqliteTable(
  "lessons",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    order: integer("order").notNull().default(0),
    name: text("name").notNull(),
    objective: text("objective"),
    prompts: text("prompts"),
    resources: text("resources"),
    week: text("week"),
    stageKey: text("stage_key"),
    points: integer("points").notNull().default(15),
  },
  (t) => [index("lessons_course").on(t.courseId, t.order)],
);

export const lessonProgress = sqliteTable(
  "lesson_progress",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    completedAt: text("completed_at").notNull().default(sql`(datetime('now'))`),
    note: text("note"),
  },
  (t) => [uniqueIndex("lesson_progress_user_lesson").on(t.userId, t.lessonId)],
);

export const certModules = sqliteTable("cert_modules", {
  id: id(),
  order: integer("order").notNull().default(0),
  name: text("name").notNull(),
  objective: text("objective"),
});

export const certDeliverables = sqliteTable(
  "cert_deliverables",
  {
    id: id(),
    moduleId: text("module_id")
      .notNull()
      .references(() => certModules.id, { onDelete: "cascade" }),
    order: integer("order").notNull().default(0),
    name: text("name").notNull(),
    evidenceType: text("evidence_type"),
    passThreshold: integer("pass_threshold").notNull().default(85),
  },
  (t) => [index("cert_deliverables_module").on(t.moduleId, t.order)],
);

export const certSubmissions = sqliteTable(
  "cert_submissions",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    deliverableId: text("deliverable_id").notNull(),
    url: text("url"),
    notes: text("notes"),
    status: text("status", { enum: ["submitted", "passed", "revise"] }).notNull().default("submitted"),
    score: integer("score"),
    feedback: text("feedback"),
    reviewedBy: text("reviewed_by"),
    createdAt: createdAt(),
  },
  (t) => [index("cert_submissions_user").on(t.userId, t.deliverableId)],
);

/* ───────────────────────── Content ladders (skins) ───────────────────────── */

export const LADDER_FORMAT_KEYS = ["loss_rebuild", "method_resource", "milestone", "authority_anchor", "tool_stack", "mistakes", "screenshot", "objection", "numbers_teardown", "bait_correct", "community", "origin_story", "roadmap"] as const;
export const LADDER_STATUSES = ["draft", "ready", "live", "done"] as const;
export const LADDER_AUDIENCES = ["warm", "cold"] as const;

export type LadderKeyword = { keyword: string; use: string };
export type LadderStat = { stat: string; source: string };
export type LadderRung = { n: number; body: string; postedAt?: string | null };

/** The facts a client's ladders are written from: product, price, keywords, what may be claimed. One per member. */
export const ladderProfiles = sqliteTable(
  "ladder_profiles",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    productName: text("product_name"),
    productPitch: text("product_pitch"),
    priceLine: text("price_line"),
    trialLine: text("trial_line"),
    keywords: text("keywords", { mode: "json" }).$type<LadderKeyword[]>().notNull().default([]),
    scarcityLine: text("scarcity_line"),
    bannedPhrases: text("banned_phrases", { mode: "json" }).$type<string[]>().notNull().default([]),
    verifiedStats: text("verified_stats", { mode: "json" }).$type<LadderStat[]>().notNull().default([]),
    claimsRules: text("claims_rules"),
    originStory: text("origin_story"),
    positioningLine: text("positioning_line"),
    handle: text("handle"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ladder_profiles_ws_user").on(t.workspaceId, t.userId)],
);

/** One skin: the brief that went in and every field that came out, editable, with the rungs' live-posting state. */
export const ladders = sqliteTable(
  "ladders",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    contentItemId: text("content_item_id"),
    format: text("format", { enum: LADDER_FORMAT_KEYS }).notNull(),
    topic: text("topic").notNull(),
    audience: text("audience", { enum: LADDER_AUDIENCES }).notNull().default("warm"),
    keyword: text("keyword").notNull().default("none"),
    sourceMaterial: text("source_material"),
    realNumbers: text("real_numbers"),
    postName: text("post_name").notNull().default(""),
    headline: text("headline").notNull().default(""),
    altHeadlines: text("alt_headlines", { mode: "json" }).$type<string[]>().notNull().default([]),
    hook: text("hook").notNull().default(""),
    copy: text("copy").notNull().default(""),
    rungs: text("rungs", { mode: "json" }).$type<LadderRung[]>().notNull().default([]),
    dmKeyword: text("dm_keyword").notNull().default(""),
    carousel: text("carousel", { mode: "json" }).$type<string[]>().notNull().default([]),
    igCaption: text("ig_caption").notNull().default(""),
    threadsChain: text("threads_chain", { mode: "json" }).$type<string[]>().notNull().default([]),
    notes: text("notes"),
    generatedBy: text("generated_by").notNull().default("scaffold"),
    status: text("status", { enum: LADDER_STATUSES }).notNull().default("draft"),
    launchedAt: text("launched_at"),
    createdAt: createdAt(),
  },
  (t) => [index("ladders_user").on(t.userId, t.status)],
);

/* ───────────────────────── Bring-your-own AI ───────────────────────── */

export const AI_PROVIDERS = ["anthropic", "openai"] as const;

/** A member's own API key, encrypted at rest. Shown again only as provider + last four. */
export const aiCredentials = sqliteTable(
  "ai_credentials",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: AI_PROVIDERS }).notNull(),
    keyEncrypted: text("key_encrypted").notNull(),
    last4: text("last4").notNull().default(""),
    lastValidatedAt: text("last_validated_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ai_credentials_ws_user").on(t.workspaceId, t.userId)],
);

/** A member's own Fathom API key (user-level), encrypted at rest. Used only when that member points at one of their recordings. */
export const fathomConnections = sqliteTable(
  "fathom_connections",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    keyEncrypted: text("key_encrypted").notNull(),
    last4: text("last4").notNull().default(""),
    lastValidatedAt: text("last_validated_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("fathom_connections_ws_user").on(t.workspaceId, t.userId)],
);
export type FathomConnection = typeof fathomConnections.$inferSelect;

/** One row per AI call: who, which key, which feature, how many tokens, what it probably cost. */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: AI_PROVIDERS }).notNull(),
    model: text("model").notNull(),
    feature: text("feature").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    /** Prompt-cache accounting for the Essence block: written at 1.25× the input price, read back at 0.1×. */
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_at").on(t.userId, t.createdAt), index("ai_usage_ws_at").on(t.workspaceId, t.createdAt)],
);

/** The client's Essence: brand voice as config, fourteen sections of JSON, owned by the client. Not a secret. One per client. */
export const essences = sqliteTable(
  "essences",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, Record<string, unknown>>>().notNull().default({}),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("essences_ws_user").on(t.workspaceId, t.userId)],
);
export type Essence = typeof essences.$inferSelect;

/* ───────────────────────── Integrations ───────────────────────── */

export const PROVIDERS = ["community_loyalty", "gohighlevel"] as const;

export const integrations = sqliteTable(
  "integrations",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider", { enum: PROVIDERS }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    config: text("config", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    /** sha256 of the inbound webhook secret. The secret itself is shown once when created and never stored. */
    inboundSecretHash: text("inbound_secret_hash"),
    lastSyncAt: text("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integrations_ws_provider").on(t.workspaceId, t.provider), index("integrations_inbound_hash").on(t.inboundSecretHash)],
);

export const syncEvents = sqliteTable(
  "sync_events",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id"),
    provider: text("provider").notNull(),
    direction: text("direction", { enum: ["out", "in"] }).notNull(),
    event: text("event").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ["sent", "received", "failed", "skipped"] }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("sync_events_ws").on(t.workspaceId, t.createdAt)],
);

/** One member's GoHighLevel sub-account for publishing: location, user, their own encrypted Private Integration token, connected accounts and the channel map. */
export const socialConnections = sqliteTable(
  "social_connections",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull().default("gohighlevel"),
    locationId: text("location_id").notNull(),
    ghlUserId: text("ghl_user_id"),
    /** The member's own location-level Private Integration token, encrypted at rest. The only credential the GoHighLevel integration uses. */
    manualToken: text("manual_token"),
    accounts: text("accounts", { mode: "json" }).$type<SocialAccount[]>().notNull().default([]),
    mapping: text("mapping", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    connectedAt: text("connected_at"),
    lastSyncAt: text("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("social_connections_user_provider").on(t.userId, t.provider)],
);

export type SocialAccount = { id: string; name: string; platform: string; type: string; isExpired: boolean; avatar?: string | null };
export type SocialConnection = typeof socialConnections.$inferSelect;

/** The Content Library: shared templates (workspace null = master, or coach-published) and each member's own saved posts. */
export const LIBRARY_KINDS = ["post", "hook", "cta", "pattern"] as const;

export const libraryPosts = sqliteTable(
  "library_posts",
  {
    id: id(),
    workspaceId: text("workspace_id"),
    userId: text("user_id"),
    kind: text("kind", { enum: LIBRARY_KINDS }).notNull().default("post"),
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    title: text("title").notNull(),
    contentType: text("content_type"),
    pillar: text("pillar"),
    angle: text("angle"),
    hook: text("hook"),
    body: text("body").notNull().default(""),
    cta: text("cta"),
    hasCta: integer("has_cta", { mode: "boolean" }).notNull().default(false),
    useWhen: text("use_when"),
    whyItWorks: text("why_it_works"),
    example: text("example"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    source: text("source").notNull().default("master"),
    sourceContentId: text("source_content_id"),
    engagements: integer("engagements").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    usedCount: integer("used_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("library_posts_scope").on(t.workspaceId, t.userId, t.kind)],
);

export type LibraryPost = typeof libraryPosts.$inferSelect;

/** Password reset tokens. Only the sha256 of the token is stored; a token is single use and expires after 60 minutes. */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: id(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("password_resets_user").on(t.userId)],
);

/**
 * Evidence: published research, each client's own. A study is citable only once the client has confirmed that what came back
 * is what they asked for; `citationQuality` starts unverified and only their confirmation moves it. `askedFor` keeps the
 * request beside the result so the two are always shown side by side.
 */
export const EVIDENCE_QUALITY = ["unverified", "verified"] as const;
export type EvidenceAskedFor = { claim: string; terms: string[]; author?: string; year?: number };
export const evidence = sqliteTable(
  "evidence",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    claim: text("claim").notNull(),
    askedFor: text("asked_for", { mode: "json" }).$type<EvidenceAskedFor>().notNull(),
    title: text("title").notNull(),
    authors: text("authors").notNull().default(""),
    year: integer("year"),
    doi: text("doi"),
    url: text("url"),
    openalexId: text("openalex_id"),
    citedByCount: integer("cited_by_count").notNull().default(0),
    citationQuality: text("citation_quality", { enum: EVIDENCE_QUALITY }).notNull().default("unverified"),
    flags: text("flags", { mode: "json" }).$type<string[]>().notNull().default([]),
    verifiedAt: text("verified_at"),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_owner").on(t.userId)],
);
export type Evidence = typeof evidence.$inferSelect;

/** The shared starter shelf: Evolve Omega's studies, upserted from src/data/research-library-seed-v2.json on every migrate. Never a client's. */
export const evidenceShared = sqliteTable("evidence_shared", {
  id: id(),
  name: text("name").notNull(),
  authorsSource: text("authors_source").notNull(),
  category: text("category").notNull(),
  confidenceLevel: text("confidence_level").notNull(),
  shortSummary: text("short_summary").notNull(),
  whyItMatters: text("why_it_matters").notNull(),
  fifteenSecondScript: text("fifteen_second_script").notNull(),
  thirtySecondReelScript: text("thirty_second_reel_script").notNull(),
  clipHook: text("clip_hook").notNull(),
  supports: text("supports", { mode: "json" }).$type<string[]>().notNull().default([]),
  doi: text("doi").notNull(),
  url: text("url").notNull(),
  openalexId: text("openalex_id").notNull(),
  citationQuality: text("citation_quality").notNull(),
  verifiedTitle: text("verified_title").notNull(),
  verifiedYear: integer("verified_year").notNull(),
  citedByCount: integer("cited_by_count").notNull().default(0),
  createdAt: createdAt(),
});
export type EvidenceShared = typeof evidenceShared.$inferSelect;

/** A shared study a client removed from their own shelf. Nobody else's shelf changes. */
export const evidenceHidden = sqliteTable(
  "evidence_hidden",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sharedId: text("shared_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("evidence_hidden_user_shared").on(t.userId, t.sharedId)],
);

/** One OpenAlex search: kept as the cache (by normalised query) and as the per-client daily count. `day` is the UTC date. */
export type EvidenceResult = { openalexId: string; title: string; authors: string; year: number | null; doi: string | null; url: string | null; citedByCount: number };
export const evidenceSearches = sqliteTable(
  "evidence_searches",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    queryKey: text("query_key").notNull(),
    query: text("query").notNull(),
    claim: text("claim").notNull().default(""),
    askedFor: text("asked_for", { mode: "json" }).$type<EvidenceAskedFor>().notNull(),
    results: text("results", { mode: "json" }).$type<EvidenceResult[]>().notNull().default([]),
    fromCache: integer("from_cache", { mode: "boolean" }).notNull().default(false),
    /** What OpenAlex reported with this call (X-RateLimit-Limit / X-RateLimit-Remaining, in credits); null for a cache hit or a mock without headers. */
    creditsLimit: integer("credits_limit"),
    creditsRemaining: integer("credits_remaining"),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_searches_user_day").on(t.userId, t.day), index("evidence_searches_key").on(t.queryKey)],
);
export type EvidenceSearch = typeof evidenceSearches.$inferSelect;

/** Fixed-window counters for login and join attempts. */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: integer("window_start").notNull().default(0),
});

export type Principle = typeof principles.$inferSelect;
export type Proof = typeof proofs.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Target = typeof targets.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type CertModule = typeof certModules.$inferSelect;
export type CertDeliverable = typeof certDeliverables.$inferSelect;
export type CertSubmission = typeof certSubmissions.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type SyncEvent = typeof syncEvents.$inferSelect;
export type LadderProfile = typeof ladderProfiles.$inferSelect;
export type Ladder = typeof ladders.$inferSelect;
export type AiCredential = typeof aiCredentials.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;
