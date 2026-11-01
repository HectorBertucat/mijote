// Module Course : les formules de docs/course.md contre des valeurs calculées à la main (zones, charge,
// forme, règle des 30 jours, pente, découplage, VO2max, signaux du matin, tendances).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRun, decouplingReading, detraining, gradeFactor, rawGradeFactor, vdot, vo2Cost, vo2Effective, type RunInput } from "@/lib/running/analysis";
import { addDays } from "@/lib/running/dates";
import { acwr, effortX, fitness, fitPace, formBand, loadOfTrimp, loadOfX, longestBefore, longestRatio, monotony, sessionLoad, thresholdHour, trimpOf, type LoadRefs } from "@/lib/running/load";
import { clean, motionOf, peak30, resample, type HrPoint } from "@/lib/running/series";
import { morning } from "@/lib/running/signals";
import { intensityShare, regularity, rollingMedian, weeklyVolume, weekSpike } from "@/lib/running/trends";
import { alertRanges, hrRefs, observedMax, restAt, tanaka, zoneOf, zoneRange, zonesOf, type HrRefs } from "@/lib/running/zones";

const REFS: HrRefs = { max: 186, maxSource: "age", rest: 58, restSource: "mesuree", threshold: 160, thresholdSource: "estimee" };
const Z = zonesOf(REFS);
const LR: LoadRefs = { ...REFS, sex: "m" };
const near = (a: number, b: number, eps: number, msg?: string) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} ≉ ${b}`);

test("zones : Tanaka, réserve cardiaque (exemple FCmax 186, FCrepos 58), bornes et zone d'une FC", () => {
  assert.equal(tanaka(31), 186); // 208 − 21,7
  assert.equal(tanaka(40), 180);
  assert.deepEqual(Z.lows, [122, 135, 148, 160, 173]);
  assert.equal(Z.method, "reserve");
  assert.deepEqual(zoneRange(Z, 1), [122, 134]);
  assert.deepEqual(zoneRange(Z, 2), [135, 147]);
  assert.deepEqual(zoneRange(Z, 5), [173, 186]);
  assert.equal(zoneOf(121, Z), 0);
  assert.equal(zoneOf(122, Z), 1);
  assert.equal(zoneOf(147, Z), 2);
  assert.equal(zoneOf(148, Z), 3);
  assert.equal(zoneOf(200, Z), 5);
  // Alertes : footing du bas de Z1 + 5 au haut de Z2 ; jamais moins de 8 bpm.
  const a = alertRanges(Z);
  assert.deepEqual(a.easy, [127, 147]);
  assert.deepEqual(a.steady, [148, 172]);
  assert.ok(a.z2mid[1] - a.z2mid[0] >= 8);
  assert.deepEqual(a.tempo, [144, 152]);
});

test("zones : seuil par défaut à 80 % de la réserve ; seuil mesuré → zones de Friel", () => {
  const r = hrRefs({ age: 31, today: "2026-11-01", entered: {}, peaks: [], rest: [] });
  assert.equal(r.max, 186);
  assert.equal(r.maxSource, "age");
  assert.equal(r.rest, 60); // défaut sans mesure
  assert.equal(r.restSource, "defaut");
  assert.equal(r.threshold, Math.round(60 + 0.8 * 126));
  const f = zonesOf({ ...REFS, threshold: 165, thresholdSource: "test" });
  assert.equal(f.method, "friel");
  assert.deepEqual(f.lows, [122, Math.round(0.85 * 165), Math.round(0.9 * 165), Math.round(0.95 * 165), 165]);
  // Saisie : prime sur tout ; seuil incohérent (≥ FCmax) ignoré.
  const s = hrRefs({ age: 31, today: "2026-11-01", entered: { max: 192, rest: 52, threshold: 200 }, peaks: [], rest: [] });
  assert.deepEqual([s.max, s.maxSource, s.rest, s.restSource, s.thresholdSource], [192, "saisie", 52, "saisie", "estimee"]);
});

test("FCmax observée : pic confirmé à 5 bpm par une autre sortie, bornes autour de Tanaka, pic isolé « à confirmer »", () => {
  const peaks = [
    { date: "2026-09-01", peak: 195 },
    { date: "2026-09-10", peak: 189 },
    { date: "2026-09-20", peak: 191 },
    { date: "2026-09-25", peak: 240 }, // artefact, hors bornes
    { date: "2026-09-26", peak: 196, doubtful: true },
  ];
  const o = observedMax(peaks, 31, "2026-10-01");
  assert.equal(o.value, 195); // 191 est à 4 bpm : il confirme 195
});

test("FCmax observée : le plus haut pic confirmé, mise à jour mensuelle vers le haut seulement", () => {
  const peaks = [
    { date: "2026-08-01", peak: 192 },
    { date: "2026-08-15", peak: 188 },
    { date: "2026-09-02", peak: 199 },
  ];
  // 199 n'a personne à 5 bpm : isolé ; 192 et 188 se confirment (192).
  assert.deepEqual(observedMax(peaks, 31, "2026-10-01"), { value: 192, pending: 199 });
  const r = hrRefs({ age: 31, today: "2026-10-12", entered: {}, peaks, rest: [] });
  assert.equal(r.max, 192);
  assert.equal(r.maxSource, "observee");
  // Une observée sous Tanaka ne sert pas.
  assert.equal(hrRefs({ age: 31, today: "2026-10-12", entered: {}, peaks: [{ date: "2026-09-01", peak: 175 }, { date: "2026-09-03", peak: 174 }], rest: [] }).maxSource, "age");
});

test("FC au repos : médiane des 30 jours (7 mesures au moins), sinon la dernière de moins de 90 jours", () => {
  const xs = Array.from({ length: 10 }, (_, i) => ({ date: addDays("2026-10-01", i), bpm: 50 + i }));
  assert.equal(restAt(xs, "2026-10-20"), Math.round((54 + 55) / 2));
  assert.equal(restAt(xs.slice(0, 5), "2026-10-20"), null);
  // Plus rien dans les 30 jours : la dernière médiane connue (fenêtre du 4 au 10 octobre : 53 à 59).
  assert.equal(restAt(xs, "2026-11-25"), 56);
  assert.equal(restAt(xs, "2027-02-01"), null);
});

test("charge : TRIMP de Banister normalisé (40 min à 140 bpm → 39 points), table effort → charge d'une heure", () => {
  near(thresholdHour(LR), 142.7, 0.05, "TRIMP seuil 1 h");
  const hr = new Array(40 * 60).fill(140);
  const t = trimpOf(hr, LR);
  near(t.trimp, 56.1, 0.05, "TRIMP");
  assert.equal(Math.round(loadOfTrimp(t.trimp, LR)), 39);
  assert.equal(Math.round(sessionLoad({ kind: "footing", minutes: 40, hr }, LR).load), 39);
  const table = [23, 35, 51, 65, 80, 94, 110, 128, 149, 168];
  for (let e = 1; e <= 10; e++) assert.equal(Math.round(loadOfX(effortX(e), 60, LR)), table[e - 1], `effort ${e}`);
  // Femme et sexe non renseigné : leurs coefficients.
  assert.ok(loadOfX(0.7, 60, { ...LR, sex: "f" }) > 0);
  assert.ok(loadOfX(0.7, 60, { ...LR, sex: null }) > 0);
});

test("charge sans série : FC moyenne > effort > allure > défaut ; natation et renforcement : l'effort d'abord", () => {
  assert.equal(sessionLoad({ kind: "footing", minutes: 40, hrAvg: 140, effort: 8 }, LR).source, "fc_moyenne");
  assert.equal(Math.round(sessionLoad({ kind: "footing", minutes: 40, hrAvg: 140 }, LR).load), 39);
  assert.equal(sessionLoad({ kind: "footing", minutes: 40, effort: 4 }, LR).source, "effort");
  assert.equal(sessionLoad({ kind: "natation", minutes: 40, hrAvg: 130, effort: 5 }, LR).source, "effort");
  assert.equal(sessionLoad({ kind: "kettlebell", minutes: 40, hrAvg: 130 }, LR).source, "fc_moyenne");
  const fit = fitPace([2.4, 2.6, 2.8, 3.0, 3.2].map((v) => ({ speed: v, hr: 100 + 15 * v })));
  assert.ok(fit && Math.abs(fit.b - 15) < 1e-9 && Math.abs(fit.a - 100) < 1e-9);
  assert.equal(fitPace([{ speed: 3, hr: 140 }]), null);
  assert.equal(sessionLoad({ kind: "footing", minutes: 40, speed: 2.8 }, LR, fit).source, "allure");
  assert.equal(sessionLoad({ kind: "natation", minutes: 40, speed: 2.8 }, LR, fit).source, "defaut");
  // Une série qui ne couvre pas 80 % de la durée ne sert pas.
  assert.equal(sessionLoad({ kind: "footing", minutes: 40, hr: new Array(600).fill(140), hrAvg: 140 }, LR).source, "fc_moyenne");
  near(sessionLoad({ kind: "marche", minutes: 60 }, LR).load, loadOfX(0.35, 60, LR), 1e-9);
});

test("condition, fatigue, fraîcheur : 1 − e^(−1/τ), fraîcheur du matin, % affiché à partir de 5", () => {
  const f = fitness([{ date: "2026-10-01", load: 100 }], "2026-10-01", "2026-10-03");
  const kc = 1 - Math.exp(-1 / 42);
  const ka = 1 - Math.exp(-1 / 7);
  near(f[0].ctl, 100 * kc, 1e-9);
  near(f[0].atl, 100 * ka, 1e-9);
  assert.equal(f[0].tsb, 0); // le matin, avant la séance
  near(f[1].tsb, 100 * kc - 100 * ka, 1e-9);
  assert.equal(f[1].tsbPct, null); // condition sous 5
  // Charge régulière : la condition monte, la fraîcheur en %.
  const daily = Array.from({ length: 120 }, (_, i) => ({ date: addDays("2026-06-01", i), load: 50 }));
  const g = fitness(daily, "2026-06-01", "2026-09-28");
  const last = g[g.length - 1];
  assert.ok(last.ctl > 40 && last.atl > last.ctl);
  assert.ok(last.tsbPct != null && last.tsbPct < 0);
  assert.deepEqual([25, 10, 0, -20, -35].map(formBand), ["transition", "frais", "neutre", "productif", "risque"]);
});

test("ACWR découplé (indicatif), monotonie", () => {
  const daily = Array.from({ length: 35 }, (_, i) => ({ date: addDays("2026-10-01", i), load: i >= 28 ? 60 : 40 }));
  const a = acwr(daily, "2026-11-04")!;
  near(a.value, (7 * 60) / (28 * 40 / 4), 1e-9);
  assert.equal(a.inBand, false);
  assert.equal(acwr([], "2026-11-04"), null);
  const m = monotony([{ date: "2026-11-04", load: 70 }, { date: "2026-11-02", load: 70 }], "2026-11-04")!;
  near(m.value, 20 / Math.sqrt((2 * 50 ** 2 + 5 * 20 ** 2) / 6), 1e-9);
});

test("règle des 30 jours : R et ses catégories (Frandsen 2025)", () => {
  const runs = [
    { date: "2026-10-01", value: 8 },
    { date: "2026-10-20", value: 10 },
    { date: "2026-09-01", value: 30 }, // plus de 30 jours avant
  ];
  assert.equal(longestBefore(runs, "2026-10-25"), 10);
  assert.equal(longestRatio(11, 10).category, "dans_la_regle");
  assert.equal(longestRatio(12, 10).category, "petit_pic");
  assert.equal(longestRatio(15, 10).category, "pic_moyen");
  assert.equal(longestRatio(21, 10).category, "grand_pic");
  assert.equal(longestRatio(5, null).category, "reprise");
});

test("allure ajustée à la pente : table de Minetti, g borné à ±0,20, plancher de 0,80 en descente", () => {
  const table: [number, number][] = [
    [-0.15, 0.51],
    [-0.1, 0.6],
    [-0.05, 0.76],
    [-0.02, 0.9],
    [0, 1],
    [0.02, 1.11],
    [0.05, 1.3],
    [0.1, 1.66],
    [0.15, 2.06],
  ];
  for (const [g, f] of table) near(rawGradeFactor(g), f, 0.006, `pente ${g}`);
  assert.equal(gradeFactor(-0.1), 0.8);
  assert.equal(gradeFactor(0.5), gradeFactor(0.2));
  near(gradeFactor(0.05), 1.3, 0.006);
});

test("VO2max effective et VDOT (Daniels et Gilbert) ; désentraînement", () => {
  const v = 1000 / 7.5;
  near(vo2Cost(v), 21.5, 0.06);
  near(vo2Effective(v, 0.64), 31.7, 0.06);
  // 5 km en 25 min : VDOT ≈ 38,3 (tables de Daniels).
  near(vdot(5000, 25 * 60), 38.3, 0.2);
  assert.equal(detraining(3, false), 1);
  assert.equal(detraining(28, false), 0.931);
  assert.equal(detraining(42, true), 0.944);
  assert.equal(detraining(120, false), 0.8);
  assert.deepEqual([-3, 3, 6, 9].map(decouplingReading), ["artefact", "bon", "correct", "marque"]);
});

test("séries : 1 Hz par interpolation (trou au-delà de 10 s), pics retirés, verrouillage sur la cadence, pic de 30 s", () => {
  const hz = resample([
    [0, 100],
    [5, 110],
    [30, 120],
  ]);
  assert.equal(hz[0], 100);
  assert.equal(hz[2], 104);
  assert.equal(hz[5], 110);
  assert.equal(hz[10], null); // 25 s sans mesure
  assert.equal(hz[30], 120);
  // Un pic de 40 bpm pendant 4 s : retiré ; une montée lente : gardée.
  const base: HrPoint[] = Array.from({ length: 120 }, (_, t) => [t, 140]);
  base[60] = [60, 185];
  base[61] = [61, 186];
  const c = clean(resample(base));
  assert.equal(c.hr[60], null);
  assert.equal(c.hr[59], 140);
  assert.equal(c.removed, 2);
  assert.equal(c.doubtful, false);
  const ramp = clean(resample(Array.from({ length: 300 }, (_, t) => [t, 120 + t / 5] as HrPoint)));
  assert.equal(ramp.removed, 0);
  // Verrouillage : une minute collée à la cadence (165), montée en 10 s (pas un pic), bien au-dessus de la médiane.
  const lock: HrPoint[] = Array.from({ length: 600 }, (_, t) => [t, t < 290 || t >= 360 ? 138 : t < 300 ? 138 + 2.7 * (t - 290) : 165]);
  const l = clean(resample(lock), 165);
  assert.ok(l.hr.slice(300, 360).every((v) => v == null));
  assert.equal(clean(resample(lock)).hr[330], 165); // sans cadence : gardée
  assert.equal(peak30(resample(Array.from({ length: 100 }, (_, t) => [t, t < 50 ? 150 : 170] as HrPoint))), 170);
  assert.equal(peak30(new Array(20).fill(170)), null); // moins de 25 s
  // Plus de 20 % retiré : FC douteuse.
  assert.equal(clean(resample(Array.from({ length: 100 }, (_, t) => [t, t % 3 ? 140 : 20] as HrPoint))).doubtful, true);
});

test("vitesse par seconde depuis les temps au kilomètre, pauses de la montre comprises", () => {
  const m = motionOf(
    [
      { km: 1, sec: 400, elevGainM: 10, elevLossM: 0 },
      { km: 1.5, sec: 200 },
    ],
    [{ type: "pause", t: 100, durSec: 30 }]
  );
  assert.equal(m.speed.length, 630);
  assert.equal(m.speed[0], 2.5);
  assert.equal(m.speed[110], 0); // en pause
  assert.equal(m.split[110], -1);
  assert.equal(m.speed[200], 2.5);
  assert.equal(m.speed[500], 2.5); // 500 − 30 = 470 s actives : 2e tronçon
  assert.equal(m.split[500], 1);
  assert.equal(m.grade[0], 0.01);
  assert.equal(m.grade[500], null);
});

/** Une sortie synthétique : allure constante, FC qui dérive de `drift` bpm sur la sortie. */
function synthetic(minutes: number, bpm: number, drift: number, paceSecKm = 420, extra: Partial<RunInput["details"]> = {}): RunInput {
  const n = minutes * 60;
  const hr: HrPoint[] = [];
  for (let t = 0; t <= n; t += 5) hr.push([t, Math.round(t < 300 ? 100 + ((bpm - 100) * t) / 300 : bpm + (drift * (t - 300)) / (n - 300))]);
  const km = n / paceSecKm;
  const splits = Array.from({ length: Math.ceil(km) }, (_, i) => ({ km: Math.min(i + 1, Math.round(km * 100) / 100), sec: Math.round(paceSecKm * Math.min(1, km - i)) }));
  return { kind: "footing", minutes, distanceM: km * 1000, details: { hr, splits, ...extra } };
}

test("analyse d'une sortie : temps par zone, temps au km, EF, découplage et ses conditions, VO2max effective, allure en Z2", () => {
  const a = analyzeRun(synthetic(50, 140, 4), Z, LR);
  assert.equal(a.distanceKm, round2((50 * 60) / 420));
  assert.equal(a.pace, 420);
  assert.equal(a.splits.length, 8);
  assert.equal(a.splits[0].pace, 420);
  assert.ok(a.zoneSec[2] > 0.85 * (a.runMin * 60), "presque tout en Z2");
  assert.ok(a.seiler.easy > 0.95 * (a.seiler.easy + a.seiler.moderate + a.seiler.hard));
  assert.equal(a.loadSource, "serie");
  assert.ok(a.decoupling.ok);
  if (a.decoupling.ok) {
    assert.ok(a.decoupling.value > 0 && a.decoupling.value < 5, `découplage ${a.decoupling.value}`);
    assert.equal(a.decoupling.drift, 2);
    assert.equal(a.decoupling.reading, "bon");
  }
  assert.ok(a.ef! > 0.9 && a.ef! < 1.1);
  assert.ok(a.vo2 != null && a.vo2 > 25 && a.vo2 < 45);
  assert.ok(a.z2Speed != null && Math.abs(a.z2Speed - 1000 / 420) < 0.01);
  assert.equal(a.continuousMin, 50);
  // Trop courte, ou trop intense : non calculable, et pourquoi.
  const short = analyzeRun(synthetic(30, 140, 2), Z, LR);
  assert.equal(short.decoupling.ok, false);
  const hard = analyzeRun(synthetic(50, 165, 4), Z, LR);
  assert.equal(hard.decoupling.ok, false);
  if (!hard.decoupling.ok) assert.match(hard.decoupling.reason, /endurance/);
  assert.ok(hard.hrHighShare! > 0.9);
  // Chaleur : signalée, pas de VO2max.
  const hot = analyzeRun(synthetic(50, 140, 10, 420, { weather: { tempC: 28 } }), Z, LR);
  assert.equal(hot.heat, true);
  assert.equal(hot.vo2, null);
  // Dérive marquée.
  const drifty = analyzeRun(synthetic(60, 125, 22), Z, LR);
  assert.ok(drifty.decoupling.ok && drifty.decoupling.value > 5 && drifty.decoupling.drift >= 9, JSON.stringify(drifty.decoupling));
});

test("analyse : marche-course (pas de découplage), sans détail (FC moyenne, durée), pente prise en compte", () => {
  // 8 × (1 min à 8:00/km, 1 min 30 à 12:30/km) : la course et la marche sont séparées par km… approchées.
  const wr = analyzeRun({ kind: "marche_course", minutes: 30, distanceM: 3000, hrAvg: 128 }, Z, LR);
  assert.equal(wr.decoupling.ok, false);
  assert.equal(wr.loadSource, "fc_moyenne");
  const bare = analyzeRun({ kind: "footing", minutes: 40 }, Z, LR);
  assert.equal(bare.loadSource, "defaut");
  assert.equal(bare.distanceKm, null);
  // En montée de 5 %, l'allure ajustée est plus rapide que l'allure.
  const hill = analyzeRun(
    { kind: "footing", minutes: 15, distanceM: 2000, details: { splits: [{ km: 1, sec: 450, elevGainM: 50, elevLossM: 0 }, { km: 2, sec: 450, elevGainM: 0, elevLossM: 50 }], elevGainM: 50, elevLossM: 50 } },
    Z,
    LR
  );
  assert.ok(hill.splits[0].gap < hill.splits[0].pace);
  assert.equal(hill.splits[1].gap, Math.round(450 / 0.8)); // descente : plancher 0,80
});

const round2 = (x: number) => Math.round(x * 100) / 100;

test("signaux du matin : ln(SDNN) 7 j sous la bande des 60 j, FC au repos +5, sommeil < 6 h deux nuits, fatigue, chaleur", () => {
  const today = "2026-11-01";
  const hrv = Array.from({ length: 60 }, (_, i) => ({ date: addDays(today, -59 + i), ms: i >= 55 ? 30 : 50 + (i % 5) }));
  const rest = Array.from({ length: 60 }, (_, i) => ({ date: addDays(today, -59 + i), bpm: i >= 54 ? 62 : 54 }));
  const m = morning({ today, hrv, rest, sleep: [{ date: today, asleepMin: 340 }, { date: addDays(today, -1), asleepMin: 350 }], tsbPct: -35, temps: [{ date: today, tempC: 27 }] });
  assert.equal(m.hrv!.low, true);
  assert.equal(m.rest!.high, true);
  assert.equal(m.shortSleep, true);
  assert.equal(m.fatigue, true);
  assert.equal(m.heat, true);
  assert.deepEqual(m.signals.map((s) => s.kind), ["hrv_basse", "fc_repos_haute", "sommeil_court", "fatigue", "chaleur"]);
  // Pas assez de mesures : pas de signal.
  const none = morning({ today, hrv: hrv.slice(0, 10), rest: [], sleep: [{ date: today, asleepMin: 300 }], tsbPct: null });
  assert.deepEqual(none.signals, []);
  // Deux matins de suite à + 7.
  const two = morning({ today, hrv: [], rest: rest.map((r, i) => ({ ...r, bpm: i >= 58 ? 62 : 54 })), sleep: [], tsbPct: 0 });
  assert.equal(two.rest!.high, true);
});

test("tendances : volume par semaine empilé, régularité, médiane glissante, répartition 80/20, alerte de volume", () => {
  const runs = [
    { date: "2026-10-05", minutes: 30, km: 4, seiler: { easy: 1500, moderate: 300, hard: 0 } },
    { date: "2026-10-08", minutes: 40, km: 5.5, seiler: null },
    { date: "2026-10-13", minutes: 30, km: 4 },
    { date: "2026-10-15", minutes: 30, km: 4 },
    { date: "2026-10-21", minutes: 90, km: 12, seiler: { easy: 4000, moderate: 1000, hard: 400 } },
  ];
  const w = weeklyVolume(runs, "2026-10-25", 3);
  assert.deepEqual(w.map((x) => x.weekStart), ["2026-10-05", "2026-10-12", "2026-10-19"]);
  assert.deepEqual(w.map((x) => x.minutes), [70, 60, 90]);
  assert.equal(w[0].easyMin, 25);
  assert.equal(w[0].moderateMin, 5);
  assert.equal(w[0].unknownMin, 40);
  assert.equal(w[2].longestKm, 12);
  assert.equal(weekSpike(w)!.ratio, round2(90 / 65));
  assert.deepEqual(regularity(runs, "2026-10-26"), { weeks: 2, of: 8 });
  const s = intensityShare(runs, "2026-10-25")!;
  assert.equal(s.ok, false);
  const r = rollingMedian([
    { date: "2026-09-01", value: 2.5 },
    { date: "2026-09-08", value: 2.7 },
    { date: "2026-09-15", value: null },
    { date: "2026-09-22", value: 9, excluded: true },
    { date: "2026-10-19", value: 2.9 }, // 6 semaines : le 1er septembre sort, le 8 reste
  ]);
  assert.deepEqual(r.map((x) => x.median), [2.5, 2.6, 2.8]);
});
