/**
 * A stand-in for the Fathom API for smoke tests. `npx tsx scripts/mock-fathom.ts 4030`, then run the app with
 * FATHOM_BASE_URL=http://localhost:4030. Two keys work: `fathom-good` is a member's own key (the testimonial harvest, three
 * recordings) and `fathom-coach` is the coach's workspace key (Recordings R1: the same three plus the group calls, with summaries
 * and action items). Anything else is 401. It records which recording's transcript was fetched (`GET /__reads`) so a walk can
 * prove that only the recording a human picked was ever read, and lists the webhooks registered with it (`GET /__webhooks`,
 * with their signing secrets, for the walk to sign a delivery the way Fathom would).
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4030);
const reads: string[] = [];
type Webhook = { id: string; secret: string; destination_url: string; triggered_for: string[]; include_transcript: boolean };
const webhooks: Webhook[] = [];
let webhookSeq = 0;

const daysAgo = (n: number, hour = 17) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
/** The latest Friday at 1:05 PM in Los Angeles, a day or more ago: inside the Academy slot of the publishing rules (rev 491). */
const lastFridayLA = (): string => {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (let n = 1; n <= 8; n++) for (const h of [20, 21]) {
    const iso = daysAgo(n, h).replace(":00:00.000Z", ":05:00.000Z");
    if (fmt.format(new Date(iso)) === "Fri 13:05") return iso;
  }
  return daysAgo(7, 20);
};
const plus = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();

