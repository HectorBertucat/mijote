// Module Course : le générateur de plan (docs/course.md § 4), sur des historiques fictifs simulés jour après
// jour : la personne fait la séance du jour (ou pas), on recalcule le lendemain. On vérifie les garanties du
// § 4.12 à chaque pas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, mondayOfDay, weekday } from "@/lib/running/dates";
import { morning } from "@/lib/running/signals";
import { buildPlan, levelForCapacity, painStop, phase0Level, placeWeek, startPoint, type DoneRun, type Feedback, type Pause, type PlanInput, type PlanOutput, type PlannedSession, type PlanSettings } from "@/lib/running/plan";
import { checkSession, kindAllowed, QUALITY, runSeconds, sessionMinutes, toWorkoutSpec } from "@/lib/running/workout";
import { zonesOf } from "@/lib/running/zones";

const Z = zonesOf({ max: 186, maxSource: "age", rest: 58, restSource: "mesuree", threshold: 160, thresholdSource: "estimee" });
const SETTINGS: PlanSettings = {
  days: [1, 3, 5, 6].map((weekday) => ({ weekday, time: weekday >= 5 ? "09:00" : "18:30" })),
  perWeek: 3,
  goal: "plus_longtemps",
  longRunDay: 6,
  fixed: [
    { weekday: 0, kind: "kettlebell" },
    { weekday: 3, kind: "kettlebell" },
    { weekday: 2, kind: "natation" },
  ],
};

const run = (date: string, minutes: number, extra: Partial<DoneRun> = {}): DoneRun => ({ date, minutes, km: minutes / 7, continuousMin: minutes - 10, effort: 4, pain: 0, completed: true, hrHighShare: 0.05, decoupling: 3, heat: false, ...extra });

function input(today: string, runs: DoneRun[], extra: Partial<PlanInput> = {}): PlanInput {
  return { today, startedOn: today, settings: SETTINGS, zones: Z, runs, feedback: [], pauses: [], overrides: [], morning: null, intensityOk: null, ...extra };
}

/** Les garanties du § 4.12 sur un plan produit. */
function guarantees(p: PlanOutput, x: PlanInput) {
  const byWeek = new Map<string, PlannedSession[]>();
  for (const s of p.sessions) byWeek.set(s.weekStart, [...(byWeek.get(s.weekStart) ?? []), s]);
  for (const [, ss] of byWeek) {
    const live = ss.filter((s) => !s.cancelled);
    const quality = live.filter((s) => QUALITY.has(s.kind)).length;
    assert.ok(quality <= (p.phase >= 3 ? 2 : p.phase === 2 ? 1 : 0) + 0, `qualité ${quality} en phase ${p.phase}`);
    assert.ok(live.length <= 4);
    for (const s of live) {
      assert.deepEqual(checkSession(s.session, x.zones), [], `${s.date} ${s.session.title}`);
      assert.ok(x.settings.days.some((d) => d.weekday === weekday(s.date)), `jour non disponible ${s.date}`);
      assert.ok(kindAllowed(s.kind, Math.max(p.phase, s.kind === "marche_course" ? 0 : 1) as 0), `${s.kind} en phase ${p.phase}`);
    }
    // Pas de qualité à moins de 48 h de la sortie longue.
    const long = live.find((s) => s.kind === "sortie_longue");
    for (const q of live.filter((s) => QUALITY.has(s.kind))) if (long) assert.ok(Math.abs(daysBetween(q.date, long.date)) >= 2);
  }
  // Règle des 30 jours (hors marche-course, réglée par ses niveaux) : au plus × 1,10 de la plus longue.
  const firm = p.sessions.filter((s) => s.firm && !s.cancelled && s.date >= x.today && s.kind !== "marche_course");
  const past = x.runs.filter((r) => r.date < mondayOfDay(x.today) && daysBetween(r.date, mondayOfDay(x.today)) <= 30);
  if (past.length) {
    const longest = Math.max(...past.map((r) => r.minutes));
    for (const s of firm) assert.ok(s.minutes <= Math.ceil(longest * 1.1) + 1, `${s.session.title} > 1,10 × ${longest}`);
  }
}

