"use client";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
      {label}
    </button>
  );
}
