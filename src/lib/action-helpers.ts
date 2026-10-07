import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readMoney } from "@/lib/engine/money";
import { requireViewer } from "@/lib/auth";
import { switchedWrite, type WhileSwitched } from "@/lib/switch";
import { teamWrite, type TeamWrite } from "@/lib/team";

/**
 * The viewer for a member's write. While a coach is switched into a client's HelixOS (rev 216) every write passes the gate in
 * src/lib/switch.ts first: refused while viewing, logged for the client while working, and refused in both modes when the
 * action says it is the client's own ("refuse", with a reason). "noop" is for a read-state side effect the caller then skips.
 * A team member (Danno, 6 Oct) passes the gate in src/lib/team.ts: refused unless the action says `team: "allow"`, and then
 * logged for the owner; "noop" again means the caller skips the side effect itself (it checks v.team).
 */
export async function ctx(opts: { whileSwitched?: WhileSwitched; reason?: string; team?: TeamWrite } = {}) {
  const v = await requireViewer({ team: "allow" });
  if (v.switchedInto) await switchedWrite(v, opts.whileSwitched ?? "log", opts.reason);
  if (v.team) await teamWrite(v, opts.team ?? "refuse");
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

/**
 * A money box (rev 444): "3.5k", "$3,500", "3500 USD" read as the amount, blank is null. One that can't be read is refused:
 * the member goes back to `refuse(error)`, an address naming the error and the box, and the shared button puts back what they
 * typed and marks that box. Never saved as 0, never as 3.5.
 */
export function money(fd: FormData, key: string, refuse: (error: string) => string): number | null {
  const m = readMoney(str(fd, key));
  if ("error" in m) redirect(refuse(m.error));
  return m.value;
}
