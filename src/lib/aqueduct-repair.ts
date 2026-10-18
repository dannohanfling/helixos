/**
 * The Aqueduct's repair moment, read for one viewer (H-327 §4, plan H-637 PR 2): the repair to play on this open, and whether
 * the "repair seen" marker needs writing. Nothing here writes; the one write is POST /api/aqueduct/seen, which the scene sends
 * when the repair starts (or straight away when only the marker moved). Never for a coach switched into a client or a team
 * member: they see the member's water, never the member's repair, and stamp nothing.
 */
import type { Viewer } from "@/lib/auth";
import type { Aqueduct } from "@/lib/aqueduct";
import { nextSeen, readSeen, repairFor, seenChanged, type Repair } from "@/lib/engine/aqueduct-repair";

export type RepairShell = { repair: Repair | null; stamp: boolean };

export function aqueductRepairFor(v: Viewer, a: Aqueduct): RepairShell {
  if (v.switchedInto || v.team) return { repair: null, stamp: false };
  const seen = readSeen(v.membership.aqueductRepairSeen);
  return { repair: repairFor(seen, a.leak, a.now, a.period), stamp: seenChanged(seen, nextSeen(seen, a.leak, a.period, v.today)) };
}
