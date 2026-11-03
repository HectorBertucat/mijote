// API de l'app iPhone : la clé désigne la personne, chaque route répond, une séance se pilote par gestes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "@/lib/db/open";
import { appApi, type AppRequest } from "@/lib/app-api/core";
import { JOINT_ORDER, figureData } from "@/lib/app-api/figures";
import { GUIDE_FALLBACK, MOTIONS, guideMotion } from "@/lib/training/figures";
import { KB_TEMPLATE } from "@/lib/training/program";
import { assignProgram } from "@/lib/training/programs";
import { keyLevel } from "@/lib/training/rhythm";
import { cycleDuration } from "@/lib/training/motion";
import { ensureLink } from "@/lib/health/link";
import { seedTest } from "./helpers";

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  const alex = ensureLink(db, "alex").key;
  const sam = ensureLink(db, "sam").key;
  const call = (key: string | null, method: AppRequest["method"], path: string, body: unknown = null, now = Date.parse("2026-10-20T08:00:00Z")) => {
    const [p, q] = path.split("?");
    const headers = new Headers(key ? { "x-mijote-key": key } : {});
    return appApi(db, { method, path: p.split("/"), query: new URLSearchParams(q ?? ""), body, headers, now });
  };
  return { db, alex, sam, call };
}

test("api app : sans clé ou avec une mauvaise clé, rien", () => {
  const { call } = setup();
  assert.equal(call(null, "GET", "moi").status, 401);
  assert.equal(call("faux", "GET", "sante").status, 401);
});

test("api app : moi, santé, journal, course, chemin inconnu", () => {
  const { alex, call } = setup();
  const moi = call(alex, "GET", "moi").body as { person: { id: string }; features: string[] };
  assert.equal(moi.person.id, "alex");
  assert.ok(moi.features.includes("seance"));
  const s = call(alex, "GET", "sante?periode=3m");
  assert.equal(s.status, 200);
  assert.ok("overview" in s.body && "goals" in s.body);
  // JSON de bout en bout : ce que l'app reçoit vraiment.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s.body)));
  const j = call(alex, "GET", "jour?date=2026-10-20").body as { date: string; totals: { kcal: number } };
  assert.equal(j.date, "2026-10-20");
  assert.equal(call(alex, "GET", "course").status, 200);
  assert.deepEqual((call(alex, "GET", "course/sorties?limit=5").body as { runs: unknown[] }).runs, []);
  assert.equal(call(alex, "GET", "rien").status, 404);
});

