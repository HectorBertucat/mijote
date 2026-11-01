// Mode démo (src/lib/demo) : l'activation, les garde-fous des bases de visiteurs (chemins, purge, plafonds),
// le foyer daté par rapport à aujourd'hui, puis la base modèle écrite pour de bon et lue par l'appli.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { and, eq, sql } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { appSettings, cookSessions, foodLog, healthSamples, mealBoxes, mealSlots, people, shoppingLists, weekPlans, weekRecipes, weighIns, workoutDetails, workouts } from "@/lib/db/schema";
import { syncPlan } from "@/lib/running/store";
import { overview } from "@/lib/health/overview";
import { basesToPurge, canCreate, demoEnabled, demoLimits, isVisitorId, maxPageCount, newVisitorId, visitorFile, visitorOfFile } from "@/lib/demo/core";
import { demoCalendar, demoHealth, demoHousehold, demoWorkouts, HEALTH_DAYS, sessionDays, SLEEP_NIGHTS, weightSeries } from "@/lib/demo/household";
import { parseV2 } from "@/lib/health/ingest-v2";
import { addDays } from "@/lib/week/propose";
import { seedDemo } from "@/lib/demo/seed";
import { aiEnabled } from "@/lib/ai";
import { authEnabled } from "@/lib/auth";
import { catalogEnabled } from "@/lib/chronocatalog";
import { isSetupDone } from "@/lib/settings";
import { listStock } from "@/lib/boxes/store";
import { homeView } from "@/lib/home/store";
import { bootstrap } from "@/seed/bootstrap";
import { KB_TEMPLATE } from "@/lib/training/program";
import { weekdayOf } from "@/lib/week/period";

/** Lance `fn` avec ces variables d'environnement, puis remet les anciennes. */
function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v == null ? delete process.env[k] : (process.env[k] = v);
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(old)) v == null ? delete process.env[k] : (process.env[k] = v);
  }
}

test("la démo ne s'active qu'avec MIJOTE_DEMO ; sans elle, rien ne change", () => {
  assert.equal(demoEnabled({}), false);
  assert.equal(demoEnabled({ MIJOTE_DEMO: "0" }), false);
  assert.equal(demoEnabled({ MIJOTE_DEMO: "1" }), true);
  withEnv({ MIJOTE_DEMO: undefined, MIJOTE_PASSWORD: "secret", ANTHROPIC_API_KEY: "cle", CHRONOCATALOG_URL: "http://catalogue" }, () => {
    assert.equal(authEnabled(), true);
    assert.equal(aiEnabled(), true);
    assert.equal(catalogEnabled(), true);
  });
  // En démo : ni mot de passe, ni IA, ni catalogue, même réglés.
  withEnv({ MIJOTE_DEMO: "1", MIJOTE_PASSWORD: "secret", ANTHROPIC_API_KEY: "cle", CHRONOCATALOG_URL: "http://catalogue" }, () => {
    assert.equal(authEnabled(), false);
    assert.equal(aiEnabled(), false);
    assert.equal(catalogEnabled(), false);
  });
});

test("une base de visiteur reste dans le dossier de la démo", () => {
  const id = newVisitorId();
  assert.ok(isVisitorId(id));
  assert.equal(visitorFile("/data/demo", id), path.resolve("/data/demo", `v-${id}.db`));
  for (const bad of ["../../etc/passwd", "", "ABC", `${id}/..`, `${id}x`, "0".repeat(31)]) assert.throws(() => visitorFile("/data/demo", bad), /invalide/);
  assert.equal(visitorOfFile(`v-${id}.db-wal`), id);
  assert.equal(visitorOfFile(`v-${id}.db`), id);
  assert.equal(visitorOfFile("modele.db"), null);
  assert.equal(visitorOfFile(`v-${id}.db.bak`), null);
});

