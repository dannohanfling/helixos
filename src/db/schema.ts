import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { OOH_CATEGORIES_DEFAULT, OOH_HOSTS_DEFAULT } from "@/lib/engine/office-hours";
import { FRAMEWORK_STATUSES, MATERIAL_KINDS, STORY_STATUSES, STORY_TYPES } from "@/lib/engine/teaching-kinds";
import { BOT_FEATURE_KEYS, REQUEST_STATES, UNLOCK_TYPES, type Behavior } from "@/lib/engine/bot-features";
import type { HorizonArea, HorizonStatus } from "@/lib/engine/horizon";
import type { CorrectionRecord } from "@/lib/engine/proof-bank";
import { EMPTY_DEFAULTS, type MfAgendaItem, type MfDefaults, type MfObjection, type MfPillar, type MfPitch, type MfProfile, type MfUrgency } from "@/lib/engine/magic-funnel";

const id = () => text("id").primaryKey();
const createdAt = () => text("created_at").notNull().default(sql`(datetime('now'))`);

/** A workspace is one coach deployment (one HelixOS base). */
/** One HOW I SAY IT example on a member's bot: the moment, what the lead says (optional), what the coach says. */
export type BotExampleRow = { id: string; moment: string; them: string | null; me: string; kind: "normal" | "objection" };
/** One of the coach's own stories on their bot: when it fits, and for a belief story the belief it answers. */
export type BotStoryRow = { id: string; text: string; when: string | null; kind: "plain" | "belief"; belief: string | null };
/** A guarantee's terms, structured (handoff rev 80, §2C): for the terms page and, later, the tracker. */
export type GuaranteeTerms = { windowMonths?: number; measure?: string; conditions?: string[]; attendancePct?: number; replayDays?: number; exclusions?: string; remedy?: string };

export const workspaces = sqliteTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  /** "Connected apps open to clients" (MCP, rev 247 B5): whether clients may connect Claude to their HelixOS. On by default; coaches always may. */
  connectedAppsOpen: integer("connected_apps_open", { mode: "boolean" }).notNull().default(true),
  /** "Send Done messages automatically after merge" (H-202): an agent's Done draft goes at once instead of waiting for Send. Off. */
  autoDoneAfterMerge: integer("auto_done_after_merge", { mode: "boolean" }).notNull().default(false),
  /** The Colosseum (rev 699): off until the coach turns it on for the workspace. */
  colosseumOn: integer("colosseum_on", { mode: "boolean" }).notNull().default(false),
  clientInviteCode: text("client_invite_code").notNull().unique(),
  coachInviteCode: text("coach_invite_code").notNull().unique(),
    /** The Platforms menu's addresses, the coach's to set (rev 843): Community Loyalty, Academy, the marketing system, Community. */
    platformLinks: text("platform_links", { mode: "json" }).$type<Partial<Record<"cl" | "academy" | "oms" | "community", string>>>().notNull().default({}),
  airtableBaseId: text("airtable_base_id"),
  /** Soft cap on AI calls per member per day, on the member's own key. A runaway loop on a client's money gets blamed on HelixOS. */
  aiDailyCap: integer("ai_daily_cap").notNull().default(40),
  /** "Expert seats live" (rev 756 §4): off at launch; while off, members' expert seats pause and their chairs take the archetypes. */
  expertSeatsLive: integer("expert_seats_live", { mode: "boolean" }).notNull().default(false),
  /** Open Office Hours (rev 124): the categories a member picks from, and who can be responsible for a request. Coach-edited. */
  oohCategories: text("ooh_categories", { mode: "json" }).$type<string[]>().notNull().default(OOH_CATEGORIES_DEFAULT),
  oohHosts: text("ooh_hosts", { mode: "json" }).$type<string[]>().notNull().default(OOH_HOSTS_DEFAULT),
  /** Office Hours as a member reads it (friction walk OH1, 7 Oct): when, in the workspace's zone, and the link to join. Coach-edited. */
  oohTime: text("ooh_time"),
  oohLink: text("ooh_link"),
  /**
   * The session as a time, anchored to the host's zone (the workspace's) (H-457, plan H-469): the weekday (0 Sunday to 6
   * Saturday), the start as the host's wall time ("17:00", null until the coach sets it) and its length. Each member reads
   * every session in their own zone; `ooh_time` stays as the coach's free note.
   */
  oohWeekday: integer("ooh_weekday").notNull().default(5),
  oohStart: text("ooh_start"),
  oohMinutes: integer("ooh_minutes").notNull().default(60),
  /** The weekly calls (H-820, plan H-828): the shared join link every call without its own uses, and its passcode. Coach-edited under Settings → Calls. */
  callsLink: text("calls_link"),
  callsPasscode: text("calls_passcode"),
  /** The Start Here orientation (H-270 §1, S1a): the coach's welcome video, a link HelixOS plays itself (mp4, webm) or opens (a Recordings share link). Null shows "Coming soon". */
  startHereVideo: text("start_here_video"),
  /** Recordings' publishing rules (rev 491): series names and time slots, coach-edited. Null keeps the defaults in recording-rules.ts. */
  recordingRules: text("recording_rules", { mode: "json" }).$type<unknown>(),
  /** When the rules took effect: a call recorded before it is never published by them on its own, only suggested. */
  recordingRulesFrom: text("recording_rules_from"),
  createdAt: createdAt(),
});

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** The first time they signed in (29 Sep). Never signed in means no automated email (canEmail); set by markSignedIn. */
  firstSignedInAt: text("first_signed_in_at"),
  /** Bumped on password change or reset; sessions carrying an older number are rejected. */
  sessionVersion: integer("session_version").notNull().default(0),
  avatarEmoji: text("avatar_emoji").notNull().default("🧭"),
  createdAt: createdAt(),
});

/** Who set a member's profile photo: the coach's Airtable import, the member's own upload, or removed by the member. */
export const HEADSHOT_SOURCES = ["import", "upload", "removed"] as const;
export type HeadshotSource = (typeof HEADSHOT_SOURCES)[number];

export const memberships = sqliteTable(
  "memberships",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["coach", "client"] }).notNull(),
    programTier: text("program_tier").notNull().default("Academy"),
    /** Office Hours by level (H-470): null follows the program level (Academy and up); "on" or "off" is the coach's own choice and holds until reset. */
    officeHoursOverride: text("office_hours_override", { enum: ["on", "off"] }),
    businessName: text("business_name"),
    bigPromise: text("big_promise"),
    /** Who the Big Promise is for. One field for the whole business; offers and webinars refine it, nothing else copies it. */
    audience: text("audience"),
    /**
     * Emails from HelixOS, per member (29 Sep): the coach's switch on their client page, every change logged. Off means no
     * automated email of any kind; a client the import creates starts off. Read only through canEmail (src/lib/email-gate.ts).
     */
    emailsEnabled: integer("emails_enabled", { mode: "boolean" }).notNull().default(true),
    reminderHour: integer("reminder_hour").notNull().default(8),
    eveningReminderHour: integer("evening_reminder_hour").notNull().default(19),
    leaderboardOptIn: integer("leaderboard_opt_in", { mode: "boolean" }).notNull().default(true),
    /** The Monday scoreboard email (rev 639): on unless the member turns it off; the Emails switch above still overrides it. */
    scoreboardEmail: integer("scoreboard_email", { mode: "boolean" }).notNull().default(true),
    /** The Monday (the member's own date) the last scoreboard went out for, so an hourly job that runs twice sends it once. */
    scoreboardSentWeek: text("scoreboard_sent_week"),
    /** My Board (rev 664): the hours a week the member can give their business; asked on first use. Jordan keeps every plan within it. */
    boardHours: integer("board_hours"),
    /** "Let my Board see my energy, sleep and training": off unless the member turns it on; the daily summary only, never meds or body numbers. */
    boardSeesBody: integer("board_sees_body", { mode: "boolean" }).notNull().default(false),
    /** The coach's own Board may use the Edge Preset; a client's is always standard. */
    boardPreset: text("board_preset", { enum: ["standard", "edge"] }).notNull().default("standard"),
    /** The photo rooms' look (revs 711, 720, 738): "auto" is night from 19:00 to 06:00 in the member's own time; the toggle sets "day" or "night" and it stays. One setting for the Council Chamber, the Colosseum and the Aqueduct. */
    sceneLook: text("scene_look", { enum: ["auto", "day", "night"] }).notNull().default("auto"),
    /** The Colosseum (rev 699 §6): the member's own photo in the arena (off; only they turn it on), hiding from the arena and standings, and Pause remembered. */
    arenaPhoto: integer("arena_photo", { mode: "boolean" }).notNull().default(false),
    arenaHidden: integer("arena_hidden", { mode: "boolean" }).notNull().default(false),
    arenaPaused: integer("arena_paused", { mode: "boolean" }).notNull().default(false),
    /** When the member last closed "N people applauded your win" on Today (H-1171); null until the first one. */
    applauseSeenAt: text("applause_seen_at"),
    /** My Helix (rev 707): "Pause the helix", remembered; and the rungs the member has already seen lit, so the once-glow never repeats. */
    helixPaused: integer("helix_paused", { mode: "boolean" }).notNull().default(false),
    helixSeen: text("helix_seen", { mode: "json" }).$type<string[]>().notNull().default([]),
    /**
     * Tools open as a client reaches them (H-164 §12): the highest My Helix phase reached (it only ever rises, so nothing closes
     * again), the highest whose opening Today has announced, "Show all tools" (the member's or the coach's switch; on for everyone
     * here before this, so nothing anyone used went away) and the share of rungs done, for the progress line under the logo.
     */
    toolsPhase: integer("tools_phase").notNull().default(0),
    toolsAnnounced: integer("tools_announced").notNull().default(0),
    showAllTools: integer("show_all_tools", { mode: "boolean" }).notNull().default(false),
    helixPct: integer("helix_pct").notNull().default(0),
    /** The Aqueduct (rev 711): "Pause the water", and the period (30 or 7 days), both remembered. */
    aqueductPaused: integer("aqueduct_paused", { mode: "boolean" }).notNull().default(false),
    aqueductPeriod: integer("aqueduct_period").notNull().default(30),
    /** The Aqueduct's repair moment (H-327 §4, plan H-637): the leak the member last saw ({ step: -1 for none, rate, period, date }); null until the first visit. Read with readSeen. */
    aqueductRepairSeen: text("aqueduct_repair_seen", { mode: "json" }).$type<{ step: number; rate: number | null; period: number; date: string }>(),
    /** The Setup card (H-270 §1): when the Start Here video played to the end (S1a), and when Settings → You was last saved by the member (S2: the time zone and reminder hours, chosen rather than defaulted). */
    startHereWatchedAt: text("start_here_watched_at"),
    profileSavedAt: text("profile_saved_at"),
    /** The streak's week (H-289 §2): every day (the default) or Monday to Friday, the member's own choice under Settings → You. */
    workDays: text("work_days", { enum: ["weekdays", "all"] }).notNull().default("all"),
    /** The menu as this member left it (H-333): which groups are collapsed, and whether the desktop sidebar is a rail. Shared across their devices. */
    navState: text("nav_state", { mode: "json" }).$type<{ collapsed?: Record<string, boolean>; rail?: boolean }>().notNull().default({}),
    /** The streak recount (H-289 §4): the points it added for this member, null until the coach applied it; and when the member saw Today's one line about it. */
    streakRecountPoints: integer("streak_recount_points"),
    streakRecountSeenAt: text("streak_recount_seen_at"),
    /** The Daily welcome (H-312): the member's own date it last showed, so it shows once a day on any device. */
    welcomeShownOn: text("welcome_shown_on"),
    /** The first arrival (H-472): when this member saw the welcome ceremony on their first sign-in; the migration stamps everyone before it. */
    firstArrivalSeenAt: text("first_arrival_seen_at"),
    /** The streak flame (H-558): the streak day whose daily surge has played, so it plays once per day. */
    streakSurgeSeenOn: text("streak_surge_seen_on"),
    // The one-time "We're showing times in {zone}" line (H-457): when the member saw it, or chose their zone in Settings.
    tzPromptSeenAt: text("tz_prompt_seen_at"),
    /** The living scenes' sounds (H-400): the crowd, the applause and the fire loop; one switch, on by default, the member's own. */
    soundsOn: integer("sounds_on", { mode: "boolean" }).notNull().default(true),
    /** "Scene motion" (Roma Vivit 2 PR 6, H-1060): off draws every living scene still, as reduced motion does; on by default, the member's own. */
    sceneMotion: integer("scene_motion", { mode: "boolean" }).notNull().default(true),
    /** Team access (H-413): the newest Office Hours request a team member booked for this owner, until the owner opens Office Hours. */
    oohNotice: text("ooh_notice", { mode: "json" }).$type<{ teamUserId: string; friday: string; requestId: string; at: string }>(),
    /** My Board's four chosen seats (rev 756), board_seats ids in chair order: left, right, front left, front right. Null: the archetypes. */
    boardCouncil: text("board_council", { mode: "json" }).$type<string[]>(),
    /** My Board's memory (H-257): "Start fresh" stamps this; the Board then reads only decisions made after it (a database stamp, UTC). Undo for seven days clears it. */
    boardFreshStartAt: text("board_fresh_start_at"),
    /** The Magic funnel (rev 812 §8): a client's switch, off until Danno turns it on for that client; the coach's own is always on. */
    mfEnabled: integer("mf_enabled", { mode: "boolean" }).notNull().default(false),
    /** Pages written a day, at most (rev 837: 300, editable in Coach). Past it, pages use the default copy. */
    mfDailyCap: integer("mf_daily_cap").notNull().default(300),
    /** The hosts the member's GoHighLevel pages live on: the only origins /api/mf answers (CORS). */
    mfDomains: text("mf_domains", { mode: "json" }).$type<string[]>().notNull().default([]),
    startedAt: text("started_at").notNull().default(sql`(date('now'))`),
    passEnabled: integer("pass_enabled", { mode: "boolean" }).notNull().default(false),
    passName: text("pass_name"),
    passUrl: text("pass_url"),
    passWebhookUrl: text("pass_webhook_url"),
    passHashtag: text("pass_hashtag"),
    passCommunityUrl: text("pass_community_url"),
    certEnabled: integer("cert_enabled", { mode: "boolean" }).notNull().default(false),
    /**
     * Body ships dark (handoff rev 195): off for everyone until turned on per member by scripts/body-flag.ts, never in the UI. Off
     * means no Body nav entry, no Body line on Today, a 404 on /body, /body/* and the Body export, and no Body card on the coach's
     * client page.
     */
    bodyEnabled: integer("body_enabled", { mode: "boolean" }).notNull().default(false),
    /**
     * "Let my coach work in my HelixOS" (rev 216): whether a coach switched into this client may create and edit, not only
     * look. On by default for every new client, every tier (Danno, 1 Oct: some clients cannot find things, and he sets them up);
     * the client turns it off in Settings, and the roster marks who has.
     */
    coachCanWork: integer("coach_can_work", { mode: "boolean" }).notNull().default(true),
    /**
     * One Open per client (H-164 §6): how the coach last opened this client's HelixOS, View or Work, remembered per client so
     * the list's Open button goes straight there. Null until the first Open (View). Work is still subject to coachCanWork.
     */
    coachOpenMode: text("coach_open_mode", { enum: ["view", "work"] }),
    /** A test account (H-164 §8): labelled Test and sorted to the bottom of the coach's client list; a tick on the client page, never a name. */
    testAccount: integer("test_account", { mode: "boolean" }).notNull().default(false),
    /**
     * "Let my coach's assistant know my progress" (Community Loyalty chat, rev 241): whether HelixOS posts a short progress
     * snapshot (pathway stage, goal, this week's 3-1-3, main offer) to the coach's bot. On by default; the member's own switch.
     */
    chatProgressShare: integer("chat_progress_share", { mode: "boolean" }).notNull().default(true),
    /** The last progress push for this member, so pushes come at most once an hour. */
    lastChatPushAt: text("last_chat_push_at"),
    eoPassUrl: text("eo_pass_url"),
    /** The Evolve Omega pass on eLoyalty, three identifiers (src/lib/engine/eloyalty.ts): the customer id is the key; the serial is a cache that goes stale on reinstall; the pass type id addresses v1 writes. Filled by the creation call. */
    eoCustomerId: text("eo_customer_id"),
    eoPassSerial: text("eo_pass_serial"),
    eoPassTypeId: text("eo_pass_type_id"),
    eoPassInstalledAt: text("eo_pass_installed_at"),
    /** The points sync (H-867): the Level last written to the pass, and the invitations already sent (each goes once). */
    eoLevelSent: text("eo_level_sent"),
    /** The Tier last written to the pass (H-1098): the kept rank, so each change is written once. */
    eoTierSent: text("eo_tier_sent"),
    eoOffersSent: text("eo_offers_sent", { mode: "json" }).$type<string[]>().notNull().default([]),
    eoPassLastPushAt: text("eo_pass_last_push_at"),
    /** The coach's Community Loyalty inbound webhook for the Rung Dripper: the URL is the credential (no auth on it), sealed at rest, never rendered, never logged. */
    clDripWebhookUrl: text("cl_drip_webhook_url"),
    /** Ship's rungs-only inbound webhook on Community Loyalty (rev 625): the rungs and the two posts' ids, never the post. Sealed. */
    clRungsWebhookUrl: text("cl_rungs_webhook_url"),
    /** Bot Features (rev 618): the milestones the coach says this client has reached where HelixOS can't see them (or overrides). */
    botUnlocks: text("bot_unlocks", { mode: "json" }).$type<Behavior[]>().notNull().default([]),
    /** The Community Loyalty contact that holds the drip state for this coach (user_ns). */
    clUserNs: text("cl_user_ns"),
    /** The client's own Community Loyalty (uChat) API token: sealed at rest, never rendered, never logged. One per client workspace. */
    clApiToken: text("cl_api_token"),
    /** When the member's own key last passed its test call (rev 850): the coach's row shows CL ✓ with this date. */
    clConnectedAt: text("cl_connected_at"),
    /** When the coach last emailed this member the link to Connect your tools (rev 850). */
    connectLinkSentAt: text("connect_link_sent_at"),
    /** The bot fields last pushed, by name: the Stage 1 names and their values only, never the token and never a webhook URL. */
    clBotFields: text("cl_bot_fields", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    clBotFieldsPushedAt: text("cl_bot_fields_pushed_at"),
    /** A fingerprint of HelixOS's Stage 1 record at the last push, so the Coach page can say "changed since the last push" without reading the bot. */
    clBotSourceKey: text("cl_bot_source_key"),
    /**
     * The member's profile photo (client headshots, Danno 8 Oct): the original and a 512 square display copy, both in the
     * private proof store under headshots/, read only through /api/headshots/[membershipId]. `headshotSource` says who set it:
     * the coach's Airtable import, the member's own upload (an import never overwrites it), or removed by the member (an
     * import never puts it back). A profile photo is never consent to publish it: proof cards, ads and graphics keep their gate.
     */
    headshotUrl: text("headshot_url"),
    headshotDisplayUrl: text("headshot_display_url"),
    headshotMime: text("headshot_mime"),
    headshotSource: text("headshot_source", { enum: HEADSHOT_SOURCES }),
    /** The Airtable attachment id the import last stored: a re-run stores only a photo whose attachment changed. */
    headshotAirtableId: text("headshot_airtable_id"),
    headshotUpdatedAt: text("headshot_updated_at"),
    /** The keyword router's two fields as last confirmed on the bot (Ship a ladder commit 2): helix_keywords_cbf and helix_keyword_agent_cbf, by name. */
    clKeywordsHeld: text("cl_keywords_held", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    clKeywordsPushedAt: text("cl_keywords_pushed_at"),
    /** What the bot says when asked about price in price mode "never", for this coach, not per offer. Null means PRICE_ANSWER_DEFAULT. */
    priceAnswer: text("price_answer"),
    /* The bot sales rules (handoff rev 80): the coach-level lines the offers field is composed from. Each is the coach's own words. */
    /** WHAT I DO: one paragraph, the first thing the bot knows about the business. */
    whatIDo: text("what_i_do"),
    /** How the bot handles price: never (the deflect line), range (the coach's range line), full (each bot offer's price). */
    priceMode: text("price_mode", { enum: ["never", "range", "full"] }).notNull().default("full"),
    /** Said when asked about price in range mode, verbatim. Needs your eyes. */
    rangeLine: text("range_line"),
    /** Said when asked about payment plans. Null means PAYMENT_PLAN_LINE_DEFAULT. Needs your eyes. */
    paymentPlanLine: text("payment_plan_line"),
    /** The guarantee as the bot says it, verbatim, written by the coach and approved by hand; never composed. Null means no guarantee on the bot. */
    guaranteeLine: text("guarantee_line"),
    /** What the guarantee covers and does not, as the bot says it. A suggestion is built from the offers; the coach's text is sent. */
    guaranteeCoverageLine: text("guarantee_coverage_line"),
    /** The guarantee's terms, structured, for the terms page and the tracker to read one record. Not sent to the bot. */
    guaranteeTerms: text("guarantee_terms", { mode: "json" }).$type<GuaranteeTerms>().notNull().default({}),
    /** Where the full terms live (a GHL page for now). */
    guaranteeTermsUrl: text("guarantee_terms_url"),
    /* How the bot sells (handoff rev 90 to 109, the Bot flow rev 4 tab): facts it knows, how the coach talks, and their stories. */
    /** After the questions, where most people go: the call, or the first entry offer's link. */
    defaultPath: text("default_path", { enum: ["call", "link"] }).notNull().default("call"),
    /** Prices on the bot (rev 121). Off composes the no-prices rules: no amounts, terms or links, no entry or core offer named, everyone to the call. */
    botPricesOn: integer("bot_prices_on", { mode: "boolean" }).notNull().default(true),
    /** How long the call is, in minutes: "the 15-minute call". Blank says "the call". */
    callMinutes: integer("call_minutes"),
    /** The one-on-one range as a fact ("$25,000 to $50,000 a year"): the contrast when recommending, never the answer to an early price question. Needs your eyes. */
    oneOnOneRange: text("one_on_one_range"),
    /** An optional lead-in before the guarantee promise, free words ("If you're putting skin in the game, I put skin in the game too."). Outside approval. */
    guaranteeLeadIn: text("guarantee_lead_in"),
    /** What the coach calls the people they work with, in the stories heading: "partners". Blank means "clients". */
    peopleWord: text("people_word"),
    /** HOW I SAY IT: short examples in the coach's words, each typed normal or objection. Outside approval. */
    botExamples: text("bot_examples", { mode: "json" }).$type<BotExampleRow[]>().notNull().default([]),
    /** MY STORIES: true stories from the coach's own life, plain or answering a belief. Each through Needs your eyes. */
    botStories: text("bot_stories", { mode: "json" }).$type<BotStoryRow[]>().notNull().default([]),
    /** The three questions the bot asks, for the coach, not per offer. Blank means the house default. */
    botQuestion1: text("bot_question_1"),
    botQuestion2: text("bot_question_2"),
    botQuestion3: text("bot_question_3"),
    /** Bot connection (rev 696, rev 808): the link the bot sends to book a call, and what to expect when you book. */
    bookingUrl: text("booking_url"),
    bookingExpect: text("booking_expect"),
    /** Who pressed the last Stage 1 push that landed: the member themself or their coach. */
    clBotFieldsPushedBy: text("cl_bot_fields_pushed_by"),
    /** The Community Loyalty agent the Bot Brief reads and pushes to (ai_agent_ns). Empty means the workspace's first agent. */
    clAgentNs: text("cl_agent_ns"),
    /** The one bot field the approved FAQ answers are composed into. Empty means the default in src/lib/engine/faq.ts. */
    faqBotField: text("faq_bot_field"),
    /** The coach has been warned and still wants the FAQ written to a field that already holds text HelixOS did not write. */
    faqOverwriteOk: integer("faq_overwrite_ok", { mode: "boolean" }).notNull().default(false),
    /** A soft remove by the coach: access ends on the next request, reminders stop, the client drops out of the coach's counts. The data stays; reinstate clears both. */
    removedAt: text("removed_at"),
    removedBy: text("removed_by"),
    /** Coach override of the workspace's daily AI cap for this member. */
    aiCapExempt: integer("ai_cap_exempt", { mode: "boolean" }).notNull().default(false),
    /** Highest tier level the member has seen the celebration for. Null until first seen: then stamped silently. */
    celebratedTierLevel: integer("celebrated_tier_level"),
    /** The highest rank whose relic clip the member has seen (H-934): the catch-up plays once for a rank reached before the clips. */
    rankClipSeenLevel: integer("rank_clip_seen_level"),
    /**
     * The highest rank this member has ever held (H-1088): backfilled once from the old thresholds, raised whenever points take
     * them past it, never lowered. Their rank is the higher of this and the rank their points earn under the current table.
     */
    rankKeptLevel: integer("rank_kept_level"),
    /** The newest What's new entry (its `n`, src/content/whats-new.ts) this member has opened the page since: the menu dot. */
    whatsNewSeen: integer("whats_new_seen"),
    /** The member's own timezone. Null means the workspace's. "Today", reminder hours and streak boundaries all follow it. */
    timezone: text("timezone"),
    lastNudgedAt: text("last_nudged_at"),
    /** Tick one: at connection the member acknowledged that anything harvested from a recording is someone else's words. Date of the tick. */
    fathomConsentAt: text("fathom_consent_at"),
    /** A coach's last look at Monthly feedback (rev 432 item 4): responses sent or changed after it count as new. */
    feedbackSeenAt: text("feedback_seen_at"),
    lastComebackAt: text("last_comeback_at"),
    /**
     * Team access (Danno, 6 Oct): how many team members this member may have at once (live rows in team_members). Five by
     * default; the coach adjusts it on the client page. No invite goes out once live members plus open invites reach it.
     */
    teamCap: integer("team_cap").notNull().default(5),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_ws_user").on(t.workspaceId, t.userId)],
);

/** Business goals (rev 530, BG1): the plan's three kinds of record and the five states one can be in. Never Body's Health goals. */
export const PLAN_KINDS = ["goal", "key_result", "initiative"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const PLAN_STATUSES = ["not_started", "on_track", "behind", "done", "dropped"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
/**
 * One record of a member's business plan: a goal, a key result or an initiative, each scoped to the workspace and member on
 * every read and write. The owner is a name, free text (Danno, 6 Oct). An initiative carries Lindsey's budget and hire
 * trigger. `goalId` names the legacy goals row a Primary business goal was moved in from, so Today's bar keeps reading it.
 */
export const planRecords = sqliteTable(
  "plan_records",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: PLAN_KINDS }).notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: PLAN_STATUSES }).notNull().default("not_started"),
    owner: text("owner"),
    dueDate: text("due_date"),
    notes: text("notes"),
    pathwayStage: text("pathway_stage"),
    order: integer("order").notNull().default(0),
    budget: real("budget"),
    hireTrigger: text("hire_trigger"),
    /** The member's Primary business goal: the one Today's bar reads (moved in from the goals table). */
    primary: integer("primary", { mode: "boolean" }).notNull().default(false),
    goalId: text("goal_id"),
    /** The Airtable V1 record an imported record came from (BG5), so a re-run updates it. */
    sourceRef: text("source_ref"),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [index("plan_records_user").on(t.workspaceId, t.userId, t.kind)],
);
export type PlanRecord = typeof planRecords.$inferSelect;
/** A link in the plan: goal to key result, key result to initiative, initiative to task; many to many where the brief allows. */
export const planLinks = sqliteTable(
  "plan_links",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    fromId: text("from_id").notNull(),
    toKind: text("to_kind", { enum: ["record", "task"] }).notNull().default("record"),
    toId: text("to_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("plan_links_pair").on(t.fromId, t.toId), index("plan_links_user").on(t.workspaceId, t.userId)],
);
export type PlanLink = typeof planLinks.$inferSelect;

/** Business goals BG2: a KPI measures a key result or a goal. Its source says where the actual comes from. */
export const KPI_PERIODS = ["week", "month", "quarter", "year", "range"] as const;
export type KpiPeriod = (typeof KPI_PERIODS)[number];
export const KPI_SOURCES = ["numbers", "manual", "close"] as const;
export type KpiSource = (typeof KPI_SOURCES)[number];
/**
 * One KPI: a name, a unit, a target over a period, and how the actual is found: a daily-log counter summed over the period
 * (Numbers, never typed twice), typed by hand (manual), or asked for in the evening close (close). Linked to one plan record.
 */
export const kpis = sqliteTable(
  "kpis",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    recordId: text("record_id").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("count"),
    target: real("target").notNull().default(0),
    period: text("period", { enum: KPI_PERIODS }).notNull().default("month"),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    source: text("source", { enum: KPI_SOURCES }).notNull().default("manual"),
    /** The daily-log counter a Numbers KPI sums (a TARGET_METRICS key). */
    metric: text("metric"),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [index("kpis_record").on(t.workspaceId, t.userId, t.recordId)],
);
export type Kpi = typeof kpis.$inferSelect;
/** One value per KPI per day, for the manual and close sources; a Numbers KPI never writes here. */
export const kpiValues = sqliteTable(
  "kpi_values",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    kpiId: text("kpi_id").notNull(),
    date: text("date").notNull(),
    value: real("value").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("kpi_values_day").on(t.kpiId, t.date), index("kpi_values_user").on(t.workspaceId, t.userId)],
);
export type KpiValue = typeof kpiValues.$inferSelect;

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
  /** The Airtable record (or row part) an imported goal came from, so a re-run updates it. */
  sourceRef: text("source_ref"),
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
    category: text("category", { enum: ["sales", "content", "community", "system", "admin", "fulfillment", "personal"] })
      .notNull()
      .default("sales"),
    dueDate: text("due_date"),
    focusDate: text("focus_date"),
    completedAt: text("completed_at"),
    points: integer("points").notNull().default(5),
    source: text("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    repeatEveryDays: integer("repeat_every_days"),
    /** Who does it, as free text: an imported task's assignee, until HelixOS has team members. */
    assignee: text("assignee"),
    /** An imported task's links as the source had them (its first-base id, goals, initiatives), kept to rebuild the links later. */
    importRefs: text("import_refs", { mode: "json" }).$type<{ v1: string | null; goals: string[]; initiatives: string[] }>(),
    /**
     * An imported task still waiting for its owner (30 Sep): "to_review" until they Keep it (back to null, a normal task) or Let go
     * ("let_go", hidden, never deleted). Only tasks with no review state show on Today, in the lock-in and in Tasks' own lists.
     */
    reviewState: text("review_state", { enum: ["to_review", "let_go"] }),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_user_status").on(t.userId, t.status), index("tasks_user_due").on(t.userId, t.dueDate)],
);

