import Image from "next/image";
import { PHOTO } from "@/lib/hermes/copy";
import { Footer } from "@/components/hermes/landing";

/** Nothing to sign up for at this address right now: a quiet page in the same look, never an error. */
export function Closed({ line }: { line?: string }) {
  return (
    <div className="hm-root" data-testid="hm-closed">
      <section className="hm-confirm-hero" style={{ minHeight: "70vh" }}>
        <div className="hm-wrap">
          <Image src={PHOTO.logo.src} width={64} height={64} alt={PHOTO.logo.alt} priority />
          <h1 className="hm-h1 hm-serif">There&apos;s no call open here right now</h1>
          <p>{line ?? "If someone sent you this link, reply to their message and they'll send you the right one."}</p>
        </div>
      </section>
      <Footer />
    </div>
  );
}