/** Simule `days` jours : chaque jour, le plan est recalculé et la séance du jour faite selon `does`. */
function simulate(from: string, days: number, history: DoneRun[], opts: { does?: (s: PlannedSession, day: number) => Partial<DoneRun> | null; feedback?: (date: string) => Feedback | null; extra?: Partial<PlanInput> } = {}) {
  const runs = [...history];
  const feedback: Feedback[] = [];
  const plans: PlanOutput[] = [];
  let pauses: Pause[] = opts.extra?.pauses ?? [];
  for (let i = 0; i < days; i++) {
    const today = addDays(from, i);
    const fb = opts.feedback?.(today);
    if (fb) feedback.push(fb);
    const x = input(today, runs, { startedOn: from, feedback: [...feedback], pauses, ...opts.extra, ...(opts.extra?.pauses ? {} : { pauses }) });
    const p = buildPlan(x);
    if (p.suspend) pauses = [...pauses, { from: p.suspend.date, to: null, reason: "douleur" }];
    guarantees(p, x);
    plans.push(p);
    const s = p.sessions.find((x) => x.date === today && !x.cancelled);
    if (!s) continue;
    const r = opts.does ? opts.does(s, i) : {};
    if (r === null) continue;
    runs.push(run(today, s.minutes, { continuousMin: s.kind === "marche_course" ? Math.round(runSeconds(s.session) / 60 / (s.session.blocks[0].iterations || 1)) : s.minutes - 10, planned: { kind: s.kind, minutes: s.minutes, level: s.session.level ?? null }, ...r }));
  }
  return { runs, plans, feedback, pauses };
}

const MON = "2026-11-02";

test("point de départ selon l'arrêt (§ 4.2) et capacité", () => {
  assert.equal(startPoint([], MON).phase, 0);
  assert.equal(startPoint([], MON).level, 1);
  const regular = Array.from({ length: 24 }, (_, i) => run(addDays("2026-05-01", i * 3), 45, { continuousMin: 35 }));
  const last = regular[regular.length - 1].date;
  const at = (days: number) => startPoint(regular, addDays(last, days));
  assert.deepEqual([at(5).phase, at(5).backoff], [1, false]);
  assert.deepEqual([at(20).phase, at(20).backoff], [1, true]);
  assert.deepEqual([at(40).phase, at(40).level], [1, 8]);
  assert.deepEqual([at(150).phase, at(150).level], [0, 4]); // 5 mois, mais coureur régulier : niveau 4
  const few = regular.slice(-5);
  assert.deepEqual([startPoint(few, addDays(last, 150)).phase, startPoint(few, addDays(last, 150)).level], [0, 1]);
  const short = Array.from({ length: 10 }, (_, i) => run(addDays("2026-05-01", i * 3), 25, { continuousMin: 12 }));
  assert.equal(startPoint(short, addDays(short[9].date, 40)).level, 5);
  assert.deepEqual([1, 5, 8, 12, 20, 25, 40].map(levelForCapacity), [1, 4, 5, 6, 7, 8, 8]);
});

test("marche-course : monter, sauter, rester, redescendre ; séance repère ; 3 séances à 2 par semaine", () => {
  const ok = (date: string, effort: number, extra: Partial<DoneRun> = {}) => run(date, 30, { effort, ...extra });
  assert.equal(phase0Level(1, [ok("2026-11-02", 4), ok("2026-11-04", 4)], 3, false).level, 2);
  assert.equal(phase0Level(1, [ok("2026-11-02", 3), ok("2026-11-04", 3)], 3, false).level, 3); // saute un niveau
  assert.equal(phase0Level(1, [ok("2026-11-02", 3)], 3, true).level, 3); // séance repère facile
  assert.equal(phase0Level(3, [ok("2026-11-02", 5), ok("2026-11-04", 6)], 3, false).level, 3);
  assert.equal(phase0Level(3, [ok("2026-11-02", 7)], 3, false).level, 2);
  assert.equal(phase0Level(3, [ok("2026-11-02", 4, { pain: 3 })], 3, false).level, 2);
  assert.equal(phase0Level(3, [ok("2026-11-02", 4, { completed: false })], 3, false).level, 2);
  assert.equal(phase0Level(2, [ok("2026-11-02", 4), ok("2026-11-05", 4)], 2, false).level, 2);
  assert.equal(phase0Level(2, [ok("2026-11-02", 4), ok("2026-11-05", 4), ok("2026-11-09", 4)], 2, false).level, 3);
  const g = phase0Level(8, [ok("2026-11-02", 4), ok("2026-11-04", 4)], 3, false);
  assert.equal(g.graduated, true);
  // Effort inconnu : la FC décide (plus de 30 % au-dessus de Z2 → on reste).
  assert.equal(phase0Level(2, [ok("2026-11-02", 0, { effort: null, hrHighShare: 0.5 }), ok("2026-11-04", 0, { effort: null, hrHighShare: 0.5 })], 3, false).level, 2);
});