test("api app : journal et pesée s'écrivent, une entrée d'une autre personne ne se touche pas", () => {
  const { alex, sam, call } = setup();
  const r = call(alex, "POST", "jour", { action: "libre", date: "2026-10-20", meal: "snack", label: "Pomme", kcal: 80, proteinG: 0.4 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const jour = (r.body as { jour: { entries: { id: string; label: string }[]; totals: { kcal: number } } }).jour;
  assert.equal(jour.totals.kcal, 80);
  const id = jour.entries[0].id;
  assert.equal(call(sam, "POST", "jour", { action: "retirer", date: "2026-10-20", id }).status, 404);
  assert.equal(call(alex, "POST", "jour", { action: "libre", date: "2026-10-21", meal: "snack", label: "Futur", kcal: 1, proteinG: 0 }).status, 400);
  assert.equal(call(alex, "POST", "jour", { action: "retirer", date: "2026-10-20", id }).status, 200);
  assert.equal(call(alex, "POST", "pesee", { kg: 12 }).status, 400);
  assert.equal(call(alex, "POST", "pesee", { kg: 78.4 }).status, 200);
});

test("api app : sport, figures échantillonnées, muscles, réglages du rythme", () => {
  const { alex, call } = setup();
  const s = call(alex, "GET", "sport").body as { program: { id: string; exercises: { id: string; muscles: { load: number }[] }[] }; guide: { auto: boolean } };
  assert.equal(s.program.id, "kb12");
  assert.ok(s.program.exercises.every((e) => e.muscles.some((m) => m.load === 3)));
  // La durée d'une répétition, la même que celle du site (figure de l'exercice).
  const ex = s.program.exercises as unknown as { id: string; cycle: number }[];
  assert.equal(ex.find((e) => e.id === "goblet")!.cycle, 5.4);
  const f = call(alex, "GET", "sport/figures?ex=goblet,swing").body as { figures: Record<string, { cycle: number; fps: number; frames: { j: number[]; bell?: unknown }[] }>; drawing: { body: { front: object } } };
  assert.deepEqual(Object.keys(f.figures), ["goblet", "swing"]);
  const g = f.figures.goblet;
  assert.equal(g.frames.length, Math.ceil(g.cycle * g.fps));
  assert.equal(g.frames[0].j.length, JOINT_ORDER.length * 2);
  assert.ok(g.frames[0].bell);
  assert.ok(Object.keys(f.drawing.body.front).length > 5);
  const r = call(alex, "POST", "sport/reglages", { auto: true, lead: 8 }).body as { guide: { auto: boolean; lead: number; change: number } };
  assert.deepEqual(r.guide, { auto: true, lead: 8, change: 10 });
});

test("api app : une séance se lance, se pilote par gestes à l'heure du serveur, se termine", () => {
  const { alex, sam, call } = setup();
  const t0 = Date.parse("2026-10-20T08:00:00Z");
  const start = call(alex, "POST", "sport/seance", { type: "A" }, t0).body as { live: { id: string; live: { i: number } } };
  const id = start.live.id;
  assert.equal(call(sam, "GET", `sport/seance/${id}`).status, 404, "la séance d'Alex n'est pas à Sam");
  const go = call(alex, "POST", `sport/seance/${id}/geste`, { k: "go", at: 0, n: 1 }, t0 + 1000).body as { live: { live: { i: number }; view: { exercise: { id: string }; reps: number } } };
  assert.equal(go.live.live.i, 1);
  assert.equal(go.live.view.exercise.id, "goblet");
  assert.ok(go.live.view.reps >= 12);
  // Le même geste rejoué (autre écran plus lent) ne fait rien.
  const again = call(alex, "POST", `sport/seance/${id}/geste`, { k: "go", at: 0, n: 1 }, t0 + 1100).body as { live: { live: { i: number } } };
  assert.equal(again.live.live.i, 1);
  const g = call(alex, "POST", `sport/seance/${id}/geste`, { k: "guide", at: 1, on: true }, t0 + 2000).body as { live: { live: { cur: { guide: number } } } };
  assert.equal(g.live.live.cur.guide, t0 + 2000 + 5000);
  assert.equal(call(alex, "POST", `sport/seance/${id}/geste`, { k: "inventé" }).status, 400);
  call(alex, "POST", `sport/seance/${id}/geste`, { k: "record", at: 1, ex: "goblet", set: 1, value: 15 }, t0 + 60_000);
  const cur = call(alex, "GET", "sport/seance", null, t0 + 61_000).body as { live: { id: string } };
  assert.equal(cur.live.id, id);
  const end = call(alex, "POST", `sport/seance/${id}/fin`, { note: "" }, t0 + 120_000);
  assert.equal(end.status, 200, JSON.stringify(end.body));
  assert.ok((end.body as { workoutId: string }).workoutId);
});

test("api app : l'import annonce app_v1, chaque réponse a generatedAt et pas de null", () => {
  const { alex, call } = setup();
  const r = call(alex, "GET", "sport/seance");
  assert.equal(typeof r.body.generatedAt, "string");
  assert.ok(!("live" in r.body), "pas de séance : clé absente, pas null");
  const noNull = (x: unknown): boolean => (Array.isArray(x) ? true : x && typeof x === "object" ? Object.values(x).every((v) => v !== null && noNull(v)) : true);
  assert.ok(noNull(call(alex, "GET", "sport").body));
  assert.ok(noNull(call(alex, "GET", "sante?periode=tout").body));
});

test("api app : séries à plat pour les graphiques", () => {
  const { alex, call } = setup();
  const s = call(alex, "GET", "sante?periode=tout").body as { series: Record<string, { unit: string; points: { date: string; value: number }[] }> };
  for (const [k, v] of Object.entries(s.series)) {
    assert.ok(v.unit, k);
    for (const p of v.points) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value), k);
  }
});

