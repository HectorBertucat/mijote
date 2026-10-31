// Apple Santé → Mijote, côté Mijote : l'app Mijote Santé (format v2) et l'ancien Raccourci (v1), par
// src/lib/health/import-api.ts sur une base en mémoire (docs/sante.md, « Le contrat »).
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { healthSamples, weighIns } from "@/lib/db/schema";
import { importGet, importPost } from "@/lib/health/import-api";
import { MAX_ITEMS, parseV2 } from "@/lib/health/ingest-v2";
import { activityLabel } from "@/lib/health/ingest";
import { ensureLink, getLink, resetHistory } from "@/lib/health/link";
import { bodySignals, receivedCounts } from "@/lib/health/samples";
import { nights, unionMinutes } from "@/lib/health/sleep";
import { seedTest } from "./helpers";

const NOW = new Date("2026-10-31T08:00:00Z");

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  const key = ensureLink(db, "alex").key;
  const h = (k = key, name = "X-Mijote-Key") => new Headers({ [name]: k, "Content-Type": "application/json" });
  const post = (body: unknown, headers = h()) => importPost(db, headers, typeof body === "string" ? body : JSON.stringify(body), NOW);
  return { db, key, h, post };
}

const sample = (uuid: string, type: string, value: number, start = "2026-10-31T07:02:00+01:00") => ({ uuid, type, start, end: start, value, unit: "", sourceName: "Balance" });
const rows = (db: ReturnType<typeof setup>["db"], kind: (typeof healthSamples.$inferSelect)["kind"]) => db.select().from(healthSamples).where(and(eq(healthSamples.personId, "alex"), eq(healthSamples.kind, kind))).all();

test("app v2 : GET annonce v2, demande tout l'historique jusqu'au paquet `complete`, « Tout renvoyer » le redemande", () => {
  const { db, h, post } = setup();
  const g = importGet(db, h(), NOW);
  assert.equal(g.status, 200);
  assert.equal(g.body.v2, true);
  assert.equal(g.body.person, "Alex");
  assert.equal(g.body.lastSyncAt, null);
  assert.equal(g.body.history, "all");

  // Paquets d'un historique : pas `last` → ni lastSyncAt ni historique reçu.
  const batch = { id: "b1", index: 0 };
  assert.equal(post({ version: 2, batch, samples: [sample("u1", "body_mass", 73.4)] }).status, 200);
  assert.equal(getLink(db, "alex")!.lastSyncAt, null);
  // Dernier paquet, mais pas la fin de l'historique : lastSyncAt seulement.
  post({ version: 2, batch: { ...batch, index: 1, last: true } });
  assert.equal(getLink(db, "alex")!.lastSyncAt, NOW.toISOString());
  assert.equal(importGet(db, h(), NOW).body.history, "all");
  // `history: "complete"` sans `last` ne compte pas.
  post({ version: 2, batch: { ...batch, index: 2, history: "complete" } });
  assert.equal(importGet(db, h(), NOW).body.history, "all");
  post({ version: 2, batch: { ...batch, index: 3, last: true, history: "complete" } });
  const after = importGet(db, h(), NOW).body;
  assert.equal("history" in after, false);
  assert.equal(after.lastSyncAt, NOW.toISOString());
  resetHistory(db, "alex");
  assert.equal(importGet(db, h(), NOW).body.history, "all");
});