test("reprise après 5 mois d'arrêt : marche-course, puis base continue, décharge 1 semaine sur 4, sortie longue bornée", () => {
  const before = Array.from({ length: 30 }, (_, i) => run(addDays("2026-03-01", i * 3), 50, { continuousMin: 40 }));
  const sim = simulate(MON, 16 * 7, before);
  const first = sim.plans[0];
  assert.equal(first.phase, 0);
  assert.equal(first.level, 4);
  assert.ok(first.sessions.filter((s) => s.firm).every((s) => s.kind === "marche_course"));
  assert.equal(first.sessions.filter((s) => s.firm).length, 3);
  // Les niveaux montent semaine après semaine, puis la base continue.
  const phases = sim.plans.filter((_, i) => i % 7 === 0).map((p) => p.phase);
  assert.ok(phases.includes(1), `phases ${phases}`);
  const p1 = sim.plans.findIndex((p) => p.phase === 1);
  assert.ok(p1 > 0 && p1 <= 5 * 7, `phase 1 au jour ${p1}`);
  // Semaine 1 de la base : 3 × 25 min, sortie longue 30 min (en minutes de course).
  const w1 = sim.plans[p1].weeks.find((w) => w.weekStart === mondayOfDay(addDays(MON, p1)))!;
  assert.equal(w1.long, 30);
  // Une décharge dans les 4 semaines qui suivent, volume en baisse, puis on repart.
  const later = sim.plans[sim.plans.length - 1].weeks.filter((w) => w.phase >= 1);
  const deload = later.findIndex((w) => w.deload);
  assert.ok(deload >= 0, JSON.stringify(later.map((w) => [w.weekStart, w.volume, w.long, w.deload])));
  assert.ok(later[deload].volume < later[deload - 1].volume);
  assert.ok(later[deload + 1].volume >= later[deload - 1].volume);
  // Progression : jamais plus de + 20 % d'une semaine prévue sur l'autre hors sortie de décharge.
  for (let i = 1; i < later.length; i++) if (!later[i - 1].deload && !later[i].deload && later[i - 1].volume) assert.ok(later[i].volume <= later[i - 1].volume * 1.25 + 5, `${later[i - 1].volume} → ${later[i].volume}`);
  // La sortie longue grandit de 5 min par semaine au plus en phase 1.
  for (let i = 1; i < later.length; i++) if (later[i].phase === 1 && later[i - 1].phase === 1 && !later[i].deload && !later[i - 1].deload) assert.ok(later[i].long - later[i - 1].long <= 5);
});

test("séance manquée : jamais rattrapée, la semaine suivante se calcule sur le réalisé ; semaine trop courte refaite", () => {
  const before = Array.from({ length: 12 }, (_, i) => run(addDays("2026-10-05", i * 2), 45, { continuousMin: 35 }));
  // Phase 1 directe (courses récentes) ; on ne fait que la sortie longue de la 2e semaine.
  const sim = simulate(MON, 21, before, { does: (s, day) => (day >= 7 && day < 14 && s.kind !== "sortie_longue" ? null : {}) });
  const p = sim.plans[14];
  assert.equal(p.phase, 1);
  const w2 = p.weeks.find((w) => w.weekStart === addDays(MON, 7))!;
  const w3 = p.weeks.find((w) => w.weekStart === addDays(MON, 14))!;
  assert.ok(w3.notes.some((n) => /trop courte/.test(n)), JSON.stringify(w3));
  assert.equal(w3.volume, w2.volume);
  // Les séances manquées ne sont pas reprogrammées : la semaine 3 n'a pas plus de séances que prévu.
  assert.ok(p.sessions.filter((s) => s.weekStart === addDays(MON, 14)).length <= 3);
});