export const CONTENT_STATUSES = ["idea", "creating", "ready", "scheduled", "posted"] as const;
/**
 * Where a record's text came from and whether a person has read it. ai_unreviewed is set when a model's text is stored;
 * it becomes ai_accepted on an explicit Accept or edited on any coach edit (an edit counts as review). Coach-written text
 * is coach. rule is text a rule composed from what the coach chose (a principle's post, a rules variant, a ladder's rungs,
 * a magnet's scaffold): never gated, since its words are Danno's doctrine the coach picked or a reshaping of the coach's
 * own. Rows from before the column stay null, never guessed and never flagged; a section row made empty is null until
 * someone writes its text. Only ai_unreviewed is ever gated.
 */
export const ORIGINS = ["ai_unreviewed", "ai_accepted", "edited", "coach", "rule"] as const;
export type Origin = (typeof ORIGINS)[number];
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
    /** The first comment under the post, sent to the Social Planner as its follow-up comment on the Facebook page and Instagram. Optional, the client's words. */
    firstComment: text("first_comment"),
    postAt: text("post_at"),
    postedAt: text("posted_at"),
    postLink: text("post_link"),
    mediaUrl: text("media_url"),
    /** A proof attachment the client picked as this post's media: previewed in-app, never written to mediaUrl or sent to the Social Planner (private storage has no public address). */
    mediaAttachmentId: text("media_attachment_id"),
    engagements: integer("engagements").notNull().default(0),
    views: integer("views").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    notes: text("notes"),
    origin: text("origin", { enum: ORIGINS }),
    createdAt: createdAt(),
  },
  (t) => [index("content_user_status").on(t.userId, t.status), index("content_user_post_at").on(t.userId, t.postAt)],
);

export const CONTACT_STAGES = ["new", "replied", "conversation", "call_booked", "no_show", "client", "cold"] as const;
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
    /** The identity a push needs: an email or a phone. Optional to note a name just met; required to move to a stage that pushes. */
    email: text("email"),
    phone: text("phone"),
    /** GoHighLevel's id for this person, stored on the first push: every push after that targets it, and matching never happens again. */
    ghlContactId: text("ghl_contact_id"),
    /** The chatbot subscriber id, for a lead with neither email nor phone; the key that path pushes on. Phase 2 fills it. */
    userNs: text("user_ns"),
    whatTheyreBuilding: text("what_theyre_building"),
    notes: text("notes"),
    lastOutboundAt: text("last_outbound_at"),
    lastInboundAt: text("last_inbound_at"),
    nextFollowUpAt: text("next_follow_up_at"),
    callAt: text("call_at"),
    /** When the call was booked (GoHighLevel's appointment webhook): the date the scoreboard counts it in, not the call's own date. */
    callBookedAt: text("call_booked_at"),
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
/* ───────────────────────── End-of-month feedback (handoff rev 124) ───────────────────────── */
export const monthlyFeedback = sqliteTable(
  "monthly_feedback",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** The month it is about ("YYYY-MM"), set from the date, never picked. */
    month: text("month").notNull(),
    /** Most proud of this past month. The member's own words: never a client result, never sent to Proof Bank or the bot. */
    proud: text("proud").notNull(),
    love: text("love").notNull(),
    less: text("less").notNull(),
    more: text("more").notNull(),
    wow: text("wow").notNull(),
    /** How likely they are to refer, 1 to 10, whole numbers. */
    referralScore: integer("referral_score").notNull(),
    /** Who they know who'd benefit. */
    referral: text("referral"),
    /** Their favorite part of the experience so far. Required from rev 129; nullable for any sent before. */
    favorite: text("favorite"),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("monthly_feedback_member_month").on(t.workspaceId, t.userId, t.month)],
);
export type MonthlyFeedback = typeof monthlyFeedback.$inferSelect;

/* ───────────────────────── Open Office Hours requests (handoff rev 124) ───────────────────────── */
export const officeHoursRequests = sqliteTable(
  "office_hours_requests",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** The Friday session it is for. */
    friday: text("friday").notNull(),
    description: text("description").notNull(),
    /** How they tried to solve it themselves. */
    triedSelf: text("tried_self").notNull(),
    /** What tools are needed. */
    tools: text("tools"),
    /** What solution we're trying to reach on the call. */
    goal: text("goal").notNull(),
    category: text("category").notNull(),
    /* The coach's, never the member's: who takes it, how it went, and notes. */
    responsible: text("responsible"),
    outcome: text("outcome", { enum: ["covered", "no_show"] }),
    coachNotes: text("coach_notes"),
    /** The Airtable record a backfilled request came from (rev 441), so a second run adds nothing. Null for the app's own. */
    airtableId: text("airtable_id"),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    /** When the member last changed their own request (rev 625): "Edited …". The coach's own notes never set it. */
    editedAt: text("edited_at"),
    /** Team access (H-413): the team member who submitted this request for the owner; null when the owner did. */
    submittedByUserId: text("submitted_by_user_id"),
    /** Who's attending (H-413): user ids of the owner and team members; an empty list reads as the owner alone. */
    attendeeUserIds: text("attendee_user_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Attendees not on HelixOS, names only (H-413); never an email or a phone number. */
    attendeesOther: text("attendees_other"),
    createdAt: createdAt(),
  },
  (t) => [index("office_hours_requests_ws_friday").on(t.workspaceId, t.friday), uniqueIndex("office_hours_requests_airtable").on(t.workspaceId, t.airtableId)],
);
export type OfficeHoursRequest = typeof officeHoursRequests.$inferSelect;

/* ───────────────────────── The weekly calls (H-820, plan H-828) ───────────────────────── */
/** Who a scheduled call is for, the program audiences Recordings uses: Accelerator and up, or Academy and up. */
export const CALL_AUDIENCES = ["accelerator_academy", "academy"] as const;
export type CallAudience = (typeof CALL_AUDIENCES)[number];
/**
 * One weekly call on the program's schedule (H-820, plan H-828), the coach's to edit under Settings → Calls: a weekday and a
 * start in the call's own zone, so a 10:00 Pacific call stays at 10:00 Pacific across a clock change and each member reads it
 * in theirs. A blank link means the workspace's shared link (`workspaces.calls_link`). Office Hours is not one of these.
 */
export const programCalls = sqliteTable(
  "program_calls",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    /** 0 Sunday to 6 Saturday, in the call's zone. */
    weekday: integer("weekday").notNull(),
    /** "HH:MM", 24-hour, the call's wall time in its zone. */
    start: text("start").notNull(),
    minutes: integer("minutes").notNull().default(60),
    timezone: text("timezone").notNull().default("America/Los_Angeles"),
    audience: text("audience", { enum: CALL_AUDIENCES }).notNull().default("academy"),
    link: text("link"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("program_calls_ws").on(t.workspaceId, t.sort)],
);
export type ProgramCall = typeof programCalls.$inferSelect;

/** A date one call doesn't happen ("No call on Thu 27 Nov"): the call's own local date in its zone. */
export const programCallSkips = sqliteTable(
  "program_call_skips",
  {
    id: id(),
    callId: text("call_id")
      .notNull()
      .references(() => programCalls.id, { onDelete: "cascade" }),
    /** "YYYY-MM-DD", the call's local date in its zone. */
    date: text("date").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("program_call_skips_call_date").on(t.callId, t.date)],
);
export type ProgramCallSkip = typeof programCallSkips.$inferSelect;

/* ───────────────────────── Monthly intention (handoff rev 129) ───────────────────────── */
export const monthlyIntentions = sqliteTable(
  "monthly_intentions",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** The month it is for ("YYYY-MM"), from the date, never picked. */
    month: text("month").notNull(),
    /* The eleven answers, in Danno's order. */
    word: text("word").notNull(),
    personalSeason: text("personal_season", { enum: ["self", "wealth", "relationships", "spirituality"] }).notNull(),
    fear: text("fear").notNull(),
    habit: text("habit").notNull(),
    skill: text("skill").notNull(),
    impact: text("impact").notNull(),
    businessSeason: text("business_season", { enum: ["marketing", "sales", "fulfillment", "operations"] }).notNull(),
    /** The member's revenue goal for the month: theirs and their coach's to see, never another member's. */
    revenueGoal: real("revenue_goal").notNull(),
    revenueWhy: text("revenue_why").notNull(),
    plan: text("plan").notNull(),
    proudLast: text("proud_last").notNull(),
    /** What they want to feel most proud of at the month's end: shown back to them, and only them, on that month's feedback. */
    proudEnd: text("proud_end").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("monthly_intentions_member_month").on(t.workspaceId, t.userId, t.month)],
);
export type MonthlyIntention = typeof monthlyIntentions.$inferSelect;

/* ───────────────────────── The community connection (handoff revs 150 to 154) ───────────────────────── */
/**
 * One per workspace: where and when HelixOS posts into the coach's GoHighLevel community. Posts go out through the Social
 * Planner on the connection of the coach who set this up (their own token, on Settings → Publishing), from a team user.
 */
export const communitySettings = sqliteTable(
  "community_settings",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    /** The coach whose GoHighLevel connection posts. */
    coachUserId: text("coach_user_id").notNull(),
    /** The Social Planner account id of the community channel (Intentions), from the accounts list, never typed. */
    channelAccountId: text("channel_account_id"),
    channelName: text("channel_name"),
    /** The Monday post: on or off, the coach's time of day ("HH:MM", their own zone) and their text (null = Danno's default). */
    mondayOn: integer("monday_on", { mode: "boolean" }).notNull().default(false),
    postTime: text("post_time").notNull().default("08:00"),
    mondayText: text("monday_text"),
    /** "Notify all members" for the Monday post (rev 187): on unless the coach turns it off. Test posts never notify. */
    mondayNotify: integer("monday_notify", { mode: "boolean" }).notNull().default(true),
    /** The first-of-the-month post (1 Oct, Danno's priority 1): on or off, its own time of day, its text (null = the default) and notify. */
    monthOn: integer("month_on", { mode: "boolean" }).notNull().default(false),
    monthTime: text("month_time").notNull().default("08:00"),
    monthText: text("month_text"),
    monthNotify: integer("month_notify", { mode: "boolean" }).notNull().default(true),
    /** The graphic each post carries (rev 328: every monthly post ends with a 540 by 540 image): a deck_images row of the coach's, copied to the public store when the post is sent. */
    monthImageId: text("month_image_id"),
    mondayImageId: text("monday_image_id"),
    /** Who the posts come from: the community member contact id of a team member (Danno's own community profile, 28 Sep live test), and the name shown. Never a client. */
    postAsId: text("post_as_id"),
    postAsName: text("post_as_name"),
    /** How a published post's id becomes a link ("https://…{postId}…"). Superseded by linkPatterns; read only as a fallback. */
    linkPattern: text("link_pattern"),
    /** The link pattern per channel (account id → pattern): each channel's address has its own slug, which doesn't follow renames. */
    linkPatterns: text("link_patterns", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    /** Set when GoHighLevel says the account is on hold: nothing posts, and nothing retries, until the coach presses Resume. */
    pausedReason: text("paused_reason"),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("community_settings_workspace").on(t.workspaceId)],
);
export type CommunitySettings = typeof communitySettings.$inferSelect;

/** Every post HelixOS sends to the community, with what happened to it: the coach's log. One Monday post per week and one month post per month, never two. */
export const communityPosts = sqliteTable(
  "community_posts",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    coachUserId: text("coach_user_id").notNull(),
    kind: text("kind", { enum: ["monday", "month", "test"] }).notNull(),
    /** The Monday of the week it is for (monday posts only). */
    weekOf: text("week_of"),
    /** The month it is for, "YYYY-MM" (month posts only). */
    monthOf: text("month_of"),
    title: text("title").notNull(),
    /** Null on a Monday row means the coach's current text at the time it posts. */
    body: text("body"),
    accountId: text("account_id"),
    /** "unknown": sent, but HelixOS can't see whether it went out (28 Sep, live): never Failed on that alone, never Post now. */
    status: text("status", { enum: ["scheduled", "sent", "posted", "failed", "skipped", "unknown"] }).notNull().default("scheduled"),
    /** The Social Planner's own id, then the community's id once published, and the link to it. */
    ghlPostId: text("ghl_post_id"),
    platformPostId: text("platform_post_id"),
    link: text("link"),
    /** Why it failed, in the coach's words (the vendor's reply stays in the server log). */
    error: text("error"),
    /** What the last read-back found (the planner's own status word, or its answer when the read failed), for the coach and for us. */
    checkNote: text("check_note"),
    /** The graphic sent with the post: the library image it came from, and the public copy's key and URL the planner was given. */
    imageId: text("image_id"),
    imageKey: text("image_key"),
    imageUrl: text("image_url"),
    /** Whether this post asked the community to notify every member (the Monday post's setting when it was sent; never a test). */
    notifyAll: integer("notify_all", { mode: "boolean" }).notNull().default(false),
    /** What GoHighLevel shows the post as from, when it says (the test post settles whether a team user is accepted). */
    authorShown: text("author_shown"),
    sentAt: text("sent_at"),
    postedAt: text("posted_at"),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("community_posts_week").on(t.workspaceId, t.kind, t.weekOf), uniqueIndex("community_posts_month").on(t.workspaceId, t.kind, t.monthOf), index("community_posts_workspace").on(t.workspaceId, t.createdAt)],
);
export type CommunityPost = typeof communityPosts.$inferSelect;

/**
 * "Share to the thread" taps: one per member per week (the week's 3-1-3) and one per member per month (the month's eleven
 * answers, 1 Oct), the points on the first of each. What the coach's cards count. A row has a week or a month, never both.
 */
export const communityShares = sqliteTable(
  "community_shares",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    weekOf: text("week_of"),
    monthOf: text("month_of"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("community_shares_member_week").on(t.workspaceId, t.userId, t.weekOf), uniqueIndex("community_shares_member_month").on(t.workspaceId, t.userId, t.monthOf)],
);

/* ───────────────────────── Weekly intention: the 3-1-3 (handoff rev 124) ───────────────────────── */
/**
 * A key result as set and as checked on Friday (rev 158): `actual` is "how many did you get", against the number in the text;
 * `kept` marks one saved as written though it reads like a task, for the coach.
 */
/** `krId` (H-198): the member's own key result in Business goals this one counts toward; its Friday number is logged there. */
export type IntentionKeyResult = { text: string; done: boolean | null; actual?: number | null; kept?: boolean; krId?: string | null };
export type IntentionTask = { title: string; taskId: string | null };
export const weeklyIntentions = sqliteTable(
  "weekly_intentions",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** The Monday of the week it is for. */
    weekOf: text("week_of").notNull(),
    /** ONE word to embody this week. */
    word: text("word").notNull(),
    /** THREE trackable key results (the third optional), each marked done or not at the end of the week. */
    keyResults: text("key_results", { mode: "json" }).$type<IntentionKeyResult[]>().notNull().default([]),
    /** ONE initiative toward the bigger goal. */
    initiative: text("initiative").notNull(),
    /** THREE tasks that move the needle (the third optional), each also a row in tasks for the week. */
    tasks: text("tasks", { mode: "json" }).$type<IntentionTask[]>().notNull().default([]),
    /** When the key results were marked done or not; null until then. */
    reviewedAt: text("reviewed_at"),
    /** The intention chain (H-198): the member's initiative in Business goals this week rolls up under; null until they link it. */
    initiativeId: text("initiative_id"),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("weekly_intentions_member_week").on(t.workspaceId, t.userId, t.weekOf)],
);
export type WeeklyIntention = typeof weeklyIntentions.$inferSelect;

