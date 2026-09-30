import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Disclosure } from "@/components/ui";
import { HumanosHeader } from "@/components/body/humanos-header";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmDelete } from "@/components/confirm-delete";
import { fmtTarget } from "@/lib/engine/body-training";
import { bodySettingsFor, dayTypesFor, requireBodyEnabled, trainingLibrary, type TrainingLibrary } from "@/lib/queries/body";
import { archiveExerciseAction, archiveRoutineAction, saveExerciseAction, saveRoutineAction } from "@/lib/actions/body";
import type * as schema from "@/db/schema";

export const metadata = { title: "HumanOS · Exercises & routines" };

const ROUTINE_ROWS = 6;

function ExerciseFields({ exercise }: { exercise?: schema.BodyExercise }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="label">Name</span>
        <input name="name" className="field py-1 text-sm" defaultValue={exercise?.name} required maxLength={80} placeholder="e.g. Bench press" />
      </label>
      <label>
        <span className="label">Logged as</span>
        <select name="kind" className="field w-auto py-1 text-sm" defaultValue={exercise?.kind ?? "weight"}>
          <option value="weight">Weight × reps</option>
          <option value="bodyweight">Bodyweight (reps, + any added)</option>
        </select>
      </label>
    </div>
  );
}

function RoutineForm({ routine, lib, types }: { routine?: TrainingLibrary["routines"][number]; lib: TrainingLibrary; types: schema.BodyDayType[] }) {
  const rows = Array.from({ length: Math.max(ROUTINE_ROWS, (routine?.items.length ?? 0) + 2) }, (_, i) => routine?.items[i] ?? null);
  // A routine keeps an archived exercise it already has; the picker otherwise offers only live ones.
  const pick = (id?: string) => lib.exercises.concat(id && !lib.exercises.some((e) => e.id === id) && lib.byId.has(id) ? [lib.byId.get(id)!] : []);
  return (
    <form action={saveRoutineAction} className="mt-2 space-y-2" data-testid={routine ? "training-edit-routine" : "training-new-routine"}>
      {routine ? <input type="hidden" name="id" value={routine.id} /> : null}
      <div className="flex flex-wrap gap-2">
        <label className="min-w-0 flex-1">
          <span className="label">Routine name</span>
          <input name="name" className="field py-1 text-sm" defaultValue={routine?.name} required maxLength={80} placeholder="e.g. Push A" />
        </label>
        <label>
          <span className="label">Offered on</span>
          <select name="dayTypeId" className="field w-auto py-1 text-sm" defaultValue={routine?.dayTypeId ?? ""}>
            <option value="">Any day (I pick it)</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-[1fr_4rem_5rem] gap-2 text-xs text-ink-3">
        <span>Exercise</span>
        <span>Sets</span>
        <span>Reps</span>
      </div>
      {rows.map((item, i) => (
        <div key={i} className="grid grid-cols-[1fr_4rem_5rem] gap-2">
          <select name={`item_${i}_exercise`} className="field min-w-0 py-1 text-sm" defaultValue={item?.exerciseId ?? ""} aria-label={`Exercise ${i + 1}`}>
            <option value="">—</option>
            {pick(item?.exerciseId).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <input name={`item_${i}_sets`} type="number" step={1} min={1} max={20} className="field py-1 text-sm tabular" defaultValue={item?.sets ?? 3} aria-label={`Sets ${i + 1}`} />
          <input name={`item_${i}_reps`} className="field py-1 text-sm" defaultValue={item?.reps ?? ""} maxLength={20} placeholder="8–10" aria-label={`Reps ${i + 1}`} />
        </div>
      ))}
      <SubmitButton className="btn btn-humanos btn-sm" pendingText="Saving…">
        Save routine
      </SubmitButton>
    </form>
  );
}

export default async function TrainingRoutinesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  if (!(await bodySettingsFor(v.workspace.id, v.user.id))) redirect("/body");
  const [lib, types] = await Promise.all([trainingLibrary(v.workspace.id, v.user.id), dayTypesFor(v.workspace.id, v.user.id)]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  return (
    <>
      <HumanosHeader title="Exercises & routines" subtitle="The exercises you do, and routines that group them with targets." action={<Link href="/body/training" className="btn btn-ghost btn-sm">← Training</Link>} />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}

      <Card className="mb-4" title="Exercises" id="exercises">
        {lib.exercises.length ? (
          <ul className="divide-y rounded-lg border" data-testid="training-exercises">
            {lib.exercises.map((e) => (
              <li key={e.id} className="p-2.5" data-testid="training-exercise-row" data-name={e.name}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/body/training/${e.id}`} className="text-sm font-medium hover:underline">
                    {e.name}
                  </Link>
                  <span className="flex items-center gap-2 text-xs text-ink-3">
                    {e.kind === "bodyweight" ? "Bodyweight" : "Weight × reps"}
                    <form action={archiveExerciseAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <ConfirmDelete what={`"${e.name}"`} undo="Its history stays, and routines that use it keep it." label="Archive" title="Archive" className="btn btn-ghost btn-xs" />
                    </form>
                  </span>
                </div>
                <Disclosure summary={<span className="text-xs text-ink-3 underline">Edit</span>}>
                  <form action={saveExerciseAction} className="mt-2 space-y-2">
                    <input type="hidden" name="id" value={e.id} />
                    <ExerciseFields exercise={e} />
                    <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…">
                      Save
                    </SubmitButton>
                  </form>
                </Disclosure>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">No exercises yet.</p>
        )}
        <Disclosure summary={<span className="btn btn-soft btn-sm">＋ New exercise</span>} className="mt-3" open={!lib.exercises.length}>
          <form action={saveExerciseAction} className="mt-2 space-y-2" data-testid="training-new-exercise">
            <ExerciseFields />
            <SubmitButton className="btn btn-humanos btn-sm" pendingText="Saving…" data-testid="training-save-exercise">
              Add exercise
            </SubmitButton>
          </form>
        </Disclosure>
      </Card>

      <Card title="Routines" id="routines">
        {lib.routines.length ? (
          <ul className="divide-y rounded-lg border" data-testid="training-routines">
            {lib.routines.map((r) => (
              <li key={r.id} className="p-2.5" data-testid="training-routine-row" data-name={r.name}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {r.name}
                      {r.dayTypeId && typeName.has(r.dayTypeId) ? <span className="ml-2 text-xs font-normal text-ink-3">on {typeName.get(r.dayTypeId)} days</span> : null}
                    </div>
                    <div className="text-xs text-ink-3">{r.lines.map((l) => `${l.exercise.name} ${fmtTarget(l)}`).join(" · ")}</div>
                  </div>
                  <form action={archiveRoutineAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <ConfirmDelete what={`"${r.name}"`} undo="Past workouts from it keep its name." label="Archive" title="Archive" className="btn btn-ghost btn-xs" />
                  </form>
                </div>
                <Disclosure summary={<span className="text-xs text-ink-3 underline">Edit</span>}>
                  <RoutineForm routine={r} lib={lib} types={types} />
                </Disclosure>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">No routines yet.</p>
        )}
        <Disclosure summary={<span className="btn btn-soft btn-sm">＋ New routine</span>} className="mt-3" open={lib.exercises.length > 0 && !lib.routines.length}>
          {lib.exercises.length ? <RoutineForm lib={lib} types={types} /> : <p className="text-sm text-ink-2">Add an exercise first.</p>}
        </Disclosure>
      </Card>
    </>
  );
}
