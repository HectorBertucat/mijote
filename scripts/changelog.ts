// Journal des changements, rassemblé à partir des fragments de docs/changelog.d/.
//   pnpm changelog           → vérifie les fragments et affiche le journal complet
//   pnpm changelog --fold    → les verse en tête de docs/CHANGELOG.md et les supprime (sur main, de temps en temps)
import fs from "fs";
import path from "path";
import { FRAGMENTS_DIR, JOURNAL, checkFragment, fold, isFragmentFile, type Fragment } from "./changelog-core";

const fragments: Fragment[] = fs.existsSync(FRAGMENTS_DIR)
  ? fs.readdirSync(FRAGMENTS_DIR).filter(isFragmentFile).map((name) => ({ name, text: fs.readFileSync(path.join(FRAGMENTS_DIR, name), "utf8") }))
  : [];
const errors = fragments.flatMap(checkFragment);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const journal = fold(fs.readFileSync(JOURNAL, "utf8"), fragments);
if (process.argv.includes("--fold")) {
  fs.writeFileSync(JOURNAL, journal);
  for (const f of fragments) fs.rmSync(path.join(FRAGMENTS_DIR, f.name));
  console.log(`${fragments.length} fragment(s) versé(s) dans ${JOURNAL}.`);
} else {
  process.stdout.write(journal);
}