export const dailyLogs = sqliteTable(
  "daily_logs",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    morningDoneAt: text("morning_done_at"),
    eveningDoneAt: text("evening_done_at"),
    /** The Daily welcome (H-312, reading A): the first open of the app that day. Opening counts as showing up, so this makes the day active. */
    openedAt: text("opened_at"),
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
    /** Docket #9 (H-195): wins that weren't on the list, counted in the close. Outreach in any app feeds the Aqueduct's DMs started stage. */
    outreachMessages: integer("outreach_messages").notNull().default(0),
    scriptsWritten: integer("scripts_written").notNull().default(0),
    videosRecorded: integer("videos_recorded").notNull().default(0),
    videosPosted: integer("videos_posted").notNull().default(0),
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
  "community",
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
    /** The points sync (H-867): set once this row has been queued to eLoyalty, alone or inside a member's opening move. */
    eoMirrored: integer("eo_mirrored", { mode: "boolean" }).notNull().default(false),
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

/**
 * A client's loyalty-pass leaderboard (rev 639): their eLoyalty (WalletPush) key, set by the coach on their /coach row and
 * sealed (it is a full admin key: never shown, logged or returned, only its last four), and the public feed it serves at
 * /api/public/leaderboard/<slug> with first names, initials, points and tiers only. Read-only on eLoyalty, always.
 */
export const leaderboardFeeds = sqliteTable(
  "leaderboard_feeds",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    membershipId: text("membership_id").notNull(),
    /** The feed's public address: the client's name and a random tail, so it can't be guessed from the name alone. */
    slug: text("slug").notNull(),
    keyEncrypted: text("key_encrypted"),
    keyLast4: text("key_last4"),
    /** The host the coach gave (default www.eloyalty.ai); the one that answered 2xx is kept once a check passes. */
    host: text("host").notNull().default("https://www.eloyalty.ai"),
    templateId: text("template_id"),
    /** A second template read during a pass migration (H-32): members on either pass, nobody counted twice. */
    templateIdAlt: text("template_id_alt"),
    /** eLoyalty customer ids the client leaves off the board, one per line on their Settings. */
    hidden: text("hidden", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** The hosted page's settings (H-28): copy, the pass link, tiers, rewards, the sample marks and the zero rule. JSON, read by src/lib/engine/leaderboard.ts. */
    pageJson: text("page_json"),
    /** A pasted Points & Transactions export, already stripped to "First L.", lifetime and available: the board before a key is in. */
    exportJson: text("export_json"),
    exportAsOf: text("export_as_of"),
    /** After a 429 the cron leaves this feed alone until this time (0161). */
    refreshAfter: text("refresh_after"),
    /** The points check (H-102, 0165): one sealed snapshot, "First L." and numbers only, so the coach can reopen the table; and when it ran. */
    pointsCheckSealed: text("points_check_sealed"),
    pointsCheckAt: text("points_check_at"),
    /** The last check, in words: the host, the member count and the field names seen (names only, never a value). */
    lastCheckAt: text("last_check_at"),
    lastCheckOk: integer("last_check_ok", { mode: "boolean" }),
    lastCheckNote: text("last_check_note"),
    /**
     * The Points desk (H-493, 0191): the HelixOS accounts of the client's team members the coach has let move points (the
     * community manager, H-429). A coach working in the client's HelixOS can always use it; nobody else ever can.
     */
    deskUserIds: text("desk_user_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** The coach's pause: while on, moves wait in the outbox and nothing is sent to eLoyalty. */
    movesPaused: integer("moves_paused", { mode: "boolean" }).notNull().default(false),
    /**
     * The coach's own program only (the Evolve Omega pass, H-622, 0202): whether clients may get a pass on it ("Get my pass" on
     * Rewards). Off until the coach's own live test has passed; the coach can always get their own.
     */
    issuePasses: integer("issue_passes", { mode: "boolean" }).notNull().default(false),
    /** The loyalty health view (H-622 §2): the program's Pass Type ID and its certificate's expiry, typed in from the portal. */
    passTypeId: text("pass_type_id"),
    certExpiresAt: text("cert_expires_at"),
    /** 429s from eLoyalty in the current 24-hour window, and when the last one came. */
    rateLimitedCount: integer("rate_limited_count").notNull().default(0),
    rateLimitedAt: text("rate_limited_at"),
    /** The points sync on the coach's own program (H-867 part 3): "off", "own" (the coach's pass only, step G) or "all" (step H). */
    syncMode: text("sync_mode", { enum: ["off", "own", "all"] }).notNull().default("off"),
    /** The invitations (H-867 part 4): "off", "own" (the coach's own test, step I) or "all"; and each rung's booking link. */
    inviteMode: text("invite_mode", { enum: ["off", "own", "all"] }).notNull().default("off"),
    inviteLinks: text("invite_links", { mode: "json" }).$type<Partial<Record<"academy" | "elite" | "lux", string>>>().notNull().default({}),
    /** The one add-and-deduct check on a team test pass (H-493): when it last ran, whether both moves landed, and what it saw, in words and numbers. The desk stays shut until it passes. */
    deskCheckAt: text("desk_check_at"),
    deskCheckOk: integer("desk_check_ok", { mode: "boolean" }),
    deskCheckNote: text("desk_check_note"),
    /** The last good feed, served when eLoyalty is busy or down; already stripped to what the page shows. */
    cacheJson: text("cache_json"),
    cachedAt: text("cached_at"),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("leaderboard_feeds_slug").on(t.slug), uniqueIndex("leaderboard_feeds_membership").on(t.membershipId)],
);
export type LeaderboardFeed = typeof leaderboardFeeds.$inferSelect;

/**
 * A leaderboard's earlier addresses (H-109): every slug a feed has had, once replaced, so /lb/<old> keeps redirecting (308) and
 * the old feed URL keeps answering, however many times the address changes. A slug is unique across feeds and aliases together.
 */
export const leaderboardSlugAliases = sqliteTable(
  "leaderboard_slug_aliases",
  {
    id: id(),
    feedId: text("feed_id").notNull(),
    slug: text("slug").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("leaderboard_slug_aliases_slug").on(t.slug), index("leaderboard_slug_aliases_feed").on(t.feedId)],
);
export type LeaderboardSlugAlias = typeof leaderboardSlugAliases.$inferSelect;

/**
 * The points outbox (H-404, H-493): every Kindness Koins move HelixOS makes on a client's eLoyalty program, one row each,
 * always a delta (an add or a deduct by customer id), never a set. `source` is unique, so one desk press, one check step or
 * one approved claim can make one move only, however often it is retried. A move whose answer was lost is never sent again
 * blind: the customer's events are read first for its tag. `eventId` and `newBalance` are eLoyalty's own answer.
 */
export const loyaltyPointsMoves = sqliteTable(
  "loyalty_points_moves",
  {
    id: id(),
    feedId: text("feed_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    /** The eLoyalty customer the points move on. */
    customerId: text("customer_id").notNull(),
    /** Positive adds, negative deducts. Never zero. */
    delta: integer("delta").notNull(),
    /** The reason sent to eLoyalty, with the move's own tag at the end so its events can be found. */
    reason: text("reason").notNull(),
    /** What made it: "desk:<id>", "check:<feed>:<time>:deduct", "claim:<id>". Unique. */
    source: text("source").notNull(),
    /** Who pressed it: the HelixOS account (the coach or the team member), never a member of the program. */
    byUserId: text("by_user_id").notNull(),
    /** pending (waiting or retrying), sent (eLoyalty answered yes), failed (refused, or out of tries). */
    status: text("status").notNull().default("pending"),
    /** The last send's outcome was unknown: read the events for the tag before sending again. */
    checkFirst: integer("check_first", { mode: "boolean" }).notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    nextTryAt: text("next_try_at").notNull().default(sql`(datetime('now'))`),
    lastStatus: integer("last_status"),
    lastNote: text("last_note"),
    eventId: text("event_id"),
    newBalance: integer("new_balance"),
    sentAt: text("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("loyalty_points_moves_source").on(t.source), index("loyalty_points_moves_feed").on(t.feedId, t.status, t.nextTryAt)],
);
export type LoyaltyPointsMove = typeof loyaltyPointsMoves.$inferSelect;

/** Bot Features (rev 618): how each feature unlocks in this workspace, one rule per feature, changed by the coach without code. */
export const botFeatureRules = sqliteTable(
  "bot_feature_rules",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    featureKey: text("feature_key", { enum: BOT_FEATURE_KEYS }).notNull(),
    type: text("type", { enum: UNLOCK_TYPES }).notNull(),
    value: text("value").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("bot_feature_rules_ws_key").on(t.workspaceId, t.featureKey)],
);
export type BotFeatureRule = typeof botFeatureRules.$inferSelect;

/** A client's "Turn it on for me": the setup they entered, then On once the coach has switched it on in their bot. Never points. */
export const botFeatureRequests = sqliteTable(
  "bot_feature_requests",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    featureKey: text("feature_key", { enum: BOT_FEATURE_KEYS }).notNull(),
    state: text("state", { enum: REQUEST_STATES }).notNull().default("requested"),
    setup: text("setup", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    requestedAt: text("requested_at").notNull().default(sql`(datetime('now'))`),
    onAt: text("on_at"),
    onBy: text("on_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bot_feature_requests_member_key").on(t.workspaceId, t.userId, t.featureKey), index("bot_feature_requests_ws_state").on(t.workspaceId, t.state)],
);
export type BotFeatureRequest = typeof botFeatureRequests.$inferSelect;

export const rewardClaims = sqliteTable("reward_claims", {
  id: id(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  rewardName: text("reward_name").notNull(),
  pointsSpent: integer("points_spent").notNull().default(0),
  status: text("status", { enum: ["requested", "fulfilled"] }).notNull().default("requested"),
  /** When the coach marked it fulfilled (H-470): the 30-day access rewards open Office Hours from this stamp. */
  fulfilledAt: text("fulfilled_at"),
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
    /** Empty until chosen: a 1:1 diagnostic described as a group program is a mis-sold product, so nothing is assumed. */
    container: text("container").notNull().default(""),
    length: text("length"),
    price: real("price").notNull().default(0),
    /** ISO 4217. A New Zealand price shown as a bare "$" to a mixed room is a 1.7x misunderstanding, not a formatting nit. */
    currency: text("currency").notNull().default("USD"),
    paymentPlan: text("payment_plan"),
    guarantee: text("guarantee"),
    scarcity: text("scarcity"),
    urgency: text("urgency"),
    /** The one line every slide carries from the offer onward: where to go and what to do. Empty means no footer. */
    ctaFooter: text("cta_footer"),
    oneBelief: text("one_belief"),
    difference: text("difference"),
    whyNow: text("why_now"),
    whyTrust: text("why_trust"),
    howItWorks: text("how_it_works"),
    forYouIf: text("for_you_if"),
    notForYouIf: text("not_for_you_if"),
    /** The three questions the bot asks before booking. Null means the house default (QUALIFYING_DEFAULTS) until the coach writes their own. */
    qualifyingQuestion1: text("qualifying_question_1"),
    qualifyingQuestion2: text("qualifying_question_2"),
    qualifyingQuestion3: text("qualifying_question_3"),
    /** "Never quote prices": the price is left out of what the bot is sent (Stage 1), and the Brief says so. */
    neverQuotePrice: integer("never_quote_price", { mode: "boolean" }).notNull().default(false),
    /* On the bot (handoff rev 80). Only an offer with a bot role feeds the bot, whatever its live or draft state elsewhere. */
    botRole: text("bot_role", { enum: ["entry", "core", "one_on_one", "not_on_bot"] }).notNull().default("not_on_bot"),
    /** The short name the bot uses ("Academy"); blank means the offer's name. */
    botName: text("bot_name"),
    /** Who it's for, one line ("new businesses with a budget under $1,000 who want help."). */
    botFor: text("bot_for"),
    /** What they get, one line; optional, added under WHAT I DO. */
    botEndResult: text("bot_end_result"),
    /** The terms as the bot says them, deposit included. Needs your eyes. */
    botTerms: text("bot_terms"),
    depositAmount: real("deposit_amount"),
    refundableIfNotFit: integer("refundable_if_not_fit", { mode: "boolean" }).notNull().default(false),
    /** Said when the link goes out and the offer is refundable. Blank means the suggested default. */
    botRefundLine: text("bot_refund_line"),
    /** When the bot shares the terms ("Share when recommending it.", "Only when Get started is too much."). Blank means the first. */
    botTermsWhen: text("bot_terms_when"),
    /** Cancelling, said only if asked ("Get started is month to month. Cancel anytime."). Needs your eyes. */
    botCancelLine: text("bot_cancel_line"),
    guaranteeCovered: integer("guarantee_covered", { mode: "boolean" }).notNull().default(false),
    objTime: text("obj_time"),
    objMoney: text("obj_money"),
    objPartner: text("obj_partner"),
    objTriedBefore: text("obj_tried_before"),
    objDiy: text("obj_diy"),
    /** The bank's objections this offer answers. The five fixed fields above are the older model, kept readable until moved into the bank. */
    objectionAssetIds: text("objection_asset_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    salesPageUrl: text("sales_page_url"),
    paymentLink: text("payment_link"),
    /* The offer ladder (handoff 27 Sep, Phase 1 of a client's Airtable import): where an offer sits and its full sales copy. */
    /** The ladder code ("T03", "B1"); blank for an offer off the ladder. */
    tierCode: text("tier_code"),
    /** Docket #10 (H-195): the offer's tier, set by the member (Freebie, Starter, Core, Premium); null reads it from the price, as before. */
    ladderTier: text("ladder_tier", { enum: ["freebie", "starter", "core", "premium"] }),
    /** Its place in its pathway: T00 is 0, B3 is 3. */
    tierOrder: integer("tier_order"),
    /** The client's pathway (sub-brand) this offer belongs to. */
    pathwayId: text("pathway_id"),
    /** Where it sits on the client's transformation arc, as they named it. */
    arcStage: text("arc_stage"),
    headline: text("headline"),
    /** The current situation of the person it's for, in their words. */
    currentSituation: text("current_situation"),
    /** The desired situation it takes them to. */
    desiredSituation: text("desired_situation"),
    coreComponents: text("core_components"),
    deliverables: text("deliverables"),
    oneLiners: text("one_liners"),
    trust: text("trust"),
    getStarted: text("get_started"),
    purpose: text("purpose"),
    objWrongTime: text("obj_wrong_time"),
    /** An archived offer: the current one that replaced it. */
    replacedByOfferId: text("replaced_by_offer_id"),
    /** The Airtable record it was imported from, so a re-run updates it. */
    sourceRef: text("source_ref"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("offers_user").on(t.userId)],
);

/**
 * A client's pathways (27 Sep): the sub-brands their offer ladder is split into ("Organisations T00 to T05", "Business B0 to B5"),
 * each with its own founder story and promise. An offer points at one.
 */
export const pathways = sqliteTable(
  "pathways",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    /** The letter its tier codes start with ("T", "B"); blank when its offers have none. */
    tierPrefix: text("tier_prefix"),
    order: integer("order").notNull().default(0),
    founderStory: text("founder_story"),
    tagline: text("tagline"),
    audiencePromise: text("audience_promise"),
    promiseEvidence: text("promise_evidence"),
    /** Where an imported pathway came from, so a re-run updates it. */
    sourceRef: text("source_ref"),
    createdAt: createdAt(),
  },
  (t) => [index("pathways_user").on(t.userId, t.order)],
);
export type Pathway = typeof pathways.$inferSelect;

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

/* ───────────────────────── Avatars (rev 501, built by Body at rev 508) ───────────────────────── */

/** The ten optional fields of an avatar, in the order the page asks them (rev 501 §2). */
export const AVATAR_FIELDS = ["who", "pains", "wants", "tried", "objections", "hangouts", "phrases", "trigger", "framework", "notFor"] as const;
export type AvatarField = (typeof AVATAR_FIELDS)[number];

/**
 * One buyer avatar of a member's: a name, a one-line description and the ten optional fields. `parentId` makes it a
 * sub-segment of another (one level). One per member may be Primary. `imported` marks one made from an offer's free-text
 * avatar, kept until the member saves it. Archived ones are kept, never deleted, until the member deletes their data.
 */
export const avatars = sqliteTable(
  "avatars",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    oneLine: text("one_line"),
    who: text("who"),
    pains: text("pains"),
    wants: text("wants"),
    tried: text("tried"),
    objections: text("objections"),
    hangouts: text("hangouts"),
    phrases: text("phrases"),
    trigger: text("trigger"),
    framework: text("framework"),
    notFor: text("not_for"),
    primary: integer("primary", { mode: "boolean" }).notNull().default(false),
    imported: integer("imported", { mode: "boolean" }).notNull().default(false),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("avatars_member").on(t.workspaceId, t.userId), index("avatars_parent").on(t.parentId)],
);
export type Avatar = typeof avatars.$inferSelect;

/**
 * An avatar interview (rev 636, answered rev 639): the questions asked and the member's answers, kept so they can stop and
 * resume (in the app or by voice) and so the coach can read the answers behind an avatar. The draft is what the server kept
 * after its checks; nothing reaches the avatar until the member keeps a field and saves.
 */
export type InterviewTurn = { field: AvatarField; question: string; answer: string | null; followUp: boolean };
export type InterviewDraft = { name: string | null; fields: Partial<Record<AvatarField, { text: string; from: number[] }>>; dropped: string[] };
export const AVATAR_INTERVIEW_STATUSES = ["open", "draft", "saved", "stopped"] as const;
export const avatarInterviews = sqliteTable(
  "avatar_interviews",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** The avatar whose empty fields it fills; null for a new avatar. */
    avatarId: text("avatar_id"),
    status: text("status", { enum: AVATAR_INTERVIEW_STATUSES }).notNull().default("open"),
    turns: text("turns", { mode: "json" }).$type<InterviewTurn[]>().notNull().default([]),
    draft: text("draft", { mode: "json" }).$type<InterviewDraft>(),
    /** The avatar it was saved into, so the avatar can say it came from an interview and show the answers. */
    savedAvatarId: text("saved_avatar_id"),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("avatar_interviews_member").on(t.workspaceId, t.userId), index("avatar_interviews_saved").on(t.savedAvatarId)],
);
export type AvatarInterview = typeof avatarInterviews.$inferSelect;

/** Which of a member's avatars an offer is for: many to many, with at most one `main` per offer. Owned like the avatar. */
export const avatarOffers = sqliteTable(
  "avatar_offers",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    avatarId: text("avatar_id")
      .notNull()
      .references(() => avatars.id, { onDelete: "cascade" }),
    offerId: text("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    main: integer("main", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("avatar_offers_pair").on(t.avatarId, t.offerId), index("avatar_offers_member").on(t.workspaceId, t.userId), index("avatar_offers_offer").on(t.offerId)],
);
export type AvatarOffer = typeof avatarOffers.$inferSelect;

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
    /** A session that deliberately names no mechanism says why here; the reason counts as the field filled in the build check. */
    mechanismWaivedReason: text("mechanism_waived_reason"),
    /** Who presents: the title slide, the file's author and the script's first person. Empty means the subject's own name. */
    presenter: text("presenter"),
    /** The one line for staying to the end; empty means no slide. */
    stayLine: text("stay_line"),
    /** The opening contract, the coach's own words: each is one slide, and a missing one is omitted and listed on the Deck step, never filled by a model. */
    promiseLine: text("promise_line"),
    chatPrompt: text("chat_prompt"),
    groundRule: text("ground_rule"),
    outcomes: text("outcomes", { mode: "json" }).$type<string[]>().notNull().default([]),
    sessionGoal: text("session_goal"),
    permissionLine: text("permission_line"),
    /** The private question of the reflection beat before the offer, the coach's own words; empty means no reflection beat. */
    reflectionPrompt: text("reflection_prompt"),
    /** Per-webinar chrome, both off by default: a logo footer bar on content slides, a CTA bar on the offer and Q&A slides. */
    footerBar: integer("footer_bar", { mode: "boolean" }).notNull().default(false),
    /** The footer bar's brand line for this webinar (§4): empty means the kit's name, or the workspace's with no kit. */
    footerBrand: text("footer_brand"),
    ctaBar: integer("cta_bar", { mode: "boolean" }).notNull().default(false),
    /** The origin story in eight beats, keyed by ORIGIN_BEATS; a beat left empty makes no slide. */
    originStory: text("origin_story", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    /** Whose material this is built from. Null is the workspace owner, the only value today; later "client_records:<id>". */
    subjectRef: text("subject_ref"),
    offerId: text("offer_id"),
    ctaType: text("cta_type").notNull().default("Book a call"),
    scheduledAt: text("scheduled_at"),
    registrationUrl: text("registration_url"),
    /** The link a sign-up is sent to join (rev 808); the registration link when it's empty. */
    joinUrl: text("join_url"),
    replayUrl: text("replay_url"),
    deckUrl: text("deck_url"),
    /** Null until entered: a funnel cannot tell "not yet logged" from zero, so nothing is logged for it. */
    registered: integer("registered"),
    showed: integer("showed"),
    offersMade: integer("offers_made"),
    callsBooked: integer("calls_booked"),
    sales: integer("sales"),
    revenue: real("revenue"),
    debriefLeak: text("debrief_leak"),
    debriefFix: text("debrief_fix"),
    debriefWins: text("debrief_wins"),
    notes: text("notes"),
    /** The last edit to the record's content (foundation, beliefs, sections, offer link); a readiness review older than this is stale. */
    updatedAt: text("updated_at"),
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
    /** A story bank asset id, or "essence:<n>" for one of the client's own stories from their Essence. */
    storyAssetId: text("story_asset_id"),
    /** A confirmed study: the client's own evidence id, or "shared:<id>" for the starter shelf. Never an unconfirmed one. */
    evidenceId: text("evidence_id"),
    /**
     * Tick two for the free-text proof, the same gate the bank applies: whose result it is, and "[Name] has given me permission
     * to use what they said here in my marketing", who ticked it and when. Text saved before the tick existed (proofChangedAt
     * null) stays usable; the tick applies from then on.
     */
    proofWho: text("proof_who"),
    proofPermissionAt: text("proof_permission_at"),
    proofPermissionBy: text("proof_permission_by"),
    proofChangedAt: text("proof_changed_at"),
    /**
     * The coach's deliberate "show it again": in this act, a proof already shown elsewhere in the deck may appear again. Without
     * it, each proof appears once in a deck (the Proof Block slide wins over a key point quoting it; the first slide over a later one).
     */
    proofRepeat: integer("proof_repeat", { mode: "boolean" }).notNull().default(false),
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
    /** Delivery direction for the presenter ("wait for the chat to fill", "count to five before advancing"): the run sheet and the speaker notes, never a slide face. */
    deliveryNote: text("delivery_note"),
    assetId: text("asset_id"),
    durationMin: integer("duration_min").notNull().default(4),
    /** Omitted: the section is left out on purpose (no consented case study for this act); the deck and the run sheet skip it. */
    status: text("status", { enum: ["todo", "drafted", "final", "omitted"] }).notNull().default("todo"),
    /** reveal: the section's key points build up one slide at a time, the way a live presenter paces a reveal. */
    buildStyle: text("build_style", { enum: ["none", "reveal"] }).notNull().default("none"),
    /** The script's provenance (ORIGINS); null for a section drafted before the mark existed or not yet written. */
    origin: text("origin", { enum: ORIGINS }),
  },
  (t) => [uniqueIndex("webinar_sections_key").on(t.webinarId, t.sectionKey)],
);

/**
 * The coach's own images for their decks: a private store (its own token, like the proof store), the database holding only
 * metadata. A screenshot or a proof image needs a recorded consent tick and name (or the word that nobody is in it) before it
 * can be used. A graphic is a designed image (a social post, a quote card); a diagram is the coach's own drawing of a framework
 * or mechanism; both are shown whole, never cropped, and a graphic is never suggested for a slot, only chosen. Reused across
 * webinars.
 */
export const DECK_IMAGE_KINDS = ["photo", "screenshot", "proof", "logo", "graphic", "diagram"] as const;
export const DECK_IMAGE_SOURCES = ["upload", "render", "ai"] as const;
export type DeckImageSource = (typeof DECK_IMAGE_SOURCES)[number];
export type DeckImageKind = (typeof DECK_IMAGE_KINDS)[number];
export const deckImages = sqliteTable(
  "deck_images",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: DECK_IMAGE_KINDS }).notNull(),
    blobKey: text("blob_key").notNull(),
    blobUrl: text("blob_url").notNull(),
    mime: text("mime").notNull(),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    caption: text("caption"),
    /** A screenshot or proof image affirms nobody's details are shown without consent: the tick, who is in it (or "No people in this"), when. */
    consentTick: integer("consent_tick", { mode: "boolean" }).notNull().default(false),
    consentName: text("consent_name"),
    consentAt: text("consent_at"),
    /** Where the picture came from (Make the graphic): uploaded by the member, rendered by HelixOS, or an AI background (rev 524). */
    source: text("source", { enum: DECK_IMAGE_SOURCES }).notNull().default("upload"),
    /** The industries a picture suits (Magic funnel C): a funnel page's hero is chosen only from pictures tagged for theirs. */
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("deck_images_user").on(t.userId, t.createdAt)],
);
export type DeckImage = typeof deckImages.$inferSelect;

/**
 * Claude's drafts for a webinar (H-181, plan H-684): one pending draft per webinar, step and section, written by a connector
 * call and never into the webinar itself. The wizard shows it beside what is there, with Approve, Edit and Discard. `fields`
 * holds only the step's own field names (WEBINAR_DRAFT_FIELDS); `notes` says what the tool took out on the way in.
 */
export const WEBINAR_DRAFT_STEPS = ["foundation", "beliefs", "offer", "script", "deck"] as const;
export type WebinarDraftStep = (typeof WEBINAR_DRAFT_STEPS)[number];
export const WEBINAR_DRAFT_STATUSES = ["pending", "approved", "edited", "discarded", "replaced"] as const;
export const webinarDrafts = sqliteTable(
  "webinar_drafts",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    webinarId: text("webinar_id")
      .notNull()
      .references(() => webinars.id, { onDelete: "cascade" }),
    step: text("step", { enum: WEBINAR_DRAFT_STEPS }).notNull(),
    /** The script section's key; empty for the other steps. */
    sectionKey: text("section_key").notNull().default(""),
    fields: text("fields", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    notes: text("notes", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Who wrote it, as the history shows it: "Claude (connector)". The connection and the Forum agent, when there is one. */
    byLabel: text("by_label").notNull(),
    appId: text("app_id"),
    agentId: text("agent_id"),
    status: text("status", { enum: WEBINAR_DRAFT_STATUSES }).notNull().default("pending"),
    decidedAt: text("decided_at"),
    decidedBy: text("decided_by"),
    createdAt: createdAt(),
  },
  (t) => [index("webinar_drafts_webinar").on(t.webinarId, t.status), index("webinar_drafts_member").on(t.workspaceId, t.userId)],
);
export type WebinarDraft = typeof webinarDrafts.$inferSelect;

/**
 * A webinar's history of Claude's drafts (H-181): each connector write, and each Approve, Edit, Discard and Undo, with who and
 * when. `before` holds the values an Approve replaced, so Undo (for seven days) can put them back.
 */
export const WEBINAR_HISTORY_ACTIONS = ["created", "drafted", "approved", "edited", "discarded", "undone"] as const;
export const webinarHistory = sqliteTable(
  "webinar_history",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    webinarId: text("webinar_id")
      .notNull()
      .references(() => webinars.id, { onDelete: "cascade" }),
    draftId: text("draft_id"),
    step: text("step", { enum: WEBINAR_DRAFT_STEPS }),
    sectionKey: text("section_key").notNull().default(""),
    action: text("action", { enum: WEBINAR_HISTORY_ACTIONS }).notNull(),
    byLabel: text("by_label").notNull(),
    /** True when the connector wrote it: "by Claude (connector)". */
    byConnector: integer("by_connector", { mode: "boolean" }).notNull().default(false),
    /** The step's fields this changed, by name. */
    changed: text("changed", { mode: "json" }).$type<string[]>().notNull().default([]),
    before: text("before", { mode: "json" }).$type<Record<string, unknown> | null>(),
    undoneAt: text("undone_at"),
    undoneBy: text("undone_by"),
    createdAt: createdAt(),
  },
  (t) => [index("webinar_history_webinar").on(t.webinarId, t.createdAt)],
);
export type WebinarHistoryRow = typeof webinarHistory.$inferSelect;

/**
 * Claude's drafts everywhere else (H-184, plan H-220 PR D2): one table for every area a connector drafts in (offers first; Essence,
 * lead magnets, content, Pathway, courses and the bot profile next). A draft sits beside what's approved and never writes into it
 * until the member's Approve. `targetId` is the row it changes, null for a new one; `base` is what those fields said when it was
 * written, so a later change shows as a conflict.
 */
export const DRAFT_AREAS = ["offer", "essence", "magnet", "content", "pathway", "course", "bot_profile"] as const;
export type DraftArea = (typeof DRAFT_AREAS)[number];
export const DRAFT_STATUSES = ["pending", "approved", "edited", "discarded", "replaced"] as const;
export const drafts = sqliteTable(
  "drafts",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    area: text("area", { enum: DRAFT_AREAS }).notNull(),
    targetId: text("target_id"),
    fields: text("fields", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    base: text("base", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    /** The member's own words the draft was built from (the connector's source_words): a figure in them counts as theirs. */
    source: text("source").notNull().default(""),
    /** What the tool took out on the way in (an income claim, a figure not in the member's own facts), in plain words. */
    notes: text("notes", { mode: "json" }).$type<string[]>().notNull().default([]),
    byLabel: text("by_label").notNull(),
    appId: text("app_id"),
    agentId: text("agent_id"),
    status: text("status", { enum: DRAFT_STATUSES }).notNull().default("pending"),
    decidedAt: text("decided_at"),
    decidedBy: text("decided_by"),
    createdAt: createdAt(),
  },
  (t) => [index("drafts_member").on(t.workspaceId, t.userId, t.status), index("drafts_target").on(t.area, t.targetId)],
);
export type Draft = typeof drafts.$inferSelect;

/** Every draft written, approved, edited, discarded or undone (H-184), with what an Approve replaced, so Undo (seven days) puts it back. */
export const CHANGE_ACTIONS = ["drafted", "approved", "edited", "discarded", "undone"] as const;
export const changeHistory = sqliteTable(
  "change_history",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    area: text("area", { enum: DRAFT_AREAS }).notNull(),
    targetId: text("target_id"),
    draftId: text("draft_id"),
    action: text("action", { enum: CHANGE_ACTIONS }).notNull(),
    byLabel: text("by_label").notNull(),
    byConnector: integer("by_connector", { mode: "boolean" }).notNull().default(false),
    changed: text("changed", { mode: "json" }).$type<string[]>().notNull().default([]),
    before: text("before", { mode: "json" }).$type<Record<string, unknown> | null>(),
    undoneAt: text("undone_at"),
    undoneBy: text("undone_by"),
    createdAt: createdAt(),
  },
  (t) => [index("change_history_target").on(t.area, t.targetId, t.createdAt), index("change_history_member").on(t.workspaceId, t.userId)],
);
export type ChangeHistoryRow = typeof changeHistory.$inferSelect;

/** The coach's choice of which image fills a suggested slot on a webinar's slide, keyed by the slot's stable key. */
export const deckSlots = sqliteTable(
  "deck_slots",
  {
    id: id(),
    webinarId: text("webinar_id").notNull().references(() => webinars.id, { onDelete: "cascade" }),
    slotKey: text("slot_key").notNull(),
    imageId: text("image_id"),
    /** Set when the coach said "I don't have this" (§6.3): the slide exports as text with no placeholder, and the shot list counts it out. */
    droppedAt: text("dropped_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("deck_slots_key").on(t.webinarId, t.slotKey)],
);
export type DeckSlot = typeof deckSlots.$inferSelect;

/**
 * The coach's choices on one slide (deck layouts 10, rev 533): a layout picked over the engine's, among the layouts that apply,
 * and the one phrase set in the accent (or cleared). Keyed by the slide's stable key (its section and its place in it), so a
 * choice survives edits elsewhere in the deck.
 */
export const deckSlideChoices = sqliteTable(
  "deck_slide_choices",
  {
    id: id(),
    webinarId: text("webinar_id").notNull().references(() => webinars.id, { onDelete: "cascade" }),
    slideKey: text("slide_key").notNull(),
    layout: text("layout"),
    accentPhrase: text("accent_phrase"),
    accentOff: integer("accent_off", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("deck_slide_choices_key").on(t.webinarId, t.slideKey)],
);
export type DeckSlideChoice = typeof deckSlideChoices.$inferSelect;

export const readinessReviews = sqliteTable("readiness_reviews", {
  id: id(),
  webinarId: text("webinar_id")
    .notNull()
    .references(() => webinars.id, { onDelete: "cascade" }),
  ratings: text("ratings", { mode: "json" }).$type<Record<string, number>>().notNull().default({}),
  /** A derived grade the coach lowered, and why: only downward, never up. Keyed by dimension. */
  overrides: text("overrides", { mode: "json" }).$type<Record<string, { value: number; reason: string }>>().notNull().default({}),
  score: integer("score").notNull().default(0),
  verdict: text("verdict", { enum: ["ready", "needs_work", "not_ready"] }).notNull().default("not_ready"),
  biggestGaps: text("biggest_gaps"),
  nextActions: text("next_actions"),
  createdAt: createdAt(),
});

/**
 * A member's brand, as a renderer reads it: six colours as bare six-digit hex, three faces and the fallback the file
 * names when a face is missing, colours the brand bans outright. One per member (rev 568); read only through the subject.
 */
export const brandKits = sqliteTable(
  "brand_kits",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    /**
     * Whose kit it is (rev 568, 6 Oct): one per member, never per workspace. A client's decks render in their own kit; a member
     * with no row renders in the house starter kit. Migration 0121 gave the one row a workspace had to the owner of its logo
     * (it was saved while switched into that client), else to the coach, and gave a coach left without one a copy, no logo.
     */
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    ground: text("ground").notNull(),
    ink: text("ink").notNull(),
    accent: text("accent").notNull(),
    muted: text("muted").notNull(),
    surface: text("surface").notNull(),
    inverseGround: text("inverse_ground"),
    inverseInk: text("inverse_ink"),
    displayFont: text("display_font").notNull(),
    bodyFont: text("body_font").notNull(),
    quoteFont: text("quote_font"),
    fontFallback: text("font_fallback").notNull().default("Arial"),
    /** The brand's logo (deck visuals §4): a deck_images row of kind logo, the member's own, shown on the cover and in the footer bar. None means the kit's name set as type. */
    logoImageId: text("logo_image_id"),
    /** A second logo for dark grounds (first-deck brief §3): the cover sits on the inverse ground, where a dark wordmark vanishes. */
    logoDarkImageId: text("logo_dark_image_id"),
    bannedColors: text("banned_colors", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Reserved for an unfilled slot on a slide, and nothing else: unmissable when flipping through. */
    placeholder: text("placeholder"),
    /** Names allowed to open a script without a warning ("Turas here"): permitted names, never a second presenter. */
    aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** The slide that puts the price next to the total value of the stack. Off, the price stands on its own. A house policy, set once. */
    showPriceAnchor: integer("show_price_anchor", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    /**
     * Make the graphic (rev 513, reserved by rev 568 so a member has one Brand section): the graphic's display name, @handle,
     * verified mark, avatar (a deck_images row of the member's own), the gold gradient's two hexes and its face. Nothing reads
     * them until Make the graphic is built; the card shows them then.
     */
    graphicDisplayName: text("graphic_display_name"),
    graphicHandle: text("graphic_handle"),
    graphicVerified: integer("graphic_verified", { mode: "boolean" }).notNull().default(false),
    graphicAvatarImageId: text("graphic_avatar_image_id"),
    graphicGoldFrom: text("graphic_gold_from"),
    graphicGoldTo: text("graphic_gold_to"),
    graphicFont: text("graphic_font"),
    /** The member's own yes to their profile photo as the graphic's badge (client headshots, rule 6): an imported photo is never consent to publish it. */
    graphicUseHeadshot: integer("graphic_use_headshot", { mode: "boolean" }).notNull().default(false),
    /** Allow AI backgrounds (rev 524): on by default; off, a graphic uses only the member's own photos or a plain ground. Faces are never generated. */
    aiBackgrounds: integer("ai_backgrounds", { mode: "boolean" }).notNull().default(true),
    /** How every AI draft spells (H-811, migration 0205): American by default; "uk_nz" adds one line to every system message. */
    spelling: text("spelling", { enum: ["us", "uk_nz"] }).notNull().default("us"),
    /** The registered name (H-811): on the decks' footer bar and as the file's company when set; the kit's name otherwise. */
    legalName: text("legal_name"),
    /** One line under the cover logo (H-811), when set and not held blank. */
    descriptor: text("descriptor"),
    /** The descriptor kept but not drawn ("Hold the descriptor blank for now"). */
    descriptorHidden: integer("descriptor_hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("brand_kits_member").on(t.workspaceId, t.userId)],
);
export type BrandKit = typeof brandKits.$inferSelect;

/** Story / analogy / objection / belief bank. workspaceId null = ships with the template. */
/** journey_stage: a stage of the client's own buyer-readiness journey (27 Sep), its order and messages in `extra`. */
export const ASSET_TYPES = ["story", "analogy", "objection", "belief", "framework", "journey_stage"] as const;
/** The one belief vocabulary: the proof bank's "belief broken", the webinar's three acts, and an objection's "which belief". "none" is a real answer (decision avoidance is not a belief). */
export const BELIEF_KEYS = ["vehicle", "internal", "external", "none"] as const;
export type BeliefKey = (typeof BELIEF_KEYS)[number];

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
    /** Objections only. One objection often has more than one answer: `reframe` is the first, these are the rest. */
    reframes: text("reframes", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Objections only. The real concern behind the words; a reframe aimed at the stated objection rather than this one misses. */
    underneath: text("underneath"),
    /** Objections only. Which belief the objection is really about, in the proof bank's vocabulary; null when unmapped, "none" when it is not a belief at all. */
    belief: text("belief", { enum: BELIEF_KEYS }),
    /** The Airtable record an imported entry came from, so a re-run updates it. */
    sourceRef: text("source_ref"),
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
    /** The body's provenance (ORIGINS): generatedBy says which generator ran, origin says whether a person has read the result. */
    origin: text("origin", { enum: ORIGINS }),
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

export type SocratesBeat = { questionIds: string[]; reframeIds: string[]; override: string | null; listenFor?: string | null; branchIds?: string[] };

export const socratesScripts = sqliteTable(
  "socrates_scripts",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    scriptType: text("script_type", { enum: SOCRATES_SCRIPT_TYPES }).notNull().default("High-Ticket Sales Call"),
    beats: text("beats", { mode: "json" }).$type<Record<string, SocratesBeat>>().notNull().default({}),
    /** The blanks the chosen questions carry, filled once each by their key (the text inside the brackets): `[X]` asked once, used everywhere. */
    fills: text("fills", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
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
    /** GoHighLevel's id for this client, stored on the first push. */
    ghlContactId: text("ghl_contact_id"),
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
    beliefBroken: text("belief_broken", { enum: BELIEF_KEYS }).notNull().default("none"),
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
    /** A partner story on the coach's bot (handoff rev 101): approved proof only, told as "who: short version (when it fits)". */
    onBot: integer("on_bot", { mode: "boolean" }).notNull().default(false),
    /** When the bot tells it, in the coach's words ("Too saturated, small audience"). Not the belief enum: that has four values. */
    botFits: text("bot_fits"),
    /** Danno's Proof Bank from Airtable (8 Oct): the call the clip came from, its categories as tags, and the Airtable record id so a re-run skips it. */
    sourceTitle: text("source_title"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    airtableId: text("airtable_id"),
    createdAt: createdAt(),
  },
  (t) => [index("proofs_user").on(t.userId, t.status), uniqueIndex("proofs_airtable").on(t.userId, t.airtableId)],
);

/**
 * Approve selected (H-1394): one batch per press, the proofs it approved, so "Undo the last batch" can put them back for
 * 24 hours. A proof approved on its own page is not in a batch. Undone once; the rows stay as the record.
 */
export const proofBatches = sqliteTable(
  "proof_batches",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    proofIds: text("proof_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** The drafts the list corrected before approving (H-1414), with the fields as they were: Undo puts them back. */
    corrections: text("corrections", { mode: "json" }).$type<CorrectionRecord[]>().notNull().default([]),
    approvedAt: text("approved_at").notNull().default(sql`(datetime('now'))`),
    undoneAt: text("undone_at"),
  },
  (t) => [index("proof_batches_user").on(t.userId, t.approvedAt)],
);
export type ProofBatch = typeof proofBatches.$inferSelect;

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
    /** The Airtable record an imported group came from, so a re-run updates it. */
    sourceRef: text("source_ref"),
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

/**
 * What a keyword fetches (ladders L1, rev 562; Ship a ladder commit 2): the product (price and trial in the final rung), a lead
 * magnet (named in the final rung only), or a conversation with one line the member writes (no price, no product name). A
 * keyword with no target cannot carry a ladder to ready. `kind` is where the bot listens for it; `tag` is what it tags the
 * person with in Community Loyalty.
 */
export type KeywordTarget = { kind: "product" | "magnet" | "conversation"; magnetId?: string | null; line?: string | null };
export const KEYWORD_KINDS = ["comment", "dm", "both"] as const;
export type KeywordKind = (typeof KEYWORD_KINDS)[number];
export type LadderKeyword = { keyword: string; use: string; target?: KeywordTarget | null; kind?: KeywordKind | null; tag?: string | null };
/** How a ladder's graphic was made: the photo (an Images id, or none for a plain ground), the headline used, the stronger fade, and whether an AI background was allowed for it. */
export type GraphicOptions = { photoImageId: string | null; headline: string; strongFade: boolean; aiBackground: boolean };
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
    /** The lead magnet this ladder offers, if any: the keyword is the magnet's, and the ask lives in a rung, never in the body. */
    leadMagnetId: text("lead_magnet_id"),
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
    /** Make the graphic (rev 513): the rendered graphic, a deck_images row of kind graphic, the member's own; and how it was made. */
    graphicImageId: text("graphic_image_id"),
    graphicOptions: text("graphic_options", { mode: "json" }).$type<GraphicOptions>(),
    /** Ship (rev 583 #1): the public, unguessable address of the graphic lives only while this token is set; minted at Ship, revoked from the ladder page. */
    graphicPublicToken: text("graphic_public_token"),
    shippedAt: text("shipped_at"),
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

/* ───────────────────────── Recordings (Fathom, the coach's key) ───────────────────────── */

/**
 * The workspace's own Fathom connection (Recordings R1, revs 254 to 265): the coach's key, sealed, used for every recording the
 * workspace shows its members. The per-member key in fathom_connections stays for the testimonial harvest and is never used here.
 * `enabledAt` is the switch-on date: title matching applies only to recordings made after it; everything earlier is a draft.
 * The webhook Fathom calls is registered from here; its signing secret is sealed because verifying a signature needs it back.
 */
export const fathomWorkspaceConnections = sqliteTable(
  "fathom_workspace_connections",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    keyEncrypted: text("key_encrypted").notNull(),
    last4: text("last4").notNull().default(""),
    lastValidatedAt: text("last_validated_at"),
    lastError: text("last_error"),
    enabledAt: text("enabled_at").notNull(),
    webhookId: text("webhook_id"),
    webhookSecretEncrypted: text("webhook_secret_encrypted"),
    webhookRegisteredAt: text("webhook_registered_at"),
    lastSyncAt: text("last_sync_at"),
    lastSyncNote: text("last_sync_note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("fathom_workspace_connections_ws").on(t.workspaceId)],
);
export type FathomWorkspaceConnection = typeof fathomWorkspaceConnections.$inferSelect;

/* ───────────────────────── Issues and suggestions (rev 432, items 2 to 4) ───────────────────────── */

/** An issue (something broken), a suggestion (an idea), or an Ask Danno answer that was wrong or out of date. */
export const MEMBER_REPORT_KINDS = ["issue", "suggestion", "ask_danno", "content"] as const;
export type MemberReportKind = (typeof MEMBER_REPORT_KINDS)[number];
/** Red blocks the member, orange annoys them, green is an idea. */
export const REPORT_SEVERITIES = ["red", "orange", "green"] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

/**
 * A form's unsent draft, kept on the server so it follows the member to another device (rev 444, part two). One row per member
 * per form, named as the browser names it ("month.<who>.<month>"); the snapshot of the form's fields as JSON, never a credential
 * (the browser leaves those out). Dropped when the save is confirmed, and after 30 days. The member's own: in their export and
 * deleted with them; never written while a coach is switched in.
 */
export const formDrafts = sqliteTable(
  "form_drafts",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    data: text("data").notNull(),
    /** Sent and not yet confirmed: a save that may not have gone through. */
    sent: integer("sent", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("form_drafts_user_key").on(t.userId, t.key)],
);
export type FormDraft = typeof formDrafts.$inferSelect;

/** Where a member report stands (H-202): New, Seen, Working on it, Done, or Not now (always with a reason). */
export const REPORT_STATUSES = ["new", "seen", "working", "done", "not_now"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * What a member sends from "I have an issue or a suggestion" in the menu: their words, the page they were on, how much it gets
 * in their way, and an optional screenshot, kept in the private store under reports/<workspace>/. For an Ask Danno answer, the
 * question and the answer as they pasted them, and whether they want to talk to the coach about it. The coach's inbox marks
 * each Seen and Done. The member's own row: in their export, and deleted with them, screenshot and all.
 */
export const memberReports = sqliteTable(
  "member_reports",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: MEMBER_REPORT_KINDS }).notNull(),
    severity: text("severity", { enum: REPORT_SEVERITIES }).notNull(),
    description: text("description").notNull().default(""),
    /** The page the member was on when they opened the form, its path only. */
    page: text("page"),
    question: text("question"),
    answer: text("answer"),
    talkToCoach: integer("talk_to_coach", { mode: "boolean" }).notNull().default(false),
    screenshotKey: text("screenshot_key"),
    screenshotUrl: text("screenshot_url"),
    screenshotType: text("screenshot_type"),
    seenAt: text("seen_at"),
    doneAt: text("done_at"),
    /** Where it stands (H-202): New until the coach answers; seenAt and doneAt follow it for older readers. */
    status: text("status", { enum: REPORT_STATUSES }).notNull().default("new"),
    /** The 3 to 6 words a reply calls it ("the GoHighLevel connection"); the coach's to edit. Null reads it from the words. */
    topic: text("topic"),
    /** Merged into another report of the same member (H-202): it sits under that one, and one reply answers both. */
    parentId: text("parent_id"),
    /** An agent's Done note, written after its fix merged (H-202): an amber draft until the coach presses Send. */
    doneDraft: text("done_draft"),
    doneDraftBy: text("done_draft_by"),
    doneDraftAt: text("done_draft_at"),
    /**
     * A Content report (H-745): what was reported, a Colosseum win or a member (their membership id), and whose it is. The reason
     * (spam, harassment or hurtful, something else) is the severity: red, orange, green. Null on every other kind.
     */
    targetKind: text("target_kind", { enum: ["win", "member"] }),
    targetId: text("target_id"),
    targetUserId: text("target_user_id"),
    /** When the coach acted on a Content report (Hide this win): the reporter's Settings → Your reports then reads "Handled". */
    handledAt: text("handled_at"),
    createdAt: createdAt(),
  },
  (t) => [index("member_reports_ws_created").on(t.workspaceId, t.createdAt), index("member_reports_user").on(t.userId), index("member_reports_parent").on(t.parentId)],
);
export type MemberReport = typeof memberReports.$inferSelect;

/**
 * Everything said on a report after it was sent (H-202): the instant receipt, each reply the coach sent with a status, and the
 * member's follow-ups. Who, when and the words, kept for good; the member reads their own, newest first, on My reports.
 */
export const REPORT_MESSAGE_KINDS = ["receipt", "status", "followup"] as const;
export const reportMessages = sqliteTable(
  "report_messages",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    reportId: text("report_id").notNull(),
    /** The member the report is from. */
    userId: text("user_id").notNull(),
    /** Who wrote it: the coach for a status reply, the member for a follow-up; null for the automatic receipt. */
    byUserId: text("by_user_id"),
    kind: text("kind", { enum: REPORT_MESSAGE_KINDS }).notNull(),
    status: text("status", { enum: REPORT_STATUSES }),
    body: text("body").notNull(),
    /** Whether an email went (only a status reply, and only while the member's Emails from HelixOS is on). */
    emailed: integer("emailed", { mode: "boolean" }).notNull().default(false),
    /** The agent that drafted a Done sent on its own after merge (H-202), by name; null when the coach wrote and sent it. */
    draftedBy: text("drafted_by"),
    /** When the member saw it on My reports; a status reply unread shows a line on their Today. */
    readAt: text("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("report_messages_report").on(t.reportId, t.createdAt), index("report_messages_user").on(t.workspaceId, t.userId)],
);
export type ReportMessage = typeof reportMessages.$inferSelect;

export const RECORDING_SOURCES = ["webhook", "sync", "backfill"] as const;
/** exact: the title names a series (rev 491; rev 261 phrases before); slot: placed by its start time; close: rev 261 only, kept for old rows. */
export const TITLE_MATCHES = ["exact", "close", "slot", "none"] as const;
/** Who a published recording is for: every Accelerator and Academy member (and above), Academy members (and above), or the named members. */
export const RECORDING_AUDIENCES = ["accelerator_academy", "academy", "members"] as const;
export type RecordingAudience = (typeof RECORDING_AUDIENCES)[number];
/** An action item as Fathom delivered it, kept whole: the text, its assignee as Fathom guessed them, and where in the call it was said. */
export type RecordingActionItem = { description: string; completed: boolean; timestamp: string | null; playbackUrl: string | null; assigneeName: string | null; assigneeEmail: string | null };
export type RecordingInvitee = { name: string | null; email: string | null };
export type RecordingTranscriptEntry = { speaker: string; email: string | null; text: string; timestamp: string };

/**
 * One coaching call from Fathom, the coach's, shown to an audience once published. The summary and action items arrive with the
 * meeting; the transcript is fetched only on request (View transcript) and then kept, so it is read from Fathom once.
 */
export const recordings = sqliteTable(
  "recordings",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    fathomRecordingId: text("fathom_recording_id").notNull(),
    /** Fathom's title, as Fathom has it. */
    title: text("title").notNull(),
    /** HelixOS's own title when a time slot placed the call (rev 491): "Evolve Omega Accelerator · Mon 9 AM". Fathom's stays under it. */
    clearTitle: text("clear_title"),
    /** The meeting's own address (fathom.video/calls/<id>) and the share link; Watch in Fathom opens the share link when there is one. */
    url: text("url").notNull().default(""),
    shareUrl: text("share_url"),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    summary: text("summary"),
    actionItems: text("action_items", { mode: "json" }).$type<RecordingActionItem[]>().notNull().default([]),
    invitees: text("invitees", { mode: "json" }).$type<RecordingInvitee[]>().notNull().default([]),
    source: text("source", { enum: RECORDING_SOURCES }).notNull(),
    titleMatch: text("title_match", { enum: TITLE_MATCHES }).notNull().default("none"),
    /** A plain note for the coach beside a draft: "title didn't match", or why a recording stayed a draft. */
    note: text("note"),
    audience: text("audience", { enum: RECORDING_AUDIENCES }),
    audienceUserIds: text("audience_user_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Skipped (rev 488): not for members; kept, recoverable, never deleted from Fathom, and a sync leaves it skipped. */
    status: text("status", { enum: ["draft", "published", "skipped"] }).notNull().default("draft"),
    publishedAt: text("published_at"),
    publishedBy: text("published_by"),
    transcript: text("transcript", { mode: "json" }).$type<RecordingTranscriptEntry[]>(),
    transcriptFetchedAt: text("transcript_fetched_at"),
    /** The coach's per-recording Hide transcript, for the odd sensitive call: members see no View transcript. */
    transcriptHidden: integer("transcript_hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recordings_ws_fathom").on(t.workspaceId, t.fathomRecordingId), index("recordings_ws_status").on(t.workspaceId, t.status, t.startedAt)],
);
export type Recording = typeof recordings.$inferSelect;

/**
 * One action item on one member's plate: suggested when Fathom's assignee matched them (or the coach assigned it), accepted when
 * it became their task (source fathom), dismissed when they let it go. The member's own row: exported and deleted with them.
 */
export const recordingSteps = sqliteTable(
  "recording_steps",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    /** The action item's position in the recording's list, so the row follows the item. */
    itemIndex: integer("item_index").notNull(),
    text: text("text").notNull(),
    assigneeEmail: text("assignee_email"),
    state: text("state", { enum: ["suggested", "accepted", "dismissed"] }).notNull().default("suggested"),
    taskId: text("task_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recording_steps_rec_user_item").on(t.recordingId, t.userId, t.itemIndex), index("recording_steps_user").on(t.userId, t.state)],
);
export type RecordingStep = typeof recordingSteps.$inferSelect;

/**
 * When a member first saw a published recording (rev 498): opened it in HelixOS, or pressed Watch in Fathom (HelixOS can't see
 * playback inside Fathom, so the tap is what counts). Until then it is new for them: a yellow dot, and a count on the menu. The
 * member's own: in their export and erased with them. Never written while a coach is switched in.
 */
export const recordingViews = sqliteTable(
  "recording_views",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    seenAt: text("seen_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recording_views_rec_user").on(t.recordingId, t.userId), index("recording_views_user").on(t.userId)],
);

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

/* ───────────────────────── Comment ladder handoffs ───────────────────────── */

/**
 * One row per ladder handed to Community Loyalty's Rung Dripper: when, how many rungs, and until when the coach's one drip
 * slot is taken (the state lives on one Community Loyalty contact, so two at once would tangle). HelixOS is never told when
 * a rung lands, so a row here means "handed", never "posted".
 */
export const DRIP_TARGETS = ["page", "instagram", "both"] as const;
export type DripTarget = (typeof DRIP_TARGETS)[number];
export const dripHandoffs = sqliteTable(
  "drip_handoffs",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    contentItemId: text("content_item_id").notNull(),
    ladderId: text("ladder_id").notNull(),
    handedAt: text("handed_at").notNull(),
    rungCount: integer("rung_count").notNull(),
    threadsAt: text("threads_at"),
    /** L2's Instagram-only drip (rev 567): where the rungs land, the Planner's ids when known, the gap and the pin (Ship, rev 583). */
    target: text("target", { enum: DRIP_TARGETS }).notNull().default("both"),
    fbPostId: text("fb_post_id"),
    igMediaId: text("ig_media_id"),
    gapMinutes: integer("gap_minutes"),
    pinLast: integer("pin_last", { mode: "boolean" }).notNull().default(false),
    expiresAt: text("expires_at").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("drip_handoffs_user").on(t.userId, t.expiresAt), index("drip_handoffs_item").on(t.contentItemId)],
);
export type DripHandoff = typeof dripHandoffs.$inferSelect;

/* ───────────────────────── Integrations ───────────────────────── */

/** walletpush: the pass itself (points, push messages). community_loyalty: the uChat chatbot platform, inbound only. */
export const PROVIDERS = ["walletpush", "community_loyalty", "gohighlevel"] as const;

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
    /** The sub-account's own name from GET /locations/{id} (locations.readonly), shown in the green Connected state; null until read. */
    locationName: text("location_name"),
    ghlUserId: text("ghl_user_id"),
    /** The member's own location-level Private Integration token, encrypted at rest. The only credential the GoHighLevel integration uses. */
    manualToken: text("manual_token"),
    accounts: text("accounts", { mode: "json" }).$type<SocialAccount[]>().notNull().default([]),
    mapping: text("mapping", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    connectedAt: text("connected_at"),
    lastSyncAt: text("last_sync_at"),
    lastError: text("last_error"),
    /** When GoHighLevel last refused a picture upload for want of medias.write (rev 840); cleared by the next upload that works. */
    mediaScopeMissingAt: text("media_scope_missing_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("social_connections_user_provider").on(t.userId, t.provider)],
);

/**
 * A picture put into the member's own GoHighLevel Media Library (rev 840), so a post carries it: one upload per picture and
 * GoHighLevel account, shared by every channel and every retry. `source` is the post's attachment id ("img:<id>" for Images,
 * else a Proof attachment's id). The URL is GoHighLevel's own storage, there at publish time for a scheduled post.
 */
export const ghlMedia = sqliteTable(
  "ghl_media",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    locationId: text("location_id").notNull(),
    source: text("source").notNull(),
    ghlFileId: text("ghl_file_id").notNull(),
    url: text("url").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ghl_media_source").on(t.workspaceId, t.userId, t.locationId, t.source)],
);
export type GhlMedia = typeof ghlMedia.$inferSelect;

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

/** A win a member shares on the Colosseum (rev 699 §5): business or community, their own words, newest first on the feed. */
export const colosseumWins = sqliteTable(
  "colosseum_wins",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: ["business", "community"] }).notNull(),
    text: text("text").notNull(),
    /** Hidden for everyone by the coach from a Content report (H-745), and who did it; clearing both is the undo. The author isn't told. */
    hiddenAt: text("hidden_at"),
    hiddenBy: text("hidden_by"),
    createdAt: createdAt(),
  },
  (t) => [index("colosseum_wins_workspace").on(t.workspaceId, t.createdAt)],
);
export type ColosseumWin = typeof colosseumWins.$inferSelect;

/**
 * Applause on a shared win (H-1171, plan H-1177): one per person per win, never on your own. The points are in the ledger
 * (src/lib/applause.ts); this row is who applauded, for the count and the list.
 */
export const winApplause = sqliteTable(
  "win_applause",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    winId: text("win_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("win_applause_once").on(t.winId, t.userId), index("win_applause_win").on(t.workspaceId, t.winId)],
);
export type WinApplause = typeof winApplause.$inferSelect;

/**
 * Block a member (H-745, App Store guideline 1.2): the blocker no longer sees the blocked member's wins, name or photo in the
 * Colosseum, its standings or the Rewards leaderboard. One row per pair, both sides by membership id. The blocked member is never
 * told. Erased with either member (src/lib/erase.ts).
 */
export const memberBlocks = sqliteTable(
  "member_blocks",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    blockerMembershipId: text("blocker_membership_id").notNull(),
    blockedMembershipId: text("blocked_membership_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("member_blocks_pair").on(t.blockerMembershipId, t.blockedMembershipId), index("member_blocks_blocked").on(t.blockedMembershipId)],
);
export type MemberBlock = typeof memberBlocks.$inferSelect;

/**
 * A login-email change (H-47): the new address holds the link (sha256 of the token only), 24 hours, single use; the change
 * happens when it's clicked. Who started it (the member, or their coach) and the masked old and new addresses stay as the log.
 */
export const emailChanges = sqliteTable(
  "email_changes",
  {
    id: id(),
    userId: text("user_id").notNull(),
    newEmail: text("new_email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    /** The user who started it: the member themselves, or the coach from the client's page. */
    startedBy: text("started_by").notNull(),
    oldMasked: text("old_masked").notNull(),
    newMasked: text("new_masked").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("email_changes_user").on(t.userId)],
);

/**
 * Evidence: published research, each client's own. A study is citable only once the client has confirmed that what came back
 * is what they asked for; `citationQuality` starts unverified and only their confirmation moves it. `askedFor` keeps the
 * request beside the result so the two are always shown side by side.
 */
export const EVIDENCE_QUALITY = ["unverified", "verified"] as const;
export type EvidenceAskedFor = { claim: string; terms: string[]; author?: string; year?: number; field?: string; fieldId?: string; fieldRefused?: boolean };
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
export type EvidenceResult = { openalexId: string; title: string; authors: string; authorNames?: string[]; year: number | null; doi: string | null; url: string | null; citedByCount: number; relevanceScore?: number | null };
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

/**
 * The object store's index: one row per object in the bucket (Vercel Blob, behind src/lib/storage.ts), never the bytes.
 * Two access rules live in one store, so the rule is in the key: only `public/magnets/<slug>/…` is ever public, written by
 * one function; everything else is private, written by another. `isPublic` is recorded for the read path and must agree
 * with the prefix; `url` is where the bucket serves the object (a CDN address for a public one, an authenticated one otherwise).
 */
export const files = sqliteTable("files", {
  key: text("key").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  contentType: text("content_type").notNull(),
  url: text("url").notNull().default(""),
  size: integer("size").notNull(),
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

/** Lead magnets: the reason someone comments in the first place. The keyword ties a comment to one magnet; the slug is its public address. */
export const MAGNET_TYPES = ["checklist", "guide", "cheat_sheet", "swipe_file", "audit", "resource_list", "ebook"] as const;
export type MagnetType = (typeof MAGNET_TYPES)[number];
export type MagnetSection = { heading: string; items: string[]; why?: string; how?: string };
export type MagnetContent = { intro: string; sections: MagnetSection[]; closing: string };
export type MagnetFormats = { page: boolean; pdf: boolean; copy: boolean; canva: boolean };
export const MAGNET_PRIMARY = ["page", "pdf", "file"] as const;
export const leadMagnets = sqliteTable(
  "lead_magnets",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    promise: text("promise").notNull().default(""),
    audience: text("audience").notNull().default(""),
    offerId: text("offer_id"),
    type: text("type", { enum: MAGNET_TYPES }).notNull().default("checklist"),
    /** The word people comment to get it. Two magnets in one workspace never share one. */
    keyword: text("keyword").notNull(),
    /** The public address: /g/<slug> counts and redirects, /m/<slug> is the hosted page. No personal data, ever. */
    slug: text("slug").notNull(),
    content: text("content", { mode: "json" }).$type<MagnetContent>().notNull().default({ intro: "", sections: [], closing: "" }),
    formats: text("formats", { mode: "json" }).$type<MagnetFormats>().notNull().default({ page: true, pdf: true, copy: false, canva: false }),
    primary: text("primary", { enum: MAGNET_PRIMARY }).notNull().default("page"),
    /** Public object keys, always under public/magnets/<slug>/: a public URL carries no workspace, user or record id. */
    pdfKey: text("pdf_key"),
    fileKey: text("file_key"),
    fileName: text("file_name"),
    /** The two hand-overs. Personal profile: the public reply and the DM the client sends by hand. Business page: what the Community Loyalty chatbot says. */
    personalReply: text("personal_reply"),
    personalDm: text("personal_dm"),
    chatbotAnswer: text("chatbot_answer"),
    chatbotDelivery: text("chatbot_delivery"),
    chatbotQuestions: text("chatbot_questions", { mode: "json" }).$type<string[]>().notNull().default([]),
    generatedBy: text("generated_by").notNull().default("none"),
    notes: text("notes"),
    /** The content's and hand-overs' provenance (ORIGINS). */
    origin: text("origin", { enum: ORIGINS }),
    /** When the client published the hosted page; the public route serves nothing before that. The publish action is where the provenance gate stands. */
    publishedAt: text("published_at"),
    /** The Airtable record an imported magnet came from, so a re-run updates it. */
    sourceRef: text("source_ref"),
    createdAt: createdAt(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("lead_magnets_slug").on(t.slug), uniqueIndex("lead_magnets_ws_keyword").on(t.workspaceId, t.keyword), index("lead_magnets_user").on(t.userId)],
);
export type LeadMagnet = typeof leadMagnets.$inferSelect;

/**
 * "Continue anyway": a coach sent content out that carried AI drafts nobody had reviewed, and chose to. One row per confirm:
 * who, when, which action, which record, and the names of the drafts it carried. The deck route accepts a confirm's id in
 * place of a clean record, once it is this user's and this webinar's. Never a value of the drafts themselves.
 */
export const REVIEW_SURFACES = ["deck_export", "magnet_publish", "post_schedule", "post_now", "post_status", "variant_status"] as const;
export type ReviewSurface = (typeof REVIEW_SURFACES)[number];
export const reviewConfirms = sqliteTable(
  "review_confirms",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** The name shown beside the confirm, as it was at the time. */
    userName: text("user_name").notNull().default(""),
    surface: text("surface", { enum: REVIEW_SURFACES }).notNull(),
    subjectId: text("subject_id").notNull(),
    items: text("items", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("review_confirms_user").on(t.userId, t.createdAt)],
);
export type ReviewConfirm = typeof reviewConfirms.$inferSelect;

/**
 * A proof's attachments: a third kind of evidence on the same row as the quote and the Fathom deep link. The bytes live in the
 * private Blob store (src/lib/proof-storage.ts: its own token, never the public store's); this table is metadata only. The two
 * questions asked at upload live here as showsAResult (inherits the typed-dollar hard block) and showsAPerson (needs the
 * likeness consent, recorded with a name and a time, before the proof can be approved).
 */
export const PROOF_ATTACHMENT_KINDS = ["image", "video", "document"] as const;
export type ProofAttachmentKind = (typeof PROOF_ATTACHMENT_KINDS)[number];
export const proofAttachments = sqliteTable(
  "proof_attachments",
  {
    id: id(),
    proofId: text("proof_id")
      .notNull()
      .references(() => proofs.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    /** proofs/<workspace_id>/<proof_id>/<uuid>.<ext> in the private store, and the store's own URL for it (unreachable without the token). */
    blobKey: text("blob_key").notNull(),
    // blob_url and display_url are the private store's addresses, unreachable without its token. They are read on the server
    // only (the read route, deletion) and never put in a payload, a prop or an export: a browser is shown /api/proofs/attachments/<id>.
    // They do not load in an <img>, and the fix for that is never the store's access setting. A test pins which files may name them.
    blobUrl: text("blob_url").notNull(),
    /** For a HEIC original, the JPEG rendition's key and URL beside it; the original is kept. */
    displayKey: text("display_key"),
    displayUrl: text("display_url"),
    /** The rendition's size, so the quota counts every byte the workspace holds, not only the originals. */
    displayBytes: integer("display_bytes"),
    kind: text("kind", { enum: PROOF_ATTACHMENT_KINDS }).notNull(),
    /** Sniffed from the bytes server-side, never the browser's claim. */
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    originalFilename: text("original_filename").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: real("duration_seconds"),
    altText: text("alt_text"),
    sortOrder: integer("sort_order").notNull().default(0),
    showsAPerson: integer("shows_a_person", { mode: "boolean" }).notNull().default(false),
    showsAResult: integer("shows_a_result", { mode: "boolean" }).notNull().default(false),
    /** The own-screen tick for an image or document, recorded when it was ticked. */
    ownScreenAt: text("own_screen_at"),
    consentRecordedAt: text("consent_recorded_at"),
    consentName: text("consent_name"),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("proof_attachments_proof").on(t.proofId, t.sortOrder), index("proof_attachments_ws").on(t.workspaceId), uniqueIndex("proof_attachments_blob_key").on(t.blobKey), uniqueIndex("proof_attachments_display_key").on(t.displayKey)],
);
export type ProofAttachment = typeof proofAttachments.$inferSelect;

/** Bytes served on every authenticated read of an attachment: the one number to instrument from day one. Not a quota. */
export const proofAttachmentReads = sqliteTable(
  "proof_attachment_reads",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    attachmentId: text("attachment_id").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("proof_attachment_reads_ws").on(t.workspaceId, t.createdAt)],
);

/** One click on a tracked link: how many, per magnet and per source. Never who; that is Community Loyalty's answer. */
export const leadMagnetHits = sqliteTable(
  "lead_magnet_hits",
  {
    id: id(),
    magnetId: text("magnet_id")
      .notNull()
      .references(() => leadMagnets.id, { onDelete: "cascade" }),
    src: text("src").notNull().default("other"),
    day: text("day").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("lead_magnet_hits_magnet").on(t.magnetId, t.day)],
);

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

/**
 * Danno's teaching library (rev 615 plan, rev 618 answers): one answer from his calls, uploaded by the coach from the library
 * files. The coach's own: read by the ladder writer for the coach's own ladders only. A full-text index (teaching_fts, made in
 * the migration by hand) sits beside it and is kept in step by src/lib/teaching.ts.
 */
export const teachingEntries = sqliteTable(
  "teaching_entries",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** The entry's own key: the question and the day it was taught, so a re-upload updates and never doubles. */
    key: text("key").notNull(),
    file: text("file").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    topic: text("topic"),
    category: text("category"),
    taughtOn: text("taught_on"),
    callType: text("call_type"),
    /** It names a price: never given to the writer (rev 618: no prices of any kind). */
    hasPrice: integer("has_price", { mode: "boolean" }).notNull().default(false),
    digest: text("digest").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("teaching_entries_user_key").on(t.userId, t.key)],
);
export type TeachingEntryRow = typeof teachingEntries.$inferSelect;

/** One item of Danno's story bank: what it is, its exact words and numbers, where it was said, and whether it may be used. */
export const storyItems = sqliteTable(
  "story_items",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    type: text("type", { enum: STORY_TYPES }).notNull(),
    what: text("what").notNull(),
    exactWords: text("exact_words"),
    numbers: text("numbers"),
    goodFor: text("good_for"),
    /** Only "ready" ever reaches the writer; "check" and "needs permission" are held until Danno clears them. */
    status: text("status", { enum: STORY_STATUSES }).notNull().default("check"),
    /** Set when Danno changed the status in the app: it then stands over the file's on a re-upload. */
    statusSetBy: text("status_set_by"),
    rawStatus: text("raw_status"),
    sourceCall: text("source_call"),
    sourceDate: text("source_date"),
    fathomUrl: text("fathom_url"),
    hasPrice: integer("has_price", { mode: "boolean" }).notNull().default(false),
    digest: text("digest").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("story_items_user_key").on(t.userId, t.key), index("story_items_user_status").on(t.userId, t.status)],
);
export type StoryItemRow = typeof storyItems.$inferSelect;

/**
 * Danno's frameworks (H-1262, plan H-1270): the how beside Doctrine's why, imported by the coach from the reviewed Framework
 * Library and published one by one. The coach's workspace's own: members see published ones, the ladder writer too (the
 * coach's own ladders only). One row a slug; a re-import updates in place. A price anywhere holds it as a draft.
 */
export const frameworks = sqliteTable(
  "frameworks",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    pillar: text("pillar"),
    rank: text("rank"),
    idea: text("idea").notNull(),
    steps: text("steps", { mode: "json" }).$type<string[]>().notNull().default([]),
    whenToUse: text("when_to_use"),
    mistakes: text("mistakes"),
    story: text("story"),
    exactWords: text("exact_words"),
    sourceCall: text("source_call"),
    sourceDate: text("source_date"),
    fathomUrl: text("fathom_url"),
    contentAngles: text("content_angles"),
    borrowedFrom: text("borrowed_from"),
    evolution: text("evolution"),
    rawStatus: text("raw_status"),
    status: text("status", { enum: FRAMEWORK_STATUSES }).notNull().default("draft"),
    hasPrice: integer("has_price", { mode: "boolean" }).notNull().default(false),
    digest: text("digest").notNull(),
    publishedAt: text("published_at"),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("frameworks_workspace_slug").on(t.workspaceId, t.slug), index("frameworks_workspace_status").on(t.workspaceId, t.status)],
);
export type FrameworkRow = typeof frameworks.$inferSelect;

/** The Partner Program (H-1307, plan H-1361): the fixed lists live in src/lib/engine/partner.ts, the columns stay plain text. */
export const PARTNER_PAYMENT_STATUSES = ["paid", "refunded", "chargeback", "failed"] as const;
export const PARTNER_PAYOUT_KINDS = ["monthly", "setup", "yearly_installment", "adjustment"] as const;

/**
 * A restaurant in the Grub N Chill Partner Program (H-1307, plan H-1361): the pipeline record, its dates, its numbers and the
 * onboarding answers. `ownerContact` is a person's details: never in a log, a list or the Forum, only on an explicit read.
 * Logo, photos and a menu file are rows in `files`, linked by `partnerFiles`.
 */
export const partnerRestaurants = sqliteTable(
  "partner_restaurants",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    business: text("business").notNull(),
    type: text("type").notNull().default("restaurant"),
    city: text("city"),
    source: text("source"),
    referredBy: text("referred_by"),
    stage: text("stage").notNull().default("talking"),
    plan: text("plan"),
    foundingPartner: integer("founding_partner", { mode: "boolean" }).notNull().default(false),
    firstContactAt: text("first_contact_at"),
    demoAt: text("demo_at"),
    signedAt: text("signed_at"),
    paidAt: text("paid_at"),
    formCompleteAt: text("form_complete_at"),
    handedToWalletpushAt: text("handed_to_walletpush_at"),
    liveAt: text("live_at"),
    featuredInGroupAt: text("featured_in_group_at"),
    cancelledAt: text("cancelled_at"),
    setupApprovedAt: text("setup_approved_at"),
    walletpushStatus: text("walletpush_status").notNull().default("not handed"),
    walletpushNote: text("walletpush_note"),
    googleReviewsAtStart: integer("google_reviews_at_start"),
    googleRatingAtStart: real("google_rating_at_start"),
    passHolders: integer("pass_holders"),
    reviewsGained: integer("reviews_gained"),
    conciergeChats: integer("concierge_chats"),
    resultsAsOf: text("results_as_of"),
    risk: text("risk").notNull().default("none"),
    cancelReason: text("cancel_reason"),
    nextStep: text("next_step"),
    nextStepDate: text("next_step_date"),
    notes: text("notes"),
    address: text("address"),
    businessPhone: text("business_phone"),
    website: text("website"),
    facebookPage: text("facebook_page"),
    instagram: text("instagram"),
    ownerContact: text("owner_contact"),
    brandColors: text("brand_colors"),
    hours: text("hours"),
    menuLink: text("menu_link"),
    googleBusinessProfile: text("google_business_profile"),
    reservationLink: text("reservation_link"),
    reward: text("reward"),
    welcomeReward: text("welcome_reward"),
    conciergeVoice: text("concierge_voice"),
    topCustomerQuestions: text("top_customer_questions"),
    restaurantContactForMessages: text("restaurant_contact_for_messages"),
    termsAcceptedAt: text("terms_accepted_at"),
    featureConsent: integer("feature_consent", { mode: "boolean" }).notNull().default(false),
    directoryCard: text("directory_card"),
    /** Fields a webhook sent that have no column yet (PR B): kept, never dropped silently. */
    extra: text("extra", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [index("partner_restaurants_workspace_stage").on(t.workspaceId, t.stage), index("partner_restaurants_workspace_business").on(t.workspaceId, t.business)],
);
export type PartnerRestaurant = typeof partnerRestaurants.$inferSelect;

/** A touch with a restaurant: who, how, what was said, what is next. */
export const partnerTouches = sqliteTable(
  "partner_touches",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => partnerRestaurants.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    who: text("who").notNull(),
    channel: text("channel").notNull(),
    firstConversation: integer("first_conversation", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    nextStep: text("next_step"),
    nextStepDate: text("next_step_date"),
    createdAt: createdAt(),
  },
  (t) => [index("partner_touches_restaurant").on(t.restaurantId, t.date)],
);
export type PartnerTouch = typeof partnerTouches.$inferSelect;

/** A payment a restaurant made (or that failed, was refunded or charged back). `month` is YYYY-MM, the statement month. */
export const partnerPayments = sqliteTable(
  "partner_payments",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => partnerRestaurants.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    plan: text("plan").notNull(),
    amount: real("amount").notNull(),
    tax: real("tax").notNull().default(0),
    feesDeducted: real("fees_deducted").notNull().default(0),
    promo: integer("promo", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: PARTNER_PAYMENT_STATUSES }).notNull().default("paid"),
    processor: text("processor"),
    month: text("month").notNull(),
    /** The processor's or webhook's own id, so the same payment never lands twice. */
    externalId: text("external_id"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("partner_payments_restaurant_month").on(t.restaurantId, t.month), uniqueIndex("partner_payments_external").on(t.workspaceId, t.externalId)],
);
export type PartnerPayment = typeof partnerPayments.$inferSelect;

/** One line of a month's statement to the fulfillment partner: built by partner_payouts_build, approved by Danno, never paid from here. */
export const partnerPayoutLines = sqliteTable(
  "partner_payout_lines",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => partnerRestaurants.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    kind: text("kind", { enum: PARTNER_PAYOUT_KINDS }).notNull(),
    amount: real("amount").notNull(),
    /** For a yearly installment, which of the 12; for a monthly or setup line, the payment it came from. */
    paymentId: text("payment_id"),
    installment: integer("installment"),
    note: text("note"),
    approvedByDannoAt: text("approved_by_danno_at"),
    createdAt: createdAt(),
  },
  (t) => [index("partner_payout_lines_workspace_month").on(t.workspaceId, t.month), index("partner_payout_lines_restaurant").on(t.restaurantId, t.month)],
);
export type PartnerPayoutLine = typeof partnerPayoutLines.$inferSelect;

/** A file (logo, photo, menu) of a restaurant: a row in `files`, named by its role. */
export const partnerFiles = sqliteTable(
  "partner_files",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => partnerRestaurants.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull(),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("partner_files_restaurant").on(t.restaurantId, t.role)],
);
export type PartnerFile = typeof partnerFiles.$inferSelect;

/** What a ladder was given from the library and story bank, and which the writer said it used: the Material used panel and the "not in the last 10 ladders" rule. */
export const ladderMaterial = sqliteTable(
  "ladder_material",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    ladderId: text("ladder_id")
      .notNull()
      .references(() => ladders.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MATERIAL_KINDS }).notNull(),
    itemId: text("item_id").notNull(),
    /** The short id the writer saw: T1…T12, S1…S8. */
    tag: text("tag").notNull(),
    used: integer("used", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("ladder_material_ladder").on(t.ladderId), index("ladder_material_user").on(t.userId, t.used)],
);
export type LadderMaterialRow = typeof ladderMaterial.$inferSelect;
export type AiCredential = typeof aiCredentials.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;

/* ───────────── The coach's brain: the FAQ store the Bot Brief approves and pushes ───────────── */

/** The categories the Knowledge Base Builder template writes; a parsed entry outside them keeps its own word. */
export const FAQ_CATEGORIES = ["Pricing", "Getting Started", "What's Included", "Results", "Process", "Logistics", "Policies", "Contact"] as const;
export const FAQ_SOURCES = ["upload", "paste", "template", "airtable"] as const;
export type FaqSource = (typeof FAQ_SOURCES)[number];

/**
 * One FAQ entry in a client's store: the template's five fields, the provenance mark (every entry starts ai_unreviewed until
 * the coach accepts it; an edit is a review), where it came from, and the rank inputs. The store is per client (workspace +
 * user). Nothing here reaches the bot until the Bot Brief approves it and a push reads back.
 */
export const faqEntries = sqliteTable(
  "faq_entries",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    question: text("question").notNull(),
    alsoAsked: text("also_asked", { mode: "json" }).$type<string[]>().notNull().default([]),
    keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull().default([]),
    answer: text("answer").notNull(),
    category: text("category").notNull().default(""),
    origin: text("origin", { enum: ORIGINS }).notNull().default("ai_unreviewed"),
    source: text("source", { enum: FAQ_SOURCES }).notNull(),
    /** The file name, or the Airtable record id, the entry came from. */
    sourceRef: text("source_ref"),
    /** Airtable's Times Asked when present; ranking falls back to recency when it is not. */
    timesAsked: integer("times_asked"),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
    createdAt: createdAt(),
  },
  (t) => [index("faq_entries_owner").on(t.workspaceId, t.userId, t.createdAt)],
);
export type FaqEntry = typeof faqEntries.$inferSelect;

/**
 * One push of the composed FAQ field to a client's bot: what was sent (the entries, as a snapshot the next Brief diffs
 * against), what was dropped past the budget, and both halves of the read-back. Only a sync whose read-back matched moves
 * the record; a failed one is kept for the log with its reason.
 */
export const faqSyncs = sqliteTable(
  "faq_syncs",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    membershipId: text("membership_id").notNull(),
    fieldName: text("field_name").notNull(),
    budget: integer("budget").notNull(),
    chars: integer("chars").notNull(),
    entryCount: integer("entry_count").notNull(),
    /** The questions dropped whole past the budget, lowest-ranked first. */
    dropped: text("dropped", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** The entries sent: id, question and answer, for the next Brief's "what changed since the last sync". */
    snapshot: text("snapshot", { mode: "json" }).$type<{ id: string; question: string; answer: string }[]>().notNull().default([]),
    valueReadBack: integer("value_read_back", { mode: "boolean" }).notNull().default(false),
    tokenReadBack: integer("token_read_back", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    note: text("note"),
    sentBy: text("sent_by"),
    createdAt: createdAt(),
  },
  (t) => [index("faq_syncs_owner").on(t.workspaceId, t.userId, t.createdAt)],
);
export type FaqSync = typeof faqSyncs.$inferSelect;

/**
 * One row per run of a deletion on request, kept by design: who ran it, whose account (the email, the only identifier kept),
 * when, and how many rows and stored objects that run removed, per table. A run the store stopped says where (stopped_at, an
 * object key) and counts what it had removed by then; the run that finishes counts the rest. No content, nothing recoverable.
 */
export const deletionAudits = sqliteTable("deletion_audits", {
  id: id(),
  workspaceId: text("workspace_id").notNull(),
  ranByUserId: text("ran_by_user_id").notNull(),
  deletedEmail: text("deleted_email").notNull(),
  counts: text("counts", { mode: "json" }).$type<Record<string, number>>().notNull().default({}),
  objects: integer("objects").notNull().default(0),
  userRemoved: integer("user_removed", { mode: "boolean" }).notNull().default(false),
  workspaceRemoved: integer("workspace_removed", { mode: "boolean" }).notNull().default(false),
  stoppedAt: text("stopped_at"),
  createdAt: createdAt(),
});

/**
 * One approval of one line the bot will be sent (Needs your eyes): the element, a hash of its exact text, who approved it and
 * when. A changed line hashes differently, so it needs approving again; nothing is approved in bulk.
 */
export const botApprovals = sqliteTable(
  "bot_approvals",
  {
    id: id(),
    membershipId: text("membership_id").notNull(),
    elementKey: text("element_key").notNull(),
    textHash: text("text_hash").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: text("approved_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("bot_approvals_member_element_hash").on(t.membershipId, t.elementKey, t.textHash)],
);

/* ───────────────────────── Body (nutrition + fitness, handoff rev 179) ───────────────────────── */
/*
 * Health data, private to the member by default: nothing here is read outside src/lib/queries/body.ts and src/lib/actions/body.ts
 * (a unit test holds that), and a coach reads it only while the member's share switch is on. Never logged, never sent to AI.
 */

export type BodyWeekPattern = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", string | null>>;
/** A cap on a tagged kind of food: per day unless `per` is "week" (rev 231's weekly caps, which show a next-allowed date). */
export type BodyCap = { tag: string; label: string; unit: string; soft: number; hard: number; per?: "day" | "week" };
export type BodyMealItem = { foodId: string; qty: number };
/** A logged line, with the food's macros per unit copied at logging time: editing a food later never rewrites a past day. */
export type BodyEntryItem = { foodId: string | null; name: string; unit: string; qty: number; cal: number; p: number; f: number; c: number; capTag: string | null; /** mg per unit (rev 231); absent on lines logged before sodium existed. */ sodium?: number; /** Pantry (phase 5): weighed raw or cooked when the member said; `check` when it couldn't convert to the food's basis. */ weighed?: "raw" | "cooked"; check?: boolean };

/** One per member: the share switch, units, floors, the weekly pattern, the refeed rule, meal slots and caps. */
export const bodySettings = sqliteTable(
  "body_settings",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** "Let my coach see my Body data": off by default, revocable any time; every change is a body_share_events row. */
    shareWithCoach: integer("share_with_coach", { mode: "boolean" }).notNull().default(false),
    /**
     * "Let AI use my Body data to support me" (rev 219): off by default, independent of coach sharing, every change a
     * body_share_events row of kind "ai". Read only through canAiUseBody in src/lib/queries/body.ts.
     */
    aiUse: integer("ai_use", { mode: "boolean" }).notNull().default(false),
    /** When the member answered "Choose whether AI can help you" (step 1 of the checklist, rev 222): Yes or Not now both set it. */
    aiAskedAt: text("ai_asked_at"),
    weightUnit: text("weight_unit", { enum: ["lb", "kg"] }).notNull().default("lb"),
    foodUnit: text("food_unit", { enum: ["oz", "g"] }).notNull().default("oz"),
    /** Metric or US (rev 424): what HumanOS shows and takes. Null until first read, then set from the member's time zone; the two units above follow it. */
    /** Supplements and meds (rev 424): the coach sees them only with this on, apart from sharing the rest; an AI only with medsAi on too. */
    medsShare: integer("meds_share", { mode: "boolean" }).notNull().default(false),
    medsAi: integer("meds_ai", { mode: "boolean" }).notNull().default(false),
    measures: text("measures", { enum: ["metric", "us"] }),
    calFloor: real("cal_floor"),
    fatFloor: real("fat_floor"),
    /** Macros where over the top of the band is harmless (🟢). */
    overOk: text("over_ok", { mode: "json" }).$type<("cal" | "p" | "f" | "c")[]>().notNull().default(["p"]),
    weekPattern: text("week_pattern", { mode: "json" }).$type<BodyWeekPattern>().notNull().default({}),
    refeedDayTypeId: text("refeed_day_type_id"),
    /** "Next refeed Saturday": until it's set, no refeed days are generated (rev 186). */
    refeedAnchor: text("refeed_anchor"),
    refeedEveryDays: integer("refeed_every_days").notNull().default(14),
    mealSlots: text("meal_slots", { mode: "json" }).$type<string[]>().notNull().default(["Breakfast", "Lunch", "Dinner", "Snacks"]),
    caps: text("caps", { mode: "json" }).$type<BodyCap[]>().notNull().default([]),
    /** Settings → Training plan (rev 648): the upper-body rotation in order, the routine pinned to the weekend, the lift day types. */
    trainingPlan: text("training_plan", { mode: "json" }).$type<BodyTrainingPlan>(),
    createdAt: createdAt(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("body_settings_member").on(t.workspaceId, t.userId)],
);
export type BodySettings = typeof bodySettings.$inferSelect;
/** Rev 648: see src/lib/engine/body-plan.ts. `liftTypes` null means every day type but one named Off or Rest. */
export type BodyTrainingPlan = { rotation: string[]; weekend: string | null; liftTypes: string[] | null };

/**
 * A day type with its own bands for calories, protein, fat and carbs, and an optional reminder shown on those days. Every band is
 * empty until the member enters it (rev 192: a blank start for everyone); a macro with no band is shown as a total, unmarked.
 */
export const bodyDayTypes = sqliteTable(
  "body_day_types",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    order: integer("order").notNull().default(0),
    calMin: real("cal_min"),
    calMax: real("cal_max"),
    pMin: real("p_min"),
    pMax: real("p_max"),
    fMin: real("f_min"),
    fMax: real("f_max"),
    cMin: real("c_min"),
    cMax: real("c_max"),
    reminder: text("reminder"),
    createdAt: createdAt(),
  },
  (t) => [index("body_day_types_member").on(t.workspaceId, t.userId)],
);
export type BodyDayType = typeof bodyDayTypes.$inferSelect;

/** Store sections the shopping list groups by (rev 237 phase 10). */
export const FOOD_SECTIONS = ["produce", "meat", "dairy", "pantry", "frozen", "other"] as const;
export type FoodSection = (typeof FOOD_SECTIONS)[number];

/** A food, per unit (1 oz, 1 egg, 1 scoop): calories, protein, fat, carbs, and an optional cap tag (cheese). */
export const bodyFoods = sqliteTable(
  "body_foods",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    cal: real("cal").notNull().default(0),
    p: real("p").notNull().default(0),
    f: real("f").notNull().default(0),
    c: real("c").notNull().default(0),
    /** Sodium per unit, in mg (rev 231). */
    sodium: real("sodium").notNull().default(0),
    capTag: text("cap_tag"),
    /** Pantry (phase 5, rev 251): the nutrition is per cooked unit unless the only source was raw. */
    basis: text("basis", { enum: ["cooked", "raw"] }).notNull().default("cooked"),
    /** Keep at least this much on hand, in the food's unit; below it the food goes on the shopping list. */
    par: real("par"),
    /** The member's entered cooked ÷ raw factor; the median of their weighings (body_yields) stands in when blank. */
    cookedYield: real("cooked_yield"),
    /** Shopping (rev 237 phase 10): the store section the list groups by; null reads as other. */
    section: text("section", { enum: FOOD_SECTIONS }),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [index("body_foods_member").on(t.workspaceId, t.userId)],
);
export type BodyFood = typeof bodyFoods.$inferSelect;

/** A saved meal: foods × a default quantity, logged in one tap (the quantities can be adjusted when logging). */
export const bodyMeals = sqliteTable(
  "body_meals",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    slot: text("slot"),
    items: text("items", { mode: "json" }).$type<BodyMealItem[]>().notNull().default([]),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [index("body_meals_member").on(t.workspaceId, t.userId)],
);
export type BodyMeal = typeof bodyMeals.$inferSelect;

/** What was eaten: one logged meal or food on a date, in a slot, with its lines and totals as they were at logging time. */
export const bodyEntries = sqliteTable(
  "body_entries",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    slot: text("slot").notNull(),
    name: text("name").notNull(),
    mealId: text("meal_id"),
    items: text("items", { mode: "json" }).$type<BodyEntryItem[]>().notNull().default([]),
    cal: real("cal").notNull().default(0),
    p: real("p").notNull().default(0),
    f: real("f").notNull().default(0),
    c: real("c").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("body_entries_member_date").on(t.workspaceId, t.userId, t.date)],
);
export type BodyEntry = typeof bodyEntries.$inferSelect;

/** A date the member set by hand: a day type other than the pattern's. */
export const bodyDays = sqliteTable(
  "body_days",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    dayTypeId: text("day_type_id"),
    /** B2 (rev 182): a rest day by choice. Training shows it as Off instead of offering a routine. */
    off: integer("off", { mode: "boolean" }).notNull().default(false),
    /** Rev 237 phase 15 (revs 196/231): a day marked travelling or ill, left out of Patterns when asked; nothing else reads it. */
    flag: text("flag", { enum: ["travel", "illness"] }),
    /** Rev 648: a routine picked by hand for this date ("do Shoulder today instead", or a swap with another day). Only that day. */
    routineId: text("routine_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_days_member_date").on(t.workspaceId, t.userId, t.date)],
);
export type BodyDay = typeof bodyDays.$inferSelect;

/** A coach's comment on one of the member's days, written while the member shared. userId is the member the day belongs to. */
export const bodyComments = sqliteTable(
  "body_comments",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    authorUserId: text("author_user_id").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("body_comments_member_date").on(t.workspaceId, t.userId, t.date)],
);
export type BodyComment = typeof bodyComments.$inferSelect;

/** The share switch's log: every on and off, with when. */
export const bodyShareEvents = sqliteTable(
  "body_share_events",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    shared: integer("shared", { mode: "boolean" }).notNull(),
    /** Which switch: coach sharing, AI use (rev 219), or HumanOS itself (rev 320: the member's, or their coach's with working access). */
    kind: text("kind", { enum: ["coach", "ai", "humanos"] }).notNull().default("coach"),
    createdAt: createdAt(),
  },
  (t) => [index("body_share_events_member").on(t.workspaceId, t.userId)],
);
export type BodyShareEvent = typeof bodyShareEvents.$inferSelect;

