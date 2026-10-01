import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card } from "@/components/ui";
import { HumanosHeader } from "@/components/body/humanos-header";
import { SubmitButton } from "@/components/submit-button";
import { ScanCode } from "@/components/body/scan-code";
import { SECTION_LABEL } from "@/lib/engine/body-shopping";
import { encodeFound, fmtPer100, foodFromFound, readBarcode, type FoundFood } from "@/lib/engine/body-find";
import { FoodSearchError, foodSearchProblem, lookupBarcode, searchFoods, usdaConfigured } from "@/lib/food-search";
import { allow } from "@/lib/rate-limit";
import { bodySettingsFor, requireBodyEnabled } from "@/lib/queries/body";
import { saveFoundFoodAction } from "@/lib/actions/body";

export const metadata = { title: "HumanOS · Find a food" };

/**
 * Find a food (rev 237 phase 13, B8): words go to USDA FoodData Central, a barcode (typed, or scanned with the camera) to Open
 * Food Facts. Each result shows its figures per 100 g; "Save to my foods" writes it per the member's own unit, with the store
 * section and the raw/cooked basis guessed and editable on Nutrition afterwards. Nothing saves until that press. A GET form, so
 * the search is in the address and the back button works.
 */
export default async function FindFoodPage({ searchParams }: { searchParams: Promise<{ q?: string; code?: string; saved?: string; error?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const settings = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!settings) redirect("/body");
  const q = (sp.q ?? "").trim().slice(0, 80);
  const codeText = (sp.code ?? "").trim();
  const code = codeText ? readBarcode(codeText) : null;
  let results: FoundFood[] = [];
  let problem: string | null = sp.error ?? null;
  if (codeText && !code) problem = "A barcode is 8 to 14 digits.";
  else if (q || code) {
    if (!(await allow(`body-find:${v.user.id}`, 60, 15 * 60000))) problem = "That's a lot of searches in a row. Wait 15 minutes and try again.";
    else {
      try {
        results = code ? [await lookupBarcode(code)] : await searchFoods(q);
      } catch (e) {
        problem = e instanceof FoodSearchError ? foodSearchProblem(e) : "The food database couldn't answer just now.";
      }
    }
  }
  const unit = settings.foodUnit;

  return (
    <>
      <HumanosHeader title="Find a food" subtitle="Search the USDA database by name, or look a product up by its barcode. Nothing saves until you press Save." action={<Link href="/body/foods" className="btn btn-ghost btn-sm">← Nutrition</Link>} />
      {sp.saved ? (
        <p className="mb-4 rounded-xl border border-ok bg-ok-soft p-3 text-sm" role="status" data-testid="find-saved">
          Saved <strong>{sp.saved}</strong> to your foods, per {unit}. Its section and basis are guesses: fix them on <Link href="/body/foods" className="underline">Nutrition</Link> if needed.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="By name">
          <form method="get" action="/body/foods/find" className="flex flex-wrap items-end gap-2" data-testid="find-search">
            <label className="min-w-0 flex-1">
              <span className="label">Food</span>
              <input name="q" className="field py-1 text-sm" defaultValue={q} placeholder="chicken breast" maxLength={80} autoFocus={!codeText} />
            </label>
            <button type="submit" className="btn btn-primary btn-sm">Search</button>
          </form>
          {!usdaConfigured() ? <p className="mt-2 text-xs text-ink-3" data-testid="find-no-key">Food search isn&apos;t set up on this server yet. A barcode still works.</p> : null}
        </Card>
        <Card title="By barcode">
          <form method="get" action="/body/foods/find" className="flex flex-wrap items-end gap-2" data-testid="find-barcode">
            <label className="min-w-0 flex-1">
              <span className="label">Number under the barcode</span>
              <input id="find-code" name="code" className="field py-1 text-sm tabular" defaultValue={codeText} inputMode="numeric" placeholder="0012345678905" maxLength={20} />
            </label>
            <button type="submit" className="btn btn-primary btn-sm">Look up</button>
          </form>
          <div className="mt-2">
            <ScanCode inputId="find-code" />
          </div>
        </Card>
      </div>
      {problem ? (
        <p className="mt-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="find-error">
          {problem}
        </p>
      ) : null}
      {results.length ? (
        <Card className="mt-4" title={code ? "Product" : `Results for “${q}”`}>
          <ul className="divide-y" data-testid="find-results">
            {results.map((r) => {
              const food = foodFromFound(r, unit);
              return (
                <li key={`${r.source}:${r.ref}`} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="find-result">
                  <div className="min-w-0">
                    <div className="font-medium" data-testid="find-result-name">{r.name}</div>
                    <div className="text-xs text-ink-3">
                      {r.brand ? `${r.brand} · ` : ""}
                      <span data-testid="find-result-per100">{fmtPer100(r.per100)}</span>
                      {` · ${SECTION_LABEL[food.section]} · per ${food.basis} weight · ${r.source === "usda" ? "USDA" : "Open Food Facts"}`}
                    </div>
                  </div>
                  <form action={saveFoundFoodAction}>
                    <input type="hidden" name="found" value={encodeFound(r)} />
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="Saving…" data-testid="find-save">
                      Save to my foods (per {unit})
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (q || code) && !problem ? (
        <p className="mt-4 text-sm text-ink-3" data-testid="find-empty">Nothing matched. Try fewer words, or add the food by hand on Nutrition.</p>
      ) : null}
    </>
  );
}
