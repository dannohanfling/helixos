import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-bg text-base font-black">H</span>
          <span className="text-lg font-bold">HelixOS</span>
        </div>
        {children}
      </div>
    </div>
  );
}
