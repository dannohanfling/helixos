"use client";

import { useEffect, useRef } from "react";

/**
 * Inside a tab bar that scrolls sideways on a phone (H-1635): once the page shows, the active tab is scrolled into view,
 * so a tab far along the bar (Data and privacy, Coach) isn't hidden past the edge. Only the bar scrolls, never the page.
 */
export function TabIntoView() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bar = ref.current?.parentElement;
    const on = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !on || bar.scrollWidth <= bar.clientWidth) return;
    // The bar is position: relative, so the tab's offsetLeft is measured from the bar itself.
    const left = on.offsetLeft;
    if (left < bar.scrollLeft || left + on.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = Math.max(0, left - 16);
  }, []);
  return <span ref={ref} hidden />;
}
