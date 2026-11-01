// Ce que lisent les pages Course (src/lib/running/page.ts) sur une base en mémoire, foyer fictif Alex et Sam :
// la séance du jour et sa semaine (séances passées reprises du plan même sans lecture ces jours-là), une sortie
// en détail (série réduite, splits, ressenti avec le plaisir), la séance du jour pour l'accueil.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "@/lib/db/open";
import { importPost } from "@/lib/health/import-api";
import { ensureLink } from "@/lib/health/link";
import { courseView, runView, todayRun } from "@/lib/running/page";
import { noteFeedback, saveRunSettings } from "@/lib/running/store";
import { seedTest } from "./helpers";

const NOW = new Date("2026-11-04T07:00:00Z"); // mercredi
const TODAY = "2026-11-04";

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  const key = ensureLink(db, "alex").key;
  const post = (body: unknown) => importPost(db, new Headers({ "X-Mijote-Key": key, "Content-Type": "application/json" }), JSON.stringify(body), NOW);
  return { db, post };
}

function run(uuid: string, start: string, minutes: number) {
  const km = Math.floor(minutes / 6.5);
  return {
    uuid,
    activity: "running",
    start,
    end: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
    durationMin: minutes,
    kcal: minutes * 10,
    distanceM: km * 1000,
    hrAvg: 138,
    hrMax: 150,
    details: {
      hr: Array.from({ length: Math.floor((minutes * 60) / 5) }, (_, i) => [i * 5, Math.round(Math.min(142, 100 + i * 0.6))]),
      splits: Array.from({ length: km }, (_, i) => ({ km: i + 1, sec: 390, hrAvg: 138, elevGainM: 3, elevLossM: 3 })),
      cadenceAvg: 162,
      elevGainM: km * 3,
      elevLossM: km * 3,
      weather: { tempC: 14, humidityPct: 60 },
    },
  };
}

test("page Course : rien sans module ; séance du jour, semaine, tendances et sorties sinon", () => {
  const { db, post } = setup();
  assert.equal(courseView(db, "alex", NOW), null);
  assert.equal(todayRun(db, "alex", TODAY), null);
  saveRunSettings(db, "alex", { enabled: true, days: [0, 2, 4, 6].map((weekday) => ({ weekday, time: "18:30" })), perWeek: 3, goal: "plus_longtemps" }, "2026-10-01");
  post({ version: 2, workouts: [run("w1", "2026-10-20T16:30:00Z", 30), run("w2", "2026-10-27T16:30:00Z", 32), run("w3", "2026-11-02T17:30:00Z", 35)] });

  const v = courseView(db, "alex", NOW)!;
  assert.ok(v);
  assert.equal(v.week.length, 7);
  assert.equal(v.week[0].date, "2026-11-02");
  // La course de lundi est dans la semaine, rapprochée de la séance prévue (reprise du plan si elle n'était pas rangée).
  assert.ok(v.runs.length === 3 && v.runs[0].date === "2026-11-02"); // la plus récente d'abord
  assert.equal(v.week[0].runs[0]?.sampleId, v.runs[0].sampleId);
  assert.ok(v.volume.length === 12 && v.volume.at(-1)!.minutes > 0);
  assert.ok(v.fitness.length > 30 && v.fitness.length <= 91); // trois mois au plus, depuis la première séance
  if (v.head) {
    assert.ok(v.head.blocks.length >= 3);
    assert.ok(v.head.why.length >= 1);
    assert.ok(["today", "next"].includes(v.head.when));
  }
  assert.ok(v.plan.track.some((p) => p.state === "en_cours"));
  assert.equal(v.feedbackDue?.date, "2026-11-02"); // la sortie de lundi n'a pas de ressenti
  noteFeedback(db, "alex", { date: "2026-11-02", effort: 4, pain: 0, enjoy: 4 });
  assert.equal(courseView(db, "alex", NOW)!.feedbackDue, null);
});

test("une sortie : analyse, série réduite pour le dessin, splits, ressenti avec le plaisir, voisines", () => {
  const { db, post } = setup();
  saveRunSettings(db, "alex", { enabled: true, days: [0, 2, 4, 6].map((weekday) => ({ weekday })), perWeek: 3, goal: "plus_longtemps" }, "2026-10-01");
  post({ version: 2, workouts: [run("w1", "2026-10-27T16:30:00Z", 32), run("w2", "2026-11-02T17:30:00Z", 150)] });
  noteFeedback(db, "alex", { date: "2026-11-02", effort: 5, pain: 2, painWhere: "genou", enjoy: 5 });
  const [last, first] = courseView(db, "alex", NOW)!.runs.map((x) => x.sampleId);
  const r = runView(db, "alex", last, NOW)!;
  assert.ok(r.hr.length > 0 && r.hr.length <= 320); // 1 800 points ramenés à 320 au plus
  assert.equal(r.analysis.splits.length, 23);
  assert.equal(r.cadence, 162);
  assert.equal(r.feedback?.enjoy, 5);
  assert.equal(r.feedback?.painWhere, "genou");
  assert.equal(r.prev, first);
  assert.equal(r.next, null);
  assert.equal(runView(db, "alex", "inconnue", NOW), null);
  assert.equal(runView(db, "sam", last, NOW), null); // une autre personne
});

test("accueil : la séance du jour seulement, lue telle quelle", () => {
  const { db } = setup();
  saveRunSettings(db, "alex", { enabled: true, days: [2].map((weekday) => ({ weekday })), perWeek: 2, goal: "reprendre" }, TODAY);
  courseView(db, "alex", NOW); // range le plan
  const t = todayRun(db, "alex", TODAY);
  assert.ok(t && t.minutes > 0 && !t.done && t.title.length > 0);
  assert.equal(todayRun(db, "alex", "2026-11-05"), null);
  assert.equal(todayRun(db, null, TODAY), null);
});
