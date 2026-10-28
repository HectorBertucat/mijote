// Écrit le Raccourci « Santé → Mijote » non signé (src/lib/health/shortcut.ts), à signer sur un Mac :
//   pnpm shortcut:build
//   shortcuts sign -m anyone -i build/sante-mijote.unsigned.shortcut -o public/raccourcis/sante-mijote.shortcut
import { mkdirSync, writeFileSync } from "fs";
import { buildShortcut, toPlist } from "../src/lib/health/shortcut";

mkdirSync("build", { recursive: true });
writeFileSync("build/sante-mijote.unsigned.shortcut", toPlist(buildShortcut()));
console.log("build/sante-mijote.unsigned.shortcut");