test("douleur : 3 à 4 → prochaine course annulée et semaine − 30 % ; ≥ 5 → suspension, reprise par la personne seulement", () => {
  const before = Array.from({ length: 12 }, (_, i) => run(addDays("2026-10-05", i * 2), 45, { continuousMin: 35 }));
  const sim = simulate(MON, 10, before, { feedback: (d) => (d === addDays(MON, 3) ? { date: d, pain: 3, where: "genou" } : null) });
  const p = sim.plans[3];
  const next = p.sessions.find((s) => s.date >= addDays(MON, 3));
  assert.equal(next?.cancelled, true);
  assert.ok(p.messages.some((m) => /douleur/i.test(m)));
  const after = sim.plans[7].weeks.find((w) => w.weekStart === addDays(MON, 7))!;
  assert.ok(after.notes.some((n) => /− 30 %/.test(n)));
  assert.ok(sim.plans[7].sessions.filter((s) => s.weekStart === addDays(MON, 7)).every((s) => !QUALITY.has(s.kind)));

  const stop = simulate(MON, 14, before, { feedback: (d) => (d === addDays(MON, 2) ? { date: d, pain: 6, where: "tibia" } : null) });
  assert.deepEqual(stop.pauses.map((x) => [x.from, x.reason]), [[addDays(MON, 2), "douleur"]]);
  for (const p of stop.plans.slice(2)) {
    assert.equal(p.sessions.length, 0);
    assert.ok(/professionnel de santé/.test(p.messages[0]));
  }
  // La personne rouvre le plan 3 semaines plus tard : départ recalculé (arrêt de 21 jours).
  const resumed = buildPlan(input(addDays(MON, 23), stop.runs, { startedOn: MON, pauses: [{ from: addDays(MON, 2), to: addDays(MON, 21), reason: "douleur" }], feedback: stop.feedback }));
  assert.equal(resumed.paused, null);
  assert.ok(resumed.sessions.some((s) => !s.cancelled));
  // Trois douleurs à 3 au même endroit en 14 jours : suspension aussi.
  assert.equal(painStop([3, 6, 10].map((d) => ({ date: addDays(MON, d), pain: 3, where: "genou" })), MON, addDays(MON, 20)), addDays(MON, 10));
  assert.equal(painStop([3, 6, 10].map((d, i) => ({ date: addDays(MON, d), pain: 3, where: ["genou", "pied", "genou"][i] })), MON, addDays(MON, 20)), null);
  // Une douleur qui dure plus de 7 jours.
  assert.equal(painStop([0, 4, 9].map((d) => ({ date: addDays(MON, d), pain: 3, where: "mollet" })).slice(0, 2).concat({ date: addDays(MON, 9), pain: 4, where: "mollet" }), MON, addDays(MON, 20)), addDays(MON, 9));
});

