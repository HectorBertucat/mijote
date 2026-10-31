// Démarrage d'une base : seed idempotent (personnes, équipement, préférences), puis
// import des recettes de src/seed/recipes/ nouvelles ou modifiées (empreinte du fichier
// dans recipes.fixture_hash, qui inclut NUTRITION_VERSION : changer le calcul ou la table
// nutritionnelle réimporte les fiches et recalcule leurs macros ; PLAN_VERSION fait de même quand le
// planificateur change, et les sessions ouvertes refont leur plan). Réimporter une recette garde son id et ses notes.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { recipes } from "@/lib/db/schema";
import { backfillPhases, upsertRecipe } from "@/lib/recipes/store";
import { NUTRITION_VERSION } from "@/lib/nutrition/compute";
import { PLAN_VERSION } from "@/lib/session/planner";
import { replanSessionsFor } from "@/lib/session/store";
import { seedBase } from "./seed";

/**
 * Dossiers de recettes, dans l'ordre de priorité : celui de l'instance (MIJOTE_RECIPES_DIR), puis
 * la bibliothèque de base (src/seed/recipes). Les deux sont importés ; sur un même slug, l'instance gagne.
 */
export function recipesDirs(): string[] {
  const candidates = [process.env.MIJOTE_RECIPES_DIR, path.join(process.cwd(), "src/seed/recipes")].filter((p): p is string => Boolean(p) && fs.existsSync(/*turbopackIgnore: true*/ p!));
  return [...new Set(candidates.map((c) => path.resolve(c)))];
}

function fixtures(dir: string) {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    // Les fichiers cachés (« ._recette.json » des copies depuis macOS, éditeurs) ne sont pas des recettes.
    .filter((f) => f.endsWith(".json") && !f.split(/[\\/]/).some((part) => part.startsWith(".")))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      return { file: f, raw: JSON.parse(text) as { slug: string }, hash: crypto.createHash("sha256").update(text).update(`\nnutrition:${NUTRITION_VERSION}\nplan:${PLAN_VERSION}`).digest("hex") };
    });
}

function fixtureSlug(dir: string, file: string): string {
  return (JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { slug: string }).slug;
}

export function importRecipes(db: Db, dir: string) {
  return fixtures(dir).map((x) => ({ file: x.file, ...upsertRecipe(db, x.raw, x.hash) }));
}

/** Réimporte les fichiers nouveaux ou modifiés depuis le dernier import (les notes sont gardées). */
export function syncRecipes(db: Db, dir: string, skip: ReadonlySet<string> = new Set()) {
  const known = new Map(db.select({ slug: recipes.slug, hash: recipes.fixtureHash }).from(recipes).all().map((r) => [r.slug, r.hash]));
  return fixtures(dir)
    .filter((x) => !skip.has(x.raw.slug) && known.get(x.raw.slug) !== x.hash)
    .map((x) => ({ file: x.file, ...upsertRecipe(db, x.raw, x.hash) }));
}

export function bootstrap(db: Db, sqlite?: { exec(sql: string): unknown }) {
  // Plusieurs processus peuvent démarrer ensemble (workers de `next build`) : on prend
  // le verrou d'écriture avant de lire, pour qu'un seul fasse le seed.
  if (sqlite) {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      bootstrapUnlocked(db);
      sqlite.exec("COMMIT");
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
    return;
  }
  bootstrapUnlocked(db);
}

function bootstrapUnlocked(db: Db) {
  seedBase(db);
  const dirs = recipesDirs();
  if (!dirs.length) return console.warn("[seed] dossier des recettes introuvable");
  // Un slug déjà fourni par un dossier prioritaire n'est pas réimporté depuis les suivants
  // (sinon les deux versions s'écraseraient à chaque démarrage).
  const taken = new Set<string>();
  const slugs: string[] = [];
  for (const dir of dirs) {
    const done = syncRecipes(db, dir, taken);
    if (done.length) console.log(`[seed] ${done.length} recette(s) importée(s) ou mise(s) à jour depuis ${dir} : ${done.map((d) => d.file).join(", ")}`);
    slugs.push(...done.filter((d) => !d.created).map((d) => fixtureSlug(dir, d.file)));
    for (const x of fixtures(dir)) taken.add(x.raw.slug);
  }
  const replanned = replanSessionsFor(db, slugs);
  if (replanned.length) console.log(`[seed] ${replanned.length} session(s) en cours replanifiée(s)`);
  const filled = backfillPhases(db);
  if (filled) console.log(`[seed] ${filled} étape(s) de cuisson ont reçu leurs sous-étapes`);
}
