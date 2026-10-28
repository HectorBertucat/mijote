// Parcours IA de bout en bout avec un faux client (aucun réseau) : ce que le code fait de chaque réponse,
// bonne, fausse puis corrigée, ou fausse deux fois. Les vrais appels se vérifient avec `pnpm test:ai`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "@/lib/db/open";
import { aiCalls, foodArt as foodArtTable } from "@/lib/db/schema";
import { setAiClient, type AiClient } from "@/lib/ai";
import { aiProgram, type AiProgramOutput } from "@/lib/training/ai";
import { MOTIONS } from "@/lib/training/figures";
import { LIBRARY } from "@/lib/training/library";
import { checkMotion } from "@/lib/training/motion-check";
import { drawFoods, loadCustomArt, missingArt } from "@/lib/illus/ai";
import { FOODS } from "@/lib/illus/art";
import type { Motion } from "@/lib/training/motion";

/** Faux client : rend les réponses dans l'ordre, garde les requêtes. */
function fake(outputs: unknown[]) {
  const sent: Record<string, unknown>[] = [];
  const client: AiClient = {
    messages: {
      parse: async (params) => {
        sent.push(params);
        const out = outputs.shift();
        if (out === undefined) throw new Error("appel IA inattendu");
        return { usage: { input_tokens: 3000, output_tokens: 2000 }, stop_reason: "end_turn", parsed_output: out };
      },
    },
  };
  return { client, sent };
}

const toAi = (m: Motion) => ({
  keys: m.keys.map((k) => ({
    angles: { neck: 0, footN: 0, footF: 0, ...k.a },
    anchor: k.c.anchor,
    anchorX: k.c.at[0],
    anchorY: k.c.at[1],
    ik: Object.entries(k.c.ik ?? {}).map(([end, t]) => ({ end: end as "handN", x: t.at[0], y: t.at[1], bend: t.bend === 1 ? ("avant" as const) : ("arriere" as const) })),
    bell: null,
  })),
  steps: m.steps.map((s) => ({ to: s.to, dur: s.dur, label: s.label, count: !!s.count })),
});
const sunk = (m: Motion) => toAi({ ...m, keys: m.keys.map((k) => ({ ...k, c: { ...k.c, at: [k.c.at[0], k.c.at[1] + 40] as [number, number] } })) });

const exercise = (id: string, motion: ReturnType<typeof toAi>) => ({
  id, name: `Exercice ${id}`, short: id, muscles: "Fessiers", repsMin: 10, repsMax: 15, uni: false, seconds: false, tempo: "2 s en haut",
  cues: ["Dos plat"], errors: [], ladder: ["Facile", "Dur"], position: "Sur le dos", movement: "Monte", feel: "Fessiers", breathing: "Souffle", easier: "Moins haut",
  gear: [], pattern: "fessiers" as const, motion,
});

const program = (extra: ReturnType<typeof exercise>[]): AiProgramOutput => ({
  name: "Renfo du soir",
  explanation: "Deux séances courtes.",
  sessions: [
    { name: "A", sub: "Bas et haut", blocks: [{ label: "Bloc 1", sets: 3, rest: 60, items: ["jBridge", "jInclinePush"], emom: null }, { label: "Fin", sets: 2, rest: 30, items: extra.map((e) => e.id), emom: null }] },
    { name: "B", sub: "Fentes", blocks: [{ label: "Bloc 1", sets: 3, rest: 60, items: ["jRevLunge", "pushup"], emom: null }, { label: "Fin", sets: 2, rest: 30, items: ["jDeadbug", "jPlank"], emom: null }] },
  ],
  warmup: ["Marche sur place"],
  principles: [{ title: "Le geste d'abord", text: "Lentement." }],
  weekNote: "2 séances.",
  newExercises: extra,
});

const REQ = { gear: [], perWeek: 2, minutes: 30, level: 1 as const, focus: "equilibre" as const };

test("programme IA : un exercice inventé à la figure juste est gardé, avec sa figure, et l'appel est journalisé", async () => {
  const { db } = openDb(":memory:");
  const figures = (m: ReturnType<typeof toAi>) => ({ exercises: [{ id: "pont-tenu", motion: m }] });
  const { client, sent } = fake([program([exercise("pont-tenu", toAi(MOTIONS.jBridge))]), figures(toAi(MOTIONS.jBridge))]);
  setAiClient(client);
  try {
    const r = await aiProgram(db, REQ, { name: "Sam", sex: "f", age: 30 }, "p1");
    assert.equal(sent.length, 2, "le programme, puis les figures des exercices inventés");
    assert.match(JSON.stringify(sent[1].messages), /pont-tenu/);
    assert.equal(r.program.name, "Renfo du soir");
    assert.deepEqual(Object.keys(r.program.motions ?? {}), ["ia-pont-tenu"]);
    assert.deepEqual(checkMotion(r.program.motions!["ia-pont-tenu"]), []);
    assert.ok(r.program.sessions.A.blocks[1].items.includes("ia-pont-tenu"));
    assert.deepEqual(r.warnings, []);
    const calls = db.select().from(aiCalls).all();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].screen, "programme");
    assert.ok(calls[0].ok && calls[0].costUsd > 0);
    // Le prompt donne la bibliothèque possible avec ce matériel, et les conventions du squelette.
    const sys = JSON.stringify(sent[0].system);
    assert.match(sys, /sol à y = 186/);
    assert.match(JSON.stringify(sent[0].messages), /Personne : Sam, femme, 30 ans/);
  } finally {
    setAiClient(null);
  }
});