test("app v2 : chaque liste rangée à sa place, réponse accepted/skipped, renvoyer ne double rien", () => {
  const { db, post } = setup();
  const body = {
    version: 2,
    source: "app",
    app: { version: "1.0 (3)", device: "iPhone", tz: "Europe/Paris" },
    batch: { id: "b", index: 0, last: true },
    samples: [sample("w1", "body_mass", 73.4), sample("f1", "body_fat", 24.5), sample("r1", "resting_hr", 58), sample("v1", "hrv_sdnn", 42), sample("o1", "vo2max", 38.2), sample("m1", "menstrual", 3)],
    daily: [
      { type: "steps", date: "2026-10-30", value: 9120, unit: "count" },
      { type: "active_energy", date: "2026-10-30", value: 540, unit: "kcal" },
      { type: "basal_energy", date: "2026-10-30", value: 1620, unit: "kcal" },
      { type: "water", date: "2026-10-30", value: 1500, unit: "mL" },
    ],
    workouts: [{ uuid: "s1", activity: "swimming", start: "2026-10-30T12:15:00+01:00", end: "2026-10-30T13:00:00+01:00", durationMin: 45, kcal: 410, distanceM: 1500, hrAvg: 128, hrMax: 162, sourceName: "Apple Watch", meta: { poolLengthM: 25 } }],
    sleep: [{ uuid: "z1", stage: "deep", start: "2026-10-31T01:00:00+01:00", end: "2026-10-31T02:10:00+01:00", sourceName: "Apple Watch" }],
    deleted: [],
    unknownField: { ignored: true },
  };
  const r = post(body);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, accepted: { samples: 6, daily: 4, workouts: 1, sleep: 1, deleted: 0 }, skipped: 0 });
  const w = db.select().from(weighIns).where(eq(weighIns.personId, "alex")).all();
  assert.equal(w.length, 1);
  assert.deepEqual([w[0].kg, w[0].date, w[0].source, w[0].externalId], [73.4, "2026-10-31", "health", "hk:w1"]);
  assert.equal(rows(db, "active_kcal")[0].value, 540);
  assert.equal(rows(db, "body_fat")[0].unit, "%");
  const s = rows(db, "workout")[0];
  assert.equal(s.value, 45);
  assert.deepEqual([s.meta?.type, s.meta?.activity, s.meta?.kcal, s.meta?.poolLengthM], ["Natation", "swimming", 410, 25]);
  assert.equal(rows(db, "sleep")[0].value, 70);

  // Le même paquet, avec un total du jour qui a grossi : remplacé, rien de doublé.
  post({ ...body, daily: [{ type: "steps", date: "2026-10-30", value: 11000, unit: "count" }] });
  assert.equal(db.select().from(weighIns).all().length, 1);
  assert.equal(rows(db, "steps").length, 1);
  assert.equal(rows(db, "steps")[0].value, 11000);
  assert.equal(rows(db, "workout").length, 1);
  assert.equal(rows(db, "sleep").length, 1);
  assert.deepEqual(receivedCounts(db, "alex"), { body_mass: 1, body_fat: 1, resting_hr: 1, hrv_sdnn: 1, vo2max: 1, menstrual: 1, steps: 1, active_kcal: 1, basal_energy: 1, water: 1, workout: 1, sleep: 1 });
});

test("app v2 : hors bornes, type inconnu, date illisible ou future → skipped, le reste passe ; uuid en double → une ligne", () => {
  const { db, post } = setup();
  const r = post({
    version: 2,
    samples: [
      sample("a", "body_mass", 400),
      sample("b", "body_mass", 20),
      sample("c", "resting_hr", 300),
      sample("d", "menstrual", 2.5),
      sample("e", "blood_glucose", 5),
      { ...sample("f", "body_mass", 70), start: "hier" },
      sample("g", "body_mass", 70, "2027-01-01T07:00:00Z"),
      { type: "body_mass", start: "2026-10-30T07:00:00Z", value: 70 },
      sample("ok", "body_mass", 72),
      sample("dup", "vo2max", 40),
      sample("dup", "vo2max", 41),
    ],
    daily: [
      { type: "steps", date: "2026-10-30", value: -5 },
      { type: "steps", date: "30/10/2026", value: 5 },
      { type: "steps", date: "2026-10-29", value: 5000 },
      { type: "steps", date: "2026-10-29", value: 6000 },
    ],
    workouts: [
      { uuid: "w", activity: "running", start: "2026-10-30T07:00:00Z", end: "2026-10-30T06:00:00Z" },
      { uuid: "x", activity: "running", start: "2026-10-30T07:00:00Z", durationMin: 30, hrAvg: 400 },
    ],
    sleep: [
      { uuid: "s", stage: "nap", start: "2026-10-30T01:00:00Z", end: "2026-10-30T02:00:00Z" },
      { uuid: "t", stage: "rem", start: "2026-10-30T02:00:00Z", end: "2026-10-30T01:00:00Z" },
    ],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, accepted: { samples: 2, daily: 1, workouts: 0, sleep: 0, deleted: 0 }, skipped: 14 });
  assert.equal(db.select().from(weighIns).all().length, 1);
  assert.equal(rows(db, "vo2max")[0].value, 41);
  assert.equal(rows(db, "steps")[0].value, 6000);
});

