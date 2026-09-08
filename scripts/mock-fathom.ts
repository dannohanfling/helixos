/**
 * A stand-in for the Fathom API for smoke tests. `npx tsx scripts/mock-fathom.ts 4030`, then run the app with
 * FATHOM_BASE_URL=http://localhost:4030. Key `fathom-good` works; anything else is 401. It records which recording's
 * transcript was fetched (`GET /__reads`) so a walk can prove that only the recording a human picked was ever read.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4030);
const reads: string[] = [];

const meetings = [
  // recording_id and the call id in the url are different numbers on purpose: a deep link built from recording_id would be dead.
  { recording_id: 180896622, title: "Jess and Evolve Omega", url: "https://fathom.video/calls/815301715", share_url: "https://fathom.video/share/abc123", created_at: "2026-09-01T16:00:00Z", recording_start_time: "2026-09-01T16:00:00Z", recording_end_time: "2026-09-01T16:45:00Z", calendar_invitees: [{ name: "Jess Morgan", email: "jess@example.com", is_external: true }, { name: "Maya Torres", email: "client@demo.helixos.app", is_external: false }] },
  { recording_id: 9002, title: "Evolve Omega: Business Strategy", url: "https://fathom.video/share/strategy-9002", share_url: "https://fathom.video/share/strategy-9002", created_at: "2026-08-28T15:00:00Z", recording_start_time: "2026-08-28T15:00:00Z", recording_end_time: "2026-08-28T15:50:00Z", calendar_invitees: [{ name: "Danno Hanfling", email: "danno@example.com", is_external: true }] },
  { recording_id: 9003, title: "Team sync", url: "https://fathom.video/share/team-9003", share_url: "https://fathom.video/share/team-9003", created_at: "2026-08-20T09:00:00Z", recording_start_time: "2026-08-20T09:00:00Z", recording_end_time: "2026-08-20T09:20:00Z", calendar_invitees: [] },
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
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__reads") return json(200, { reads });
  const key = req.headers["x-api-key"];
  if (key !== "fathom-good") return json(401, { message: "Invalid API key" });
  if (url.pathname === "/external/v1/meetings" && req.method === "GET") {
    if (url.searchParams.get("include_transcript") === "true") reads.push("LIST_WITH_TRANSCRIPTS"); // a walk fails on this: the list must never carry transcripts
    return json(200, { items: meetings, limit: 10, next_cursor: null });
  }
  const m = url.pathname.match(/^\/external\/v1\/recordings\/(\d+)\/transcript$/);
  if (m && req.method === "GET") {
    reads.push(m[1]);
    const t = transcripts[m[1]];
    return t ? json(200, { transcript: t }) : json(404, { message: "Recording not found" });
  }
  return json(404, { message: "Not found" });
}).listen(port, () => console.log(`mock Fathom on http://localhost:${port}`));
