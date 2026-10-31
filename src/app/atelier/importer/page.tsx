import { ImportApp } from "@/components/atelier/ImportApp";
import { monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { estimateImportUsd, IMPORT_MAX_CHARS, importQuota } from "@/lib/atelier/import";
import { db } from "@/lib/db/client";
import { demoEnabled } from "@/lib/demo/core";
import { DemoNotice } from "@/components/demo/DemoNotice";

export const dynamic = "force-dynamic";

export default function Importer() {
  if (demoEnabled())
    return (
      <DemoNotice title="L’import a besoin de l’IA">
        Chez toi, colle le texte d’une recette trouvée ailleurs : l’IA la met en fiche, le code la vérifie. Pas d’IA dans la démo.
      </DemoNotice>
    );
  return <ImportApp limits={{ ...importQuota(db), spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() }} estimateUsd={estimateImportUsd(IMPORT_MAX_CHARS)} maxChars={IMPORT_MAX_CHARS} />;
}