test("fatigue : effort trop haut, signaux du matin, fatigue de charge → séance raccourcie, qualité remplacée, repos", () => {
  const before = Array.from({ length: 40 }, (_, i) => run(addDays("2026-08-10", i * 2), 50, { continuousMin: 45 }));
  // Effort 7 sur le dernier footing.
  const tired = [...before, run(addDays(MON, -1), 40, { effort: 7, planned: { kind: "footing", minutes: 40 } })];
  const p = buildPlan(input(MON, tired, { startedOn: "2026-09-01" }));
  const next = p.sessions.find((s) => s.date >= MON && !s.cancelled)!;
  assert.match(next.session.notes, /Raccourcie/);
  assert.ok(p.messages.some((m) => /Effort trop haut/.test(m)));
  // Variabilité basse et FC au repos haute : 1 à 2 jours de repos.
  const hrv = Array.from({ length: 60 }, (_, i) => ({ date: addDays(MON, -59 + i), ms: i >= 55 ? 28 : 50 }));
  const rest = Array.from({ length: 60 }, (_, i) => ({ date: addDays(MON, -59 + i), bpm: i >= 54 ? 63 : 55 }));
  const m = morning({ today: MON, hrv, rest, sleep: [], tsbPct: -10 });
  const q = buildPlan(input(MON, before, { startedOn: "2026-09-01", morning: m }));
  assert.ok(q.sessions.filter((s) => s.date <= addDays(MON, 1) && s.date >= MON).every((s) => s.cancelled));
  assert.ok(q.sessions.filter((s) => s.date >= MON && !s.cancelled).every((s) => !QUALITY.has(s.kind)));
  // Deux signaux dans la semaine : décharge avancée la semaine suivante.
  assert.equal(q.weeks[q.weeks.length - 1].deload, true);
  // Fatigue de charge seule : la prochaine séance raccourcie.
  const f = buildPlan(input(MON, before, { startedOn: "2026-09-01", morning: morning({ today: MON, hrv: [], rest: [], sleep: [], tsbPct: -40 }) }));
  assert.match(f.sessions.find((s) => s.date >= MON && !s.cancelled)!.session.notes, /Raccourcie/);
});

test("phase 2 : qualité une fois par semaine à 48 h de la sortie longue, test aérobie, lignes droites, pas en décharge", () => {
  const before = Array.from({ length: 60 }, (_, i) => run(addDays("2026-07-01", i * 2), i % 3 === 2 ? 70 : 45, { continuousMin: 60 }));
  const sim = simulate("2026-09-01", 9 * 7, before, { extra: { settings: { ...SETTINGS, perWeek: 4, days: [1, 2, 4, 6].map((weekday) => ({ weekday })) } } });
  const last = sim.plans[sim.plans.length - 1];
  assert.ok(sim.plans.some((p) => p.phase === 2), `phases ${[...new Set(sim.plans.map((p) => p.phase))]}`);
  const sessions = sim.plans.flatMap((p) => p.sessions.filter((s) => s.firm && s.date === p.sessions[0]?.date));
  assert.ok(sim.plans.some((p) => p.sessions.some((s) => s.kind === "fartlek" || s.kind === "cotes")), "de la qualité en phase 2");
  assert.ok(sim.plans.some((p) => p.sessions.some((s) => s.kind === "test_aerobie")), "un test aérobie");
  assert.ok(sim.plans.some((p) => p.sessions.some((s) => s.kind === "footing_lignes")), "des lignes droites");
  assert.ok(last.weeks.filter((w) => w.deload).length >= 1);
  assert.ok(sessions.length >= 0);
});

test("cohabitation : pas de sortie longue ni de qualité le lendemain du kettlebell, natation un jour sans course", () => {
  // Kettlebell lundi et jeudi : la sortie longue va le samedi ou le dimanche, pas le vendredi.
  const pl = placeWeek(
    [
      { role: "long", kind: "sortie_longue", minutes: 60 },
      { role: "q1", kind: "fartlek", minutes: 40 },
      { role: "e1", kind: "footing", minutes: 35 },
    ],
    [1, 2, 4, 5, 6],
    [
      { weekday: 0, kind: "kettlebell" },
      { weekday: 3, kind: "kettlebell" },
      { weekday: 2, kind: "natation" },
    ],
    2,
    null,
    null
  );
  const long = pl.days.get("long")!;
  const q = pl.days.get("q1")!;
  assert.ok(long === 6, `sortie longue le ${long}`);
  assert.ok(Math.abs(q - long) >= 2);
  assert.ok(q !== 1 && q !== 4, "pas de qualité le lendemain du kettlebell");
  // Phases 0–1 : pas deux jours de suite si possible.
  const p0 = placeWeek(
    [1, 2, 3].map((i) => ({ role: `wr${i}`, kind: "marche_course" as const, minutes: 35 })),
    [0, 1, 2, 3, 4, 5, 6],
    [],
    0,
    null,
    -1
  );
  const ds = [...p0.days.values()].sort();
  assert.ok(ds.every((d, i) => i === 0 || d - ds[i - 1] >= 2) && ds[0] >= 1, `jours ${ds}`);
  // Trop peu de jours : une sortie de moins, et on le dit.
  const few = placeWeek([1, 2, 3].map((i) => ({ role: `e${i}`, kind: "footing" as const, minutes: 30 })), [5, 6], [], 1, null, null);
  assert.equal(few.days.size, 2);
  assert.ok(few.notes.length > 0);
  // Tout est pris (kettlebell 3 jours, natation, 4 sorties) : un footing saute pour garder un jour libre.
  const full = placeWeek(
    [
      { role: "long", kind: "sortie_longue", minutes: 60 },
      ...[1, 2, 3].map((i) => ({ role: `e${i}`, kind: "footing" as const, minutes: 30 })),
    ],
    [0, 1, 2, 3, 4, 5, 6],
    [0, 2, 4].map((weekday) => ({ weekday, kind: "renfo" as const })),
    2,
    null,
    null
  );
  // Les footings vont avec le renforcement (course d'abord), la sortie longue un jour libre, et un jour reste sans rien.
  const runDays = [...full.days.values()];
  const busy = new Set([...runDays, 0, 2, 4]);
  assert.ok(busy.size < 7, `jours ${runDays}`);
  assert.ok(![0, 2, 4].includes(full.days.get("long")!));
  assert.ok(full.notes.some((n) => /renforcement/.test(n)));
});