/**
 * The HelixOS MCP server's OAuth (rev 224, approved rev 247): HelixOS is the authorization server. A client app (Claude's
 * connector) registers itself, the member approves scopes on the consent screen, and the app holds tokens that act only as
 * that member. Codes and tokens are stored as sha256 hashes only, like inbound secrets and reset links.
 */
export const MCP_SCOPES = ["today", "tasks", "goals", "offers", "content", "content:write", "content:publish", "dms", "proofs", "sales", "recordings", "office_hours", "board", "library", "webinars", "webinars:write", "essence", "magnets", "bot", "forum", "inbox", "body", "partner", "clients"] as const;

/** An app that registered itself (RFC 7591). Public clients only: no secret. Redirect URIs never change after registration. */
export const oauthClients = sqliteTable("oauth_clients", {
  id: id(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

/** One authorization code: single use, ten minutes, bound to the client, its redirect URI, the PKCE challenge, the resource and the ticked scopes. */
export const oauthCodes = sqliteTable(
  "oauth_codes",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    membershipId: text("membership_id").notNull(),
    clientId: text("client_id").notNull(),
    codeHash: text("code_hash").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    resource: text("resource"),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("oauth_codes_hash").on(t.codeHash)],
);

/** A member's grant to one app: the scopes they ticked, when it was last used and for what, and when they cut it. Settings lists these. */
export const connectedApps = sqliteTable(
  "connected_apps",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    membershipId: text("membership_id").notNull(),
    clientId: text("client_id").notNull(),
    name: text("name").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
    lastUsedAt: text("last_used_at"),
    lastTool: text("last_tool"),
    revokedAt: text("revoked_at"),
    /**
     * The Handoff inbox (rev 769): the Forum agent this connection speaks as, set when the coach ties it (Cowork's claude.ai
     * connector, which can't send a token) or made with an agent token. Null for an ordinary connection: no inbox tools.
     */
    agentId: text("agent_id"),
    /** An agent token switched into a client's HelixOS (H-1385): the client's membership, while the coach's grant for that agent stands. */
    switchedMembershipId: text("switched_membership_id"),
    createdAt: createdAt(),
  },
  (t) => [index("connected_apps_member").on(t.workspaceId, t.userId)],
);

/** Access (one hour) and refresh (thirty days) tokens of a grant, by hash. A refresh token is used once; a second use revokes the grant. */
export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    id: id(),
    appId: text("app_id").notNull(),
    kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("oauth_tokens_hash").on(t.tokenHash), index("oauth_tokens_app").on(t.appId)],
);

