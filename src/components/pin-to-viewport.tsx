"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Keeps a top or bottom bar still while the client pinch-zooms the page. A bar in the layout viewport scales with the
 * page; this pins its child to the visual viewport instead (window.visualViewport, resize and scroll events), so the
 * content zooms and the bars stay where they are. At scale 1 nothing is touched, so the normal layout is untouched.
 */
export function PinToViewport({ edge, children }: { edge: "top" | "bottom"; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!vv || !el) return;
    const saved = el.getAttribute("style");
    const apply = () => {
      if (vv.scale <= 1.001) {
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
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, [edge]);
  return (
    <div ref={ref} className="contents" data-pin={edge}>
      {children}
    </div>
  );
}