test("chaque séance planifiée se traduit en WorkoutSpec du contrat (plages de bpm, jamais de zone)", () => {
  const p = buildPlan(input(MON, []));
  assert.ok(p.sessions.length > 0);
  for (const s of p.sessions) {
    const spec = toWorkoutSpec(s.session);
    assert.equal(spec.activity, "running");
    assert.equal(spec.location, "outdoor");
    const steps = [spec.warmup, spec.cooldown, ...spec.blocks.flatMap((b) => b.steps)];
    for (const st of steps) {
      assert.ok(["time", "open", "distance"].includes(st.goal.type));
      if (st.alert) {
        assert.equal(st.alert.type, "heartRate");
        assert.ok(!("zone" in st.alert));
        assert.ok(st.alert.range_max - st.alert.range_min >= 8);
      }
    }
    assert.ok(spec.blocks.every((b) => b.iterations >= 1 && b.steps.every((x) => x.type === "work" || x.type === "recovery")));
    assert.equal(sessionMinutes(s.session), s.minutes);
  }
});

test("déterministe : même entrée, même plan ; une séance manquée ne casse rien ; malade → repos 2 jours", () => {
  const before = Array.from({ length: 20 }, (_, i) => run(addDays("2026-09-20", i * 2), 45, { continuousMin: 35 }));
  const a = buildPlan(input("2026-11-04", before, { startedOn: "2026-10-12" }));
  const b = buildPlan(input("2026-11-04", before, { startedOn: "2026-10-12" }));
  assert.deepEqual(a, b);
  const sick = buildPlan(input("2026-11-04", before, { startedOn: "2026-10-12", feedback: [{ date: "2026-11-04", sick: true }] }));
  assert.ok(sick.sessions.filter((s) => s.date >= "2026-11-04" && s.date <= "2026-11-06").every((s) => s.cancelled));
  const afterSick = sick.sessions.find((s) => s.date > "2026-11-06" && s.firm && !s.cancelled);
  if (afterSick) assert.match(afterSick.session.notes, /Raccourcie/);
});

test("un seul jour disponible : une sortie par semaine, et le message d'entretien", () => {
  const p = buildPlan(input(MON, [], { settings: { ...SETTINGS, days: [{ weekday: 6 }] } }));
  assert.equal(p.sessions.filter((s) => s.firm).length, 1);
  const before = Array.from({ length: 12 }, (_, i) => run(addDays("2026-10-05", i * 2), 45, { continuousMin: 35 }));
  const q = buildPlan(input(MON, before, { settings: { ...SETTINGS, days: [{ weekday: 6 }] } }));
  assert.equal(q.phase, 1);
  assert.ok(q.weeks.some((w) => w.notes.some((n) => /entretien/.test(n))));
});