/** Every tool call: which app, which tool, whether it worked and how long it took. Never the arguments. */
export const mcpCalls = sqliteTable(
  "mcp_calls",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    appId: text("app_id").notNull(),
    tool: text("tool").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull().default(true),
    error: text("error"),
    ms: integer("ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("mcp_calls_app").on(t.appId, t.createdAt)],
);

/** The chat channels Community Loyalty links (rev 247): chat only. Email and SMS run through GoHighLevel and are never here. */
export const CHAT_CHANNELS = ["messenger", "instagram", "whatsapp", "telegram", "webchat"] as const;

/**
 * "Tap to confirm it's you" (Community Loyalty chat, rev 241): a one-time link the coach's bot asks HelixOS for, so a chat on
 * Messenger, Instagram or WhatsApp can be tied to the member's HelixOS account by the member, signed in, never by the bot.
 * Only the token's sha256 is stored. A row becomes a linked chat when the member confirms it (userId set, linkedAt set) and
 * stays as the record until they unlink it.
 */
export const chatLinks = sqliteTable(
  "chat_links",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    /** The member who confirmed, once they have. Null while the link waits. */
    userId: text("user_id"),
    /** The Community Loyalty contact (user_ns) the chat belongs to. An id, not a secret. */
    userNs: text("user_ns").notNull(),
    channel: text("channel", { enum: CHAT_CHANNELS }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    linkedAt: text("linked_at"),
    unlinkedAt: text("unlinked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("chat_links_token").on(t.tokenHash), index("chat_links_member").on(t.workspaceId, t.userId)],
);

/* ── B2, workouts (rev 182): routines of exercises, one session a day, sets as weight × reps. ── */

/** An exercise the member does. Weighted logs weight × reps; bodyweight logs reps (and any added weight). */
export const bodyExercises = sqliteTable(
  "body_exercises",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    /** "timed" (rev 653): a treadmill, a bike; logged as an activity under the session, minutes and distance, never as reps. */
    kind: text("kind", { enum: ["weight", "bodyweight", "timed"] }).notNull().default("weight"),
    /** How far this machine or stack steps up, in the member's weight unit (rev 486): set by the member, or learned from a next-time weight they changed. Null: learned from what they've logged, else 5 (2.5 for a dumbbell). */
    step: real("step"),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [index("body_exercises_member").on(t.workspaceId, t.userId)],
);
export type BodyExercise = typeof bodyExercises.$inferSelect;

/**
 * An exercise merged into another (rev 507): what moved, so Undo can put it back for 7 days. `setIds` are the merged exercise's
 * sets now on the kept one; `routines` and `health` hold the items and restrictions as they were before; `keptStep` the kept
 * exercise's step before it took the merged one's. The member's own: in their export and erased with them.
 */
export const bodyExerciseMerges = sqliteTable(
  "body_exercise_merges",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    keptId: text("kept_id").notNull(),
    mergedId: text("merged_id").notNull(),
    setIds: text("set_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    routines: text("routines", { mode: "json" }).$type<{ routineId: string; items: BodyRoutineItem[] }[]>().notNull().default([]),
    health: text("health", { mode: "json" }).$type<{ healthId: string; restricted: string[] }[]>().notNull().default([]),
    keptStep: real("kept_step"),
    undoneAt: text("undone_at"),
    createdAt: createdAt(),
  },
  (t) => [index("body_exercise_merges_member").on(t.workspaceId, t.userId), index("body_exercise_merges_merged").on(t.mergedId)],
);
export type BodyExerciseMerge = typeof bodyExerciseMerges.$inferSelect;

/** One line of a routine: the exercise and its target, e.g. 3 sets of "8–10". */
/** `weight`: a target the member accepted from a post-workout read (rev 471), in their weight unit; none until they do. */
export type BodyRoutineItem = { exerciseId: string; sets: number; reps: string; weight?: number | null };

/** A routine: exercises in order with targets. Tied to a day type, it's the one Training offers on that type's days. */
export const bodyRoutines = sqliteTable(
  "body_routines",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    dayTypeId: text("day_type_id"),
    items: text("items", { mode: "json" }).$type<BodyRoutineItem[]>().notNull().default([]),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [index("body_routines_member").on(t.workspaceId, t.userId)],
);
export type BodyRoutine = typeof bodyRoutines.$inferSelect;

/** A day's workout: at most one per date, with the routine it started from (its name copied, so renaming never rewrites it). */
export const bodySessions = sqliteTable(
  "body_sessions",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    routineId: text("routine_id"),
    routineName: text("routine_name"),
    /** Phase 3 (rev 237): "Finish workout" stamps the session done; logging another set reopens it. */
    completedAt: text("completed_at"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_sessions_member_date").on(t.workspaceId, t.userId, t.date)],
);
export type BodySession = typeof bodySessions.$inferSelect;

/** One set: weight × reps in the unit it was logged in (lb or kg). Weight is null for a bodyweight set with nothing added. */
export const bodySets = sqliteTable(
  "body_sets",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    exerciseId: text("exercise_id").notNull(),
    date: text("date").notNull(),
    weight: real("weight"),
    unit: text("unit", { enum: ["lb", "kg"] }).notNull().default("lb"),
    reps: integer("reps").notNull(),
    /** Rev 653: a note on the set ("right shoulder pinched"), and a warm-up, which no PR, volume, tally or next weight counts. */
    note: text("note"),
    warmup: integer("warmup", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("body_sets_member_exercise").on(t.workspaceId, t.userId, t.exerciseId, t.date), index("body_sets_session").on(t.sessionId)],
);
export type BodySet = typeof bodySets.$inferSelect;

/* ── Body composition (rev 237 phase 2, migration 0083): every reading, as one long table. ── */

/** Where a daily number came from. "health" is the Apple Health webhook (B4), "whoop" B6. */
export const BODY_SOURCES = ["manual", "renpho", "airtable", "whoop", "health"] as const;
export type BodySource = (typeof BODY_SOURCES)[number];

/**
 * One number of one reading: weight, body fat % and the rest, each its own row, so adding a metric is adding a key, never a
 * migration. The rows of one step on the scale share a readingId and are kept together (rev 251: the day's figure is the
 * lowest-weight reading, whole, never mixed across readings). Masses are stored in lb whatever the member's unit; the keys and
 * their units are in src/lib/engine/body-scale.ts.
 */
export const bodyDaily = sqliteTable(
  "body_daily",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    key: text("key").notNull(),
    value: real("value").notNull(),
    source: text("source", { enum: BODY_SOURCES }).notNull().default("manual"),
    readingId: text("reading_id").notNull(),
    /** The reading's wall time, HH:MM, when the source gave one. */
    time: text("time"),
    createdAt: createdAt(),
  },
  (t) => [index("body_daily_member_key_date").on(t.workspaceId, t.userId, t.key, t.date), index("body_daily_reading").on(t.readingId)],
);
export type BodyDailyRow = typeof bodyDaily.$inferSelect;

/** What a goal is of (rev 508 §5): a scale number, the waist, a lift, a habit, workouts a week, or average sleep. */
export const BODY_GOAL_KINDS = ["scale", "waist", "lift", "habit", "training", "sleep"] as const;
export type BodyGoalKind = (typeof BODY_GOAL_KINDS)[number];

/**
 * A goal: the target (in the stored unit: lb, inches, hours, a count a week) and, optionally, by when. One per key: a scale
 * goal's key is its metric ("weight"), the others "waist", "lift:<exercise>", "habit:<habit>", "training", "sleep". A lift is a
 * weight for `reps`; a habit and training count days or sessions a week. The start is where the line begins (the 7-day average
 * the day it was set, unless the member gave one). Goals from before rev 508 are scale goals with no start: the engine reads it.
 */
export const bodyGoals = sqliteTable(
  "body_goals",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    kind: text("kind", { enum: BODY_GOAL_KINDS }).notNull().default("scale"),
    refId: text("ref_id"),
    reps: integer("reps"),
    target: real("target").notNull(),
    by: text("by"),
    startValue: real("start_value"),
    startDate: text("start_date"),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_goals_member_key").on(t.workspaceId, t.userId, t.key)],
);
export type BodyGoal = typeof bodyGoals.$inferSelect;

/* ── Pantry (rev 237 phase 5, migration 0086): what's on hand, and the weighings a cooked yield is learned from. ── */

/** One thing on the shelf: a food, how much in what unit, raw or cooked, where, bought when, use by when. */
export const bodyPantry = sqliteTable(
  "body_pantry",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    foodId: text("food_id").notNull(),
    qty: real("qty").notNull(),
    unit: text("unit").notNull(),
    state: text("state", { enum: ["raw", "cooked"] }).notNull().default("raw"),
    location: text("location", { enum: ["fridge", "freezer", "pantry"] }).notNull().default("fridge"),
    boughtOn: text("bought_on"),
    useBy: text("use_by"),
    createdAt: createdAt(),
  },
  (t) => [index("body_pantry_member").on(t.workspaceId, t.userId), index("body_pantry_food").on(t.foodId)],
);
export type BodyPantryItem = typeof bodyPantry.$inferSelect;

/** One raw → cooked weighing of a food, in one unit: the cooked yield is their median (rev 251). */
export const bodyYields = sqliteTable(
  "body_yields",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    foodId: text("food_id").notNull(),
    raw: real("raw").notNull(),
    cooked: real("cooked").notNull(),
    unit: text("unit").notNull(),
    date: text("date").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("body_yields_food").on(t.workspaceId, t.userId, t.foodId)],
);
export type BodyYield = typeof bodyYields.$inferSelect;

/* ── Habits and the health log (rev 237 phase 8, B7, migration 0089). Sleep needs no table: its numbers are body_daily keys. ── */

/** What a habit counts in: done or not, minutes, a count, or an amount in its unit. */
export const HABIT_KINDS = ["done", "minutes", "count", "amount"] as const;
export type HabitKind = (typeof HABIT_KINDS)[number];

/** A habit from the starter list or the member's own: its kind, an optional daily target, and the weekdays it applies (empty = every day). */
export const bodyHabits = sqliteTable(
  "body_habits",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: HABIT_KINDS }).notNull().default("done"),
    unit: text("unit"),
    target: real("target"),
    days: text("days", { mode: "json" }).$type<number[]>().notNull().default([]),
    order: integer("order").notNull().default(0),
    /** Optional easy / medium / hard (Joy, rev 431): shown on the habit, no change to how it counts. */
    difficulty: text("difficulty", { enum: ["easy", "medium", "hard"] }),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [index("body_habits_member").on(t.workspaceId, t.userId)],
);
export type BodyHabit = typeof bodyHabits.$inferSelect;