type Meeting = Record<string, unknown> & { recording_id: number; created_at: string };
const memberMeetings: Meeting[] = [
  // recording_id and the call id in the url are different numbers on purpose: a deep link built from recording_id would be dead.
  { recording_id: 180896622, title: "Jess and Evolve Omega", url: "https://fathom.video/calls/815301715", share_url: "https://fathom.video/share/abc123", created_at: "2026-09-01T16:00:00Z", recording_start_time: "2026-09-01T16:00:00Z", recording_end_time: "2026-09-01T16:45:00Z", calendar_invitees: [{ name: "Jess Morgan", email: "jess@example.com", is_external: true }, { name: "Maya Torres", email: "client@demo.helixos.app", is_external: false }] },
  { recording_id: 9002, title: "Evolve Omega: Business Strategy", url: "https://fathom.video/share/strategy-9002", share_url: "https://fathom.video/share/strategy-9002", created_at: "2026-08-28T15:00:00Z", recording_start_time: "2026-08-28T15:00:00Z", recording_end_time: "2026-08-28T15:50:00Z", calendar_invitees: [{ name: "Danno Hanfling", email: "danno@example.com", is_external: true }] },
  { recording_id: 9003, title: "Team sync", url: "https://fathom.video/share/team-9003", share_url: "https://fathom.video/share/team-9003", created_at: "2026-08-20T09:00:00Z", recording_start_time: "2026-08-20T09:00:00Z", recording_end_time: "2026-08-20T09:20:00Z", calendar_invitees: [] },
];
/** The coach's own calls (Recordings R1), dated relative to now so a walk's "last thirty days" window always holds them. */
const SUMMARY_ACC = "## Purpose\nWeek 3 of the Accelerator: the comment ladder and the first offer.\n\n## Key takeaways\n- Post the ladder on Thursday, reply to every comment within an hour.\n- **One offer**, said the same way every time.\n\n## Next steps\n1. Maya posts the ladder.\n2. Jordan books three calls.";
const coachMeetings: Meeting[] = [
  { recording_id: 9101, title: "Evolve Omega: Automation Accelerator – Week 3", url: "https://fathom.video/calls/815301799", share_url: "https://fathom.video/share/acc-9101", created_at: daysAgo(3), recording_start_time: plus(daysAgo(3), 1), recording_end_time: plus(daysAgo(3), 55), calendar_invitees: [{ name: "Maya Torres", email: "client@demo.helixos.app", is_external: false }, { name: "Jordan Lee", email: "client2@demo.helixos.app", is_external: false }], default_summary: { template_name: "general", markdown_formatted: SUMMARY_ACC }, action_items: [{ description: "Post the comment ladder on Thursday", completed: false, user_generated: false, recording_timestamp: "00:14:02", recording_playback_url: "https://fathom.video/share/acc-9101?timestamp=842", assignee: { name: "Maya Torres", email: "client@demo.helixos.app", team: null } }, { description: "Book three discovery calls before Friday", completed: false, user_generated: false, recording_timestamp: "00:31:10", recording_playback_url: "https://fathom.video/share/acc-9101?timestamp=1870", assignee: { name: "Jordan Lee", email: "client2@demo.helixos.app", team: null } }, { description: "Send the replay link to the group", completed: false, user_generated: false, recording_timestamp: "00:52:00", recording_playback_url: null, assignee: { name: "Danno Hanfling", email: "coach@demo.helixos.app", team: null } }] },
  { recording_id: 9102, title: "Evolve Omega: Community Building Q&A", url: "https://fathom.video/calls/815301800", share_url: "https://fathom.video/share/aca-9102", created_at: daysAgo(5, 20), recording_start_time: plus(daysAgo(5, 20), 2), recording_end_time: plus(daysAgo(5, 20), 60), calendar_invitees: [{ name: "Maya Torres", email: "client@demo.helixos.app", is_external: false }], default_summary: { template_name: "general", markdown_formatted: "## Purpose\nAcademy Q&A on pricing.\n\n## Key takeaways\n- Raise the price when the calendar is full." }, action_items: [] },
  { recording_id: 9103, title: "Evolve Omega Accel", url: "https://fathom.video/calls/815301801", share_url: "https://fathom.video/share/accel-9103", created_at: daysAgo(10), recording_start_time: plus(daysAgo(10), 1), recording_end_time: plus(daysAgo(10), 50), calendar_invitees: [], default_summary: { template_name: "general", markdown_formatted: "## Purpose\nA call whose title is close but not exact." }, action_items: [] },
  { recording_id: 9104, title: "Maya and Danno, one-to-one", url: "https://fathom.video/calls/815301802", share_url: "https://fathom.video/share/one-9104", created_at: daysAgo(2, 15), recording_start_time: plus(daysAgo(2, 15), 0), recording_end_time: plus(daysAgo(2, 15), 30), calendar_invitees: [{ name: "Maya Torres", email: "client@demo.helixos.app", is_external: false }, { name: "Danno Hanfling", email: "coach@demo.helixos.app", is_external: false }], default_summary: { template_name: "general", markdown_formatted: "## Purpose\nMaya's launch plan, just the two of us." }, action_items: [{ description: "Write the launch email", completed: false, user_generated: false, recording_timestamp: "00:10:00", recording_playback_url: null, assignee: { name: "Maya Torres", email: "client@demo.helixos.app", team: null } }] },
  // No useful title: placed by the time it started (Friday 1 PM in Los Angeles, the Academy slot).
  { recording_id: 9105, title: "Impromptu Zoom Meeting", url: "https://fathom.video/calls/815301803", share_url: "https://fathom.video/share/zoom-9105", created_at: lastFridayLA(), recording_start_time: lastFridayLA(), recording_end_time: plus(lastFridayLA(), 45), calendar_invitees: [{ name: "Maya Torres", email: "client@demo.helixos.app", is_external: false }, { name: "Jordan Lee", email: "client2@demo.helixos.app", is_external: false }, { name: "Danno Hanfling", email: "coach@demo.helixos.app", is_external: false }], default_summary: { template_name: "general", markdown_formatted: "## Purpose\nFriday Academy session on pricing pages." }, action_items: [] },
];
const transcripts: Record<string, { speaker: { display_name: string; matched_calendar_invitee_email: string | null }; text: string; timestamp: string }[]> = {
  "180896622": [
    { speaker: { display_name: "Maya Torres", matched_calendar_invitee_email: "client@demo.helixos.app" }, text: "So tell me how the last month has actually gone.", timestamp: "00:12:04" },
    { speaker: { display_name: "jess@example.com", matched_calendar_invitee_email: "jess@example.com" }, text: "Honestly it's been different. I've had three new clients this month and I didn't chase a single one.", timestamp: "00:12:19" },
    { speaker: { display_name: "jess@example.com", matched_calendar_invitee_email: "jess@example.com" }, text: "Before this I was posting every day and getting nothing back.", timestamp: "00:12:31" },
    { speaker: { display_name: "Maya Torres", matched_calendar_invitee_email: "client@demo.helixos.app" }, text: "What changed, do you think?", timestamp: "00:12:40" },
    { speaker: { display_name: "jess@example.com", matched_calendar_invitee_email: "jess@example.com" }, text: "The comment ladders. People read the whole thing and message me.", timestamp: "00:12:47" },
  ],
  "9002": [{ speaker: { display_name: "Danno Hanfling", matched_calendar_invitee_email: "danno@example.com" }, text: "Strategy notes, nothing for marketing.", timestamp: "00:01:00" }],
  "9003": [{ speaker: { display_name: "Maya Torres", matched_calendar_invitee_email: null }, text: "Team sync.", timestamp: "00:00:10" }],
  "9101": [
    { speaker: { display_name: "Danno Hanfling", matched_calendar_invitee_email: "coach@demo.helixos.app" }, text: "Week three. The ladder goes up on Thursday.", timestamp: "00:00:30" },
    { speaker: { display_name: "Maya Torres", matched_calendar_invitee_email: "client@demo.helixos.app" }, text: "I'll post it Thursday morning and reply within the hour.", timestamp: "00:14:02" },
    { speaker: { display_name: "Jordan Lee", matched_calendar_invitee_email: "client2@demo.helixos.app" }, text: "Three calls before Friday, got it.", timestamp: "00:31:10" },
  ],
  "9102": [{ speaker: { display_name: "Danno Hanfling", matched_calendar_invitee_email: "coach@demo.helixos.app" }, text: "Raise the price when the calendar is full.", timestamp: "00:05:00" }],
  "9104": [{ speaker: { display_name: "Maya Torres", matched_calendar_invitee_email: "client@demo.helixos.app" }, text: "The launch email goes Tuesday.", timestamp: "00:10:00" }],
  // 9201 arrives only by webhook in the walk; its transcript is here for View transcript.
  "9201": [
    { speaker: { display_name: "Danno Hanfling", matched_calendar_invitee_email: "coach@demo.helixos.app" }, text: "Week four. Offers, said the same way every time.", timestamp: "00:00:20" },
    { speaker: { display_name: "Maya Torres", matched_calendar_invitee_email: "client@demo.helixos.app" }, text: "Mine is the 90-Day Reset.", timestamp: "00:09:12" },
  ],
};

