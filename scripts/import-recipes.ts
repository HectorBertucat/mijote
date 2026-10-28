// Importe (ou met à jour) les recettes au format standard de src/seed/recipes/ (sous-dossiers compris).
import path from "path";
import { openDb } from "@/lib/db/open";
import fs from "fs";
import { importRecipes } from "@/seed/bootstrap";
import { RecipeInput } from "@/lib/recipes/format";
import { phaseIssues } from "@/lib/recipes/phases";
import { seedBase } from "@/seed/seed";

const { db } = openDb();
seedBase(db); // l'équipement doit exister : les étapes y font référence
for (const r of importRecipes(db, path.join(process.cwd(), "src/seed/recipes"))) {
  console.log(`${r.created ? "créée " : "mise à jour"}  ${r.file}`);
}
// Sous-étapes chronométrées : obligatoires. Celles qui manquent ont été découpées par le code ; écris-les dans la fiche.
let missing = 0;
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".json") ? [path.join(dir, e.name)] : []));
for (const f of walk(path.join(process.cwd(), "src/seed/recipes"))) {
  for (const i of phaseIssues(RecipeInput.parse(JSON.parse(fs.readFileSync(f, "utf8"))))) {
    missing++;
    console.warn(`⚠ ${path.basename(f)}, étape ${i.step} : ${i.issue} (« ${i.text}… »)`);
  }
}
if (missing) process.exitCode = 1;