test("api app : une figure seule, versionnée, avec ses repères, son matériel et le rôle des muscles", () => {
  const { alex, call } = setup();
  const f = call(alex, "GET", "sport/figures/goblet").body as { id: string; version: string; loop: boolean; cues: { t: number; label: string }[]; accessories: { type: string }[]; muscles: { role: string }[] };
  assert.equal(f.id, "goblet");
  assert.match(f.version, /^[0-9a-f]{12}$/);
  assert.equal(f.version, (call(alex, "GET", "sport/figures/goblet").body as { version: string }).version, "même figure, même version");
  assert.deepEqual(f.cues[0], { t: 0, label: "Descends" });
  assert.ok(f.accessories.some((a) => a.type === "kettlebell"));
  assert.ok(f.muscles.some((m) => m.role === "primary"));
  assert.equal(call(alex, "GET", "sport/figures/inconnu").status, 404);
  const s = call(alex, "GET", "sport").body as { program: { figureIds: Record<string, string[]> } };
  assert.ok(s.program.figureIds.A.includes("goblet"));
});

test("api app : gestes nommés, phase et fin de phase, révision périmée, renvoi sans effet", () => {
  const { alex, call } = setup();
  const t0 = Date.parse("2026-10-20T08:00:00Z");
  type L = { live: { version: number; state: { revision: number; phase: string; phaseEndsAt?: number; pausedPhase?: string }; live: { i: number }; figureIds: string[] } };
  const id = (call(alex, "POST", "sport/seance", { type: "A" }, t0).body as { live: { id: string } }).live.id;
  let r = call(alex, "POST", `sport/seance/${id}/action`, { action: "next" }, t0).body as L;
  assert.equal(r.live.live.i, 1);
  assert.ok(r.live.figureIds.includes("goblet"));
  assert.equal(r.live.state.phase, "work", "série sans rythme : elle attend « Série faite »");
  r = call(alex, "POST", `sport/seance/${id}/action`, { action: "start", revision: r.live.state.revision, actionId: "a1" }, t0 + 1000).body as L;
  assert.equal(r.live.state.phase, "setup");
  assert.equal(r.live.state.phaseEndsAt, t0 + 6000);
  // Le même actionId renvoyé ne refait rien.
  const again = call(alex, "POST", `sport/seance/${id}/action`, { action: "start", actionId: "a1" }, t0 + 2000).body as L;
  assert.equal(again.live.version, r.live.version);
  const stale = call(alex, "POST", `sport/seance/${id}/action`, { action: "pause", revision: 1 }, t0 + 3000);
  assert.equal(stale.status, 409);
  assert.ok("live" in stale.body);
  r = (call(alex, "GET", `sport/seance/${id}`, null, t0 + 7000).body as L);
  assert.equal(r.live.state.phase, "work");
  r = call(alex, "POST", `sport/seance/${id}/action`, { action: "pause" }, t0 + 8000).body as L;
  assert.equal(r.live.state.phase, "paused");
  assert.equal(r.live.state.pausedPhase, "work");
  assert.ok(!("phaseEndsAt" in r.live.state));
  r = call(alex, "POST", `sport/seance/${id}/action`, { action: "log", reps: 14 }, t0 + 9000).body as L;
  assert.equal(r.live.live.i, 2);
  assert.equal(call(alex, "POST", `sport/seance/${id}/action`, { action: "voler" }).status, 400);
});

test("api app : un geste automatique ne part que dans les 5 minutes après la fin (séance oubliée)", () => {
  const { alex, call } = setup();
  const t0 = Date.parse("2026-10-20T08:00:00Z");
  type S = { live: { state: { phase: string; autoGesture?: string; autoAt?: number; autoUntil?: number } } };
  const id = (call(alex, "POST", "sport/seance", { type: "A" }, t0).body as { live: { id: string } }).live.id;
  call(alex, "POST", `sport/seance/${id}/action`, { action: "next" }, t0);
  call(alex, "POST", `sport/seance/${id}/geste`, { k: "guide", at: 1, on: true, reps: 12, lead: 0 }, t0);
  const s = (call(alex, "GET", `sport/seance/${id}`, null, t0 + 10_000).body as S).live.state;
  assert.equal(s.autoGesture, "record");
  // goblet : 12 × 5,4 s, puis 1,2 s ; noté seul pendant 5 minutes, pas après.
  assert.equal(s.autoAt, t0 + 12 * 5400 + 1200);
  assert.equal(s.autoUntil, s.autoAt! + 5 * 60_000);
});

