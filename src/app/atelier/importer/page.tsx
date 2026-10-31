import { ImportApp } from "@/components/atelier/ImportApp";
import { monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { estimateImportUsd, IMPORT_MAX_CHARS, importQuota } from "@/lib/atelier/import";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default function Importer() {
  return <ImportApp limits={{ ...importQuota(db), spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() }} estimateUsd={estimateImportUsd(IMPORT_MAX_CHARS)} maxChars={IMPORT_MAX_CHARS} />;
}
