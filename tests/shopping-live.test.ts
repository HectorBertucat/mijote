// Variantes de nom sur « no_match », et suivi d'une vérification en direct (client simulé :
// aucune requête vers chronocatalog ni Chronodrive).
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { shoppingItems, shoppingLists } from "@/lib/db/schema";
import type { LiveRequestState, ResolvedProduct, ResolveResponse } from "@/lib/chronocatalog";
import { pollLive, resolveIngredient, startLiveCheck, type LiveClient } from "@/lib/shopping/build";
import { nameVariants } from "@/lib/shopping/rules";

test("variantes : sans quantité, sans qualificatifs, puis les premiers mots", () => {
  assert.deepEqual(nameVariants("2 kg sauté de porc sans os label rouge", "Sauté de porc sans os Label Rouge (4 barquettes de 500 g)"), [
    "sauté de porc sans os label rouge",
    "sauté de porc",
    "sauté",
  ]);
  assert.deepEqual(nameVariants("3 gousses d'ail", "Ail, haché"), ["ail"]);
  assert.deepEqual(nameVariants("150 g emmental râpé", "Râpé (moitié dans la ricotta)"), ["emmental râpé", "Râpé"]);
});

test("no_match : on réessaie avec la quantité et on garde la variante qui trouve un type", async () => {
  const asked: string[] = [];
  const res = async (q: string): Promise<ResolveResponse> => {
    asked.push(q);
    const hit = q === "2000 g sauté de porc";
    return { query: q, source: "t", matchedTypes: hit ? [{ id: "t", slug: "saute_porc", name: "Sauté de porc", broadCategory: "viande", unit: "kg", products: [] }] : [], none: hit ? null : { reason: "no_match", why: "" } };
  };
  const r = await resolveIngredient({ lineRaw: "2 kg sauté de porc sans os label rouge", item: "Sauté de porc sans os Label Rouge", grams: 2000, units: null }, res);
  assert.equal(r?.matchedTypes[0].slug, "saute_porc");
  assert.deepEqual(asked, ["2 kg sauté de porc sans os label rouge", "2000 g sauté de porc sans os label rouge", "2000 g sauté de porc"]);
  // Sel : « rien à acheter » n'est pas un no_match, pas de nouvel essai.
  asked.length = 0;
  await resolveIngredient({ lineRaw: "sel", item: "Sel", grams: null, units: null }, async (q) => (asked.push(q), { query: q, source: "t", matchedTypes: [], none: { reason: "pantry", why: "" } }));
  assert.equal(asked.length, 1);
});

test("vérifier en direct : demande sans attendre, puis suivi ligne par ligne", async () => {
  const { db } = openDb(":memory:");
  db.insert(shoppingLists).values({ id: "L" }).run();
  const card = (id: string, ageHours: number): ResolvedProduct => ({
    id, name: id, slug: id, productUrl: "", imageUrl: null, brandName: null, quantityLabel: "500 g", weightG: 500, isFrozen: false,
    currentPrice: 3, currentPricePerKg: null, promoPriceEur: null, stockStatus: "HIGH_STOCK", source: "chronodrive", isFavorite: false,
    availability: { status: "available", stockStatus: "HIGH_STOCK", label: null, remainingStock: null, maxQuantity: null, isDeliverable: true, lastCheckedAt: new Date().toISOString(), ageHours, stale: false },
  });
  db.insert(shoppingItems).values([
    { id: "a", listId: "L", item: "A", chronoProductId: "pa", packs: 1, productJson: card("pa", 30), state: "warn", aisle: "Épicerie", warnings: ["vérifié il y a 1 j"] },
    { id: "b", listId: "L", item: "B", chronoProductId: "pb", packs: 1, productJson: card("pb", 30), state: "warn", aisle: "Boucherie" },
  ]).run();
  const states: Record<string, LiveRequestState["status"]> = { ra: "pending" };
  const calls: { refresh?: string[]; waitSeconds?: number }[] = [];
  const client: LiveClient = {
    live: async (req) => {
      calls.push(req);
      return {
        refresh: (req.refresh ?? []).map((id) => (id === "pa" ? { productId: id, outcome: calls.length === 1 ? "queued" : "fresh", requestId: "ra", status: "pending" } : { productId: id, outcome: "fresh", requestId: null })),
        products: (req.refresh ?? []).map((id) => card(id, 0)),
      };
    },
    liveRequests: async (ids) => ({ requests: ids.map((id) => ({ id, productId: null, status: states[id] ?? "pending", doneAt: null, error: null })) }),
  };
  const s = await startLiveCheck(db, "L", client);
  assert.deepEqual(s, { asked: 2, pending: 1 });
  assert.equal(calls[0].waitSeconds, 0);
  const get = (id: string) => db.select().from(shoppingItems).where(eq(shoppingItems.id, id)).get()!;
  assert.equal(get("b").liveStatus, "fresh");
  assert.equal(get("b").state, "ok");
  assert.equal(get("a").liveStatus, "pending");

  assert.deepEqual(await pollLive(db, "L", client), { total: 2, pending: 1, checked: 1 });
  states.ra = "done";
  assert.deepEqual(await pollLive(db, "L", client), { total: 2, pending: 0, checked: 2 });
  assert.equal(get("a").liveStatus, "done");
  assert.equal(get("a").state, "ok");
  assert.deepEqual(calls.at(-1)?.refresh, ["pa"]);
});