test("purge : les bases inactives, puis les moins récentes au-delà du plafond", () => {
  const limits = { maxBases: 3, idleMs: 60_000 };
  const now = 1_000_000;
  const bases = [
    { id: "a", lastSeen: now - 120_000 }, // inactive
    { id: "b", lastSeen: now - 50_000 },
    { id: "c", lastSeen: now - 10_000 },
    { id: "d", lastSeen: now - 20_000 },
    { id: "e", lastSeen: now - 1_000 },
  ];
  assert.deepEqual(basesToPurge(bases, now, limits), ["a", "b"]);
  // Une place à faire pour une nouvelle base : la suivante la moins récente part aussi.
  assert.deepEqual(basesToPurge(bases, now, limits, 1), ["a", "b", "d"]);
  assert.deepEqual(basesToPurge([], now, limits, 1), []);
});

test("plafonds : créations par minute, taille d'une base, réglages bornés", () => {
  const now = 10 * 60_000;
  assert.equal(canCreate([now - 61_000, now - 70_000], now, { newPerMinute: 2 }), true);
  assert.equal(canCreate([now - 1_000, now - 2_000], now, { newPerMinute: 2 }), false);
  assert.equal(maxPageCount(4096 * 100, 4096, { headroomMb: 1 }), 100 + 256);
  const d = demoLimits({});
  assert.deepEqual([d.maxBases, d.idleMs, d.headroomMb, d.newPerMinute], [100, 120 * 60_000, 32, 30]);
  const l = demoLimits({ MIJOTE_DEMO_MAX_BASES: "999999", MIJOTE_DEMO_IDLE_MIN: "1", MIJOTE_DEMO_MAX_MB: "abc" });
  assert.deepEqual([l.maxBases, l.idleMs, l.headroomMb], [1000, 5 * 60_000, 32]);
});

test("le calendrier suit aujourd'hui : la semaine en cours a été cuisinée le dimanche d'avant", () => {
  for (const today of ["2026-11-02", "2026-11-05", "2026-11-08"]) {
    const c = demoCalendar(today);
    assert.equal(weekdayOf(c.current.start), 0);
    assert.ok(c.current.start <= today && today < c.next.start);
    assert.equal(weekdayOf(c.current.cookedOn), 6);
    assert.ok(c.previous.cookedOn < c.current.cookedOn && c.current.listOn < c.current.cookedOn);
  }
});

test("le foyer démo : profils complets, pesées et séances datées avant aujourd'hui", () => {
  const today = "2026-11-05";
  const h = demoHousehold(today);
  assert.deepEqual(h.people.map((p) => p.name), ["Alex", "Sam"]);
  for (const p of h.people) for (const k of ["sex", "birthDate", "heightCm", "activity", "goal", "setupDoneAt"] as const) assert.ok(p[k] != null, `${p.name} : ${k}`);
  for (const w of h.weighIns) assert.ok(w.date >= addDays(today, -HEALTH_DAYS) && w.date <= today && w.kg > 50 && w.kg < 90);
  assert.ok(h.weighIns.some((w) => w.date === today), "une pesée aujourd'hui");
  const alex = h.weighIns.filter((w) => w.personId === "alex");
  assert.ok(alex[0].kg > alex.at(-1)!.kg, "Alex perd doucement");
  // Les mêmes séries chaque jour (graine fixe), pas de doublon de date.
  assert.deepEqual(weightSeries("2026-10-01", "2026-10-20", 80, 79, 3), weightSeries("2026-10-01", "2026-10-20", 80, 79, 3));
  assert.equal(new Set(alex.map((w) => w.date)).size, alex.length);
  const days = sessionDays("2026-10-26", "2026-11-05", [0, 3]);
  assert.deepEqual(days, ["2026-10-26", "2026-10-29", "2026-11-02"]);
  const ws = demoWorkouts(KB_TEMPLATE, "alex", "2026-10-26", "2026-11-05", [0, 3], 5);
  assert.deepEqual(ws.map((w) => w.type), ["A", "B", "A"]);
  for (const w of ws) for (const e of w.entries) assert.ok(KB_TEMPLATE.exercises[e.ex] && e.sets.every((n) => n > 0));
  // Aucun plat de la démo n'est servi deux semaines de suite.
  const all = [...h.weeks.previous, ...h.weeks.current, ...h.weeks.next];
  assert.equal(new Set(all).size, all.length);
  const slugs = new Set(fs.readdirSync("src/seed/recipes").map((f) => (JSON.parse(fs.readFileSync(path.join("src/seed/recipes", f), "utf8")) as { slug: string }).slug));
  for (const slug of all) assert.ok(slugs.has(slug), slug);
});

