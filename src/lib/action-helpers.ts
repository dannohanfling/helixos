import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";

export async function ctx() {
  const v = await requireViewer();
  return { v, workspaceId: v.workspace.id, userId: v.user.id };
}

export function refresh(): void {
  revalidatePath("/", "layout");
}

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export function num(fd: FormData, key: string): number {
  const n = Number(String(fd.get(key) ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function opt(fd: FormData, key: string): string | null {
  const s = str(fd, key);
  return s.length ? s : null;
}
