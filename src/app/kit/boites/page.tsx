import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { DishBox } from "@/components/ui/dish";
import { dishArt, type DishRecipe } from "@/lib/illus/dish";

// Les boîtes des recettes de src/seed/recipes (dishArt + DishBox), dans toutes les tailles. Non liée.
export const metadata: Metadata = { title: "Boîtes · cuisine", robots: { index: false, follow: false } };

const MODEL = { garni: "garni", mijote: "mijoté", veloute: "velouté", gratine: "gratiné" } as const;

function seedRecipes(): DishRecipe[] {
  // Copiées à côté du serveur autonome (outputFileTracingIncludes de next.config.ts).
  const dir = join(process.cwd(), "src/seed/recipes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as DishRecipe);
}

export default function BoitesPage() {
  const recipes = seedRecipes();
  const first = recipes.find((r) => r.slug === "poulet-teriyaki-riz") ?? recipes[0];
  return (
    <div className="grid gap-12">
      <div>
        <h1 className="text-[30px] font-extrabold">Boîtes</h1>
        <p className="mt-2 max-w-[66ch] text-ink-2">
          {recipes.length} recettes, chacune dessinée à partir de ses ingrédients : sauce, garniture, féculent à part, touche finale. Même recette, même boîte.
        </p>
      </div>
      {first && (
        <section className="grid gap-6">
          <h2 className="text-[20px] font-bold">Tailles</h2>
          <DishBox recipe={first} size="hero" live />
          <div className="flex flex-wrap items-end gap-6">
            <DishBox recipe={first} size="sm" />
            <DishBox recipe={first} size="md" />
            <DishBox recipe={first} size="lg" />
          </div>
        </section>
      )}
      <section className="grid gap-6">
        <h2 className="text-[20px] font-bold">Recettes</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(256px,1fr))] gap-6">
          {recipes.map((r) => {
            const art = dishArt(r);
            return (
              <figure key={r.slug} className="grid gap-2">
                <DishBox recipe={r} size="lg" />
                <figcaption className="text-[14px]">
                  {r.name}
                  <span className="block text-[12px] text-faint">
                    {MODEL[art.model]} · {art.sauce.tone}
                    {art.side ? ` · ${art.side.kind} à part` : ""} · {art.main.map((m) => m.art).join(", ")}
                  </span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </section>
    </div>
  );
}
