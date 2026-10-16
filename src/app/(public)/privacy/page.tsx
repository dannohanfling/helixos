import { LEGAL_PAGES } from "@/content/legal";
import { legalMetadata } from "@/lib/engine/legal";
import { LegalArticle } from "../legal-article";

const page = LEGAL_PAGES["privacy"];
export const metadata = legalMetadata(page);

export default function Page() {
  return <LegalArticle page={page} />;
}
