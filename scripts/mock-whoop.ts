/**
 * A stand-in for WHOOP's developer platform for the Body walk. `npx tsx scripts/mock-whoop.ts 4072`, then run the app with
 * WHOOP_API_URL=http://localhost:4072, WHOOP_AUTH_URL=http://localhost:4072/oauth/oauth2, WHOOP_CLIENT_ID=test-whoop-client and
 * WHOOP_CLIENT_SECRET=test-whoop-secret. The authorize page sends the member straight back with a code; the token endpoint
 * answers a bearer token; the v2 API serves one member's synthetic nights, recoveries, cycles and workouts, dated relative to
 * today (the walk reads the same records to compute what should land). `GET /__calls` lists every request; `POST /__webhook`
 * makes the mock send a signed webhook to the URL given, for the walk to prove the route.
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4072);
const calls: { method: string; path: string }[] = [];
const SECRET = "test-whoop-secret";
const TOKEN = "whoop-access-1";
const USER_ID = 4242;

const day = (back: number, hm: string) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - back);
  return `${d.toISOString().slice(0, 10)}T${hm}:00.000Z`;
};
export const records = {
  sleep: [
    { id: "slp-1", user_id: USER_ID, start: day(1, "04:40"), end: day(0, "12:05"), nap: false, score_state: "SCORED", score: { stage_summary: { total_in_bed_time_milli: 7.25 * 3600000, total_awake_time_milli: 0.25 * 3600000 }, sleep_performance_percentage: 86 } },
    { id: "slp-2", user_id: USER_ID, start: day(2, "05:00"), end: day(1, "11:50"), nap: false, score_state: "SCORED", score: { stage_summary: { total_in_bed_time_milli: 6.5 * 3600000, total_awake_time_milli: 0.5 * 3600000 }, sleep_performance_percentage: 74 } },
    { id: "nap-1", user_id: USER_ID, start: day(1, "20:00"), end: day(1, "20:40"), nap: true, score_state: "SCORED", score: { stage_summary: { total_in_bed_time_milli: 2400000, total_awake_time_milli: 0 } } },
  ],
  recovery: [
    { cycle_id: 901, sleep_id: "slp-1", user_id: USER_ID, created_at: day(0, "12:10"), score_state: "SCORED", score: { recovery_score: 67, resting_heart_rate: 51, hrv_rmssd_milli: 72.4 } },
    { cycle_id: 900, sleep_id: "slp-2", user_id: USER_ID, created_at: day(1, "11:55"), score_state: "SCORED", score: { recovery_score: 44, resting_heart_rate: 55, hrv_rmssd_milli: 48.1 } },
  ],
  cycle: [
    { id: 901, user_id: USER_ID, start: day(0, "12:05"), end: null, score_state: "SCORED", score: { strain: 8.2 } },
    { id: 900, user_id: USER_ID, start: day(1, "11:50"), end: day(0, "12:05"), score_state: "SCORED", score: { strain: 14.6 } },
  ],
  workout: [
    { id: "wk-lift", user_id: USER_ID, start: day(1, "16:00"), end: day(1, "16:52"), sport_name: "Weightlifting", score_state: "SCORED", score: { strain: 10.1, average_heart_rate: 118, max_heart_rate: 158 } },
    { id: "wk-sauna", user_id: USER_ID, start: day(1, "17:00"), end: day(1, "17:18"), sport_name: "Sauna", score_state: "SCORED", score: { strain: 3.4, average_heart_rate: 96, max_heart_rate: 110 } },
    { id: "wk-walk", user_id: USER_ID, start: day(0, "14:00"), end: day(0, "14:35"), sport_name: "Walking", score_state: "SCORED", score: { strain: 4.0, average_heart_rate: 98, max_heart_rate: 120 } },
  ],
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  calls.push({ method: req.method ?? "?", path: url.pathname });
  if (url.pathname === "/__calls") return json(200, { calls });
  if (url.pathname === "/__records") return json(200, records);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    // The walk asks the mock to send a signed webhook to the app, as WHOOP would.
    if (url.pathname === "/__webhook" && req.method === "POST") {
      const { to, event, badSecret } = JSON.parse(raw || "{}") as { to: string; event: Record<string, unknown>; badSecret?: boolean };
      const body = JSON.stringify(event);
      const ts = String(Date.now());
      const sig = createHmac("sha256", badSecret ? "wrong" : SECRET).update(ts + body).digest("base64");
      try {
        const r = await fetch(to, { method: "POST", headers: { "content-type": "application/json", "X-WHOOP-Signature": sig, "X-WHOOP-Signature-Timestamp": ts }, body });
        return json(200, { status: r.status, body: await r.text() });
      } catch (e) {
        return json(502, { error: String(e) });
      }
    }
    if (url.pathname === "/oauth/oauth2/auth") {
      const back = new URL(url.searchParams.get("redirect_uri") ?? "http://localhost:3000/");
      back.searchParams.set("code", url.searchParams.get("client_id") === "test-whoop-client" ? "good-code" : "bad-code");
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/oauth/oauth2/token" && req.method === "POST") {
      const form = new URLSearchParams(raw);
      if (form.get("client_secret") !== SECRET) return json(401, { error: "invalid_client" });
      if (form.get("grant_type") === "authorization_code" && form.get("code") !== "good-code") return json(400, { error: "invalid_grant" });
      return json(200, { access_token: TOKEN, refresh_token: "whoop-refresh-1", expires_in: 3600, scope: "offline read:profile read:recovery read:sleep read:workout read:cycles", token_type: "bearer" });
    }
    if ((req.headers.authorization ?? "") !== `Bearer ${TOKEN}`) return json(401, { error: "unauthorized" });
    const p = url.pathname;
    if (p === "/developer/v2/user/profile/basic") return json(200, { user_id: USER_ID, email: "member@example.com", first_name: "Demo", last_name: "Member" });
    const one = (list: { id?: unknown; cycle_id?: unknown }[], id: string) => list.find((x) => String(x.id ?? x.cycle_id) === id);
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^\/developer\/v2\/activity\/sleep\/([^/]+)$/))) return json(one(records.sleep, m[1]) ? 200 : 404, one(records.sleep, m[1]) ?? { error: "not found" });
    if ((m = p.match(/^\/developer\/v2\/activity\/workout\/([^/]+)$/))) return json(one(records.workout, m[1]) ? 200 : 404, one(records.workout, m[1]) ?? { error: "not found" });
    if ((m = p.match(/^\/developer\/v2\/recovery\/([^/]+)$/))) return json(one(records.recovery, m[1]) ? 200 : 404, one(records.recovery, m[1]) ?? { error: "not found" });
    if ((m = p.match(/^\/developer\/v2\/cycle\/([^/]+)$/))) return json(one(records.cycle, m[1]) ? 200 : 404, one(records.cycle, m[1]) ?? { error: "not found" });
    if (p === "/developer/v2/activity/sleep") return json(200, { records: records.sleep });
    if (p === "/developer/v2/activity/workout") return json(200, { records: records.workout });
    if (p === "/developer/v2/recovery") return json(200, { records: records.recovery });
    if (p === "/developer/v2/cycle") return json(200, { records: records.cycle });
    return json(404, { error: "not found" });
  });
}).listen(port, () => console.log(`mock-whoop on :${port}`));
