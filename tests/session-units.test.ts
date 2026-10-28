// La session reçoit les unités choisies (Composer, liste de courses, Semaine) : bols, durées
// et manques suivent le multiplicateur, sans double facteur sur les besoins de la liste.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { recipeIngredients, recipes } from "@/lib/db/schema";
import { bootstrap } from "@/seed/bootstrap";
import type { ResolveResponse } from "@/lib/chronocatalog";
import { buildShoppingList } from "@/lib/shopping/build";
import { buildPlan, createSession, getSession, rescaleSession } from "@/lib/session/store";

// Tout se trouve, en paquets de 250 g : la liste achète de quoi couvrir les besoins.
async function resolveAll(q: string): Promise<ResolveResponse> {
  const slug = q.toLowerCase().replace(/[^a-z]+/g, "-").slice(0, 40);
  return {
    query: q, source: "t", none: null, confidence: 0.9, purchase: null, quantity: null,
    matchedTypes: [{ id: slug, slug, name: q, broadCategory: "epicerie", unit: "kg", products: [{
      id: `p-${slug}`, name: `Produit ${q}`, slug, productUrl: "", imageUrl: null, brandName: null, quantityLabel: "250 g", weightG: 250, isFrozen: false,
      currentPrice: 1, currentPricePerKg: null, promoPriceEur: null, stockStatus: "HIGH_STOCK", source: "chronodrive", isFavorite: false,
      availability: { status: "available", stockStatus: "HIGH_STOCK", label: null, remainingStock: null, maxQuantity: null, isDeliverable: true, lastCheckedAt: new Date().toISOString(), ageHours: 1, stale: false },
    }] }],
  } as ResolveResponse;
}

const gramsIn = (qty: string | null) => Number((qty ?? "").match(/([\d\s]+(?:,\d+)?)\s*g\b/)?.[1].replace(/\s/g, "").replace(",", ".") ?? NaN);

test("Composer : multiplicateur et grammes ajoutés passent dans le plan (bols, durées)", () => {
  const { db } = openDb(":memory:");
  bootstrap(db);
  const base = buildPlan(db, { slugs: ["chasseur-porc"], durations: false });
  const x2 = buildPlan(db, { slugs: ["chasseur-porc"], scales: { "chasseur-porc": 2 }, durations: false });
  assert.equal(x2.recipes[0].scale, 2);
  const b1 = base.bowls.find((b) => b.items.some((i) => /\d\s*g\b/.test(i.qty ?? "")))!;
  const b2 = x2.bowls.find((b) => b.letter === b1.letter)!;
  const i1 = b1.items.find((i) => /\d\s*g\b/.test(i.qty ?? ""))!;
  const i2 = b2.items.find((i) => i.item === i1.item)!;
  assert.ok(Math.abs(gramsIn(i2.qty) - 2 * gramsIn(i1.qty)) <= 0.05 * gramsIn(i2.qty) + 5, `${i1.qty} → ${i2.qty}`);
  // Gestes de la prep et ceux glissés dans la cuisson (seul).
  const prep = (p: typeof base) => p.prep.tasks.reduce((s, t) => s + t.minutes, 0) + p.steps.reduce((s, x) => s + (x.tasks ?? []).reduce((y, t) => y + t.minutes, 0), 0);
  assert.ok(prep(x2) > prep(base), "la prep dure plus longtemps au double");
  // Grammes ajoutés : comptés une fois pour toute la cuisson, gardés quand on refait le plan.
  const r = db.select().from(recipes).where(eq(recipes.slug, "chasseur-porc")).get()!;
  const ing = db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, r.id)).all().find((i) => !i.pantry && (i.grams ?? 0) >= 100)!;
  const id = createSession(db, { slugs: ["chasseur-porc"], scales: { "chasseur-porc": 2 }, extras: { [ing.id]: 200 }, durations: false });
  const plan = getSession(db, id)!.plan;
  assert.deepEqual(plan.extras, { [ing.id]: 200 });
  const line = plan.bowls.flatMap((b) => b.items).find((i) => i.item === ing.item);
  if (line?.qty && /\bg\b/.test(line.qty)) assert.ok(Math.abs(gramsIn(line.qty) - (ing.grams! * 2 + 200)) <= 10, line.qty);
  rescaleSession(db, id, { "chasseur-porc": 1.5 });
  const again = getSession(db, id)!.plan;
  assert.equal(again.recipes[0].scale, 1.5);
  assert.deepEqual(again.extras, { [ing.id]: 200 });
});

test("liste de courses à ×2 : la session prend ×2 et ne voit pas de faux manques (pas de double facteur)", async () => {
  const { db } = openDb(":memory:");
  bootstrap(db);
  const listId = await buildShoppingList(db, ["chasseur-porc"], { scales: { "chasseur-porc": 2 }, resolveLine: resolveAll, resolveTotal: resolveAll });
  const plan = buildPlan(db, { slugs: ["chasseur-porc"], shoppingListId: listId, durations: false });
  assert.equal(plan.recipes[0].scale, 2);
  assert.ok(plan.bowls.some((b) => b.items.some((i) => i.ordered)), "produits commandés affichés");
  assert.deepEqual(plan.shortages.map((s) => s.item), []);
  // Réduire au prorata (×1,5 sur une liste à ×2) : besoin ramené à l'échelle, toujours couvert.
  const less = buildPlan(db, { slugs: ["chasseur-porc"], shoppingListId: listId, scales: { "chasseur-porc": 1.5 }, durations: false });
  assert.equal(less.shortages.length, 0);
  // Au-delà de la liste (×3), il manque bien des ingrédients.
  const more = buildPlan(db, { slugs: ["chasseur-porc"], shoppingListId: listId, scales: { "chasseur-porc": 3 }, durations: false });
  assert.ok(more.shortages.length > 0);
});
