// Vérification de l'IA en vrai (appels payants, quelques dizaines de centimes) : chaque fonction IA
// de Mijote appelée une fois sur une base jetable, et sa sortie contrôlée comme le fait l'appli.
//   ANTHROPIC_API_KEY=… pnpm test:ai            (toutes les fonctions)
//   ANTHROPIC_API_KEY=… pnpm test:ai programme  (une seule : ajuster, atelier, creer, coach, programme, dessins, estimation)
// Sans catalogue relié : les ingrédients ne sont pas vérifiés au drive (c'est le mode par défaut).
import assert from "node:assert/strict";
import path from "path";
import { openDb } from "@/lib/db/open";
import { aiCalls } from "@/lib/db/schema";
import { proposeAdjustment, proposeCreation } from "@/lib/atelier";
import { composeProposals, refineProposal, startCreation } from "@/lib/creation";
import { askCoach } from "@/lib/health/coach";
import { estimateMeal } from "@/lib/health/estimate";
import { getPerson } from "@/lib/health/store";
import { addPerson } from "@/lib/household";
import { drawFoods } from "@/lib/illus/ai";
import { computeNutrition } from "@/lib/nutrition/compute";
import { aiProgram } from "@/lib/training/ai";
import { buildSteps } from "@/lib/training/program";
import { checkMotion } from "@/lib/training/motion-check";
import { motionOf } from "@/lib/training/figures";
import { syncRecipes } from "@/seed/bootstrap";
import { seedBase } from "@/seed/seed";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY manquante : ce script fait de vrais appels à l'API Claude.");
  process.exit(2);
}
if (process.env.MIJOTE_AI_MOCK === "1") {
  console.error("MIJOTE_AI_MOCK=1 : à retirer, ce script vérifie les vrais appels.");
  process.exit(2);
}
delete process.env.CHRONOCATALOG_URL;
process.env.AI_MONTHLY_CAP_USD = "5";

const { db } = openDb(":memory:");
seedBase(db);
syncRecipes(db, path.join(process.cwd(), "src/seed/recipes"));
const alex = addPerson(db, { name: "Alex", portionUnits: 5, sex: "m", birthDate: "1995-07-01", heightCm: 180, weightKg: 78, activity: "moderate", goal: "recomp" });
addPerson(db, { name: "Sam", portionUnits: 4, sex: "f", birthDate: "1996-07-01", heightCm: 165, weightKg: 60, activity: "light", goal: "maintain" });

