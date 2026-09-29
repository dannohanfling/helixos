import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import { switchedWrite, type WhileSwitched } from "@/lib/switch";

/**
 * The viewer for a member's write. While a coach is switched into a client's HelixOS (rev 216) every write passes the gate in
 * src/lib/switch.ts first: refused while viewing, logged for the client while working, and refused in both modes when the
 * action says it is the client's own ("refuse", with a reason). "noop" is for a read-state side effect the caller then skips.
 */
export async function ctx(opts: { whileSwitched?: WhileSwitched; reason?: string } = {}) {
  const v = await requireViewer();
  if (v.switchedInto) await switchedWrite(v, opts.whileSwitched ?? "log", opts.reason);
  return { v, workspaceId: v.workspace.id, userId: v.user.id };
}

export function refresh(): void {
  revalidatePath("/", "layout");
}

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** A number field left blank is null: "not entered" is not zero. */
export function optNum(fd: FormData, key: string): number | null {
  const raw = String(fd.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function num(fd: FormData, key: string): number {
  const n = Number(String(fd.get(key) ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function opt(fd: FormData, key: string): string | null {
  const s = str(fd, key);
  return s.length ? s : null;
}
