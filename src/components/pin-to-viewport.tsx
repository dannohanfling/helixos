"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Keeps a top or bottom bar still while the client pinch-zooms the page. A bar in the layout viewport scales with the
 * page; this pins its child to the visual viewport instead (window.visualViewport, resize and scroll events), so the
 * content zooms and the bars stay where they are. Below a real zoom (1.05) nothing is touched: the bar stays CSS fixed at
 * its edge, so iOS Safari's toolbar showing or hiding, which nudges the reported scale and lags its height, can never leave
 * the bar stranded partway up the screen (H-1043).
 */
const REAL_ZOOM = 1.05;
export function PinToViewport({ edge, children }: { edge: "top" | "bottom"; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!vv || !el) return;
    const saved = el.getAttribute("style");
    const apply = () => {
      if (vv.scale <= REAL_ZOOM) {
        if (saved === null) el.removeAttribute("style");
        else el.setAttribute("style", saved);
        return;
      }
      const s = vv.scale;
      const width = window.innerWidth; // the layout viewport, which is the screen's width at scale 1
      const y = edge === "top" ? vv.offsetTop : vv.offsetTop + vv.height - el.offsetHeight / s;
      el.style.position = "fixed";
      el.style.top = "0";
      el.style.bottom = "auto";
      el.style.left = "0";
      el.style.right = "auto";
      el.style.width = `${width}px`;
      el.style.transformOrigin = "0 0";
      el.style.transform = `translate(${vv.offsetLeft}px, ${y}px) scale(${1 / s})`;
      el.style.zIndex = "50";
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("scroll", apply, { passive: true });
    window.addEventListener("resize", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      if (saved === null) el.removeAttribute("style");
      else el.setAttribute("style", saved);
    };
  }, [edge]);
  return (
    <div ref={ref} className="contents" data-pin={edge}>
      {children}
    </div>
  );
}