test("un an d'Apple Santé pour la démo : un paquet v2 que l'import accepte en entier, le même chaque jour", () => {
  const today = "2026-11-05";
  const now = new Date(`${today}T23:00:00Z`);
  for (const id of ["alex", "sam"] as const) {
    const p = demoHealth(id, today, 7);
    assert.deepEqual(p, demoHealth(id, today, 7));
    const parsed = parseV2(p, now);
    assert.ok(!("error" in parsed));
    if ("error" in parsed) return;
    assert.equal(parsed.skipped, 0, `${id} : rien de refusé`);
    const steps = p.daily.filter((d) => d.type === "steps");
    assert.equal(steps.length, HEALTH_DAYS + 1);
    assert.ok(steps.every((d) => d.date <= today && d.value > 0));
    assert.ok(steps.at(-1)!.value < steps.at(-2)!.value, "aujourd'hui n'est pas fini");
    const nights = new Set(p.sleep.map((x) => x.end.slice(0, 10)));
    assert.ok(nights.size >= SLEEP_NIGHTS - 1 && nights.size <= SLEEP_NIGHTS + 1);
    assert.ok(p.workouts.length > 60, `${id} : ${p.workouts.length} séances`);
    assert.ok(p.samples.some((x) => x.type === "vo2max"));
  }
  assert.ok(demoHealth("alex", today, 7).workouts.some((w) => w.activity === "running" && w.distanceM! > 4000));
});

