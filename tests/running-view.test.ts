// Interface du module Course (src/lib/running/view.ts) : séance du jour, état sur la montre, blocs lisibles et
// profil, phrase « pourquoi », semaine, frise des phases, forme en mots, allure à FC égale, conseils de
// nutrition, prévu / fait, découplage et efficacité en une phrase, série réduite, ressenti à demander. Pur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "@/lib/running/dates";
import { fitness } from "@/lib/running/load";
import {
  decouplingText,
  downsample,
  durText,
  efficiencyTrend,
  efText,
  feedbackDue,
  formWords,
  fuelAdvice,
  paceText,
  phaseTrack,
  pickSession,
  planCompare,
  readableBlocks,
  sessionProfile,
  watchState,
  weekDays,
  weekSentence,
  whyLine,
  zoneSpan,
  type PlannedRow,
} from "@/lib/running/view";
import { fartlek, footing, longRun, walkRun } from "@/lib/running/workout";
import { zonesOf } from "@/lib/running/zones";

const Z = zonesOf({ max: 186, maxSource: "age", rest: 58, restSource: "mesuree", threshold: 160, thresholdSource: "estimee" });
const TODAY = "2026-11-04"; // mercredi

const row = (date: string, status: PlannedRow["status"], extra: Partial<PlannedRow> = {}): PlannedRow => ({
  id: `s-${date}`,
  date,
  time: "18:30",
  kind: "footing",
  minutes: 35,
  status,
  session: footing(35, Z),
  version: 1,
  watchVersion: null,
  watchError: null,
  sampleId: null,
  ...extra,
});

test("formats : allure, durées", () => {
  assert.equal(paceText(402.4), "6:42");
  assert.equal(paceText(null), "—");
  assert.equal(durText(45), "45 s");
  assert.equal(durText(2100), "35 min");
  assert.equal(durText(150), "2 min 30");
  assert.equal(durText(3900), "1 h 05");
});

test("séance du jour : celle du jour si elle reste à faire, sinon la prochaine ; faite et annulée signalées", () => {
  const rows = [row("2026-11-03", "faite"), row("2026-11-04", "programmee"), row("2026-11-06", "prevue")];
  let p = pickSession(rows, TODAY);
  assert.equal(p.when, "today");
  assert.equal(p.row?.date, TODAY);

  p = pickSession([row("2026-11-04", "faite", { sampleId: "w1" }), row("2026-11-06", "prevue")], TODAY);
  assert.equal(p.when, "next");
  assert.equal(p.row?.date, "2026-11-06");
  assert.equal(p.doneToday?.sampleId, "w1");

  p = pickSession([row("2026-11-04", "annulee"), row("2026-11-08", "prevue"), row("2026-11-06", "manquee")], TODAY);
  assert.equal(p.row?.date, "2026-11-08");
  assert.equal(p.cancelledToday?.date, TODAY);

  assert.deepEqual(pickSession([row("2026-11-02", "faite")], TODAY), { row: null, when: null, doneToday: null, cancelledToday: null });
});

test("montre : programmée à la version en cours, mise à jour attendue, refus, montre qui ne prend pas, à programmer", () => {
  assert.equal(watchState(row(TODAY, "programmee", { watchVersion: 1 }), null).kind, "montre");
  assert.equal(watchState(row(TODAY, "prevue", { version: 3, watchVersion: 2 }), { supported: true, authorized: true }).kind, "maj");
  const err = watchState(row(TODAY, "prevue", { watchError: "pas de place" }), null);
  assert.equal(err.kind, "erreur");
  assert.match(err.text, /pas de place/);
  assert.equal(watchState(row(TODAY, "prevue"), { supported: false, authorized: false }).kind, "non_pris");
  assert.equal(watchState(row(TODAY, "prevue"), { supported: true, authorized: false }).kind, "non_autorise");
  assert.equal(watchState(row(TODAY, "prevue"), null).kind, "a_programmer");
});

test("blocs lisibles : échauffement, répétitions, retour au calme, cibles en bpm et en zone ; profil déroulé", () => {
  assert.equal(zoneSpan([127, 147], Z), "Z1–Z2");
  assert.equal(zoneSpan([140, 146], Z), "Z2");
  assert.equal(zoneSpan([100, 110], Z), "Z1"); // sous les zones : on dit Z1

  const b = readableBlocks(walkRun(3, Z), Z);
  assert.equal(b[0].steps[0].role, "warmup");
  assert.equal(b[b.length - 1].steps[0].role, "cooldown");
  const reps = b[1];
  assert.equal(reps.reps, 5);
  assert.equal(reps.steps[0].role, "work");
  assert.equal(reps.steps[0].seconds, 180);
  assert.ok(reps.steps[0].hr && reps.steps[0].zone === zoneSpan(reps.steps[0].hr, Z));
  assert.equal(reps.steps[1].role, "recovery");
  assert.equal(reps.steps[1].hr, null);
  assert.equal(reps.seconds, 5 * (180 + 60));

  const prof = sessionProfile(walkRun(3, Z), Z);
  assert.equal(prof.length, 1 + 5 * 2 + 1);
  assert.equal(prof.reduce((s, p) => s + p.seconds, 0), 300 + 5 * 240 + 300);
  assert.ok(prof.every((p) => p.level >= 1 && p.level <= 5));

  const f = sessionProfile(fartlek(6, Z), Z);
  assert.ok(Math.max(...f.map((p) => p.level)) >= 3); // le soutenu monte au-dessus de l'endurance
});

