import JSZip from "jszip";
import { NextResponse } from "next/server";
import { apiViewer } from "@/lib/auth";
import { principlesFor } from "@/lib/board-principles";
import { boardSkillFiles } from "@/lib/engine/board";

export const dynamic = "force-dynamic";

/**
 * GET /api/board/skill: "Download your Board for Claude" (rev 664 §9). evolve-omega-board.skill, a zip with the skill's folder at
 * its root, built now from the workspace's current Danno principles. Any signed-in member of the workspace may download it;
 * nothing of any member's own data is in it.
 */
export async function GET() {
  const v = await apiViewer();
  if (!v) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const principles = (await principlesFor(v.workspace.id)).map((p) => ({ title: p.title, body: p.body, goodFor: p.goodFor }));
  const zip = new JSZip();
  for (const f of boardSkillFiles(principles)) zip.file(f.path, f.text);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="evolve-omega-board.skill"', "cache-control": "no-store" },
  });
}