test("la base modèle : foyer prêt, semaine répartie, courses, session finie, boîtes au frigo et au congélo", async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mijote-demo-"));
  const { sqlite, db } = openDb(path.join(dir, "modele.db"));
  try {
    bootstrap(db, sqlite);
    await seedDemo(db, today);
    const c = demoCalendar(today);
    assert.ok(isSetupDone(db));
    assert.equal(db.select().from(people).all().length, 2);
    assert.ok(db.select().from(weighIns).all().length > 60);
    assert.ok(db.select().from(workouts).all().length >= 20);
    // Course : Alex suit un plan depuis six semaines, ses courses ont leur détail, le plan est rangé.
    assert.ok(db.select().from(workoutDetails).all().length >= 14);
    const run = syncPlan(db, "alex", new Date(`${today}T08:00:00Z`))!;
    assert.ok(run.plan.phase >= 1, `phase ${run.plan.phase}`);
    assert.ok(run.data.runs.some((r) => r.analysis.decoupling.ok), "un découplage calculable (sortie longue)");
    assert.ok(run.data.runs.filter((r) => r.analysis.loadSource === "serie").length >= 14, "charge tirée de la série de FC");
    assert.ok(run.data.runs.every((r) => r.date < today));
    assert.ok(run.sessions.some((s) => s.date >= today && s.status === "prevue"));
    assert.equal(run.plan.paused, null);
    assert.equal(db.select().from(weekRecipes).all().length, 9);
    const done = db.select().from(cookSessions).where(eq(cookSessions.status, "done")).all();
    assert.equal(done.length, 2);
    assert.ok(done.every((s) => s.endedAt! < `${today}T00:00`));
    const lists = db.select().from(shoppingLists).all();
    assert.equal(lists.length, 3);
    assert.equal(lists.filter((l) => l.status === "draft").length, 1, "la liste de la semaine suivante est à faire");
    const stock = listStock(db, today);
    assert.ok(stock.some((b) => b.place === "freezer"), "des boîtes au congélo");
    if (weekdayOf(today) < 5) assert.ok(stock.some((b) => b.place === "fridge"), "des boîtes au frigo");
    assert.ok(stock.every((b) => !b.plannedFor || b.plannedFor >= today), "les boîtes des repas passés sont mangées");
    // Les repas mangés et les habitudes du matin remplissent le journal.
    const eaten = db.select().from(mealBoxes).where(eq(mealBoxes.status, "eaten")).all();
    assert.ok(eaten.length > 10);
    assert.ok(db.select().from(foodLog).where(and(eq(foodLog.personId, "sam"), eq(foodLog.date, c.previous.start))).all().length >= 2);
    // La semaine en cours et la suivante couvrent tous les repas pris à la maison ou au bureau.
    for (const start of [c.current.start, c.next.start]) {
      const plan = db.select().from(weekPlans).where(eq(weekPlans.weekStart, start)).get()!;
      const open = db.select().from(mealSlots).where(eq(mealSlots.weekPlanId, plan.id)).all().filter((x) => x.place !== "away");
      assert.equal(open.filter((x) => !x.recipeId).length, 0, `repas sans plat la semaine du ${start}`);
    }
    // Un an d'Apple Santé : la vue d'ensemble a de quoi dessiner.
    assert.ok(db.select().from(healthSamples).all().length > 3000);
    const alex = db.select().from(people).where(eq(people.id, "alex")).get()!;
    const o = overview(db, alex, "1an", today);
    assert.ok(o.bars.steps!.filter((b) => b.value != null).length >= 50);
    assert.ok(o.synthesis.length >= 3, o.synthesis.join(" "));
    assert.ok(o.types.types.includes("Course"));
    // L'accueil se lit sans erreur.
    const home = homeView(db, "alex");
    assert.ok(home);
  } finally {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bases de visiteurs : copiées du modèle, séparées, remises à zéro, plafonnées", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mijote-demo-bases-"));
  const keys = ["MIJOTE_DATA_DIR", "MIJOTE_DEMO_MAX_BASES", "MIJOTE_DEMO_NEW_PER_MIN", "MIJOTE_DEMO_MAX_MB"] as const;
  const old = keys.map((k) => process.env[k]);
  Object.assign(process.env, { MIJOTE_DATA_DIR: dir, MIJOTE_DEMO_MAX_BASES: "2", MIJOTE_DEMO_NEW_PER_MIN: "4", MIJOTE_DEMO_MAX_MB: "4" });
  const { prepareDemo, visitorDb, resetVisitor, demoDir } = await import("@/lib/demo/store");
  try {
    await prepareDemo();
    assert.equal(demoDir(), path.join(dir, "demo"));
    const [a, b, c, d] = [newVisitorId(), newVisitorId(), newVisitorId(), newVisitorId()];
    const name = (id: string, t: number) => visitorDb(id, t).select().from(appSettings).where(eq(appSettings.key, "home.name")).get()?.value;
    assert.equal(name(a, 1_000), "Chez Alex et Sam");
    visitorDb(a, 1_001).update(appSettings).set({ value: "Maison A" }).where(eq(appSettings.key, "home.name")).run();
    assert.equal(name(b, 1_002), "Chez Alex et Sam", "l'autre visiteur a sa base");
    assert.equal(name(a, 1_003), "Maison A");
    // Une base ne grossit pas au-delà du modèle + MIJOTE_DEMO_MAX_MB : SQLite refuse d'écrire.
    visitorDb(a, 1_003).run(sql`create table remplissage (x blob)`);
    assert.throws(() => {
      for (let i = 0; i < 8; i++) visitorDb(a, 1_003).run(sql`insert into remplissage values (zeroblob(1048576))`);
    }, (e: Error & { cause?: unknown }) => /full/i.test(String(e.cause ?? e)));
    assert.ok(fs.statSync(visitorFile(path.join(dir, "demo"), a)).size < 8 * 1024 * 1024);
    // Recommencer : la base repart du modèle.
    resetVisitor(a);
    assert.equal(name(a, 1_004), "Chez Alex et Sam");
    // Plafond de 2 bases : la troisième efface la moins récemment utilisée (b).
    name(c, 1_005);
    const files = () => fs.readdirSync(path.join(dir, "demo")).filter((f) => /^v-.*\.db$/.test(f)).sort();
    assert.deepEqual(files(), [`v-${a}.db`, `v-${c}.db`].sort());
    // Trop de créations dans la minute : le modèle en lecture seule, rien ne s'écrit.
    const ro = visitorDb(d, 1_006);
    assert.equal(ro.select().from(appSettings).where(eq(appSettings.key, "home.name")).get()?.value, "Chez Alex et Sam");
    assert.throws(() => ro.update(appSettings).set({ value: "x" }).run(), /readonly/i);
    assert.ok(!files().includes(`v-${d}.db`));
  } finally {
    keys.forEach((k, i) => (old[i] == null ? delete process.env[k] : (process.env[k] = old[i])));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