test("pourquoi cette séance : phase, progression, apport, signal du matin d'abord, sinon la fraîcheur", () => {
  const base = { phase: 1 as const, level: null, weekInPhase: 3, week: { volume: 90, long: 35, deload: false }, prevVolume: 80, kind: "sortie_longue" as const, signals: [], tsbPct: -20, adapted: false };
  const w = whyLine(base);
  assert.match(w[0], /Base continue, semaine 3 : 90 min de course prévues, \+13 % sur la semaine d’avant\./);
  assert.match(w[1], /plus longue des 30 derniers jours/);
  assert.match(w[2], /encaisses la charge/);
  assert.match(whyLine({ ...base, week: { volume: 63, long: 30, deload: true } })[0], /semaine allégée/);
  assert.match(whyLine({ ...base, signals: ["chaleur", "hrv_basse"] })[2], /Variabilité/); // la chaleur passe après
  assert.match(whyLine({ ...base, phase: 0, level: 4, kind: "marche_course" })[0], /niveau 4 sur 8/);
  assert.equal(whyLine({ ...base, tsbPct: null }).length, 2);
  assert.match(whyLine({ ...base, tsbPct: null, adapted: true }).at(-1)!, /ajustée/);
});

test("la semaine : sept jours, courses faites, autres sports, activités fixes à venir ; la phrase", () => {
  const rows = [row("2026-11-03", "faite", { sampleId: "w1" }), row("2026-11-05", "prevue"), row("2026-11-08", "prevue", { kind: "sortie_longue", minutes: 50 }), row("2026-11-02", "manquee")];
  const days = weekDays(TODAY, rows, [{ sampleId: "w1", date: "2026-11-03", minutes: 36, km: 5.2, plannedId: "s-2026-11-03" }], [{ date: "2026-11-02", kind: "natation", minutes: 40 }], [
    { weekday: 0, kind: "natation" },
    { weekday: 4, kind: "kettlebell" },
  ]);
  assert.equal(days.length, 7);
  assert.equal(days[0].date, "2026-11-02");
  assert.equal(days[2].today, true);
  assert.deepEqual(days[0].others, [{ kind: "natation", minutes: 40 }]);
  assert.deepEqual(days[0].fixed, []); // passé : on ne prévoit plus
  assert.deepEqual(days[4].fixed, ["kettlebell"]);
  assert.equal(days[1].runs[0].sampleId, "w1");
  assert.equal(weekSentence(days), "1 sortie faite sur 4, 36 min de course, 1 manquée, sans rattrapage.");
  assert.match(weekSentence(weekDays(TODAY, [row("2026-11-03", "faite")], [], [], [])), /Semaine bouclée/);
});

test("frise des phases : jusqu'à celle de l'objectif, au moins la phase en cours", () => {
  assert.deepEqual(phaseTrack(1, "plus_longtemps").map((p) => p.state), ["faite", "en_cours", "a_venir"]);
  assert.equal(phaseTrack(0, "semi").length, 4);
  assert.equal(phaseTrack(2, "reprendre").length, 3); // déjà au-delà de l'objectif : la phase en cours reste
});

test("forme en mots : forme, fatigue, fraîcheur et sa bande, variation sur 4 semaines", () => {
  const daily = Array.from({ length: 70 }, (_, i) => ({ date: addDays("2026-08-01", i), load: i % 2 ? 45 : 0 }));
  const days = fitness(daily, "2026-08-01", "2026-10-09");
  const f = formWords(days)!;
  assert.equal(f.forme, Math.round(days.at(-1)!.ctl));
  assert.ok(f.delta28! > 0);
  assert.match(f.sentence, /^Forme \d+, en hausse de \d+ en quatre semaines\. Fatigue \d+\. Fraîcheur/);
  assert.ok(f.band);
  const fresh = formWords(fitness([{ date: "2026-10-01", load: 10 }], "2026-10-01", "2026-10-03"))!;
  assert.equal(fresh.fraicheur, null);
  assert.match(fresh.sentence, /Pas encore assez/);
  assert.equal(formWords([]), null);
});

