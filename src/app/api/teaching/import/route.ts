import { NextResponse } from "next/server";
import { apiViewer } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";
import { importTeachingText } from "@/lib/teaching";

/**
 * The coach's teaching library and story bank, uploaded from Coach → Teaching library (rev 615 plan). The browser sends each
 * file's text in parts cut at entry boundaries, under 3 MB a part, so a large library file never meets the host's body limit.
 * Coach only, their own, never while switched into a client. Re-sending a part updates and never doubles.
 */
export const maxDuration = 60;
const MAX = 3.5 * 1024 * 1024;
export async function POST(request: Request) {
  const say = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "cache-control": "private, no-store" } });
  const v = await apiViewer();
  if (!v) return say(401, "Sign in first.");
  if (v.role !== "coach" || v.switchedInto) return say(403, "The teaching library is the coach's own.");
  if (!(await allow(`teaching-import:${v.user.id}`, 200, 15 * 60000))) return say(429, "That's a lot of uploads in a row. Wait a few minutes and try again.");
  let body: { file?: unknown; text?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX) return say(413, "That part is too large. Upload the file again: it's sent in smaller parts.");
    body = JSON.parse(raw);
  } catch {
    return say(400, "That upload couldn't be read. Choose the file again.");
  }
  const file = typeof body.file === "string" ? body.file.trim().slice(0, 200) : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!file || !/\.(md|markdown|txt)$/i.test(file)) return say(400, "Choose the .md files: the story bank and the library files.");
  if (!text.trim()) return say(400, "That file is empty.");
  const counts = await importTeachingText(v.workspace.id, v.user.id, file, text);
  return NextResponse.json({ ok: true, ...counts }, { headers: { "cache-control": "private, no-store" } });
}
