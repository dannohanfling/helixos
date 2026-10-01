"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Scan a barcode with the camera (rev 237 phase 13). The decoder (@zxing/browser) loads only when the member presses Scan, never
 * with the page; a phone without a usable camera, or a refusal, says so and leaves the typed number as the way in. A read code
 * goes into the barcode box and the form is sent; nothing is saved by this (the result still waits for Save).
 */
export function ScanCode({ inputId }: { inputId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "scanning" | "unsupported" | "denied">("idle");
  const video = useRef<HTMLVideoElement>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  async function start() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return setState("unsupported");
    setState("loading");
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      setState("scanning");
      const controls = await reader.decodeFromVideoDevice(undefined, video.current!, (result) => {
        const text = result?.getText();
        if (!text) return;
        controls.stop();
        stop.current = null;
        const input = document.getElementById(inputId) as HTMLInputElement | null;
        if (!input) return;
        input.value = text;
        input.form?.requestSubmit();
      });
      stop.current = () => controls.stop();
    } catch {
      setState("denied");
    }
  }
  function cancel() {
    stop.current?.();
    stop.current = null;
    setState("idle");
  }

  return (
    <div className="space-y-2">
      {state === "scanning" || state === "loading" ? (
        <div className="space-y-2">
          <video ref={video} className="w-full max-w-sm rounded-lg border bg-black" muted playsInline data-testid="scan-video" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
            Stop
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={start} data-testid="scan-start">
          📷 Scan
        </button>
      )}
      {state === "unsupported" ? <p className="text-xs text-ink-3">This browser can&apos;t open the camera here. Type the number under the barcode instead.</p> : null}
      {state === "denied" ? <p className="text-xs text-ink-3">The camera didn&apos;t open (not allowed, or none). Type the number under the barcode instead.</p> : null}
    </div>
  );
}
