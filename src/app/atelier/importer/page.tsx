import Link from "next/link";
import { ImportApp } from "@/components/atelier/ImportApp";
import { Icon } from "@/components/ui";
import { monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { estimateImportUsd, IMPORT_MAX_CHARS, importQuota } from "@/lib/atelier/import";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default function Importer() {
  return (
    <div className="grid gap-3.5">
      <Link href="/recettes" className="inline-flex w-fit items-center gap-1 text-[14px] font-semibold text-ink-2 hover:text-ink">
        <Icon name="chev" size="s" className="rotate-180" />
        Recettes
      </Link>
      <ImportApp limits={{ ...importQuota(db), spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() }} estimateUsd={estimateImportUsd(IMPORT_MAX_CHARS)} maxChars={IMPORT_MAX_CHARS} />
    </div>
  );
}
