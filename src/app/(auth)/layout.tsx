import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { APP_DESCRIPTION } from "@/lib/brand";

export const dynamic = "force-dynamic";

// The public entrance is the one place an app link gets seen socially: title, description and the logo card.
export const metadata: Metadata = {
  openGraph: { title: "HelixOS", description: APP_DESCRIPTION, siteName: "HelixOS", type: "website" },
  twitter: { card: "summary_large_image", title: "HelixOS", description: APP_DESCRIPTION },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex flex-col items-center gap-2" data-testid="brand-logo">
          <BrandLogo size={128} />
          <span className="text-sm font-semibold tracking-wide text-ink-2">HelixOS</span>
        </div>
        <div className="auth-brand">{children}</div>
      </div>
    </div>
  );
}
