"use client";

import { useEffect, useState } from "react";

/**
 * ?debug=overflow (Danno, 12 Oct): on a phone that pans sideways, outlines in red and lists every element wider than the screen
 * or past its edges, anywhere on the page: HelixOS's own, a fixed bar, or something a third-party script added (the chat
 * bubble), with the numbers that say which of them it is. Add "-nochat" (?debug=overflow-nochat) to load the page without the
 * chat bubble's script, to see whether the panning goes with it. Off unless asked for; it changes nothing on the page but the
 * outlines and its own panel.
 */
type Row = { what: string; where: string; box: string; outside: boolean; fixed: boolean };
type Report = { at: string; facts: string[]; rows: Row[]; total: number };

const PANEL = "data-overflow-debug";
const MARK = "data-overflow-mark";

function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const test = el.getAttribute("data-testid");
  const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 4).join(".")}` : "";
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  return `${el.tagName.toLowerCase()}${id}${test ? `[${test}]` : ""}${cls}${text ? ` "${text}"` : ""}`;
}

/**
 * Inside a box that scrolls or clips sideways (a table wrapper, a carousel): its overflow doesn't reach the page. The app shell's
 * own clip is the safety net, not a scroller, so what it is hiding is listed too.
 */
function insideScroller(el: Element): boolean {
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement && !a.hasAttribute("data-app-shell"); a = a.parentElement) {
    const x = getComputedStyle(a).overflowX;
    if (x !== "visible") return true;
  }
  return false;
}

export function measureOverflow(): Report {
  document.querySelectorAll(`[${MARK}]`).forEach((el) => {
    (el as HTMLElement).style.outline = el.getAttribute(MARK) ?? "";
    el.removeAttribute(MARK);
  });
  const vw = window.innerWidth;
  const vv = window.visualViewport;
  const de = document.documentElement;
  const shell = document.querySelector("[data-app-shell]");
  const ios = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  const facts = [
    `screen ${screen.width}px · window ${vw}px · page ${de.scrollWidth}px (body ${document.body.scrollWidth}px) · panned ${Math.round(window.scrollX)}px`,
    `zoom ${vv ? vv.scale.toFixed(2) : "?"} · visible ${vv ? Math.round(vv.width) : "?"}px · dpr ${window.devicePixelRatio}`,
    `${ios ? `iOS ${ios[1]}.${ios[2]}` : navigator.userAgent.slice(0, 40)} · clip ${CSS.supports("overflow-x", "clip") ? "yes" : "no"} · html ${getComputedStyle(de).overflowX} · body ${getComputedStyle(document.body).overflowX}`,
  ];
  const rows: Row[] = [];
  const listed = new Set<Element>();
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (el.closest(`[${PANEL}]`)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const past = r.right > vw + 0.5 || r.left < -0.5;
    if (!past) continue;
    const style = getComputedStyle(el);
    const fixed = style.position === "fixed";
    if (!fixed && insideScroller(el)) continue;
    // The outermost one only: a child that is past the edge only because its parent is adds nothing.
    let a = el.parentElement;
    while (a && !listed.has(a)) a = a.parentElement;
    if (a) continue;
    listed.add(el);
    rows.push({
      what: describe(el),
      where: `${style.position}${style.transform !== "none" ? " transformed" : ""}${style.visibility === "hidden" || style.opacity === "0" ? " invisible" : ""}`,
      box: `left ${Math.round(r.left)} right ${Math.round(r.right)} width ${Math.round(r.width)}`,
      outside: Boolean(shell && !shell.contains(el)),
      fixed,
    });
    const h = el as HTMLElement;
    h.setAttribute(MARK, h.style.outline);
    h.style.outline = "2px solid #e11d48";
  }
  return { at: new Date().toLocaleTimeString(), facts, rows: rows.slice(0, 15), total: rows.length };
}

export function OverflowDebug() {
  const [on, setOn] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    if (!/[?&]debug=overflow/.test(window.location.search)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address, read once after mounting, never during render
    setOn(true);
    let timer = 0;
    const check = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setReport(measureOverflow()), 250);
    };
    check();
    // The chat script and late images arrive after the page: look again for the first half minute, and on any resize.
    const ticks = window.setInterval(check, 3000);
    const stop = window.setTimeout(() => window.clearInterval(ticks), 30000);
    window.addEventListener("resize", check);
    window.visualViewport?.addEventListener("resize", check);
    return () => {
      window.clearInterval(ticks);
      window.clearTimeout(stop);
      window.clearTimeout(timer);
      window.removeEventListener("resize", check);
      window.visualViewport?.removeEventListener("resize", check);
    };
  }, []);
  if (!on || !report) return null;
  return (
    <div
      {...{ [PANEL]: "" }}
      data-testid="overflow-debug"
      style={{ position: "fixed", left: 0, right: 0, top: 0, zIndex: 2147483647, maxHeight: "45vh", overflowY: "auto", background: "rgba(17,19,24,.94)", color: "#f6f5f1", font: "11px/1.4 ui-monospace, Menlo, monospace", padding: "8px 10px", boxSizing: "border-box", width: "100%", overflowWrap: "anywhere" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>Overflow check · {report.at}</strong>
        <button type="button" onClick={() => setReport(measureOverflow())} style={{ background: "#f6f5f1", color: "#111318", borderRadius: 6, padding: "2px 8px", flexShrink: 0 }} data-testid="overflow-debug-recheck">
          Check again
        </button>
      </div>
      {report.facts.map((f) => (
        <div key={f}>{f}</div>
      ))}
      <div style={{ marginTop: 4, fontWeight: 700 }} data-testid="overflow-debug-count">
        {report.total ? `${report.total} wider than the screen${report.total > report.rows.length ? ` (first ${report.rows.length})` : ""}:` : "Nothing is wider than the screen."}
      </div>
      <ol style={{ margin: 0, paddingLeft: 16 }} data-testid="overflow-debug-list">
        {report.rows.map((r, i) => (
          <li key={i}>
            {r.what} · {r.where}
            {r.outside ? " · added outside HelixOS" : ""} · {r.box}
          </li>
        ))}
      </ol>
    </div>
  );
}