test("programme IA : une figure sous le sol repart à l'IA avec ses erreurs, la correction est gardée", async () => {
  const { db } = openDb(":memory:");
  const { client, sent } = fake([program([exercise("pont-tenu", sunk(MOTIONS.jBridge))]), { exercises: [{ id: "pont-tenu", motion: sunk(MOTIONS.jBridge) }] }, { exercises: [{ id: "ia-pont-tenu", motion: toAi(MOTIONS.jBridge) }] }]);
  setAiClient(client);
  try {
    const r = await aiProgram(db, REQ, { name: "Sam" }, "p2");
    assert.equal(sent.length, 3);
    assert.match(JSON.stringify(sent[2].messages), /sous le sol/);
    assert.deepEqual(checkMotion(r.program.motions!["ia-pont-tenu"]), []);
    assert.deepEqual(r.warnings, []);
  } finally {
    setAiClient(null);
  }
});

test("programme IA : une figure fausse deux fois est remplacée par la bibliothèque, et on le dit", async () => {
  const { db } = openDb(":memory:");
  const { client } = fake([program([exercise("pont-tenu", sunk(MOTIONS.jBridge))]), { exercises: [] }, { exercises: [{ id: "ia-pont-tenu", motion: sunk(MOTIONS.jBridge) }] }]);
  setAiClient(client);
  try {
    const r = await aiProgram(db, REQ, { name: "Sam" }, "p3");
    assert.ok(!JSON.stringify(r.program.sessions).includes("ia-pont-tenu"));
    assert.equal(Object.keys(r.program.motions ?? {}).length, 0);
    assert.ok(r.warnings.some((w) => /ne tenait pas debout/.test(w)), r.warnings.join(" | "));
    for (const s of Object.values(r.program.sessions)) for (const b of s.blocks) for (const x of b.items) assert.ok(LIBRARY[x] && MOTIONS[x], x);
  } finally {
    setAiClient(null);
  }
});

test("programme IA : le plafond mensuel coupe avant l'appel", async () => {
  const { db } = openDb(":memory:");
  const { client, sent } = fake([program([])]);
  setAiClient(client);
  process.env.AI_MONTHLY_CAP_USD = "0";
  try {
    await assert.rejects(aiProgram(db, REQ, { name: "Sam" }, "p4"), /plafond/i);
    assert.equal(sent.length, 0);
  } finally {
    delete process.env.AI_MONTHLY_CAP_USD;
    setAiClient(null);
  }
});

const SVG_OK = FOODS.tomate.svg;
const SVG_BAD = '<circle cx="32" cy="32" r="20" fill="#ff0000"/><script>alert(1)</script>';

test("dessins IA : bon dessin gardé, mauvais redemandé, toujours mauvais refusé ; rien de dangereux en base", async () => {
  const { db } = openDb(":memory:");
  const items = ["Poireau", "Patate douce", "Kumquat"];
  const { client, sent } = fake([
    { drawings: [
      { item: "Poireau", label: "Poireau", category: "legume", svg: SVG_OK },
      { item: "Patate douce", label: "Patate douce", category: "legume", svg: SVG_BAD },
      { item: "Kumquat", label: "Kumquat", category: "fruit", svg: SVG_BAD },
    ] },
    { drawings: [
      { item: "Patate douce", label: "Patate douce", category: "legume", svg: SVG_OK },
      { item: "Kumquat", label: "Kumquat", category: "fruit", svg: SVG_BAD },
    ] },
  ]);
  setAiClient(client);
  try {
    const r = await drawFoods(db, items);
    assert.equal(sent.length, 2);
    assert.match(JSON.stringify(sent[1].messages), /couleur hors des jetons|balise interdite/);
    assert.deepEqual(r.saved.map((s) => s.item).sort(), ["Patate douce", "Poireau"]);
    assert.deepEqual(r.failed.map((f) => f.item), ["Kumquat"]);
    const rows = db.select().from(foodArtTable).all();
    assert.equal(rows.length, 2);
    for (const row of rows) assert.ok(!/script|#ff/i.test(row.svg));
    assert.deepEqual(Object.keys(loadCustomArt(db)).sort(), ["patate douce", "poireau"]);
    // Ce qui est dessiné ne manque plus ; un aliment de la banque ne manque jamais.
    const missing = missingArt(db, [{ item: "Poireau, émincé" }, { item: "Tomates", food: "tomate" }, { item: "Kumquat" }]);
    assert.deepEqual(missing, ["Kumquat"]);
  } finally {
    setAiClient(null);
  }
});

test("dessins IA : rien à dessiner, aucun appel", async () => {
  const { db } = openDb(":memory:");
  const { client, sent } = fake([]);
  setAiClient(client);
  try {
    const r = await drawFoods(db, []);
    assert.deepEqual(r, { saved: [], failed: [] });
    assert.equal(sent.length, 0);
  } finally {
    setAiClient(null);
  }
});