export const HABIT_SOURCES = ["manual", "whoop"] as const;
/** One habit's value on one day (1 for done); at most one row per habit and day. */
export const bodyHabitLogs = sqliteTable(
  "body_habit_logs",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    habitId: text("habit_id").notNull(),
    date: text("date").notNull(),
    value: real("value").notNull(),
    source: text("source", { enum: HABIT_SOURCES }).notNull().default("manual"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_habit_logs_habit_date").on(t.habitId, t.date), index("body_habit_logs_member_date").on(t.workspaceId, t.userId, t.date)],
);
export type BodyHabitLog = typeof bodyHabitLogs.$inferSelect;

export const HEALTH_SIDES = ["left", "right", "both"] as const;
/**
 * The health log (revs 231 and 251): one row per injury, the member's alone. Never shown to the coach even while sharing is on,
 * never in AI features, MCP tools or any export to the coach; in the member's own export and delete-all like the rest of Body.
 */
export const bodyHealth = sqliteTable(
  "body_health",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    side: text("side", { enum: HEALTH_SIDES }),
    startedOn: text("started_on").notNull(),
    resolvedOn: text("resolved_on"),
    /** Affected movements, in the member's words ("overhead pressing"). */
    movements: text("movements"),
    /** Exercises to leave out while it's open, marked on Training. */
    restricted: text("restricted", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("body_health_member").on(t.workspaceId, t.userId)],
);
export type BodyHealth = typeof bodyHealth.$inferSelect;

/* ── Shopping and Instacart (rev 237 phase 10, migration 0089). ── */

/** The week's plan the shopping list starts from: a saved meal, how many times this week (Monday-keyed). */
export const bodyPlan = sqliteTable(
  "body_plan",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    monday: text("monday").notNull(),
    mealId: text("meal_id").notNull(),
    times: integer("times").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_plan_member_week_meal").on(t.workspaceId, t.userId, t.monday, t.mealId)],
);
export type BodyPlanRow = typeof bodyPlan.$inferSelect;

export type BodyOrderLine = { name: string; qty: number; unit: string };
/**
 * Every push to Instacart (rev 232's log): the lines sent, the shopping-list link that came back, and a status. Today the last step
 * creates the link and stops ("link"); auto-ordering later adds pending, placed and cancelled without rework. HelixOS never
 * places or pays for an order, and nothing of a payment is ever here.
 */
export const bodyOrders = sqliteTable(
  "body_orders",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    lines: text("lines", { mode: "json" }).$type<BodyOrderLine[]>().notNull().default([]),
    link: text("link"),
    status: text("status", { enum: ["link", "failed", "pending", "placed", "cancelled"] }).notNull().default("link"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("body_orders_member").on(t.workspaceId, t.userId)],
);
export type BodyOrder = typeof bodyOrders.$inferSelect;

/* ── Devices: WHOOP (B6, rev 237 phase 11, migration 0090). ── */

/**
 * A member's connected device: one row per provider, the OAuth tokens sealed at rest (src/lib/crypto.ts), never logged or shown.
 * Disconnect deletes the row. Body table: the member's export and delete-all, never a coach's export.
 */
export const bodyDevices = sqliteTable(
  "body_devices",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: ["whoop"] }).notNull().default("whoop"),
    /** The provider's id for this member, so a webhook finds them without a token. */
    providerUserId: text("provider_user_id"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: text("expires_at"),
    scopes: text("scopes"),
    connectedAt: text("connected_at"),
    lastSyncAt: text("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_devices_member_provider").on(t.workspaceId, t.userId, t.provider), index("body_devices_provider_user").on(t.provider, t.providerUserId)],
);
export type BodyDevice = typeof bodyDevices.$inferSelect;

