/**
 * Server-side timing for a page's load (H-164 §9): `tick()` reads the clock outside a component body (the purity lint refuses
 * `performance.now()` in render), and `logTiming` writes one line of names and milliseconds, never a value from the page.
 */
export const tick = (): number => performance.now();

export function logTiming(page: string, marks: { name: string; from: number; to: number }[], extra: Record<string, string | number> = {}): void {
  const parts = marks.map((m) => `${m.name}=${Math.round(m.to - m.from)}ms`);
  const total = marks.length ? `total=${Math.round(marks[marks.length - 1].to - marks[0].from)}ms` : "";
  console.log(`[${page}] ${[...parts, total, ...Object.entries(extra).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join(" ")}`);
}
