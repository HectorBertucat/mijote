import { test } from "node:test";
import assert from "node:assert/strict";
import { modeOf, planSession, validatePlan, type SessionPlan } from "@/lib/session/planner";
import { reduce, threadOf, bowlsCompletedBy, type SessionEvent } from "@/lib/session/state";
import { parseGesture, prepAhead } from "@/lib/session/gestures";
import { load, RES } from "./helpers";

const chasseur = load("chasseur-porc.json");
const forno = load("pasta-al-forno.json");
const caramel = load("porc-caramel.json");
const colombo = load("colombo-porc.json");
const saute = load("saute-minute-gingembre-miel.json");
const medaillons = load("medaillons-moutarde.json");
const paprika = load("poulet-paprika-fume-patates-douces.json");
const dahl = load("dahl-pois-casses-poulet.json");

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - 1e-6 && b0 < a1 - 1e-6;

function checkInvariants(plan: SessionPlan) {
  assert.deepEqual(plan.errors, [], plan.errors.map((e) => e.message).join("\n"));
  assert.deepEqual(validatePlan(plan, RES), []);
  // Une seule personne (ou chaque personne, à deux) : les moments « mains » ne se chevauchent pas.
  const act = plan.steps.filter((s) => s.hands?.length);
  const same = (a: (typeof act)[number], b: (typeof act)[number]) => (a.person ?? "A") === (b.person ?? "A");
  for (let i = 0; i < act.length; i++)
    for (let j = i + 1; j < act.length; j++)
      if (same(act[i], act[j])) for (const [a0, a1] of act[i].hands!) for (const [b0, b1] of act[j].hands!) assert.ok(!overlaps(a0, a1, b0, b1), `${act[i].id} et ${act[j].id} en même temps`);
  // L'ordre de chaque recette est respecté (un à-côté « pendant le braisage » ou une cuisson de base, le riz, ne retient pas le fil principal).
  const side = (t: string) => /\bpendant (?:le|la|les|l'|que|ce)\b/i.test(t);
  for (const r of plan.recipes) {
    const mine = plan.steps.filter((s) => s.recipeSlug === r.slug && !s.tasks && !s.base).sort((a, b) => a.order - b.order);
    for (let i = 1; i < mine.length; i++) {
      const prev = [...mine.slice(0, i)].reverse().find((p) => !side(p.text)) ?? mine[i - 1];
      assert.ok(mine[i].startMin >= prev.startMin, `${mine[i].id} avant ${prev.id}`);
    }
  }
  // Seul, gestes glissés dans la cuisson : le bol est fini avant l'étape qui s'en sert.
  for (const g of plan.steps.filter((s) => s.tasks)) {
    for (const l of g.bowls) {
      const user = plan.steps.find((s) => !s.tasks && s.bowls.includes(l));
      if (user) assert.ok(g.endMin <= user.startMin + 1e-6, `${g.id} finit après ${user.id}`);
    }
  }
  // Numéros du fil dans l'ordre des heures.
  plan.steps.forEach((s, i) => {
    assert.equal(s.no, i + 1);
    if (i) assert.ok(s.startMin >= plan.steps[i - 1].startMin);
  });
}

test("chasseur + forno : un plan qui tient, four à 160 puis 200 °C sans chevauchement", () => {
  const plan = planSession([chasseur, forno], RES, { braiseOnHob: false });
  checkInvariants(plan);
  const ch = plan.steps.filter((s) => s.recipeSlug === chasseur.slug && s.oven);
  const fo = plan.steps.filter((s) => s.recipeSlug === forno.slug && s.oven);
  assert.ok(ch.length >= 2 && fo.length === 2);
  assert.ok(ch.every((s) => s.oven!.temp === 160) && fo.every((s) => s.oven!.temp === 200));
  const chEnd = Math.max(...ch.map((s) => s.oven!.untilMin));
  const foStart = Math.min(...fo.map((s) => s.oven!.preheatFromMin));
  const chStart = Math.min(...ch.map((s) => s.oven!.preheatFromMin));
  const foEnd = Math.max(...fo.map((s) => s.oven!.untilMin));
  assert.ok(foStart >= chEnd - 1e-6 || chStart >= foEnd - 1e-6, "les deux températures s'enchaînent");
  // Un préchauffage à 200 °C est prévu dans le fil.
  assert.ok(plan.steps.some((s) => s.kind === "preheat" && s.text.includes("200")));
  // Le braisage passe 4 min sur le grand foyer, puis au four.
  const braise = plan.steps.find((s) => s.id === `${chasseur.slug}#7`)!;
  assert.equal(braise.hobId, "hob-28");
  assert.equal(braise.hobUntilMin! - braise.startMin, 4);
  assert.equal(braise.oven!.fromMin, braise.hobUntilMin);
  // Champignons « pendant le braisage » : en parallèle, sur le foyer moyen.
  const champi = plan.steps.find((s) => s.id === `${chasseur.slug}#8`)!;
  assert.ok(champi.startMin < braise.endMin);
  assert.equal(champi.hobId, "hob-21");
  // Poêle : 3 fournées de 500 g pour 1,5 kg de sauté.
  assert.equal(plan.steps.find((s) => s.id === `${chasseur.slug}#4`)!.batches, 3);
  // En parallèle, c'est plus court que tout à la suite.
  const sequential = plan.steps.reduce((s, x) => s + (x.kind === "preheat" ? 0 : x.durationMin), 0);
  assert.ok(plan.cookingMin < sequential * 0.8, `${plan.cookingMin} vs ${sequential}`);
  assert.ok(plan.totalMin > plan.prep.minutes);
});

test("bols re-lettrés sur la session, couleur par recette, « sert à l'étape N »", () => {
  const plan = planSession([chasseur, forno], RES);
  const letters = plan.bowls.map((b) => b.letter);
  assert.equal(new Set(letters).size, letters.length);
  assert.deepEqual(letters.slice(0, 3), ["A", "B", "C"]);
  const chColor = plan.recipes[0].color;
  const foColor = plan.recipes[1].color;
  assert.notEqual(chColor, foColor);
  assert.ok(plan.bowls.filter((b) => b.recipeSlug === chasseur.slug).every((b) => b.color === chColor));
  // Les bols de forno suivent ceux du chasseur (8 bols : A à H).
  const foA = plan.bowls.find((b) => b.recipeSlug === forno.slug && b.original === "A")!;
  assert.equal(foA.letter, "I");
  // Le texte de l'étape parle du nouveau bol.
  const saucisse = plan.steps.find((s) => s.id === `${forno.slug}#3`)!;
  const foC = plan.bowls.find((b) => b.recipeSlug === forno.slug && b.original === "C")!;
  assert.ok(saucisse.text.includes(`(bol ${foC.letter})`), saucisse.text);
  assert.deepEqual(saucisse.bowls, [foC.letter]);
  // Bol B du chasseur (échalotes) sert à l'étape de la cocotte.
  const chB = plan.bowls.find((b) => b.recipeSlug === chasseur.slug && b.original === "B")!;
  assert.equal(chB.usedBy!.stepId, `${chasseur.slug}#6`);
  assert.equal(chB.usedBy!.no, plan.steps.find((s) => s.id === `${chasseur.slug}#6`)!.no);
  assert.ok(chB.items.some((i) => i.item.startsWith("Échalotes") && i.qty === "4 · 120 g"));
});

test("prep : les oignons et l'ail des deux recettes se coupent d'un coup", () => {
  const plan = planSession([chasseur, forno], RES, { interleave: false });
  const oignons = plan.prep.tasks.find((t) => t.id === "cut-oignon")!;
  assert.equal(oignons.items.length, 2);
  assert.deepEqual(oignons.items.map((i) => i.recipeSlug).sort(), [chasseur.slug, forno.slug].sort());
  assert.equal(oignons.total, "3 · 450 g");
  const ail = plan.prep.tasks.find((t) => t.id === "cut-ail")!;
  assert.equal(ail.total, "8");
  // La viande se coupe après les légumes.
  const ids = plan.prep.tasks.map((t) => t.id);
  assert.ok(ids.indexOf("cut-filet_poulet") > ids.indexOf("cut-oignon"));
  // Le geste « tamponner le sauté » (prep sans bol) est gardé.
  assert.ok(plan.prep.tasks.some((t) => t.kind === "other" && t.text?.startsWith("Tamponne")));
  assert.ok(plan.prep.minutes >= 44);
  const oven = planSession([chasseur, forno], RES, { braiseOnHob: false, interleave: false });
  assert.ok(oven.prep.notes.some((n) => n.includes("160")) || oven.steps.some((s) => s.kind === "preheat" && s.text.includes("160")));
});

test("gestes lus dans le nom de l'ingrédient", () => {
  assert.deepEqual(parseGesture("Oignons, émincés"), { base: "Oignons", gesture: "émincés" });
  assert.deepEqual(parseGesture("Échine de porc en cubes de 4 cm"), { base: "Échine de porc", gesture: "en cubes de 4 cm" });
  assert.deepEqual(parseGesture("Râpé (moitié dans la ricotta, moitié dessus)"), { base: "Râpé", gesture: null });
  assert.deepEqual(parseGesture("Thym, 2 feuilles de laurier"), { base: "Thym", gesture: null });
});

test("caramel + colombo : une seule cocotte, les deux recettes se la passent", () => {
  // Sans rechange dans la fiche du colombo.
  const strict = { ...colombo, steps: colombo.steps.map((s) => ({ ...s, equipmentAlt: null })) };
  const plan = planSession([caramel, strict], RES);
  checkInvariants(plan);
  const coc = plan.steps.filter((s) => s.equipmentId === "cocotte");
  const span = (slug: string) => {
    const m = coc.filter((s) => s.recipeSlug === slug);
    return [Math.min(...m.map((s) => s.startMin)), Math.max(...m.map((s) => s.endMin))];
  };
  const [a0, a1] = span(caramel.slug);
  const [b0, b1] = span(colombo.slug);
  assert.ok(!overlaps(a0, a1, b0, b1));
  assert.ok(coc.some((s) => s.notes.some((n) => n.includes("Rince"))));
});

test("récipient de rechange : le colombo mijote au faitout quand la cocotte sert au caramel, et le plan le dit", () => {
  const strict = { ...colombo, steps: colombo.steps.map((s) => ({ ...s, equipmentAlt: null })) };
  for (const mode of ["solo", "duo"] as const) {
    const without = planSession([caramel, strict], RES, { mode });
    const plan = planSession([caramel, colombo], RES, { mode });
    checkInvariants(plan);
    assert.ok(plan.totalMin < without.totalMin - 30, `${mode} : ${plan.totalMin} vs ${without.totalMin}`);
    const co = plan.steps.filter((s) => s.recipeSlug === colombo.slug && s.equipmentId);
    assert.ok(co.some((s) => s.equipmentId === "faitout") && !co.some((s) => s.equipmentId === "cocotte"));
    assert.match(plan.decisions?.[0] ?? "", /Colombo de porc se fait dans le faitout au lieu de la cocotte \(la cocotte sert à : Porc au caramel/);
    const first = co.find((s) => s.order === 3)!;
    assert.match(first.text, /^Faitout préchauffé vide/);
  }
  // Seul dans la session, le colombo garde sa cocotte.
  assert.ok(planSession([colombo], RES).steps.some((s) => s.equipmentId === "cocotte"));
});

test("seul : des gestes de prep se glissent dans les temps morts, la session raccourcit", () => {
  const before = planSession([chasseur, dahl], RES, { interleave: false });
  const plan = planSession([chasseur, dahl], RES);
  checkInvariants(plan);
  // Glisser ne rallonge jamais ; depuis que les mijotés se surveillent au lieu d'occuper les mains (01/11/2026),
  // le plan sans gestes glissés est déjà plus court qu'avant ; glisser gagne encore.
  assert.ok(plan.totalMin < before.totalMin - 5, `${plan.totalMin} vs ${before.totalMin}`);
  const colombo2 = [planSession([chasseur, colombo], RES), planSession([chasseur, colombo], RES, { interleave: false })];
  assert.ok(colombo2[0].totalMin <= colombo2[1].totalMin + 1e-6 && colombo2[0].totalMin <= 240, `${colombo2[0].totalMin} vs ${colombo2[1].totalMin}`);
  // La poêle préchauffée à vide n'attend pas qu'un geste finisse : la saisie suit le préchauffage.
  for (const p of [plan, planSession([chasseur, forno], RES), planSession([chasseur, forno], RES, { mode: "duo" })]) {
    const pre = p.steps.find((s) => s.id === `${chasseur.slug}#3`)!;
    const sear = p.steps.find((s) => s.id === `${chasseur.slug}#4`)!;
    assert.equal(sear.startMin, pre.endMin);
  }
  const gestes = plan.steps.filter((s) => s.tasks);
  assert.ok(gestes.length > 0);
  for (const g of gestes) {
    assert.equal(g.kind, "prep");
    assert.ok(g.id.startsWith("geste:"));
    assert.match(g.text, /^Pendant que ça cuit/);
    // Un moment d'au moins 5 min, un geste par sous-étape chronométrée.
    assert.ok(g.durationMin >= 5 - 1e-6, `${g.id} : ${g.durationMin} min`);
    assert.equal(g.phases!.length, g.tasks!.length);
    assert.deepEqual(g.phases!.map((p) => p.min), g.tasks!.map((t) => t.minutes));
    for (const t of g.tasks!) assert.ok(!plan.prep.tasks.some((x) => x.id === t.id), "le geste n'est plus dans la prep");
  }
  assert.ok(plan.prep.tasks.every((t) => t.kind !== "weigh"), "seul, la pesée reste dans les bols");
  assert.ok(plan.bowls.some((b) => b.during?.length));
  assert.ok(plan.prep.notes.some((n) => n.includes("pendant la cuisson")));
  // Total = prep (avant la cuisson) + fil.
  assert.equal(plan.totalMin, plan.prep.minutes + plan.cookingMin);
});

test("4 recettes : le plan tient et se termine", () => {
  const plan = planSession([chasseur, forno, saute, medaillons], RES);
  checkInvariants(plan);
  assert.equal(new Set(plan.recipes.map((r) => r.color)).size, 4);
});

test("erreurs explicites : four à deux températures, foyer incompatible, deux récipients sur un foyer", () => {
  const plan = planSession([chasseur, forno], RES, { braiseOnHob: false });
  const bad = structuredClone(plan);
  // Le forno au four en même temps que le chasseur.
  const ch = bad.steps.find((s) => s.id === `${chasseur.slug}#7`)!;
  const fo = bad.steps.find((s) => s.id === `${forno.slug}#7`)!;
  fo.oven = { ...fo.oven!, fromMin: ch.oven!.fromMin, untilMin: ch.oven!.fromMin + 25, preheatFromMin: ch.oven!.fromMin };
  // Le faitout et la cocotte sur le grand foyer en même temps.
  const pates = bad.steps.find((s) => s.id === `${forno.slug}#2`)!;
  pates.hobId = "hob-28";
  pates.startMin = ch.startMin;
  pates.hobUntilMin = ch.startMin + 18;
  pates.endMin = ch.startMin + 18;
  // La cocotte sur le petit foyer.
  const coc = bad.steps.find((s) => s.id === `${chasseur.slug}#12`)!;
  coc.hobId = "hob-14";
  const issues = validatePlan(bad, RES);
  const kinds = new Set(issues.map((i) => i.kind));
  assert.ok(kinds.has("oven_temp"), JSON.stringify(issues));
  assert.ok(kinds.has("hob_shared"));
  assert.ok(kinds.has("hob_fit"));
  const oven = issues.find((i) => i.kind === "oven_temp")!;
  assert.match(oven.message, /160 °C .* 200 °C|200 °C .* 160 °C/);
  assert.match(issues.find((i) => i.kind === "hob_fit")!.message, /Cocotte ne va pas sur le petit foyer/);
});

test("foyer imposé incompatible : erreur du planificateur", () => {
  const r = structuredClone(saute);
  r.steps[0] = { ...r.steps[0], hobId: "hob-28" }; // petite casserole : petit foyer seulement
  const plan = planSession([r], RES);
  const e = plan.errors.find((x) => x.kind === "hob_fit");
  assert.ok(e, JSON.stringify(plan.errors));
  assert.match(e.message, /Petite casserole ne va pas sur le grand foyer/);
});

test("ingrédients commandés : produit dans le bol, manque signalé, réduction au prorata", () => {
  const sauté = chasseur.ingredients.find((i) => i.foodId === "saute_porc")!;
  const champi = chasseur.ingredients.find((i) => i.foodId === "champignon")!;
  const plan = planSession([chasseur, forno], RES, {
    ordered: [
      { recipeIngredientId: sauté.id!, productName: "Sauté de porc LR", brand: "Auchan", packLabel: "500 g", packs: 3, gramsBought: 1500, gramsNeeded: 2000 },
      { recipeIngredientId: champi.id!, productName: "Champignons de Paris", brand: null, packLabel: "500 g", packs: 2, gramsBought: 1000, gramsNeeded: 1000 },
    ],
  });
  const bowlA = plan.bowls.find((b) => b.recipeSlug === chasseur.slug && b.original === "A")!;
  assert.equal(bowlA.items[0].ordered, "2 × Champignons de Paris 500 g");
  assert.equal(plan.shortages.length, 1);
  assert.equal(plan.shortages[0].ratio, 0.75);
  assert.deepEqual(plan.scaleSuggestions, [{ recipeSlug: chasseur.slug, factor: 0.75 }]);
  // Sans commande : rien de signalé.
  assert.deepEqual(planSession([chasseur], RES).shortages, []);
  // Recette réduite : quantités des bols à l'échelle.
  const small = planSession([{ ...chasseur, scale: 0.5 }], RES);
  assert.equal(small.bowls[0].items[0].qty, "500 g");
});

// ─── Étape 7 : modes de session ───

test("braisage au four qui continue : la cocotte reste au four, sans nouveau préchauffage (défaut vu en prod)", () => {
  const plan = planSession([chasseur, forno], RES, { braiseOnHob: false });
  checkInvariants(plan);
  const braise = plan.steps.find((s) => s.id === `${chasseur.slug}#7`)!;
  const champi = plan.steps.find((s) => s.id === `${chasseur.slug}#10`)!;
  assert.equal(champi.hobId, null, "on ne sort pas la cocotte");
  assert.equal(champi.oven!.preheatFromMin, champi.oven!.fromMin, "pas de préchauffage pour « ajoute les champignons »");
  assert.ok(braise.oven!.untilMin >= champi.oven!.fromMin - 1e-6, "le four reste à 160 °C entre les deux");
  // Un seul préchauffage à 160 °C (pendant la prep ou dans le fil).
  const pre160 = plan.steps.filter((s) => s.kind === "preheat" && s.text.includes("160")).length + plan.prep.notes.filter((n) => n.includes("160")).length;
  assert.equal(pre160, 1);
  // Et le braisage n'attend plus le riz : les champignons arrivent à 1 h de braisage.
  assert.equal(champi.startMin, braise.endMin);
});

test("braiser sur la plaque : chasseur + paprika, le four reste à 220 °C pour le paprika, et le plan le dit", () => {
  const oven = planSession([chasseur, paprika], RES, { braiseOnHob: false });
  const plan = planSession([chasseur, paprika], RES);
  checkInvariants(plan);
  assert.ok(plan.totalMin < oven.totalMin, `${plan.totalMin} vs ${oven.totalMin}`);
  assert.match(plan.decisions?.[0] ?? "", /Chasseur de porc braise sur la plaque .* niveau 2-3/);
  const braise = plan.steps.find((s) => s.id === `${chasseur.slug}#7`)!;
  const champi = plan.steps.find((s) => s.id === `${chasseur.slug}#10`)!;
  assert.equal(braise.oven, null);
  assert.equal(braise.hobId, "hob-28");
  assert.equal(braise.hobLevelLabel, "8 puis 2-3");
  assert.equal(champi.hobId, "hob-28", "même foyer, la cocotte ne bouge pas");
  assert.ok(braise.hobUntilMin! >= champi.startMin - 1e-6);
  assert.ok(braise.notes.some((n) => n.includes("couvercle")));
  assert.ok(plan.steps.filter((s) => s.oven).every((s) => s.oven!.temp === 220));
  // À deux, chasseur + forno : le four reste à 200 °C pour le forno.
  const duo = planSession([chasseur, forno], RES, { mode: "duo" });
  assert.match(duo.decisions?.[0] ?? "", /Chasseur de porc braise sur la plaque/);
  assert.ok(duo.steps.filter((s) => s.oven).every((s) => s.oven!.temp === 200));
  // Une seule recette au four : pas de braisage sur la plaque à décider.
  assert.ok(!(planSession([chasseur], RES).decisions ?? []).some((d) => d.includes("braise")));
});

test("à deux : chasseur + forno nettement plus court que seul, sans conflit de ressource", () => {
  const solo = planSession([chasseur, forno], RES);
  const soloOven = planSession([chasseur, forno], RES, { braiseOnHob: false, interleave: false });
  const duo = planSession([chasseur, forno], RES, { mode: "duo" });
  checkInvariants(duo);
  assert.deepEqual(duo.persons, ["A", "B"]);
  // Cible d'Alex : autour de 2 h 15 - 2 h 45 (seul : plus de 3 h 30).
  assert.ok(duo.totalMin >= 120 && duo.totalMin <= 175, `à deux : ${duo.totalMin} min`);
  assert.ok(duo.totalMin <= solo.totalMin * 0.8, `${duo.totalMin} vs seul ${solo.totalMin}`);
  assert.ok(soloOven.totalMin > 225, `seul, four seulement : ${soloOven.totalMin}`);
  // Démarrage ensemble : A et B ont chacun quelque chose à t = 0.
  const tasks = duo.prep.tasks;
  for (const p of ["A", "B"] as const) assert.ok(tasks.some((t) => t.person === p && t.startMin === 0), `${p} commence à 0`);
  assert.ok(tasks.every((t) => t.person && t.startMin != null && t.endMin != null));
  assert.ok(duo.steps.every((s) => s.person === "A" || s.person === "B"));
  // Gestes : un grand couteau et une planche chacun ; jamais le même en même temps ; la seconde planche sert.
  const cut = tasks.filter((t) => t.kind === "cut");
  assert.ok(cut.every((t) => t.tools?.length === 2 && t.tools.some((x) => x.startsWith("Grand couteau")) && t.tools.some((x) => /planche/i.test(x))));
  assert.ok(cut.some((t) => t.tools!.includes("Seconde planche")));
  for (let i = 0; i < cut.length; i++)
    for (let j = i + 1; j < cut.length; j++) {
      const a = cut[i];
      const b = cut[j];
      if (overlaps(a.startMin!, a.endMin!, b.startMin!, b.endMin!)) {
        assert.notEqual(a.person, b.person);
        assert.deepEqual(a.tools!.filter((x) => b.tools!.includes(x)), [], `${a.id} et ${b.id}`);
      }
    }
  // Chaque personne : une chose à la fois, prep et cuisson confondues.
  for (const p of ["A", "B"] as const) {
    const busy = [
      ...tasks.filter((t) => t.person === p).map((t) => [t.startMin!, t.endMin!, t.id] as const),
      ...duo.steps.filter((s) => s.person === p).flatMap((s) => (s.hands ?? []).map(([a, b]) => [a, b, s.id] as const)),
    ];
    for (let i = 0; i < busy.length; i++)
      for (let j = i + 1; j < busy.length; j++) assert.ok(!overlaps(busy[i][0], busy[i][1], busy[j][0], busy[j][1]), `${p} : ${busy[i][2]} et ${busy[j][2]}`);
  }
  // Une étape attend les gestes qui remplissent ses bols.
  for (const s of duo.steps)
    for (const l of s.bowls) {
      const b = duo.bowls.find((x) => x.letter === l)!;
      for (const id of b.tasks ?? []) assert.ok(tasks.find((t) => t.id === id)!.endMin! <= s.startMin + 1e-6, `${s.id} avant ${id}`);
    }
  // Le sauté se tamponne avant la saisie.
  const tamponne = tasks.find((t) => t.kind === "other" && t.recipeSlug === chasseur.slug)!;
  assert.ok(tamponne.endMin! <= duo.steps.find((s) => s.id === `${chasseur.slug}#3`)!.startMin + 1e-6);
  // Passages de relais explicites quand un récipient change de mains.
  assert.ok((duo.handoffs ?? []).length > 0);
  for (const h of duo.handoffs!) {
    assert.match(h.text, /^[AB] libère (la|le|l') .+ pour [AB]$/);
    assert.notEqual(h.from, h.to);
    assert.ok(duo.steps.find((s) => s.id === h.toStepId)!.notes.some((n) => n.includes(h.text)));
  }
  // Aucune erreur de validation (personnes et ustensiles compris).
  assert.deepEqual(validatePlan(duo, RES), []);
});

test("à deux : validatePlan voit une personne à deux endroits et un ustensile pris deux fois", () => {
  const duo = structuredClone(planSession([chasseur, forno], RES, { mode: "duo" }));
  const [a, b] = duo.prep.tasks.filter((t) => t.kind === "cut");
  b.person = a.person;
  b.startMin = a.startMin;
  b.endMin = a.startMin! + b.minutes;
  b.tools = [...a.tools!];
  const kinds = new Set(validatePlan(duo, RES).map((i) => i.kind));
  assert.ok(kinds.has("person_busy"));
  assert.ok(kinds.has("tool_shared"));
});

test("seul : pas de seconde planche, pas de personne", () => {
  const plan = planSession([chasseur, forno], RES);
  assert.equal(modeOf(plan), "solo");
  assert.ok(plan.prep.tasks.every((t) => !t.tools && !t.person));
  assert.ok(plan.steps.every((s) => s.person === undefined));
  // Un plan d'avant l'étape 7 (sans mode) se lit en mode seul.
  const old = structuredClone(plan) as Partial<SessionPlan>;
  delete old.mode;
  assert.equal(modeOf(old), "solo");
});

test("prep la veille : ce qui se prépare la veille, ce qui attend le jour même", () => {
  const ing = (item: string, foodId: string | null, pantry = false) => prepAhead({ item, foodId, pantry }, parseGesture(item).gesture);
  assert.equal(ing("Courgettes (1 kg), râpées et pressées", "courgette").eve, false);
  assert.equal(ing("Champignons de Paris frais, en quartiers", "champignon").eve, false);
  assert.equal(ing("Persil, ciselé (à la fin)", "persil").eve, false);
  assert.equal(ing("Rigatoni Rummo n°51 (400 g sur 500)", "pates").eve, false);
  assert.equal(ing("Riz basmati (à part)", "riz_basmati", true).eve, false);
  assert.equal(ing("Oignons, émincés", "oignon").eve, true);
  assert.equal(ing("Ail, haché", "ail").eve, true);
  assert.equal(ing("Filets de poulet (la barquette de 600 g), en dés de 2 cm", "filet_poulet").eve, true);
  assert.match(ing("Saucisse de Toulouse, sortie du boyau, en morceaux", "saucisse_toulouse").reason, /boyau/);
  assert.equal(ing("Ricotta (2 × 250 g)", "ricotta").eve, true);
  assert.match(ing("Pulpe de tomate (3 boîtes de 400 g)", "pulpe_tomate").reason, /placard/);
  assert.equal(ing("Cube de volaille dans 300 ml d'eau chaude", "bouillon_cube", true).eve, true);

  const plan = planSession([chasseur, forno], RES, { mode: "veille" });
  checkInvariants(plan);
  assert.equal(plan.mode, "veille");
  const bowl = (slug: string, original: string) => plan.bowls.find((b) => b.recipeSlug === slug && b.original === original)!;
  assert.equal(bowl(forno.slug, "C").fridge, true, "saucisse au frigo");
  assert.equal(bowl(forno.slug, "E").fridge, true, "ricotta + râpé au frigo");
  assert.equal(bowl(forno.slug, "B").fridge, false, "courgettes le jour même");
  assert.equal(bowl(chasseur.slug, "A").fridge, false, "champignons le jour même");
  assert.equal(bowl(chasseur.slug, "B").fridge, true, "échalotes, oignon, ail au frigo");
  assert.equal(bowl(chasseur.slug, "G").fridge, false, "riz le jour même");
  const task = (id: string) => plan.prep.tasks.find((t) => t.id === id)!;
  assert.equal(task("cut-oignon").eve, true);
  assert.equal(task("cut-courgette").eve, false);
  assert.equal(task("cut-champignon").eve, false);
  assert.equal(task(`other-${chasseur.slug}-2`).eve, false, "le sauté se tamponne juste avant la saisie");
  // La prep se partage entre la veille et le jour même ; le jour même est plus court que seul (prep d'abord).
  const solo = planSession([chasseur, forno], RES, { interleave: false });
  assert.ok(plan.prep.eveMin! > 0 && plan.prep.minutes > 0);
  assert.equal(plan.prep.eveMin! + plan.prep.minutes, solo.prep.minutes);
  assert.ok(plan.totalMin < solo.totalMin);
  assert.equal(plan.cookingMin, solo.cookingMin);
});

// ─── Prep la veille, puis à deux le jour J ───

/** Le journal d'une soirée « prep la veille » : chaque bol du frigo coché, puis « C'est au frigo ». */
function eveJournal(plan: SessionPlan, skip: string[] = []): SessionEvent[] {
  let t = Date.parse("2026-10-24T17:00:00Z");
  const at = () => new Date((t += 4 * 60000)).toISOString();
  const evs: SessionEvent[] = plan.bowls
    .filter((b) => b.fridge && !skip.includes(b.letter))
    .map((b) => ({ id: `b-${b.letter}`, at: at(), kind: "bowl_ready", ref: b.letter, payload: { ready: true } }));
  evs.push({ id: "fridge", at: at(), kind: "note", ref: null, payload: { status: "fridge" } });
  return evs;
}

test("prep la veille puis à deux : chasseur + forno, le jour J refait à deux avec les bols du frigo", () => {
  const veille = planSession([chasseur, forno], RES, { mode: "veille" });
  const evs = eveJournal(veille);
  const st = reduce("prep", evs);
  const day = planSession([chasseur, forno], RES, { mode: "duo", eve: { doneTasks: [...st.prepDone], readyBowls: [...st.bowlsReady] } });
  checkInvariants(day);
  assert.equal(modeOf(day), "duo");
  assert.deepEqual(day.persons, ["A", "B"]);
  // Le journal de la veille reste valable : mêmes lettres de bol, mêmes ids d'étape.
  assert.deepEqual(day.bowls.map((b) => [b.letter, b.recipeSlug, b.original]), veille.bowls.map((b) => [b.letter, b.recipeSlug, b.original]));
  assert.deepEqual(day.steps.map((s) => s.id).filter((id) => !id.startsWith("four")).sort(), veille.steps.map((s) => s.id).filter((id) => !id.startsWith("four")).sort());
  // La soirée : ses gestes sont faits, ses bols au frigo et sans tâche.
  const eveIds = veille.prep.tasks.filter((t) => t.eve).map((t) => t.id).sort();
  assert.deepEqual(day.eve!.tasks.map((t) => t.id).sort(), eveIds);
  assert.deepEqual(day.eve!.bowls.sort(), veille.bowls.filter((b) => b.fridge).map((b) => b.letter).sort());
  assert.ok(day.eve!.minutes > 0);
  for (const l of day.eve!.bowls) {
    const b = day.bowls.find((x) => x.letter === l)!;
    assert.equal(b.fridge, true);
    assert.equal(b.tasks, undefined, `bol ${l} : rien à refaire`);
  }
  // Le jour J : seulement ce qui ne se fait pas la veille, chaque geste a sa personne et son heure.
  assert.ok(day.prep.tasks.every((t) => !eveIds.includes(t.id)));
  assert.ok(day.prep.tasks.every((t) => t.person && t.startMin != null));
  const cut = day.prep.tasks.filter((t) => t.kind === "cut").map((t) => t.id);
  assert.ok(cut.includes("cut-champignon") && cut.includes("cut-courgette"));
  assert.ok(!cut.includes("cut-oignon-veille") && !cut.includes("cut-oignon"));
  assert.ok(day.prep.tasks.every((t) => !(t.kind === "weigh" && day.eve!.bowls.includes(t.bowls![0]))), "pas de pesée pour un bol du frigo");
  // Démarrage ensemble, une chose à la fois par personne, outils jamais partagés en même temps.
  for (const p of ["A", "B"] as const) assert.ok(threadOf(day, p)[0].startMin === 0, `${p} commence à 0`);
  assert.deepEqual(validatePlan(day, RES), []);
  // Plus court que le jour J seul et qu'une session à deux complète.
  const duo = planSession([chasseur, forno], RES, { mode: "duo" });
  assert.ok(day.totalMin < veille.totalMin, `${day.totalMin} vs seul ${veille.totalMin}`);
  assert.ok(day.totalMin <= duo.totalMin, `${day.totalMin} vs à deux sans veille ${duo.totalMin}`);
  assert.ok(day.prep.minutes < duo.prep.minutes);
  // Braiser sur la plaque reste proposé, et les relais sont explicites.
  assert.match(day.decisions?.[0] ?? "", /braise sur la plaque/);
  assert.ok((day.handoffs ?? []).length > 0);
  for (const h of day.handoffs!) assert.ok(day.steps.find((s) => s.id === h.toStepId)!.notes.some((n) => n.includes(h.text)));
  // Les étapes qui prennent un bol du frigo n'attendent aucun geste.
  const coc = day.steps.find((s) => s.bowls.includes(day.bowls.find((b) => b.recipeSlug === chasseur.slug && b.original === "B")!.letter))!;
  assert.ok(coc);
  // Le journal rejoue : les bols de la veille sont prêts, et un « Fait » de B s'ajoute.
  const firstB = threadOf(day, "B").find((it) => it.type === "prep")!;
  const later: SessionEvent[] = [
    ...evs,
    { id: "resume", at: "2026-10-25T09:00:00Z", kind: "note", ref: null, payload: { status: "prep", resume: true, dayMode: "duo", replan: true } },
    { id: "go", at: "2026-10-25T09:01:00Z", kind: "note", ref: null, payload: { status: "cooking" } },
    { id: "b1", at: "2026-10-25T09:06:00Z", kind: "step_done", ref: firstB.id, payload: { person: "B" } },
  ];
  const s2 = reduce("fridge", later);
  assert.equal(s2.status, "cooking");
  assert.ok(day.eve!.bowls.every((l) => s2.bowlsReady.has(l)));
  assert.ok(s2.prepDone.has(firstB.id.slice(5)));
  // Un bol du frigo n'est jamais « complété » par un geste du jour J.
  assert.ok(bowlsCompletedBy(day, s2.prepDone).every((l) => !day.eve!.bowls.includes(l)));
});

test("prep la veille puis à deux : un bol pas coché la veille se refait le jour J", () => {
  const veille = planSession([chasseur, forno], RES, { mode: "veille" });
  const echalotes = veille.bowls.find((b) => b.recipeSlug === chasseur.slug && b.original === "B")!;
  const st = reduce("prep", eveJournal(veille, [echalotes.letter]));
  const day = planSession([chasseur, forno], RES, { mode: "duo", eve: { doneTasks: [...st.prepDone], readyBowls: [...st.bowlsReady] } });
  checkInvariants(day);
  const b = day.bowls.find((x) => x.letter === echalotes.letter)!;
  assert.equal(b.fridge, false);
  assert.ok(!day.eve!.bowls.includes(echalotes.letter));
  // Les échalotes ne remplissent que ce bol : à refaire, avec leur pesée, avant l'étape qui le prend.
  const ech = day.prep.tasks.find((t) => t.kind === "cut" && t.items.every((i) => i.bowl === echalotes.letter))!;
  assert.ok(ech, "geste des échalotes au jour J");
  assert.match(ech.eveReason ?? "", /pas fait la veille/);
  assert.ok(b.tasks!.includes(ech.id));
  const step = day.steps.find((s) => s.id === echalotes.usedBy!.stepId)!;
  for (const id of b.tasks!) assert.ok(day.prep.tasks.find((t) => t.id === id)!.endMin! <= step.startMin + 1e-6);
});