/**
 * A member's key for sending weigh-ins in from outside (rev 508 §4: Apple Health through an iOS Shortcut). Only its hash is
 * stored; the key itself is shown once, when made, and never logged, shown again or exported. Revoke stops it for good.
 * Body table: the member's export (without the hash) and delete-all, never a coach's export.
 */
/**
 * Bot connection (rev 696): the key a member's Community Loyalty bot sends to HelixOS's bot server, one live key per member.
 * Shown once in full; kept only as its hash and its last four. Revoking it stops every call at once.
 */
export const botKeys = sqliteTable(
  "bot_keys",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    last4: text("last4").notNull(),
    /** Who made it: the member, or their coach on the client's bot page. */
    createdBy: text("created_by").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bot_keys_hash").on(t.tokenHash), index("bot_keys_member").on(t.workspaceId, t.userId)],
);
export type BotKey = typeof botKeys.$inferSelect;

/**
 * A sign-up for one of a member's webinars, made by their bot (rev 808): who, the custom fields the bot passed (industry, pain,
 * problem, desire and any others, cleaned and length-limited: they come from strangers), and a long random code set aside for
 * their own page (the Magic funnel, coming). The person is in the member's DMs too, as a "webinar" lead.
 */
export const webinarSignups = sqliteTable(
  "webinar_signups",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    webinarId: text("webinar_id").notNull(),
    firstName: text("first_name").notNull(),
    email: text("email").notNull(),
    contactId: text("contact_id"),
    /** The bot's contact id for this person, when the flow passed one. */
    clContactId: text("cl_contact_id"),
    custom: text("custom", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    pageCode: text("page_code").notNull(),
    /** The Magic funnel (revs 812, 815): "chat" signed up inside the chat; "mf" was sent a personal page and isn't in until they register. */
    source: text("source", { enum: ["chat", "mf"] }).notNull().default("chat"),
    lastName: text("last_name"),
    phone: text("phone"),
    /** The prospect's own words for the writer (pain, industry, the conversation summary): cleaned and cut, never shown on the page. */
    said: text("said", { mode: "json" }).$type<{ pain: string; industry: string; summary: string }>(),
    /** Who they are as a business owner, written first (rev 815 §2); shown on their DMs lead, counts only for a coach. */
    profile: text("profile", { mode: "json" }).$type<MfProfile>(),
    /** Their page, one JSON (rev 815 §3), and which sections are personal and which fell back to the member's default copy. */
    pitch: text("pitch", { mode: "json" }).$type<MfPitch>(),
    pitchSources: text("pitch_sources", { mode: "json" }).$type<Record<string, "personal" | "default">>(),
    pitchStatus: text("pitch_status", { enum: ["none", "writing", "personal", "partial", "default"] }).notNull().default("none"),
    /** Why the page is the default copy, when it is: "no key", "daily cap", "no profile" or "failed". */
    pitchNote: text("pitch_note"),
    pitchAt: text("pitch_at"),
    /** The first time their page asked for it. */
    openedAt: text("opened_at"),
    /** When they registered, and how HelixOS heard: inside the chat, GHL's workflow webhook, or the page's own signal. */
    registeredAt: text("registered_at"),
    registeredVia: text("registered_via", { enum: ["chat", "webhook", "page", "helixos"] }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("webinar_signups_person").on(t.webinarId, t.email), uniqueIndex("webinar_signups_page").on(t.pageCode), index("webinar_signups_member").on(t.workspaceId, t.userId)],
);
export type WebinarSignup = typeof webinarSignups.$inferSelect;

/**
 * The Magic funnel's setup for one webinar (revs 812, 815; Coach → Webinars → Magic funnel): the switch, the voice and prompt
 * box, three pillars, the agenda, objections answered from the facts, real urgency only, the Proof Bank items it may pick from,
 * and default copy for every section. The facts themselves (title, date, promise, what they'll learn, who it's for) are the
 * webinar's own fields.
 */
export const mfSetups = sqliteTable(
  "mf_setups",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    webinarId: text("webinar_id").notNull(),
    live: integer("live", { mode: "boolean" }).notNull().default(false),
    /** Null: Danno's IGDITD prompt (DEFAULT_PROMPT), adapted for a page shown before they register. */
    prompt: text("prompt"),
    pillars: text("pillars", { mode: "json" }).$type<MfPillar[]>().notNull().default([]),
    agenda: text("agenda", { mode: "json" }).$type<MfAgendaItem[]>().notNull().default([]),
    objections: text("objections", { mode: "json" }).$type<MfObjection[]>().notNull().default([]),
    urgency: text("urgency", { mode: "json" }).$type<MfUrgency>().notNull().default({ seatCap: null, bonusDeadline: null, bonusLine: "", liveOnly: false }),
    defaults: text("defaults", { mode: "json" }).$type<MfDefaults>().notNull().default(EMPTY_DEFAULTS),
    /** The Proof Bank items it may pick from; empty means every approved item with the permission tick. */
    proofIds: text("proof_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** With none chosen (H-9): any approved proof with the permission tick, or none at all when off. */
    proofAny: integer("proof_any", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("mf_setups_webinar").on(t.webinarId), index("mf_setups_member").on(t.workspaceId, t.userId)],
);
export type MfSetup = typeof mfSetups.$inferSelect;

/**
 * A coach's preview of one prospect's page, kept a day so it can open as the real page (H-142): the written pitch for a
 * made-up person, by a 256-bit code. Never a sign-up: no email, no contact, no counts, no form. Rows past their day are
 * deleted when the next preview is made.
 */
export const mfPreviews = sqliteTable(
  "mf_previews",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    webinarId: text("webinar_id").notNull(),
    code: text("code").notNull(),
    firstName: text("first_name").notNull().default(""),
    pitch: text("pitch", { mode: "json" }).$type<MfPitch>().notNull(),
    sources: text("sources", { mode: "json" }).$type<Record<string, "personal" | "default">>().notNull().default({}),
    createdAt: createdAt(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [uniqueIndex("mf_previews_code").on(t.code), index("mf_previews_member").on(t.workspaceId, t.userId)],
);
export type MfPreview = typeof mfPreviews.$inferSelect;

export const bodyIngestTokens = sqliteTable(
  "body_ingest_tokens",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    label: text("label").notNull().default("Apple Health"),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_ingest_tokens_hash").on(t.tokenHash), index("body_ingest_tokens_member").on(t.workspaceId, t.userId)],
);
export type BodyIngestToken = typeof bodyIngestTokens.$inferSelect;

/** A workout the device recorded, by its sport: when, how long, strain and heart rate. One row per provider id; replaced when updated. */
export const bodyActivities = sqliteTable(
  "body_activities",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    /** "manual" (rev 653): logged by the member, by voice or a timed exercise; providerId is then the row's own id. */
    provider: text("provider", { enum: ["whoop", "manual"] }).notNull().default("whoop"),
    providerId: text("provider_id").notNull(),
    date: text("date").notNull(),
    sport: text("sport").notNull(),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    minutes: real("minutes").notNull().default(0),
    strain: real("strain"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    /** Phase 16b: metres covered, minutes in heart-rate zones 0 to 5, and the Training session this workout sits under. */
    distanceM: real("distance_m"),
    zones: text("zones", { mode: "json" }).$type<number[]>(),
    sessionId: text("session_id"),
    /** Rev 653: easy, moderate or hard, as the member said it; none from WHOOP, which has strain. */
    intensity: text("intensity", { enum: ["easy", "moderate", "hard"] }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_activities_member_provider_id").on(t.workspaceId, t.userId, t.provider, t.providerId), index("body_activities_member_date").on(t.workspaceId, t.userId, t.date)],
);
export type BodyActivity = typeof bodyActivities.$inferSelect;

/**
 * How I feel (rev 653), one a day, saved again to update: energy, mood and sleep feel 1 to 5, soreness and where. The numbers follow
 * the member's coach-sharing switch like sleep; the note is the member's alone, never shown to a coach. Not the weekly check-in.
 */
export const FEEL_SORENESS = ["none", "some", "sore"] as const;
export const bodyFeelings = sqliteTable(
  "body_feelings",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    date: text("date").notNull(),
    energy: integer("energy"),
    mood: integer("mood"),
    soreness: text("soreness", { enum: FEEL_SORENESS }),
    sorenessArea: text("soreness_area"),
    sleepFeel: integer("sleep_feel"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("body_feelings_member_date").on(t.workspaceId, t.userId, t.date)],
);
export type BodyFeeling = typeof bodyFeelings.$inferSelect;

/**
 * B9 (rev 237): a coach's template, sent one way to a client as a snapshot of the coach's own day type, meal (with its foods) or
 * routine (with its exercises). `userId` is the client, so it goes with their data; the coach reads nothing of the client's.
 */
export const TEMPLATE_SEND_STATUS = ["sent", "accepted", "declined"] as const;
export const bodyTemplateSends = sqliteTable(
  "body_template_sends",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    coachUserId: text("coach_user_id").notNull(),
    coachName: text("coach_name").notNull(),
    kind: text("kind", { enum: ["day_type", "meal", "routine"] }).notNull(),
    name: text("name").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: TEMPLATE_SEND_STATUS }).notNull().default("sent"),
    decidedAt: text("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [index("body_template_sends_member").on(t.workspaceId, t.userId), index("body_template_sends_coach").on(t.workspaceId, t.coachUserId)],
);
export type BodyTemplateSend = typeof bodyTemplateSends.$inferSelect;

/** B9: the member's weekly check-in, the week's numbers as lines plus one note, sent to the coach even with sharing off. One a week. */
export const bodyCheckins = sqliteTable(
  "body_checkins",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    monday: text("monday").notNull(),
    lines: text("lines", { mode: "json" }).$type<string[]>().notNull().default([]),
    note: text("note").notNull().default(""),
    sentAt: text("sent_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_checkins_member_week").on(t.workspaceId, t.userId, t.monday)],
);
export type BodyCheckin = typeof bodyCheckins.$inferSelect;

/**
 * Supplements, vitamins and prescriptions (rev 424; Joy and Tom, rev 431): what the member takes and when, the supply on hand, and
 * for a script its issue, expiry, repeats and refill rule. Private like the health log: never the coach unless the member shares
 * this area on its own switch; never to an AI without its own tick. No dose advice, no interaction checks.
 */
export const bodyMeds = sqliteTable(
  "body_meds",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ["supplement", "vitamin", "prescription"] }).notNull().default("supplement"),
    dose: text("dose"),
    howTaken: text("how_taken"),
    timesPerDay: integer("times_per_day").notNull().default(1),
    days: text("days", { mode: "json" }).$type<number[]>().notNull().default([]),
    withFood: text("with_food", { enum: ["with", "without", "either"] }),
    note: text("note"),
    perDose: real("per_dose").notNull().default(1),
    unitWord: text("unit_word"),
    onHand: real("on_hand"),
    boxedUntil: text("boxed_until"),
    supplyDays: integer("supply_days"),
    repeatsLeft: integer("repeats_left"),
    lastFilledOn: text("last_filled_on"),
    issuedOn: text("issued_on"),
    expiresOn: text("expires_on"),
    scriptKind: text("script_kind", { enum: ["paper", "electronic"] }),
    refillRule: text("refill_rule", { enum: ["before_runout", "share_used"] }).notNull().default("before_runout"),
    refillDays: integer("refill_days").notNull().default(12),
    refillShare: integer("refill_share").notNull().default(75),
    remindDays: integer("remind_days").notNull().default(5),
    remindOn: text("remind_on", { enum: ["runout", "refill_open"] }).notNull().default("runout"),
    pharmacy: text("pharmacy"),
    prescriber: text("prescriber"),
    archivedAt: text("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [index("body_meds_member").on(t.workspaceId, t.userId)],
);
export type BodyMed = typeof bodyMeds.$inferSelect;

/** A dose taken: one row per med, date and dose of the day (1 to its times a day). */
export const bodyMedLogs = sqliteTable(
  "body_med_logs",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    medId: text("med_id").notNull(),
    date: text("date").notNull(),
    slot: integer("slot").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("body_med_logs_dose").on(t.medId, t.date, t.slot), index("body_med_logs_member_date").on(t.workspaceId, t.userId, t.date)],
);
export type BodyMedLog = typeof bodyMedLogs.$inferSelect;

/**
 * "Switch to client" (rev 216): the coach's switches in and out, and every change made while working in a client's HelixOS,
 * in plain words. The client sees the changes in Settings ("Changes by your coach"); the coach's client page shows the
 * switches. Never the values themselves: which page, which item, what was done.
 */
export const coachChanges = sqliteTable(
  "coach_changes",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    clientMembershipId: text("client_membership_id").notNull(),
    /** The client whose HelixOS it was: theirs, so it is in their export and goes with deletion on request. */
    userId: text("user_id").notNull(),
    coachUserId: text("coach_user_id").notNull(),
    /** The coach's agent that made the change or switched (H-1385), when it was an agent on its token and not the coach themselves. */
    agentId: text("agent_id"),
    kind: text("kind", { enum: ["switch_in", "switch_out", "change"] }).notNull(),
    mode: text("mode", { enum: ["view", "work"] }).notNull(),
    /** What was done, in plain words ("Saved an offer"). */
    action: text("action"),
    /** The page it was done on ("Offers") and the item's name when there is one ("Deep Work Reset"). */
    page: text("page"),
    item: text("item"),
    createdAt: createdAt(),
  },
  (t) => [index("coach_changes_client").on(t.clientMembershipId, t.createdAt)],
);
export type CoachChange = typeof coachChanges.$inferSelect;

/**
 * An agent working in a client's HelixOS (H-1385): the coach's grant, per client and per agent, off by default. Revoked
 * rows stay as the record; a live grant has no revokedAt. The agent's token switches in only while one stands, and only
 * while the client's own "Let my coach work in my HelixOS" is on does it work rather than view.
 */
export const agentClientGrants = sqliteTable(
  "agent_client_grants",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    coachUserId: text("coach_user_id").notNull(),
    agentId: text("agent_id").notNull(),
    clientMembershipId: text("client_membership_id").notNull(),
    grantedAt: text("granted_at").notNull().default(sql`(datetime('now'))`),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("agent_client_grants_client").on(t.clientMembershipId, t.agentId), index("agent_client_grants_agent").on(t.agentId)],
);
export type AgentClientGrant = typeof agentClientGrants.$inferSelect;

/**
 * Team access (Danno, 6 Oct): a person a member invited into their HelixOS, with their own login. A row here is not a
 * membership: nothing that counts, reminds or ranks members ever sees a team member. `userId` is the owner (the member whose
 * HelixOS it is), so the row is in the owner's export and erased with them; `teamUserId` is the person on the team. Removal is
 * soft (`removedAt`): access ends on the next request, the row stays for "added by" and the log. One live row per person per
 * owner (the partial unique index in migration 0122); a person removed and invited again gets a new row.
 */
export const teamMembers = sqliteTable(
  "team_members",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    /** The owner's membership, in the same workspace. */
    ownerMembershipId: text("owner_membership_id").notNull(),
    /** The owner's user id: whose data the team member works in. */
    userId: text("user_id").notNull(),
    /** The team member's own account. */
    teamUserId: text("team_user_id").notNull(),
    /** Who created the invite this person joined through: the owner, or their coach from the client page. */
    addedBy: text("added_by").notNull(),
    /** The last request they made in this HelixOS, to the hour. */
    lastActiveAt: text("last_active_at"),
    /** The first arrival (H-472): when this team member saw the welcome ceremony on their first sign-in. */
    firstArrivalSeenAt: text("first_arrival_seen_at"),
    removedAt: text("removed_at"),
    removedBy: text("removed_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("team_members_owner").on(t.ownerMembershipId, t.removedAt),
    index("team_members_user").on(t.teamUserId, t.removedAt),
    uniqueIndex("team_members_live").on(t.ownerMembershipId, t.teamUserId).where(sql`removed_at IS NULL`),
  ],
);
export type TeamMember = typeof teamMembers.$inferSelect;

/**
 * An invite link to a member's team: works once, for seven days, and only its sha256 hash is stored (the link itself is
 * shown to the inviter once and never written anywhere). `userId` is the owner's, so it is theirs to export and erase.
 */
export const teamInvites = sqliteTable(
  "team_invites",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    ownerMembershipId: text("owner_membership_id").notNull(),
    userId: text("user_id").notNull(),
    createdBy: text("created_by").notNull(),
    codeHash: text("code_hash").notNull().unique(),
    /** Who the inviter meant it for, in their own words ("Sam, our VA"). Optional; shown beside the pending invite. */
    label: text("label"),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    usedByUserId: text("used_by_user_id"),
    /** The inviter cancelled it before it was used. */
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("team_invites_owner").on(t.ownerMembershipId, t.createdAt)],
);
export type TeamInvite = typeof teamInvites.$inferSelect;

/**
 * What each team member did in the owner's HelixOS: one row per write request, in plain words, as coach_changes records a
 * switched coach's; and their sign-ins, joins and removals. The owner's, in their export, erased with them.
 */
export const teamChanges = sqliteTable(
  "team_changes",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    ownerMembershipId: text("owner_membership_id").notNull(),
    /** The owner's user id. */
    userId: text("user_id").notNull(),
    teamMemberId: text("team_member_id").notNull(),
    teamUserId: text("team_user_id").notNull(),
    kind: text("kind", { enum: ["joined", "sign_in", "change", "removed"] }).notNull(),
    /** What was done, in plain words ("Created task"). */
    action: text("action"),
    /** The page it was done on ("Tasks") and the item's name when there is one. */
    page: text("page"),
    item: text("item"),
    createdAt: createdAt(),
  },
  (t) => [index("team_changes_owner").on(t.ownerMembershipId, t.createdAt)],
);
export type TeamChange = typeof teamChanges.$inferSelect;
export type ChatLink = typeof chatLinks.$inferSelect;
export type OauthClient = typeof oauthClients.$inferSelect;
export type ConnectedApp = typeof connectedApps.$inferSelect;
export type OauthToken = typeof oauthTokens.$inferSelect;

/**
 * A headshot from the coach's Airtable import that matched no client, or more than one, or had no email (client headshots,
 * Danno 8 Oct): the coach picks the client, or dismisses it. Never guessed. The photo was downloaded when the row was made
 * (Airtable's addresses expire within hours) and lives in the private store under headshots/<workspace>/review/. One row per
 * attachment: a re-run never adds the same photo twice, whatever became of it.
 */