test("api app : keys de chaque figure, la même hauteur de bille que le site", () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    const { keys, steps } = figureData(m);
    assert.equal(keys, m.keys.length, id);
    // La formule de l'app (docs/api-app.md) donne la hauteur de rhythm.ts pour chaque pose visée.
    for (const s of steps) assert.equal(keys <= 1 ? 1 : 1 - s.to / (keys - 1), keyLevel(m, s.to), id);
  }
});

test("api app : un exercice sans figure est rythmé par la figure de repli, servie avec les autres", () => {
  const { db, alex, call } = setup();
  const sessions = structuredClone(KB_TEMPLATE.sessions);
  const A = Object.keys(sessions)[0];
  sessions[A].blocks[0].items.push("sansFigure");
  assignProgram(db, "alex", { ...KB_TEMPLATE, sessions, exercises: { ...KB_TEMPLATE.exercises, sansFigure: { ...KB_TEMPLATE.exercises.goblet, name: "Sans figure" } } }, "generateur");
  const s = call(alex, "GET", "sport").body as { program: { exercises: { id: string; hasFigure: boolean; cycle: number; guideFigure: string }[]; figureIds: Record<string, string[]> } };
  const e = s.program.exercises.find((x) => x.id === "sansFigure")!;
  assert.equal(e.hasFigure, false);
  assert.equal(e.guideFigure, GUIDE_FALLBACK);
  assert.equal(s.program.exercises.find((x) => x.id === "goblet")!.guideFigure, "goblet");
  assert.ok(s.program.figureIds[A].includes(GUIDE_FALLBACK));
  // La figure de repli est celle du site : même durée, mêmes poses.
  const site = guideMotion(null, "sansFigure");
  assert.equal(e.cycle, cycleDuration(site));
  const f = call(alex, "GET", "sport/figures").body as { figures: Record<string, { cycle: number; keys: number }> };
  assert.ok(!("sansFigure" in f.figures));
  assert.equal(f.figures[GUIDE_FALLBACK].cycle, e.cycle);
  assert.equal(f.figures[GUIDE_FALLBACK].keys, site.keys.length);
});

