// Couverture de la banque d'illustrations : pour chaque ingrédient et chaque étape des recettes
// (src/seed/recipes/), le dessin choisi, et ce qui tombe sur un générique (dessin à créer).
// pnpm illus:coverage            → rapport texte
// pnpm illus:coverage --html f   → planche HTML de tous les dessins (contrôle visuel)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIONS, FOODS } from "../src/lib/illus/art";
import { actionArt, foodArt } from "../src/lib/illus/resolve";
import { RecipeInput } from "../src/lib/recipes/format";

const dir = join(process.cwd(), "src/seed/recipes");
const recipes = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => RecipeInput.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));

const missing = new Map<string, string[]>();
const lines: string[] = [];
for (const r of recipes) {
  lines.push(`\n# ${r.name}`);
  for (const i of r.ingredients) {
    const a = foodArt(i.food, i.item);
    lines.push(`  ${a.exact ? " " : "?"} ${a.id.padEnd(20)} ${i.item}`);
    if (!a.exact) missing.set(i.item, [...(missing.get(i.item) ?? []), r.slug]);
  }
  for (const s of r.steps) {
    const a = actionArt(s.kind, s.text);
    lines.push(`  ${a.exact ? " " : "?"} [${a.id}] ${s.text.slice(0, 70)}`);
    for (const p of s.phases ?? []) lines.push(`      · [${actionArt(s.kind, p.text).id}] ${p.text.slice(0, 60)}`);
  }
}
console.log(lines.join("\n"));
console.log(`\n${Object.keys(FOODS).length} aliments, ${Object.keys(ACTIONS).length} gestes.`);
console.log(missing.size ? `À dessiner (générique utilisé) :\n${[...missing].map(([k, v]) => `  - ${k} (${v.join(", ")})`).join("\n")}` : "Tout ingrédient a son dessin.");

const htmlAt = process.argv.indexOf("--html");
if (htmlAt > 0) {
  const css = readFileSync(join(process.cwd(), "src/components/illus/illus.css"), "utf8");
  const cell = (id: string, label: string, svg: string) =>
    `<figure><svg class="illu is-live" viewBox="0 0 64 64" width="96" height="96" fill="none" stroke="var(--i-line)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${svg}</svg><figcaption>${label}<br><small>${id}</small></figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><style>:root{--ease-out:cubic-bezier(.2,.8,.2,1);--ease-in-out:cubic-bezier(.6,0,.3,1)}${css}
body{font:13px system-ui;background:#f6f4f0;margin:20px}div{display:grid;grid-template-columns:repeat(auto-fill,120px);gap:10px}figure{margin:0;text-align:center;background:#fff;border-radius:12px;padding:8px}small{color:#888}</style>
<h2>Gestes</h2><div>${Object.entries(ACTIONS).map(([k, a]) => cell(k, a.label, a.svg)).join("")}</div>
<h2>Aliments</h2><div>${Object.entries(FOODS).map(([k, a]) => cell(k, a.label, a.svg)).join("")}</div>`;
  writeFileSync(process.argv[htmlAt + 1], html);
  console.log(`Planche : ${process.argv[htmlAt + 1]}`);
}