test("allure à FC égale : tendance sur six semaines, sorties exclues mises de côté", () => {
  const runs = Array.from({ length: 12 }, (_, i) => ({ date: addDays("2026-09-01", i * 4), z2Speed: 2.4 + i * 0.02 }));
  runs.push({ date: "2026-10-20", z2Speed: 1.5, excluded: true } as (typeof runs)[number] & { excluded: boolean });
  const t = efficiencyTrend(runs, "2026-10-21");
  assert.equal(t.points.length, 12);
  assert.match(t.sentence, /s\/km plus vite/);
  assert.match(efficiencyTrend(runs.slice(0, 2), "2026-10-21").sentence, /quelques sorties/);
  const flat = efficiencyTrend(Array.from({ length: 6 }, (_, i) => ({ date: addDays("2026-09-01", i * 7), z2Speed: 2.5 })), "2026-10-21");
  assert.match(flat.sentence, /tient/);
});

test("nutrition (§ 5) : rien sous une heure, en-cas de 60 à 75 min, glucides et pas de déficit au-delà ; garde-fous", () => {
  assert.equal(fuelAdvice({ minutes: 45, hot: false, deficitKcal: 400, weekRunMin: 120 }), null);
  const mid = fuelAdvice({ minutes: 70, hot: false, deficitKcal: null, weekRunMin: 150 })!;
  assert.match(mid.lines.join(" "), /en-cas/);
  const long = fuelAdvice({ minutes: 90, hot: false, deficitKcal: 300, weekRunMin: 150 })!;
  assert.match(long.title, /Sortie longue/);
  assert.match(long.lines.join(" "), /30 à 60 g de glucides par heure/);
  assert.match(long.lines.join(" "), /Pas de déficit aujourd’hui/);
  assert.doesNotMatch(fuelAdvice({ minutes: 90, hot: false, deficitKcal: -100, weekRunMin: 150 })!.lines.join(" "), /déficit/);
  assert.match(fuelAdvice({ minutes: 40, hot: true, deficitKcal: null, weekRunMin: 100 })!.lines[0], /Chaleur/);
  assert.match(fuelAdvice({ minutes: 40, hot: false, deficitKcal: 600, weekRunMin: 200 })!.lines[0], /déficit est fort/);
});

test("prévu / fait : comme prévu, plus courte, plus longue, plus intense, hors plan", () => {
  const p = { kind: "footing" as const, minutes: 40 };
  assert.equal(planCompare(p, { movingMin: 41, hrHighShare: 0.05, easyShare: 0.92 }).verdict, "comme_prevu");
  assert.match(planCompare(p, { movingMin: 41, hrHighShare: 0.05, easyShare: 0.92 }).text, /92 % en facile/);
  assert.equal(planCompare(p, { movingMin: 30, hrHighShare: 0, easyShare: null }).verdict, "plus_court");
  assert.equal(planCompare(p, { movingMin: 50, hrHighShare: 0, easyShare: null }).verdict, "plus_long");
  assert.equal(planCompare(p, { movingMin: 40, hrHighShare: 0.45, easyShare: 0.5 }).verdict, "plus_intense");
  assert.equal(planCompare({ kind: "fartlek", minutes: 40 }, { movingMin: 40, hrHighShare: 0.45, easyShare: 0.5 }).verdict, "comme_prevu"); // le soutenu est prévu
  assert.equal(planCompare(null, { movingMin: 33, hrHighShare: null, easyShare: null }).verdict, "libre");
});

test("découplage et efficacité en une phrase", () => {
  assert.match(decouplingText({ ok: true, value: 3.2, drift: 4, reading: "bon" }, false), /3,2 % \(\+4 bpm.*L’endurance tient/);
  assert.match(decouplingText({ ok: true, value: 9.1, drift: 11, reading: "marque" }, true), /dérivé.*chaud/);
  assert.match(decouplingText({ ok: false, reason: "trop court" }, false), /non calculé : trop court\./);
  assert.equal(efText(null, 1.2), null);
  assert.match(efText(1.32, 1.2)!, /\+10 %/);
  assert.match(efText(1.2, 1.2)!, /Comme tes dernières/);
  assert.match(efText(1.2, null)!, /monte à mesure/);
});

test("série réduite : moyenne par tranche, ordre gardé, rien à faire sous le plafond", () => {
  const pts: [number, number][] = Array.from({ length: 2000 }, (_, i) => [i * 3, 100 + (i % 10)]);
  const d = downsample(pts, 300);
  assert.ok(d.length <= 300 && d.length > 290);
  assert.ok(d.every((p, i) => i === 0 || p[0] > d[i - 1][0]));
  assert.ok(d.every((p) => p[1] >= 100 && p[1] <= 109));
  assert.equal(downsample(pts.slice(0, 10), 300).length, 10);
});

test("ressenti à demander : la dernière sortie des 2 jours, si rien n'est noté ce jour-là", () => {
  const runs = [{ date: "2026-11-01" }, { date: "2026-11-03" }];
  assert.equal(feedbackDue(runs, new Set(), TODAY)?.date, "2026-11-03");
  assert.equal(feedbackDue(runs, new Set(["2026-11-03"]), TODAY), null);
  assert.equal(feedbackDue([{ date: "2026-10-30" }], new Set(), TODAY), null);
  assert.ok(longRun(60, Z)); // les constructeurs restent la source des séances
});