const KEYS: Record<string, Meeting[]> = { "fathom-good": memberMeetings, "fathom-coach": [...coachMeetings, ...memberMeetings] };

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__reads") return json(200, { reads });
  if (url.pathname === "/__webhooks") return json(200, { webhooks });
  const key = String(req.headers["x-api-key"] ?? "");
  const meetings = KEYS[key];
  if (!meetings) return json(401, { message: "Invalid API key" });
  if (url.pathname === "/external/v1/meetings" && req.method === "GET") {
    if (url.searchParams.get("include_transcript") === "true") reads.push("LIST_WITH_TRANSCRIPTS"); // a walk fails on this: the list must never carry transcripts
    const after = url.searchParams.get("created_after");
    const withSummary = url.searchParams.get("include_summary") === "true";
    const withItems = url.searchParams.get("include_action_items") === "true";
    const items = meetings
      .filter((m) => !after || m.created_at >= after)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((m) => {
        const { default_summary, action_items, ...rest } = m;
        return { ...rest, ...(withSummary ? { default_summary: default_summary ?? null } : {}), ...(withItems ? { action_items: action_items ?? [] } : {}) };
      });
    return json(200, { items, limit: 10, next_cursor: null });
  }
  const m = url.pathname.match(/^\/external\/v1\/recordings\/(\d+)\/transcript$/);
  if (m && req.method === "GET") {
    reads.push(m[1]);
    const t = transcripts[m[1]];
    return t ? json(200, { transcript: t }) : json(404, { message: "Recording not found" });
  }
  if (url.pathname === "/external/v1/webhooks" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw || "{}") as Record<string, unknown>;
      } catch {
        body = {};
      }
      if (typeof body.destination_url !== "string" || !body.destination_url) return json(422, { message: "destination_url is required" });
      const hook: Webhook = { id: `wh_${++webhookSeq}`, secret: `whsec_${Buffer.from(`mock-fathom-secret-${webhookSeq}-${Date.now()}`).toString("base64")}`, destination_url: body.destination_url, triggered_for: Array.isArray(body.triggered_for) ? body.triggered_for.map(String) : [], include_transcript: body.include_transcript === true };
      webhooks.push(hook);
      return json(201, { id: hook.id, url: hook.destination_url, secret: hook.secret, triggered_for: hook.triggered_for, created_at: new Date().toISOString() });
    });
    return;
  }
  const w = url.pathname.match(/^\/external\/v1\/webhooks\/([\w-]+)$/);
  if (w && req.method === "DELETE") {
    const i = webhooks.findIndex((h) => h.id === w[1]);
    if (i < 0) return json(404, { message: "Webhook not found" });
    webhooks.splice(i, 1);
    res.writeHead(204);
    return res.end();
  }
  return json(404, { message: "Not found" });
}).listen(port, () => console.log(`mock Fathom on http://localhost:${port}`));