test("app v2 : suppressions par uuid, dans les pesées comme dans les échantillons ; inconnues sans effet", () => {
  const { db, post } = setup();
  post({ version: 2, samples: [sample("w1", "body_mass", 73), sample("f1", "body_fat", 25)], sleep: [{ uuid: "z", stage: "core", start: "2026-10-31T01:00:00Z", end: "2026-10-31T03:00:00Z" }] });
  const r = post({ version: 2, deleted: [{ uuid: "w1", type: "body_mass" }, { uuid: "z" }, { uuid: "inconnu" }, { type: "body_fat" }] });
  assert.deepEqual(r.body, { ok: true, accepted: { samples: 0, daily: 0, workouts: 0, sleep: 0, deleted: 3 }, skipped: 1 });
  assert.equal(db.select().from(weighIns).all().length, 0);
  assert.equal(rows(db, "sleep").length, 0);
  assert.equal(rows(db, "body_fat").length, 1);
});

test("app v2 : une pesée et une séance déjà reçues du Raccourci sont reprises sous leur uuid, pas doublées", () => {
  const { db, post } = setup();
  post({ weights: [{ kg: 73.4, at: "2026-10-31T07:02:00+01:00" }], workouts: [{ type: "Swimming", start: "2026-10-30T12:15:00+01:00", durationMin: 45 }] });
  post({ version: 2, samples: [sample("w1", "body_mass", 73.4)], workouts: [{ uuid: "s1", activity: "swimming", start: "2026-10-30T12:15:00+01:00", durationMin: 45 }] });
  const w = db.select().from(weighIns).all();
  assert.deepEqual(w.map((x) => x.externalId), ["hk:w1"]);
  assert.deepEqual(rows(db, "workout").map((x) => x.externalId), ["hk:s1"]);
  post({ version: 2, deleted: [{ uuid: "s1" }] });
  assert.equal(rows(db, "workout").length, 0);
});

test("import : clé (X-Mijote-Key ou l'ancien X-Cuisine-Key), version, JSON, taille, nombre d'éléments", () => {
  const { db, key, h, post } = setup();
  assert.equal(importGet(db, new Headers(), NOW).status, 401);
  assert.equal(importGet(db, h("mauvaise"), NOW).status, 401);
  assert.equal(post({ version: 2 }, h("mauvaise")).status, 401);
  assert.equal(importGet(db, h(key, "X-Cuisine-Key"), NOW).status, 200);
  assert.equal(post({ version: 2, samples: [sample("a", "body_mass", 70)] }, h(key, "X-Cuisine-Key")).status, 200);
  assert.equal(post("{pas du json").status, 400);
  assert.equal(post([1, 2]).status, 400);
  assert.equal(post({ version: 3 }).status, 400);
  assert.equal(post({ version: 2, samples: "non" }).status, 400);
  assert.equal(post({ version: 2, batch: { last: "oui" } }).status, 400);
  const big = post({ version: 2, samples: [{ uuid: "x".repeat(1024 * 1024) }] });
  assert.equal(big.status, 413);
  assert.equal(big.body.ok, false);
  const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ uuid: `d${i}` }));
  assert.equal(post({ version: 2, deleted: many }).status, 413);
  assert.equal(post({ version: 2, deleted: many.slice(1) }).status, 200);
  assert.equal(importPost(db, new Headers({ "X-Mijote-Key": key, "Content-Length": String(2 * 1024 * 1024) }), "", NOW).status, 413);
});

test("import v1 : inchangé (Raccourci déjà installé), fenêtre et lastSyncAt", () => {
  const { db, h, post } = setup();
  const r = post({ weights: [{ kg: "73,8", at: "2026-10-21T06:30:00+02:00" }], steps: [{ date: "2026-10-21", count: 4000 }], workouts: [], source: "shortcut", window: 180 }, h());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, person: "Alex", weights: 1, steps: 1, activeKcal: 0, workouts: 0, skipped: 0 });
  const g = importGet(db, h(), NOW).body;
  assert.equal(g.window, 7);
  assert.equal(g.mode, "week");
  // L'historique du Raccourci (6 mois) n'est pas l'historique complet de l'app.
  assert.equal(g.history, "all");
  assert.equal(post({ version: 1, weights: [{ kg: 73, at: "2026-10-22T06:30:00+02:00" }] }).status, 200);
});

