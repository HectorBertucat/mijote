// Importer une recette depuis un texte collé : garde-fous sans appel, quota du jour, recette correcte
// importée « à essayer » avec son lien, recette bancale signalée « à relire ». Faux client IA.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { openDb } from "@/lib/db/open";
import { aiCalls } from "@/lib/db/schema";
import { setAiClient, type AiClient } from "@/lib/ai";
import type { ResolveResponse } from "@/lib/chronocatalog";
import { RecipeInput } from "@/lib/recipes/format";
import { loadRecipeInput, saveDraft } from "@/lib/atelier";
import { getRecipe } from "@/lib/recipes/queries";
import { toAiRecipe, type AiRecipe } from "@/lib/atelier/schema";
import { cleanUrl, estimateImportUsd, IMPORT_MAX_CHARS, ImportRefused, importBatchUnits, importQuota, precheckImport, proposeImport } from "@/lib/atelier/import";
import { householdMembers } from "@/lib/eaters/store";
import { seedTest } from "./helpers";

const offline = async (q: string): Promise<ResolveResponse> => ({ query: q, source: "test", matchedTypes: [], none: { reason: "no_match", why: "test" } });

const CAPTION = `Poulet basquaise du dimanche 🍗🌶️
Ingrédients pour 4 :
- 800 g de hauts de cuisse de poulet
- 3 poivrons
- 2 oignons
- 400 g de tomates concassées
- 2 c. à s. d'huile d'olive
Saisir le poulet, ajouter les légumes et laisser mijoter 40 min.
#batchcooking #poulet #recettefacile`;

const URL_IG = "https://www.instagram.com/p/ABC123/?igsh=xyz&utm_source=ig_web";

/** La fiche de démonstration, ramenée au batch de l'import (5 repas pour Alex et Sam). */
function goodRecipe(units: number): AiRecipe {
  const r = RecipeInput.parse(JSON.parse(fs.readFileSync("src/seed/recipes/poulet-basquaise.json", "utf8")));
  const ai = toAiRecipe(r);
  const k = units / r.servingsUnits;
  return {
    ...ai,
    slug: "poulet-basquaise-instagram",
    name: "Poulet basquaise du dimanche",
    servingsUnits: units,
    ingredients: ai.ingredients.map((i) => ({ ...i, grams: i.grams != null ? Math.round(i.grams * k) : null, units: i.units != null ? Math.round(i.units * k) : null })),
  };
}

function fakeClient(make: () => AiRecipe) {
  let calls = 0;
  const client: AiClient = {
    messages: {
      parse: async (params) => {
        calls++;
        assert.equal((params as { model?: string }).model, "claude-haiku-5-5", "l'import passe par Haiku");
        return { usage: { input_tokens: 4000, output_tokens: 5000 }, stop_reason: "end_turn", parsed_output: { recipe: make(), explanation: "Quantités multipliées par 2,8." } };
      },
    },
  };
  return { client, calls: () => calls };
}

function freshDb() {
  const { db } = openDb(":memory:");
  seedTest(db);
  return db;
}

test("garde-fous : texte vide, trop court ou sans quantités refusé sans appel ni coût", async () => {
  const db = freshDb();
  const fake = fakeClient(() => goodRecipe(45));
  setAiClient(fake.client);
  try {
    for (const text of ["", "   \n  ", "Trop bon ce plat !! 😍 #food", "Une recette de poulet basquaise vraiment délicieuse, à faire absolument ce week-end avec toute la famille, merci maman."]) {
      await assert.rejects(proposeImport(db, { text, url: URL_IG }, { resolve: offline }), ImportRefused);
    }
    await assert.rejects(proposeImport(db, { text: CAPTION, url: "pas un lien" }, { resolve: offline }), /adresse web/);
    assert.equal(fake.calls(), 0);
    assert.equal(db.select().from(aiCalls).all().length, 0, "rien dans le journal : aucun coût");
  } finally {
    setAiClient(null);
  }
});