test("api app : les plats, manger une portion, annuler, réajuster", async () => {
  const { db, alex, sam, call } = setup();
  const fs = await import("fs");
  const { upsertRecipe } = await import("@/lib/recipes/store");
  const { saveReserve } = await import("@/lib/reserve/store");
  const { cookSessions } = await import("@/lib/db/schema");
  const { id: recipeId } = upsertRecipe(db, JSON.parse(fs.readFileSync("src/seed/recipes/poulet-teriyaki-riz.json", "utf8")));
  db.insert(cookSessions).values({ id: "S", planJson: { version: 1, recipes: [{ slug: "poulet-teriyaki-riz", name: "Teriyaki", color: "x", scale: 1 }] }, status: "done", endedAt: "2026-10-18T17:00:00Z" }).run();
  saveReserve(db, "S", recipeId, { weights: { plat: 1500, riz: 1100, "haricots-verts": 600 }, counts: { alex: 4, sam: 3 } }, new Date("2026-10-18T17:30:00Z"));
  const now = Date.parse("2026-10-20T10:30:00Z");
  type Dish = { id: string; status: string; groups: { key: string; leftG: number; base?: string }[]; people: { personId: string; me: boolean; total: number; left: number; portion?: { grams: { key: string; g: number }[] }; next?: { source: string } }[] };
  type Plats = { dishes: Dish[]; eaten: { id: string; entryId: string; kcal: number }[]; person: { id: string } };
  const moi = call(alex, "GET", "moi").body as { features: string[] };
  assert.ok(moi.features.includes("plats"));
  const p0 = call(alex, "GET", "plats", null, now).body as unknown as Plats;
  assert.equal(p0.person.id, "alex");
  const dish = p0.dishes[0];
  assert.equal(dish.status, "cooked");
  assert.deepEqual(dish.people.map((x) => [x.personId, x.me, x.left]), [["alex", true, 4], ["sam", false, 3]]);
  assert.deepEqual(dish.people[0].portion!.grams.map((g) => g.key), ["plat", "riz", "haricots-verts"]);
  assert.equal(dish.people[0].next!.source, "recipient");
  // JSON de bout en bout, sans null dans les objets.
  assert.ok(!JSON.stringify(p0).includes(":null"));

  const r = call(alex, "POST", "plats/manger", { dishId: dish.id }, now);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const body = r.body as unknown as { serving: { id: string; entryId: string; meal: string; kcal: number }; plats: Plats };
  assert.equal(body.serving.meal, "lunch");
  assert.equal(body.plats.dishes[0].people[0].left, 3);
  assert.equal(body.plats.eaten[0].id, body.serving.id);
  // Au journal du jour.
  const jour = call(alex, "GET", "jour?date=2026-10-20", null, now).body as { entries: { id: string; kcal: number }[] };
  assert.equal(jour.entries[0].id, body.serving.entryId);
  // Ce que Sam a vraiment pris, puis une deuxième portion le même jour.
  const s2 = call(sam, "POST", "plats/manger", { dishId: dish.id, grams: { plat: 150, riz: 120 }, meal: "dinner" }, now);
  assert.equal(s2.status, 200);
  assert.equal(call(alex, "POST", "plats/manger", { dishId: dish.id, meal: "dinner" }, now).status, 200);
  assert.equal(call(alex, "POST", "plats/manger", { dishId: dish.id, date: "2026-10-21" }, now).status, 400);
  assert.equal(call(alex, "POST", "plats/manger", { dishId: "inconnu" }, now).status, 404);
  // Annuler : pas la portion d'une autre ; la sienne, oui.
  const samServing = (s2.body as unknown as { serving: { id: string } }).serving.id;
  assert.equal(call(alex, "POST", "plats/annuler", { servingId: samServing }, now).status, 404);
  const u = call(alex, "POST", "plats/annuler", { servingId: body.serving.id }, now);
  assert.equal(u.status, 200);
  assert.equal((u.body as unknown as { plats: Plats }).plats.dishes[0].people[0].left, 3);
  // Réglage : nouvelle pesée et une portion de plus pour Sam ; le riz, une base, se pèse dans son récipient.
  const g = call(alex, "POST", "plats/reglage", { dishId: dish.id, weights: { plat: 500, riz: 900 }, left: { sam: 3 } }, now);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const after = (g.body as unknown as { plats: Plats }).plats.dishes[0];
  assert.equal(after.groups.find((x) => x.key === "plat")!.leftG, 500);
  assert.equal(after.groups.find((x) => x.key === "riz")!.base, "riz");
  assert.equal(after.people.find((x) => x.personId === "sam")!.left, 3);
  assert.equal(call(alex, "POST", "plats/reglage", { dishId: dish.id, left: { sam: 99 } }, now).status, 400);
  // Les bases : le riz du plat dans son récipient ; une portion dit d'où vient son riz.
  type Base = { family: string; leftG: number; low: boolean; containers: { id: string; leftG: number }[]; remake: { rawG: number; steps: string[] } };
  const pl = (g.body as unknown as { plats: { bases: Base[]; freeze: unknown[] } }).plats;
  assert.ok(moi.features.includes("bases"));
  const riz = pl.bases.find((x) => x.family === "riz")!;
  assert.ok(riz.leftG > 0 && riz.remake.rawG > 0 && riz.remake.steps.length === 3);
  assert.ok(Array.isArray(pl.freeze));
  const w = call(alex, "POST", "plats/base-pesee", { baseId: riz.containers[0].id, grams: 100 }, now);
  assert.equal(w.status, 200, JSON.stringify(w.body));
  const riz2 = (w.body as unknown as { plats: { bases: Base[] } }).plats.bases.find((x) => x.family === "riz")!;
  assert.deepEqual([riz2.leftG, riz2.low], [100, true]);
  const re = call(alex, "POST", "plats/base-refaire", { family: "riz", rawG: 500 }, now);
  assert.equal(re.status, 200, JSON.stringify(re.body));
  assert.equal((re.body as unknown as { plats: { bases: Base[] } }).plats.bases.find((x) => x.family === "riz")!.leftG, 1350);
  assert.equal(call(alex, "POST", "plats/base-fini", { baseId: riz.containers[0].id }, now).status, 200);
  assert.equal(call(alex, "POST", "plats/base-fini", { baseId: "inconnu" }, now).status, 404);
  assert.equal(call(alex, "POST", "plats/base-refaire", { family: "caviar", rawG: 10 }, now).status, 404);
});