test("app v2 : sans `batch`, le paquet est le dernier ; parseV2 garde l'ordre et ignore les champs inconnus", () => {
  const p = parseV2({ version: 2, samples: [sample("a", "lean_mass", 55, "2026-10-30T07:00:00Z")], extra: 1 }, NOW);
  assert.ok(!("error" in p));
  if ("error" in p) return;
  assert.equal(p.last, true);
  assert.equal(p.historyComplete, false);
  assert.equal(p.samples[0].start, "2026-10-30T07:00:00.000Z");
  assert.ok("error" in parseV2({ version: 1 }, NOW));
});

test("séances : activity de Santé en snake_case → nom français, sinon les mots tels quels", () => {
  assert.equal(activityLabel("traditional_strength_training"), "Renforcement");
  assert.equal(activityLabel("high_intensity_interval_training"), "HIIT");
  assert.equal(activityLabel("pilates"), "Pilates");
  assert.equal(activityLabel("other"), "Séance");
  assert.equal(activityLabel(""), "Séance");
  assert.equal(activityLabel("disc_sports"), "Disc sports");
});

test("sommeil : nuits datées du réveil, union iPhone + montre, phases détaillées plutôt que « endormi »", () => {
  assert.equal(unionMinutes([[0, 60_000 * 60], [30 * 60_000, 90 * 60_000], [120 * 60_000, 150 * 60_000]]), 120);
  const seg = (stage: "asleep" | "core" | "deep" | "rem" | "awake" | "in_bed", a: string, b: string) => ({ stage, start: a, end: b });
  const n = nights([
    seg("in_bed", "2026-10-30T22:30:00Z", "2026-10-31T06:30:00Z"),
    seg("asleep", "2026-10-30T23:00:00Z", "2026-10-31T06:00:00Z"), // iPhone, sans détail
    seg("core", "2026-10-30T23:00:00Z", "2026-10-31T01:00:00Z"),
    seg("deep", "2026-10-31T01:00:00Z", "2026-10-31T02:00:00Z"),
    seg("awake", "2026-10-31T02:00:00Z", "2026-10-31T02:15:00Z"),
    seg("rem", "2026-10-31T02:15:00Z", "2026-10-31T03:45:00Z"),
    seg("core", "2026-10-31T03:30:00Z", "2026-10-31T06:00:00Z"), // chevauche : compté une fois
    seg("asleep", "2026-10-29T23:00:00Z", "2026-10-30T06:00:00Z"),
  ]);
  assert.deepEqual(
    n.map((x) => [x.date, x.asleepMin, x.deepMin, x.remMin]),
    [
      ["2026-10-30", 420, null, null],
      ["2026-10-31", 405, 60, 90],
    ]
  );
});

test("signaux du corps : sommeil des 7 dernières nuits, FC au repos sur 7 jours comparée au mois d'avant", () => {
  const { db, post } = setup();
  const hr = [55, 56, 57].map((v, i) => sample(`r${i}`, "resting_hr", v, `2026-10-${28 + i}T07:00:00Z`));
  const old = sample("r-old", "resting_hr", 60, "2026-10-01T07:00:00Z");
  post({ version: 2, samples: [...hr, old, sample("o", "vo2max", 38)], sleep: [{ uuid: "z", stage: "asleep", start: "2026-10-30T23:00:00Z", end: "2026-10-31T06:00:00Z" }] });
  const b = bodySignals(db, "alex", "2026-10-31");
  assert.equal(b.restingHr?.value, 56);
  assert.equal(b.restingHr?.before, 60);
  assert.equal(b.vo2max?.value, 38);
  assert.equal(b.sleep?.avgMin, 420);
  assert.equal(b.bodyFat, null);
  assert.equal(bodySignals(db, "sam", "2026-10-31").sleep, null);
});