test("garde-fous : hashtags retirés, texte trop long tronqué, lien nettoyé", () => {
  const p = precheckImport({ text: CAPTION, url: URL_IG });
  assert.ok(!p.text.includes("#batchcooking"));
  assert.equal(p.truncated, false);
  assert.equal(p.url, "https://www.instagram.com/p/ABC123/");
  const long = precheckImport({ text: CAPTION + "\n" + "bla ".repeat(3000) });
  assert.equal(long.truncated, true);
  assert.equal(long.text.length, IMPORT_MAX_CHARS);
  assert.equal(cleanUrl("monblog.fr/poulet?p=12"), "https://monblog.fr/poulet?p=12");
  assert.equal(cleanUrl(""), null);
  assert.ok(estimateImportUsd(CAPTION.length) < 0.01, "un import coûte moins d'un centime");
});

test("recette correcte : importée « à essayer », lien en source, rien à relire", async () => {
  const db = freshDb();
  const units = importBatchUnits(householdMembers(db));
  assert.equal(units, 45);
  const fake = fakeClient(() => goodRecipe(units));
  setAiClient(fake.client);
  process.env.AI_MONTHLY_CAP_USD = "30";
  try {
    const p = await proposeImport(db, { text: CAPTION, url: URL_IG }, { resolve: offline });
    assert.equal(fake.calls(), 1);
    assert.deepEqual(p.review, []);
    assert.equal(p.source, "https://www.instagram.com/p/ABC123/");
    assert.equal(p.draft.kcalUnit, null, "la nutrition est recalculée en code");
    const call = db.select().from(aiCalls).all();
    assert.equal(call.length, 1);
    assert.equal(call[0].screen, "importer");
    assert.equal(importQuota(db).used, 1);

    const slug = saveDraft(db, p.draft, { origin: "import", source: p.source, review: p.review.length > 0 });
    const saved = getRecipe(db, slug)!.recipe;
    assert.equal(saved.status, "to_try");
    assert.equal(saved.source, "https://www.instagram.com/p/ABC123/");
    assert.ok(saved.tags.includes("importée"));
    assert.ok(!saved.tags.includes("à relire"));
    assert.equal(loadRecipeInput(db, slug)?.servingsUnits, 45);
  } finally {
    setAiClient(null);
  }
});

test("recette bancale : quantités douteuses signalées, enregistrée « à relire »", async () => {
  const db = freshDb();
  const fake = fakeClient(() => {
    const r = goodRecipe(45);
    // L'IA a oublié de multiplier : quantités pour 4 et 45 unités annoncées, une ligne sans quantité, un aliment inventé.
    r.ingredients = r.ingredients.map((i) => ({ ...i, grams: i.grams != null ? Math.round(i.grams / 6) : null }));
    r.ingredients[1] = { ...r.ingredients[1], grams: null, units: null };
    r.ingredients.push({ lineRaw: "50 g piment d'Espelette", item: "Piment d'Espelette", grams: 50, units: null, group: null, optional: false, pantry: false, food: "piment_espelette" });
    return r;
  });
  setAiClient(fake.client);
  try {
    const p = await proposeImport(db, { text: CAPTION, url: null }, { resolve: offline });
    assert.ok(p.review.some((w) => w.startsWith("Sans quantité")));
    assert.ok(p.review.some((w) => w.includes("g d'ingrédients par unité")));
    assert.ok(p.review.some((w) => w.includes("Piment d'Espelette")), "un id nutrition inventé est retiré et signalé");
    const slug = saveDraft(db, p.draft, { origin: "import", source: p.source, review: p.review.length > 0 });
    const saved = getRecipe(db, slug)!.recipe;
    assert.ok(saved.tags.includes("à relire"));
    assert.equal(saved.source, "Importée depuis un texte collé.");
  } finally {
    setAiClient(null);
  }
});

test("quota : au-delà de la limite du jour, refus sans appel", async () => {
  const db = freshDb();
  const fake = fakeClient(() => goodRecipe(45));
  setAiClient(fake.client);
  process.env.AI_IMPORTS_PER_DAY = "1";
  try {
    await proposeImport(db, { text: CAPTION }, { resolve: offline });
    await assert.rejects(proposeImport(db, { text: CAPTION }, { resolve: offline }), /Limite d'imports du jour atteinte \(1\)/);
    assert.equal(fake.calls(), 1);
    assert.deepEqual(importQuota(db), { used: 1, limit: 1, left: 0 });
  } finally {
    delete process.env.AI_IMPORTS_PER_DAY;
    setAiClient(null);
  }
});