export const HEADSHOT_REVIEW_REASONS = ["no_email", "no_match", "shared_email", "several_members"] as const;
export const HEADSHOT_REVIEW_STATUSES = ["open", "picked", "dismissed"] as const;
export const headshotReviews = sqliteTable(
  "headshot_reviews",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    airtableRecordId: text("airtable_record_id").notNull(),
    attachmentId: text("attachment_id").notNull(),
    name: text("name").notNull().default(""),
    email: text("email"),
    reason: text("reason", { enum: HEADSHOT_REVIEW_REASONS }).notNull(),
    /** The memberships it could be, when there were several. */
    candidates: text("candidates", { mode: "json" }).$type<string[]>().notNull().default([]),
    photoUrl: text("photo_url"),
    displayUrl: text("photo_display_url"),
    mime: text("mime"),
    status: text("status", { enum: HEADSHOT_REVIEW_STATUSES }).notNull().default("open"),
    pickedMembershipId: text("picked_membership_id"),
    resolvedBy: text("resolved_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("headshot_reviews_attachment").on(t.workspaceId, t.attachmentId)],
);
export type HeadshotReview = typeof headshotReviews.$inferSelect;

/* ───────────────────────── My Board (rev 664) ───────────────────────── */

/**
 * One question to the member's Board, and its answer as the server checked it. A follow-up on the same decision points at the
 * first (parentId), so the first question hears all five advisors and later ones the few who matter. Private to the member;
 * shared with the coach only when they say so. Steps become tasks only through "Set it up for me", and their status is read
 * live from those tasks, never copied here.
 */
export type BoardUsed = { label: string; href: string };
export type BoardProposal = { id: string; kind: string; title: string; detail: string; before?: string | null; after?: string | null; payload: Record<string, unknown> };
export type BoardApplied = { proposalId: string; kind: string; ref: string | null; href: string | null; at: string };
export type BoardCheckin = { at: string; steps: { index: number; state: "done" | "stuck" | "dropped" }[]; note?: string | null };
export const boardDecisions = sqliteTable(
  "board_decisions",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    parentId: text("parent_id"),
    question: text("question").notNull(),
    mode: text("mode").notNull().default("board"),
    focus: text("focus"),
    preset: text("preset", { enum: ["standard", "edge"] }).notNull().default("standard"),
    answer: text("answer", { mode: "json" }).$type<import("@/lib/engine/board").BoardAnswer>(),
    /** What the server changed or left out, said to the member. */
    notes: text("notes", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** "The Board used: …": what was read for this answer, each with its page. */
    used: text("used", { mode: "json" }).$type<BoardUsed[]>().notNull().default([]),
    proposals: text("proposals", { mode: "json" }).$type<BoardProposal[]>().notNull().default([]),
    applied: text("applied", { mode: "json" }).$type<BoardApplied[]>().notNull().default([]),
    /** The tasks the steps became, by step index; null for a step not set up. */
    stepTasks: text("step_tasks", { mode: "json" }).$type<(string | null)[]>().notNull().default([]),
    checkins: text("checkins", { mode: "json" }).$type<BoardCheckin[]>().notNull().default([]),
    /** The seats this answer sat with (rev 756 §5), chair by chair, with the version each used. Null on answers before it. */
    seats: text("seats", { mode: "json" }).$type<BoardSeatUsed[]>(),
    sharedAt: text("shared_at"),
    /** "The Board remembers this" (H-257): off keeps the decision out of future discussions; the decision itself stays. */
    remembered: integer("remembered", { mode: "boolean" }).notNull().default(true),
    /** An example (H-257): a coach's demo, saved and replayable, out of the Board's memory and the Forum's count. */
    example: integer("example", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("board_decisions_member").on(t.workspaceId, t.userId, t.createdAt), index("board_decisions_parent").on(t.parentId)],
);
export type BoardDecision = typeof boardDecisions.$inferSelect;

/** One seat an answer sat with: enough to name it as it was then. */
export type BoardSeatUsed = { id: string | null; key: string; name: string; short: string; role: string; kind: "chair" | "expert" | "archetype" | "custom" | "edge"; version: number; operator: boolean; paused?: boolean; retired?: boolean };

/**
 * My Board's seat library (rev 756 §6), the coach workspace's own: the 62 approved expert seats seeded word for word from
 * docs/board/board-seat-library-v1.md, the four archetypes from board-profile.md, and members' custom seats (owner set, at most
 * two each, private to them and their coach). An edit bumps the version; answers keep the version they used.
 */
export const boardSeats = sqliteTable(
  "board_seats",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["expert", "archetype", "custom"] }).notNull(),
    /** A custom seat's member; null for the library. (Named userId so the member-data lists key on it; the column keeps its name.) */
    userId: text("owner_user_id"),
    areas: text("areas", { mode: "json" }).$type<string[]>().notNull().default([]),
    card: text("card").notNull().default(""),
    profile: text("profile", { mode: "json" }).$type<import("@/lib/engine/board-seats").SeatProfile>().notNull(),
    isOperator: integer("is_operator", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    version: integer("version").notNull().default(1),
    /** A custom seat named after a real person (it must end in "style"); with no sources it runs as "my read" only. */
    realPerson: integer("real_person", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("board_seats_slug").on(t.workspaceId, t.slug), index("board_seats_owner").on(t.workspaceId, t.userId)],
);
export type BoardSeat = typeof boardSeats.$inferSelect;

/** Danno's principles (rev 664 §8), the coach's to edit, seeded from docs/board/danno-source-pack.md. */
export const boardPrinciples = sqliteTable(
  "board_principles",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    goodFor: text("good_for").notNull().default(""),
    order: integer("order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("board_principles_ws").on(t.workspaceId, t.order)],
);
export type BoardPrinciple = typeof boardPrinciples.$inferSelect;

/**
 * Building with AI: the words (rev 768). The seed lives in src/content/glossary.ts; a row here is a coach's change to one entry
 * of their workspace's glossary (same slug: edited or hidden) or an entry they added (a new slug). The page reads the seed with
 * these on top, so an edit shows on the next load.
 */
export const glossaryEntries = sqliteTable(
  "glossary_entries",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    heading: text("heading").notNull(),
    term: text("term").notNull(),
    meaning: text("meaning").notNull(),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("glossary_entries_slug").on(t.workspaceId, t.slug)],
);
export type GlossaryEntry = typeof glossaryEntries.$inferSelect;

/**
 * The Forum (rev 765): a member's own map of their AI agents. An agent is a building on one of twelve plots; reports from the connector, the
 * member's webhook or the member themselves set its status and its now, last and next. `plotId` is the plot it stands on in
 * the photo forum (one of FORUM_PLOTS, at most one agent each); null lists it under the map, in the Outer districts.
 * Built-in agents (the booking bot, Ship, Recordings, My Board) are read live from what HelixOS already records and only get
 * a row here when the member moves one. Everything an agent sends is untrusted text, capped and scrubbed before it lands.
 */
export const FORUM_STATUSES = ["working", "waiting", "idle", "done"] as const;
/** The twelve plots on the forum photo (forum12-plots.json), in the order new agents take them. */
export const FORUM_PLOTS = ["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10", "p11", "p12"] as const;
export const FORUM_SOURCES = ["member", "connector", "webhook", "builtin", "seed", "agent", "watch"] as const;
export type ForumMilestone = { name: string; state: "done" | "now" | "queued"; rev?: string };
export const forumAgents = sqliteTable(
  "forum_agents",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    /** The name lowercased and trimmed: a report names its agent, and one name is one agent. */
    nameKey: text("name_key").notNull(),
    platform: text("platform"),
    role: text("role"),
    link: text("link"),
    plotId: text("plot_id", { enum: FORUM_PLOTS }),
    /** Set for a built-in agent's row (made only when it's moved): booking, ship, recordings or board. */
    builtIn: text("built_in"),
    status: text("status", { enum: FORUM_STATUSES }).notNull().default("idle"),
    now: text("now"),
    last: text("last"),
    next: text("next"),
    /** A flow on the map: shown for 30 minutes after flowAt, or until this agent's next report clears it. */
    flowTo: text("flow_to"),
    flowLabel: text("flow_label"),
    flowAt: text("flow_at"),
    queue: text("queue", { mode: "json" }).$type<ForumMilestone[]>().notNull().default([]),
    createdBy: text("created_by", { enum: FORUM_SOURCES }).notNull().default("member"),
    /** False for an agent a report made, until the member confirms it ("new" on its card). */
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(true),
    reportedAt: text("reported_at"),
    /** Automatic lights (H-19): the last call through this agent's own connection, and the status it reported itself when a call lit it working. */
    lastCallAt: text("last_call_at"),
    restStatus: text("rest_status", { enum: FORUM_STATUSES }),
    /** The stall watch (H-495): the owner's "Don't watch this agent"; when it was flagged, the last sign of life before it, and its What needs you item. */
    stallMuted: integer("stall_muted", { mode: "boolean" }).notNull().default(false),
    stalledAt: text("stalled_at"),
    stallSince: text("stall_since"),
    stallNeedId: text("stall_need_id"),
    createdAt: createdAt(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("forum_agents_name").on(t.workspaceId, t.userId, t.nameKey), index("forum_agents_member").on(t.workspaceId, t.userId)],
);
export type ForumAgent = typeof forumAgents.$inferSelect;

/** The log: one row per report part, kept 90 days. The payload is what was saved (already capped and scrubbed). */
export const forumEvents = sqliteTable(
  "forum_events",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id"),
    kind: text("kind", { enum: ["status", "flow", "needs_you", "queue", "headline", "removed", "member"] }).notNull(),
    source: text("source", { enum: FORUM_SOURCES }).notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    /** When it happened: the report's own time when it sent one (UTC), otherwise when it arrived. */
    at: text("at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("forum_events_member").on(t.workspaceId, t.userId, t.at)],
);
export type ForumEvent = typeof forumEvents.$inferSelect;

/** "What needs you": stays until the member ticks it done or the agent reports it cleared. Ticking sends nothing back. */
export const forumNeeds = sqliteTable(
  "forum_needs",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id"),
    what: text("what").notNull(),
    detail: text("detail"),
    when: text("when"),
    doneAt: text("done_at"),
    doneBy: text("done_by", { enum: ["member", "agent"] }),
    createdAt: createdAt(),
  },
  (t) => [index("forum_needs_member").on(t.workspaceId, t.userId, t.doneAt)],
);
export type ForumNeed = typeof forumNeeds.$inferSelect;

/** One per member: the share switch, the headline, and the webhook's secret as a hash only (shown once when made). */
export const forumSettings = sqliteTable(
  "forum_settings",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    shareWithCoach: integer("share_with_coach", { mode: "boolean" }).notNull().default(false),
    headline: text("headline"),
    headlineAt: text("headline_at"),
    webhookHash: text("webhook_hash"),
    webhookCreatedAt: text("webhook_created_at"),
    webhookUsedAt: text("webhook_used_at"),
    /** When a coach's build team was seeded (rev 765 §5), so removing them doesn't bring them back. */
    seededAt: text("seeded_at"),
    /** The Handoff inbox (rev 769): email the owner when something needs their approval. On until they turn it off. */
    approvalEmails: integer("approval_emails", { mode: "boolean" }).notNull().default(true),
    /** Scheduled check-ins (Danno, 13 Oct): Pause all, every agent's check-in answers quiet. */
    checkinsPaused: integer("checkins_paused", { mode: "boolean" }).notNull().default(false),
    /** The stall watch (H-495): an email to the owner's own address when an agent stops checking in. Off until they turn it on. */
    stallEmails: integer("stall_emails", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("forum_settings_member").on(t.workspaceId, t.userId), uniqueIndex("forum_settings_webhook").on(t.webhookHash)],
);
export type ForumSettings = typeof forumSettings.$inferSelect;

/**
 * The Handoff inbox (rev 769): agents pass briefs, plans, status and files through HelixOS, and only the owner (Danno, the
 * coach) approves, by hand. An agent's identity is its token (or its tied connection), never a name in a message. Messages are
 * numbered per owner (H-1, H-2 …). A token is stored as its hash only, shown once.
 */
export const agentTokens = sqliteTable(
  "agent_tokens",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id").notNull(),
    /** The connection row the token acts through, so every call is audited and rate-limited like any connection. */
    appId: text("app_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    last4: text("last4").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agent_tokens_hash").on(t.tokenHash), index("agent_tokens_owner").on(t.workspaceId, t.userId)],
);
export type AgentToken = typeof agentTokens.$inferSelect;

/**
 * Check connection (H-559): calls that came in on an agent token HelixOS doesn't accept, counted per minute. A revoked token
 * of a known agent counts against that agent (scope "agent:<id>"); any other unknown token adds to one global count (scope
 * "global", no agent, no owner). Never a token, a prefix or an address.
 */
export const agentAuthFailures = sqliteTable(
  "agent_auth_failures",
  {
    id: id(),
    scope: text("scope").notNull(),
    workspaceId: text("workspace_id"),
    userId: text("user_id"),
    agentId: text("agent_id"),
    /** The minute, as "2026-10-17T19:05:00Z". */
    minute: text("minute").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("agent_auth_failures_scope_minute").on(t.scope, t.minute), index("agent_auth_failures_agent").on(t.agentId)],
);

export const HANDOFF_DECISIONS = ["approved", "changed", "declined"] as const;
export const handoffMessages = sqliteTable(
  "handoff_messages",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    seq: integer("seq").notNull(),
    /** The sending agent; null when the owner wrote it (an answer "from Danno"). */
    fromAgentId: text("from_agent_id"),
    /** Agent ids, and "danno" for the owner. */
    toIds: text("to_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    replyToId: text("reply_to_id"),
    threadId: text("thread_id"),
    fileIds: text("file_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    needsApproval: integer("needs_approval", { mode: "boolean" }).notNull().default(false),
    approvalReasons: text("approval_reasons", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** The agent's text claims Danno approved: shown with a "not an approval" tag, never counted. */
    claimsApproval: integer("claims_approval", { mode: "boolean" }).notNull().default(false),
    decision: text("decision", { enum: HANDOFF_DECISIONS }),
    decisionNote: text("decision_note"),
    decidedAt: text("decided_at"),
    decidedBy: text("decided_by"),
    /** On the owner's answer that carries a decision: the message decided. */
    decisionForId: text("decision_for_id"),
    /** Danno's own message marked urgent (13 Oct): it gets past an agent's busy check-in. Only the owner can set it. */
    urgent: integer("urgent", { mode: "boolean" }).notNull().default(false),
    /** H-351: on hold (the writer is still changing it, or it waits on another decision): the reason, shown under the title; null when not held. */
    holdReason: text("hold_reason"),
    heldAt: text("held_at"),
    /** H-351: replaced by a newer post; the post never leaves, it moves to the Superseded tab. */
    supersededById: text("superseded_by_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("handoff_messages_seq").on(t.workspaceId, t.userId, t.seq), index("handoff_messages_thread").on(t.threadId)],
);
export type HandoffMessage = typeof handoffMessages.$inferSelect;

/** One recipient's copy: delivered once (the first handoff_inbox that returned it), then acked with an optional note. */
export const handoffDeliveries = sqliteTable(
  "handoff_deliveries",
  {
    id: id(),
    messageId: text("message_id").notNull(),
    /** An agent id, or "danno" for the owner. */
    recipient: text("recipient").notNull(),
    deliveredAt: text("delivered_at"),
    ackedAt: text("acked_at"),
    ackNote: text("ack_note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("handoff_deliveries_once").on(t.messageId, t.recipient), index("handoff_deliveries_recipient").on(t.recipient, t.deliveredAt)],
);

export const handoffFiles = sqliteTable(
  "handoff_files",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id"),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    /** The size the agent declared until the upload is checked; the store's own size after. */
    size: integer("size").notNull(),
    key: text("key").notNull(),
    status: text("status", { enum: ["pending", "ready", "rejected"] }).notNull().default("pending"),
    reason: text("reason"),
    readyAt: text("ready_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("handoff_files_key").on(t.key), index("handoff_files_owner").on(t.workspaceId, t.userId)],
);
export type HandoffFile = typeof handoffFiles.$inferSelect;

/** Every post, file, ack, approval and token change, with who and when: Coach → Inbox → History. */
export const handoffAudit = sqliteTable(
  "handoff_audit",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id"),
    action: text("action").notNull(),
    ref: text("ref"),
    note: text("note"),
    at: text("at").notNull(),
  },
  (t) => [index("handoff_audit_owner").on(t.workspaceId, t.userId, t.at)],
);

/**
 * One agent's scheduled check-ins (Danno, 13 Oct): off until the owner turns them on; how often the timer on Danno's Claude
 * account sends the standing check-in (shown, not enforced here); the active hours in their zone; the session link the Forum's
 * Nudge opens; the busy note an agent sets for a long job; and the last check-in, its act and the day's count (40 at most).
 */
export const handoffAgents = sqliteTable(
  "handoff_agents",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id").notNull(),
    checkins: integer("checkins", { mode: "boolean" }).notNull().default(false),
    everyMinutes: integer("every_minutes").notNull().default(60),
    activeFrom: text("active_from").notNull().default("07:00"),
    activeTo: text("active_to").notNull().default("19:00"),
    activeDays: text("active_days", { mode: "json" }).$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
    tz: text("tz").notNull().default("America/Los_Angeles"),
    sessionUrl: text("session_url"),
    busyNote: text("busy_note"),
    busySince: text("busy_since"),
    lastCheckinAt: text("last_checkin_at"),
    lastAct: text("last_act"),
    countDay: text("count_day"),
    countToday: integer("count_today").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("handoff_agents_agent").on(t.workspaceId, t.userId, t.agentId)],
);
export type HandoffAgent = typeof handoffAgents.$inferSelect;

export * from "./schema-hermes";

/**
 * My Helix (rev 707 with rev 710's curriculum): the 67 rungs as data, not code, seeded from src/data/seed/rungs.json and
 * editable by the coach without a deploy; and a member's ticks for the rungs no signal covers.
 */
export const helixRungs = sqliteTable("helix_rungs", {
  key: text("key").primaryKey(),
  phase: integer("phase").notNull(),
  order: integer("order").notNull(),
  label: text("label").notNull(),
  /** One of the engine's SIGNALS keys; "tick" when the member (or the coach for them) marks it. */
  signal: text("signal").notNull().default("tick"),
  href: text("href").notNull().default("/today"),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
export type HelixRungRow = typeof helixRungs.$inferSelect;

export const helixTicks = sqliteTable(
  "helix_ticks",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    rungKey: text("rung_key").notNull(),
    /** Who ticked it: the member, or the coach switched in (then also logged as the coach's change). */
    byUserId: text("by_user_id").notNull(),
    /** Docket #10 (H-195): one line on how it was done ("posted it in the group on Tuesday"), shown on the rung. */
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("helix_ticks_member_rung").on(t.workspaceId, t.userId, t.rungKey)],
);
export type HelixTick = typeof helixTicks.$inferSelect;

/**
 * The Setup card (H-270 §1): the 26 setup steps as data, seeded from src/data/seed/setup.json and editable by the coach without
 * a deploy (label, link, group, order, what it reads, what it needs first, minutes); and a member's ticks for the steps no signal
 * covers, with the coach's ticks for the two steps that are the coach's to confirm.
 */
export const setupSteps = sqliteTable("setup_steps", {
  key: text("key").primaryKey(),
  group: text("group").notNull(),
  order: integer("order").notNull(),
  label: text("label").notNull(),
  href: text("href").notNull().default("/today"),
  /** One of the engine's SETUP_SIGNALS keys; "tick" when the member (or the coach for them) marks it, "coach-tick" for the coach alone. */
  signal: text("signal").notNull().default("tick"),
  needs: text("needs", { mode: "json" }).$type<string[]>().notNull().default([]),
  minutes: integer("minutes").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
export type SetupStepRow = typeof setupSteps.$inferSelect;

export const setupTicks = sqliteTable(
  "setup_ticks",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    stepKey: text("step_key").notNull(),
    /** Who ticked it: the member, or the coach (switched in, or on the client page). */
    byUserId: text("by_user_id").notNull(),
    byCoach: integer("by_coach", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("setup_ticks_member_step").on(t.workspaceId, t.userId, t.stepKey)],
);
export type SetupTick = typeof setupTicks.$inferSelect;

/**
 * On the horizon (H-385, plan H-387): what members see of what is coming, per workspace. The coach adds, edits, hides, reorders
 * and moves items between the four lists; `shipped_at` is stamped when one moves to Just shipped; `menu_key` names the menu
 * entry an item greys out as Coming soon until it ships (src/lib/engine/horizon.ts HORIZON_MENU_KEYS).
 */
export const horizonItems = sqliteTable(
  "horizon_items",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    title: text("title").notNull(),
    line: text("line").notNull(),
    area: text("area").$type<HorizonArea>().notNull(),
    status: text("status").$type<HorizonStatus>().notNull(),
    /** "You asked for this": it came from member feedback. */
    fromFeedback: integer("from_feedback", { mode: "boolean" }).notNull().default(false),
    sort: integer("sort").notNull().default(0),
    shippedAt: text("shipped_at"),
    menuKey: text("menu_key"),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("horizon_items_ws").on(t.workspaceId, t.status)],
);
export type HorizonItem = typeof horizonItems.$inferSelect;

/** A member's "Want this" on an item: one per member and item; `notified_at` once the "it shipped" notice was shown and dismissed. */
export const horizonWants = sqliteTable(
  "horizon_wants",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    itemId: text("item_id").notNull(),
    notifiedAt: text("notified_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("horizon_wants_member_item").on(t.workspaceId, t.userId, t.itemId), index("horizon_wants_item").on(t.itemId)],
);
export type HorizonWant = typeof horizonWants.$inferSelect;

/**
 * The HelixOS apps' devices (H-626 Phase 2, plan H-877). The store app records itself on first open and on each open after
 * (Get the app, H-655, hides once one was opened in the last 30 days). `token` stays empty until the member says yes to
 * notifications; iPhone tokens are Apple's (sent through APNs), Android tokens are Firebase's. Erased with the account.
 */
export const pushDevices = sqliteTable(
  "push_devices",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    membershipId: text("membership_id").notNull(),
    userId: text("user_id").notNull(),
    platform: text("platform", { enum: ["ios", "android"] }).notNull(),
    /** The app's own install id, so a reinstall or a new token updates the same row. */
    installId: text("install_id").notNull(),
    token: text("token"),
    appVersion: text("app_version"),
    createdAt: createdAt(),
    lastSeenAt: text("last_seen_at").notNull().default(sql`(datetime('now'))`),
    /** Apple or Google said the token is gone (uninstalled, or notifications switched off in the phone's settings). */
    disabledAt: text("disabled_at"),
  },
  (t) => [uniqueIndex("push_devices_install").on(t.membershipId, t.installId), index("push_devices_member").on(t.membershipId, t.lastSeenAt)],
);
export type PushDevice = typeof pushDevices.$inferSelect;

/**
 * A member's notification choices (H-767): the main switch, one switch per type (only the ones changed from their default
 * are stored), quiet hours in their own time zone, and where the permission card stands. One row per membership, made when
 * first needed. The lock-in and close times are the membership's reminder_hour and evening_reminder_hour.
 */
export const pushPrefs = sqliteTable("push_prefs", {
  id: id(),
  membershipId: text("membership_id").notNull().unique(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  types: text("types", { mode: "json" }).$type<Record<string, boolean>>().notNull().default(sql`'{}'`),
  quietStart: integer("quiet_start").notNull().default(21),
  quietEnd: integer("quiet_end").notNull().default(7),
  /** The HelixOS card that asks first (H-767): how many times it has been shown, and the member's last answer. */
  askedCount: integer("asked_count").notNull().default(0),
  askedAt: text("asked_at"),
  answer: text("answer", { enum: ["yes", "not_now"] }),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
export type PushPrefs = typeof pushPrefs.$inferSelect;

/**
 * Every push sent (H-767): what enforces the daily cap of 3, one of each type a day, and once per call reminder step.
 * `key` names the occasion ("2026-10-19" for a daily one, a call occurrence and step for a call). Kept 30 days.
 * Never holds the message text, so nothing a member wrote or logged sits here.
 */
export const pushSends = sqliteTable(
  "push_sends",
  {
    id: id(),
    membershipId: text("membership_id").notNull(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    key: text("key").notNull(),
    sentAt: text("sent_at").notNull().default(sql`(datetime('now'))`),
    /** How many devices took it; 0 means none was reachable. */
    delivered: integer("delivered").notNull().default(0),
  },
  (t) => [uniqueIndex("push_sends_once").on(t.membershipId, t.type, t.key), index("push_sends_day").on(t.membershipId, t.sentAt)],
);
export type PushSend = typeof pushSends.$inferSelect;

/**
 * 30 Days in the Arena (H-1562, plan H-1563): a member challenge in a set window. One row per challenge per workspace, made
 * the first time the workspace's Arena page is read; the dates and the target are the plan's (src/lib/engine/arena.ts).
 */
export const arenaChallenges = sqliteTable(
  "arena_challenges",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** The window in the challenge's own zone, as dates: the first and the last day that count. */
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    /** The last day to join, in the same zone. */
    joinBy: text("join_by").notNull(),
    timezone: text("timezone").notNull(),
    targetDays: integer("target_days").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("arena_challenges_slug").on(t.workspaceId, t.slug)],
);
export type ArenaChallenge = typeof arenaChallenges.$inferSelect;

/** Pods of five with a captain (PR B): the coach names the captain and moves members between pods. */
export const arenaPods = sqliteTable(
  "arena_pods",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    challengeId: text("challenge_id").notNull(),
    name: text("name").notNull(),
    captainMembershipId: text("captain_membership_id"),
    createdAt: createdAt(),
  },
  (t) => [index("arena_pods_challenge").on(t.challengeId)],
);
export type ArenaPod = typeof arenaPods.$inferSelect;

/** A member's "I'm in": once per challenge. Days closed and points are read from the daily logs and the ledger, never copied. */
export const arenaEntries = sqliteTable(
  "arena_entries",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    membershipId: text("membership_id").notNull(),
    challengeId: text("challenge_id").notNull(),
    podId: text("pod_id"),
    joinedAt: text("joined_at").notNull(),
    /** Set when the member reaches the target (PR C); the prize itself is applied by hand by the coach. */
    finishedAt: text("finished_at"),
  },
  (t) => [uniqueIndex("arena_entries_once").on(t.challengeId, t.membershipId), index("arena_entries_user").on(t.workspaceId, t.userId)],
);
export type ArenaEntry = typeof arenaEntries.$inferSelect;

/** The live Huddles (PR B), one row per date, with the start as a UTC instant. */
export const arenaHuddles = sqliteTable(
  "arena_huddles",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    challengeId: text("challenge_id").notNull(),
    startsAt: text("starts_at").notNull(),
    label: text("label").notNull(),
  },
  (t) => [uniqueIndex("arena_huddles_once").on(t.challengeId, t.startsAt)],
);
export type ArenaHuddle = typeof arenaHuddles.$inferSelect;

/** "I'm here" at a Huddle (PR B): once per member per Huddle, worth the huddle points in the ledger. */
export const arenaHuddleCheckins = sqliteTable(
  "arena_huddle_checkins",
  {
    id: id(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    membershipId: text("membership_id").notNull(),
    huddleId: text("huddle_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("arena_huddle_checkins_once").on(t.huddleId, t.membershipId)],
);
export type ArenaHuddleCheckin = typeof arenaHuddleCheckins.$inferSelect;