const CHECKS: Record<string, () => Promise<string>> = {
  async ajuster() {
    const p = await proposeAdjustment(db, "chasseur-porc", { optionId: "moins-kcal" }, { leadId: alex });
    const before = p.verification.before!.lead.kcal;
    const after = p.verification.after.lead.kcal;
    assert.ok(p.draft.ingredients.length >= 5, "recette complète");
    assert.ok(p.draft.steps.length >= 4, "étapes");
    // Les macros sont recalculées en code depuis les grammes, jamais recopiées de l'IA.
    const n = computeNutrition(p.draft.ingredients.map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null, yield: i.yield ?? null })), p.draft.servingsUnits);
    assert.equal(after, Math.round(n.perUnit.kcal * 5));
    assert.ok(after < before, `moins de kcal demandé : ${before} → ${after}`);
    return `${p.draft.name} : ${before} → ${after} kcal pour Alex, ${p.verification.warnings.length} avertissement(s)`;
  },
  async atelier() {
    const p = await proposeCreation(db, { envie: "Un plat de lentilles corail au lait de coco, pour la semaine, végétarien", add: [], remove: [], avoid: [] }, null, { leadId: alex });
    assert.ok(p.draft.ingredients.length >= 5 && p.draft.steps.length >= 3);
    assert.ok(p.verification.after.people.length === 2, "une part par personne du foyer");
    assert.ok(p.verification.after.coverage >= 0.6, `nutrition couverte à ${Math.round(p.verification.after.coverage * 100)} %`);
    assert.ok(!p.draft.ingredients.some((i) => /porc|poulet|boeuf|bœuf/i.test(i.item)), "végétarien respecté");
    return `${p.draft.name} (${p.draft.servingsUnits} unités), ${Math.round(p.verification.after.lead.kcal)} kcal pour Alex`;
  },
  async coach() {
    const m = await askCoach(db, getPerson(db, alex)!, "Je veux perdre un peu de ventre sans perdre de muscle, je peux faire 3 séances de 30 min à la maison. Tu me proposes des objectifs ?");
    assert.ok(m.text.length > 40, "une vraie réponse");
    return `${m.text.slice(0, 90).replace(/\s+/g, " ")}…${m.proposal ? " (avec objectifs vérifiés)" : ""}`;
  },
  async programme() {
    const req = { gear: ["miniBande" as const, "chaise" as const], perWeek: 3, minutes: 30, level: 1 as const, focus: "bas" as const, notes: "Genou gauche sensible : pas de saut. J'aimerais un exercice de mollets." };
    const r = await aiProgram(db, req, { name: "Sam", sex: "f", age: 30 }, "ia-check");
    const p = r.program;
    assert.ok(Object.keys(p.sessions).length >= 2);
    for (const [k, s] of Object.entries(p.sessions)) {
      assert.ok(s.blocks.length >= 1, `séance ${k}`);
      for (const b of s.blocks) for (const x of b.items) {
        assert.ok(p.exercises[x], `${x} : fiche`);
        const m = motionOf(p, x);
        assert.ok(m, `${x} : figure`);
        assert.deepEqual(checkMotion(m!), [], `${x} : figure valide`);
      }
      assert.ok(buildSteps(p, k).some((st) => st.k === "ex"));
    }
    const invented = Object.keys(p.motions ?? {});
    return `${p.name} : ${Object.keys(p.sessions).length} séances, ${p.order.length} exercices, inventés : ${invented.join(", ") || "aucun"}${r.warnings.length ? ` ; ${r.warnings.join(" ; ")}` : ""}`;
  },
  async dessins() {
    const r = await drawFoods(db, ["Poireau", "Patate douce"]);
    assert.ok(r.saved.length >= 1, `refusés : ${r.failed.map((f) => `${f.item} (${f.errors.join(", ")})`).join(" ; ")}`);
    return `gardés : ${r.saved.map((s) => s.label).join(", ")}${r.failed.length ? ` ; refusés : ${r.failed.map((f) => f.item).join(", ")}` : ""}`;
  },
  async creer() {
    // Recherche bornée (Haiku, web), deux propositions (Sonnet), une retouche : le parcours de /atelier/creer.
    const c = await startCreation(db, "Un plat gourmand, protéiné, one pot, avec des pois chiches", { leadId: alex });
    const r = c.research!;
    assert.ok(r.sources.length >= 1, `sources : ${r.sources.length}, écartées : ${r.dropped.map((d) => d.why).join(", ")}`);
    assert.ok(r.searches <= 4, `${r.searches} recherches`);
    const after = await composeProposals(db, c.id, { leadId: alex });
    assert.equal(after.proposals.length, 2);
    for (const p of after.proposals) {
      assert.ok(p.draft.ingredients.length >= 5 && p.draft.steps.length >= 3, p.draft.name);
      assert.ok(p.figures.length === 2 && p.figures[0].kcal > 0, "une part par personne, calculée en code");
    }
    const p = after.proposals[0];
    const refined = await refineProposal(db, c.id, p.id, { ask: "Plus de sauce" }, { leadId: alex });
    const q = refined.proposals[0];
    assert.equal(q.draft.servingsUnits, p.draft.servingsUnits);
    const ko = (x: typeof p) => x.defects.filter((d) => d.level === "ko").map((d) => d.text).join(" | ") || "aucun défaut bloquant";
    return `${r.sources.length} source(s) (${r.sources.map((s) => new URL(s.url).hostname).join(", ")}), ${r.searches} recherche(s) ; ${after.proposals.map((x) => `« ${x.draft.name} » ${x.figures[0].kcal} kcal / ${x.figures[0].protein} g pour Alex (${ko(x)})`).join(" ; ")} ; retouche : ${q.asks[0].answer} ; création ${refined.costUsd.toFixed(3)} $`;
  },
  async estimation() {
    const e = await estimateMeal(db, "une assiette de pâtes carbonara et un yaourt", "Alex");
    assert.ok(e.kcal > 400 && e.kcal < 1600, `${e.kcal} kcal`);
    assert.ok(e.proteinG > 10 && e.proteinG < 90);
    return `${e.label} : ${Math.round(e.kcal)} kcal, ${Math.round(e.proteinG)} g de protéines`;
  },
};

async function main() {
  const only = process.argv.slice(2);
  const names = only.length ? only : Object.keys(CHECKS);
  let failed = 0;
  for (const name of names) {
    const run = CHECKS[name];
    if (!run) throw new Error(`Inconnu : ${name} (${Object.keys(CHECKS).join(", ")})`);
    const t0 = Date.now();
    try {
      const msg = await run();
      console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(0)} s) : ${msg}`);
    } catch (e) {
      failed++;
      console.log(`✖ ${name} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const calls = db.select().from(aiCalls).all();
  const cost = calls.reduce((s, c) => s + c.costUsd, 0);
  console.log(`\n${calls.length} appel(s), ${calls.filter((c) => !c.ok).length} en erreur, coût ${cost.toFixed(3)} $`);
  for (const c of calls) console.log(`  ${c.screen.padEnd(18)} ${c.model.padEnd(18)} ${String(c.inputTokens).padStart(6)} → ${String(c.outputTokens).padStart(5)} jetons  ${c.costUsd.toFixed(4)} $  ${((c.durationMs ?? 0) / 1000).toFixed(0)} s${c.error ? `  ${c.error}` : ""}`);
  process.exit(failed ? 1 : 0);
}

main();
