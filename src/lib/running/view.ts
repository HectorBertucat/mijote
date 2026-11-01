// Ce que montre l'interface du module Course, calculé en code (docs/course.md § 7) : la séance du jour ou la
// prochaine, ses blocs lisibles (cibles en bpm et en zone) et son profil, son état sur la montre, la phrase
// « pourquoi cette séance », la semaine jour par jour, la frise des phases, la forme en mots simples, la
// tendance d'allure à FC égale, les conseils de nutrition du § 5, la comparaison prévu / fait d'une sortie, le
// découplage et l'efficacité en une phrase. Les chiffres viennent des modules purs de ce dossier. Pur.
import { DECOUPLING_BANDS, EASY_SHARE_MIN, HR_HIGH_SHARE, TREND_WEEKS } from "./constants";
import { addDays, daysBetween, mondayOfDay, round, weekday, WEEKDAY_LABEL } from "./dates";
import { FORM_LABEL, formBand, type FitnessDay, type FormBand } from "./load";
import { GOAL_LIMIT, PHASE_LABEL, type Phase, type RunGoal, type WeekSummary } from "./plan";
import type { SignalKind } from "./signals";
import { rollingMedian } from "./trends";
import { KIND_LABEL, QUALITY, type Alert, type Goal, type RunSession, type SessionKind } from "./workout";
import { zoneOf, type Zones } from "./zones";

const NB = " ";

// ─── Formats ───

/** « 6:42 » (s/km, sans unité). */
export const paceText = (secPerKm: number | null | undefined) => {
  if (!secPerKm || !Number.isFinite(secPerKm)) return "—";
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** « 42 min », « 1 h 05 », « 45 s », « 2 min 30 ». */
export function durText(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}${NB}s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)}${NB}min${NB}${String(s % 60).padStart(2, "0")}` : `${s / 60}${NB}min`;
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}${NB}h${NB}${String(m % 60).padStart(2, "0")}`;
}
/** « 5,2 km » */
export const kmText = (km: number) => `${km.toLocaleString("fr-FR", { maximumFractionDigits: km < 10 ? 2 : 1 })}${NB}km`;
const fr = (v: number, digits = 0) => v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signedInt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}`;

// ─── La séance du jour ───

/** Une séance rangée, telle que la page la lit (run_sessions). */
export interface PlannedRow {
  id: string;
  date: string;
  time: string | null;
  kind: string;
  minutes: number;
  status: "prevue" | "programmee" | "faite" | "manquee" | "annulee";
  session: RunSession;
  version: number;
  watchVersion: number | null;
  watchError: string | null;
  sampleId: string | null;
}

const live = (r: Pick<PlannedRow, "status">) => r.status === "prevue" || r.status === "programmee";

/**
 * La séance à montrer en tête : celle du jour si elle reste à faire ; sinon la prochaine. `doneToday` : la séance
 * du jour déjà faite (on la salue, la suivante passe en tête) ; `cancelledToday` : annulée par l'adaptation.
 */
export function pickSession<T extends PlannedRow>(rows: T[], today: string): { row: T | null; when: "today" | "next" | null; doneToday: T | null; cancelledToday: T | null } {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  const todays = sorted.filter((r) => r.date === today);
  const doneToday = todays.find((r) => r.status === "faite") ?? null;
  const cancelledToday = todays.find((r) => r.status === "annulee") ?? null;
  const now = todays.find(live);
  if (now) return { row: now, when: "today", doneToday, cancelledToday };
  const next = sorted.find((r) => r.date > today && live(r)) ?? null;
  return { row: next, when: next ? "next" : null, doneToday, cancelledToday };
}

export type WatchState = { kind: "montre" | "maj" | "erreur" | "a_programmer" | "non_pris" | "non_autorise"; text: string };

/** Où en est la séance sur la montre, d'après l'accusé de l'app (statut « programmée », version, erreur). */
export function watchState(r: Pick<PlannedRow, "status" | "version" | "watchVersion" | "watchError">, watch: { supported: boolean; authorized: boolean } | null): WatchState {
  if (r.status === "programmee" && r.watchVersion === r.version) return { kind: "montre", text: "Sur ta montre" };
  if (r.watchError) return { kind: "erreur", text: `La montre l’a refusée${NB}: ${r.watchError}` };
  if (watch && !watch.supported) return { kind: "non_pris", text: "Ta montre ne prend pas les séances programmées : suis les blocs ci-dessous." };
  if (watch && !watch.authorized) return { kind: "non_autorise", text: "À programmer : autorise l’app Mijote Santé à ajouter des séances (Réglages de l’iPhone)." };
  if (r.watchVersion != null && r.watchVersion < r.version) return { kind: "maj", text: "Changée depuis : ouvre l’app Mijote Santé pour la mettre à jour sur la montre." };
  return { kind: "a_programmer", text: "À programmer : ouvre l’app Mijote Santé." };
}

// ─── Les blocs lisibles ───

export interface ReadableStep {
  role: "warmup" | "work" | "recovery" | "cooldown";
  label: string;
  seconds: number | null;
  meters: number | null;
  hr: [number, number] | null;
  /** « Z2 », « Z1–Z2 ». */
  zone: string | null;
  pace: [number, number] | null;
}
export interface ReadableBlock {
  reps: number;
  steps: ReadableStep[];
  /** Durée du bloc, répétitions comprises (s). */
  seconds: number;
}

/** La zone (ou les zones) couverte par une plage de bpm : « Z2 », « Z1–Z2 ». */
export function zoneSpan(hr: [number, number], z: Pick<Zones, "lows">): string {
  const lo = Math.max(1, zoneOf(hr[0], z));
  const hi = Math.max(1, zoneOf(hr[1], z));
  return lo === hi ? `Z${lo}` : `Z${lo}–Z${hi}`;
}

const goalSec = (g: Goal) => (typeof g === "object" && "time" in g ? g.time : null);
const goalM = (g: Goal) => (typeof g === "object" && "distance" in g ? g.distance : null);
const alertHr = (a: Alert) => (a && "hr" in a ? a.hr : null);
const alertPace = (a: Alert) => (a && "pace" in a ? a.pace : null);

/** Échauffement, blocs (avec leurs répétitions) et retour au calme, avec leurs cibles en bpm et en zone. */
export function readableBlocks(s: RunSession, z: Pick<Zones, "lows">): ReadableBlock[] {
  const step = (role: ReadableStep["role"], st: { goal: Goal; alert: Alert; label: string }): ReadableStep => {
    const hr = alertHr(st.alert);
    return { role, label: st.label, seconds: goalSec(st.goal), meters: goalM(st.goal), hr, zone: hr ? zoneSpan(hr, z) : null, pace: alertPace(st.alert) };
  };
  const one = (st: ReadableStep): ReadableBlock => ({ reps: 1, steps: [st], seconds: st.seconds ?? 0 });
  return [
    one(step("warmup", s.warmup)),
    ...s.blocks.map((b) => {
      const steps = b.steps.map((st) => step(st.purpose, st));
      return { reps: b.iterations, steps, seconds: b.iterations * steps.reduce((x, st) => x + (st.seconds ?? 0), 0) };
    }),
    one(step("cooldown", s.cooldown)),
  ];
}

/** Le profil d'une séance : un morceau par pas (répétitions déroulées), sa durée et son intensité 1 à 5. */
export function sessionProfile(s: RunSession, z: Pick<Zones, "lows">): { seconds: number; level: number; role: ReadableStep["role"] }[] {
  const level = (role: ReadableStep["role"], a: Alert) => {
    const hr = alertHr(a);
    if (hr) return Math.max(1, zoneOf(Math.round((hr[0] + hr[1]) / 2), z));
    if (role === "work") return s.kind === "cotes" || s.kind === "footing_lignes" || s.kind === "test_friel" ? 4 : 2;
    return 1;
  };
  const out: { seconds: number; level: number; role: ReadableStep["role"] }[] = [];
  const push = (role: ReadableStep["role"], st: { goal: Goal; alert: Alert }) => {
    const sec = goalSec(st.goal);
    if (sec) out.push({ seconds: sec, level: level(role, st.alert), role });
  };
  push("warmup", s.warmup);
  for (const b of s.blocks) for (let i = 0; i < Math.min(b.iterations, 30); i++) for (const st of b.steps) push(st.purpose, st);
  push("cooldown", s.cooldown);
  return out;
}

// ─── Pourquoi cette séance ───

const KIND_WHY: Record<SessionKind, string> = {
  marche_course: "La marche fait partie de la séance : c’est elle qui laisse le corps s’adapter sans se blesser.",
  footing: "Un footing facile : c’est lui qui construit l’endurance, à une allure où tu peux parler.",
  footing_lignes: "Les lignes droites de la fin réveillent la foulée, sans fatigue.",
  sortie_longue: "La sortie longue de la semaine : jamais plus de 10 % au-dessus de la plus longue des 30 derniers jours.",
  test_aerobie: "Le test aérobie mesure ton allure à FC fixe : on le refait dans quelques semaines pour comparer.",
  fartlek: "Une seule séance soutenue cette semaine, loin de la sortie longue.",
  cotes: "Les côtes courtes renforcent sans taper : une seule séance soutenue cette semaine.",
  tempo: "Le tempo, « confortablement difficile », fait monter le seuil.",
  test_friel: "Le test mesure ta FC au seuil : tes zones deviendront plus justes.",
};

const SIGNAL_WHY: Record<SignalKind, string> = {
  hrv_basse: "Variabilité cardiaque basse cette semaine : pas de séance soutenue, volume tenu.",
  fc_repos_haute: "FC au repos au-dessus de l’habitude : pas de séance soutenue, volume tenu.",
  sommeil_court: "Deux nuits courtes : rien de soutenu aujourd’hui.",
  fatigue: "Fatigue de charge haute : la séance est raccourcie.",
  chaleur: "Chaleur : cours tôt et fie-toi à la FC plutôt qu’à l’allure.",
};

const FORM_WHY: Record<FormBand, string> = {
  transition: "Peu de charge ces dernières semaines : on reprend doucement.",
  frais: "Tu es frais : bon moment pour tenir la séance en entier.",
  neutre: "Charge et repos s’équilibrent.",
  productif: "Tu encaisses la charge : c’est ce qui fait progresser.",
  risque: "Fatigue trop haute : on lève le pied.",
};

/**
 * Pourquoi cette séance, en deux ou trois phrases calculées : où l'on en est (phase, niveau, semaine, volume),
 * ce que la séance apporte, et l'état du moment (signal du matin, sinon la fraîcheur).
 */
export function whyLine(x: {
  phase: Phase;
  level: number | null;
  weekInPhase: number;
  week: Pick<WeekSummary, "volume" | "long" | "deload"> | null;
  /** Volume de la semaine d'avant (prévu), pour dire la progression. */
  prevVolume: number | null;
  kind: SessionKind;
  signals: SignalKind[];
  tsbPct: number | null;
  /** La séance a été changée par l'adaptation du jour (notes du plan). */
  adapted: boolean;
}): string[] {
  const out: string[] = [];
  if (x.phase === 0) {
    out.push(`Marche-course, niveau ${x.level ?? 1} sur 8 : deux séances faites en entier sans forcer, et tu passes au suivant.`);
  } else if (x.week) {
    const prog = x.prevVolume && x.week.volume > x.prevVolume ? `, ${signedInt(((x.week.volume - x.prevVolume) / x.prevVolume) * 100)}${NB}% sur la semaine d’avant` : "";
    out.push(`${PHASE_LABEL[x.phase]}, semaine ${x.weekInPhase} : ${x.week.volume}${NB}min de course prévues${x.week.deload ? ", semaine allégée pour assimiler" : prog}.`);
  }
  out.push(KIND_WHY[x.kind]);
  const sig = x.signals.find((k) => k !== "chaleur") ?? x.signals[0];
  if (sig) out.push(SIGNAL_WHY[sig]);
  else if (x.tsbPct != null) out.push(FORM_WHY[formBand(x.tsbPct)]);
  if (x.adapted && !sig) out.push("La séance a été ajustée ce matin d’après tes derniers retours.");
  return out;
}

// ─── La semaine ───

export type OtherKind = "natation" | "kettlebell" | "renfo" | "velo" | "marche" | "autre";
export const OTHER_LABEL: Record<OtherKind, string> = { natation: "Natation", kettlebell: "Kettlebell", renfo: "Renforcement", velo: "Vélo", marche: "Marche", autre: "Séance" };

export interface WeekDay<T extends PlannedRow = PlannedRow> {
  date: string;
  /** « lun. » */
  short: string;
  today: boolean;
  past: boolean;
  planned: T[];
  /** Courses faites ce jour-là, rapprochées d'une séance ou non. */
  runs: { sampleId: string; minutes: number; km: number | null; plannedId: string | null }[];
  others: { kind: OtherKind; minutes: number }[];
  /** Activités fixes prévues ce jour-là (natation, kettlebell) quand rien n'est encore fait. */
  fixed: OtherKind[];
}

/** Les sept jours de la semaine de `today`, avec les séances prévues, les courses faites et les autres sports. */
export function weekDays<T extends PlannedRow>(
  today: string,
  rows: T[],
  runs: { sampleId: string; date: string; minutes: number; km: number | null; plannedId: string | null }[],
  others: { date: string; kind: OtherKind; minutes: number }[],
  fixed: { weekday: number; kind: OtherKind }[]
): WeekDay<T>[] {
  const monday = mondayOfDay(today);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const done = others.filter((o) => o.date === date);
    return {
      date,
      short: `${WEEKDAY_LABEL[i].slice(0, 3)}.`,
      today: date === today,
      past: date < today,
      planned: rows.filter((r) => r.date === date && r.status !== "annulee").concat(rows.filter((r) => r.date === date && r.status === "annulee")),
      runs: runs.filter((r) => r.date === date).map(({ sampleId, minutes, km, plannedId }) => ({ sampleId, minutes, km, plannedId })),
      others: done.map(({ kind, minutes }) => ({ kind, minutes })),
      fixed: date >= today ? fixed.filter((f) => f.weekday === weekday(date) && !done.some((o) => o.kind === f.kind)).map((f) => f.kind) : [],
    };
  });
}

/** La semaine en une phrase : « 1 sortie faite sur 3, 35 min de course. » */
export function weekSentence(days: WeekDay[]): string {
  const planned = days.flatMap((d) => d.planned).filter((r) => r.status !== "annulee");
  const done = planned.filter((r) => r.status === "faite").length;
  const missed = planned.filter((r) => r.status === "manquee").length;
  const runMin = days.flatMap((d) => d.runs).reduce((s, r) => s + r.minutes, 0);
  const parts = [`${done} sortie${done > 1 ? "s" : ""} faite${done > 1 ? "s" : ""} sur ${planned.length}`];
  if (runMin) parts.push(`${Math.round(runMin)}${NB}min de course`);
  if (missed) parts.push(`${missed} manquée${missed > 1 ? "s" : ""}, sans rattrapage`);
  const left = planned.filter(live).length;
  return `${parts.join(", ")}.${planned.length && !left ? " Semaine bouclée." : ""}`;
}

// ─── Les phases ───

export interface PhaseStep {
  phase: Phase;
  label: string;
  state: "faite" | "en_cours" | "a_venir";
}

/** La frise des phases jusqu'à celle que vise l'objectif (au moins la phase en cours). */
export function phaseTrack(phase: Phase, goal: RunGoal): PhaseStep[] {
  const last = Math.max(phase, GOAL_LIMIT[goal].phase) as Phase;
  return ([0, 1, 2, 3] as Phase[]).filter((p) => p <= last).map((p) => ({ phase: p, label: PHASE_LABEL[p], state: p < phase ? "faite" : p === phase ? "en_cours" : "a_venir" }));
}

// ─── Forme, fatigue, fraîcheur ───

const FORM_WORDS: Record<FormBand, string> = {
  transition: "tu te reposes beaucoup, la forme baisse doucement",
  frais: "tu es reposé, bon moment pour une sortie qui compte",
  neutre: "travail et repos s’équilibrent",
  productif: "tu travailles, c’est ce qui fait progresser",
  risque: "trop de fatigue, on lève le pied",
};

export interface FormWords {
  forme: number;
  fatigue: number;
  /** Fraîcheur du matin en % de la forme (null sous 5 de forme). */
  fraicheur: number | null;
  band: FormBand | null;
  /** Variation de la forme sur 4 semaines. */
  delta28: number | null;
  sentence: string;
}

/** Les trois chiffres du modèle de Banister, dits sans jargon : forme (42 j), fatigue (7 j), fraîcheur. */
export function formWords(days: FitnessDay[]): FormWords | null {
  const last = days[days.length - 1];
  if (!last) return null;
  const before = days.length > 28 ? days[days.length - 29] : null;
  const forme = Math.round(last.ctl);
  const fatigue = Math.round(last.atl);
  const delta28 = before ? Math.round(last.ctl - before.ctl) : null;
  const band = last.tsbPct != null ? formBand(last.tsbPct) : null;
  const parts: string[] = [];
  parts.push(delta28 == null || delta28 === 0 ? `Forme ${forme}.` : `Forme ${forme}, ${delta28 > 0 ? "en hausse" : "en baisse"} de ${Math.abs(delta28)} en quatre semaines.`);
  parts.push(`Fatigue ${fatigue}.`);
  if (band && last.tsbPct != null) parts.push(`Fraîcheur ${signedInt(last.tsbPct)}${NB}% : ${FORM_WORDS[band]}.`);
  else parts.push("Pas encore assez de séances pour parler de fraîcheur.");
  return { forme, fatigue, fraicheur: last.tsbPct != null ? Math.round(last.tsbPct) : null, band, delta28, sentence: parts.join(" ") };
}
export { FORM_LABEL };

// ─── Allure à FC égale ───

/** km/h d'une vitesse en m/s. */
export const kmh = (ms: number) => round(ms * 3.6, 2);

/**
 * La tendance d'allure en endurance (§ 3.8) : par sortie, la vitesse ajustée médiane à FC égale (milieu de Z2),
 * et sa médiane glissante sur 6 semaines ; la phrase compare la dernière médiane à celle d'il y a 6 semaines.
 */
export function efficiencyTrend(runs: { date: string; z2Speed: number | null; excluded?: boolean }[], today: string) {
  const points = rollingMedian(runs.map((r) => ({ date: r.date, value: r.z2Speed, excluded: r.excluded })));
  const last = points[points.length - 1];
  if (points.length < 3 || !last) return { points, sentence: "Il faut quelques sorties faciles avec cardio pour voir la tendance." };
  const ref = [...points].reverse().find((p) => daysBetween(p.date, last.date) >= 7 * TREND_WEEKS - 7) ?? points[0];
  const now = 1000 / last.median;
  const then = 1000 / ref.median;
  const diff = Math.round(then - now);
  const since = daysBetween(ref.date, today) >= 7 * TREND_WEEKS - 7 ? "il y a six semaines" : `le ${new Date(`${ref.date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })}`;
  const sentence =
    Math.abs(diff) < 3
      ? `À FC égale en endurance, ton allure tient (${paceText(now)}/km) : elle se lit en mois, pas en jours.`
      : diff > 0
        ? `À FC égale en endurance, tu cours ${diff}${NB}s/km plus vite qu’${since} (${paceText(now)}/km contre ${paceText(then)}) : le cardio progresse.`
        : `À FC égale en endurance, tu cours ${-diff}${NB}s/km moins vite qu’${since} (${paceText(now)}/km contre ${paceText(then)}) : fatigue, chaleur ou reprise, à suivre.`;
  return { points, sentence };
}

// ─── Nutrition (§ 5) ───

export interface FuelAdvice {
  title: string;
  lines: string[];
}

/**
 * Le conseil du jour d'une séance (§ 5), sobre : rien de particulier sous une heure, un en-cas facultatif de 60
 * à 75 min, et pour une sortie de plus de 75 min les glucides, l'eau et pas de déficit ce jour-là. La cible de
 * Santé ne change pas : le déficit se répartit sur les autres jours. Garde-fou du déficit fort pour le volume.
 */
export function fuelAdvice(x: { minutes: number; hot: boolean; deficitKcal: number | null; weekRunMin: number }): FuelAdvice | null {
  const lines: string[] = [];
  let title = "";
  if (x.minutes > 75) {
    title = "Sortie longue : de quoi tenir";
    lines.push("La veille ou le matin, un repas riche en féculents.");
    lines.push("Pendant : 30 à 60 g de glucides par heure, à essayer à l’entraînement avant un jour qui compte.");
    lines.push("Pars avec de l’eau et bois selon ta soif.");
    lines.push("Après, dans les 2 h : un repas avec glucides et protéines.");
    if (x.deficitKcal != null && x.deficitKcal > 0) lines.push("Pas de déficit aujourd’hui : mange à ta faim, l’écart se répartit sur les autres jours de la semaine.");
  } else if (x.minutes >= 60) {
    title = "Plus d’une heure";
    lines.push("Un en-cas glucidique avant si ton dernier repas date.");
    lines.push("Pars avec de l’eau, bois selon ta soif.");
  }
  if (x.hot) {
    title ||= "Chaleur";
    lines.push("Chaleur : cours tôt, ralentis, et prends de l’eau même pour une sortie courte.");
  }
  if (x.deficitKcal != null && x.deficitKcal > 500 && x.weekRunMin > 180) {
    title ||= "Déficit et volume";
    lines.push("Le déficit est fort pour ce volume : récupération et progrès risquent d’en pâtir.");
  }
  return lines.length ? { title, lines } : null;
}

// ─── Une sortie ───

export interface PlanCompare {
  verdict: "comme_prevu" | "plus_long" | "plus_court" | "plus_intense" | "libre";
  text: string;
}

/** La sortie face à la séance prévue : durée (± 15 %) et intensité (plus de 30 % au-dessus de Z2 sur une séance facile). */
export function planCompare(planned: { kind: SessionKind; minutes: number } | null, done: { movingMin: number; hrHighShare: number | null; easyShare: number | null }): PlanCompare {
  const m = Math.round(done.movingMin);
  if (!planned) return { verdict: "libre", text: `Sortie libre, hors plan : ${m}${NB}min.` };
  const ratio = done.movingMin / planned.minutes;
  const easyKind = !QUALITY.has(planned.kind) && planned.kind !== "test_friel";
  const of = `${m}${NB}min pour ${planned.minutes} prévues`;
  if (easyKind && done.hrHighShare != null && done.hrHighShare > HR_HIGH_SHARE)
    return { verdict: "plus_intense", text: `Plus intense que prévu : ${fr(done.hrHighShare * 100)}${NB}% du temps au-dessus de l’endurance. Ralentir, et marcher si besoin, fait partie de la séance.` };
  if (ratio < 0.85) return { verdict: "plus_court", text: `Plus courte que prévu (${of}). Pas de rattrapage : la suite se calcule sur ce qui a été fait.` };
  if (ratio > 1.15) return { verdict: "plus_long", text: `Plus longue que prévu (${of}). La prochaine sortie longue en tient compte.` };
  const easy = done.easyShare != null ? `, ${fr(done.easyShare * 100)}${NB}% en facile` : "";
  return { verdict: "comme_prevu", text: `Faite comme prévu : ${of}${easy}.` };
}

/** Le découplage en une phrase (§ 3.4) : la valeur, sa lecture, la dérive en bpm. */
export function decouplingText(d: { ok: true; value: number; drift: number; reading: "artefact" | "bon" | "correct" | "marque" } | { ok: false; reason: string }, heat: boolean): string {
  if (!d.ok) return `Découplage non calculé : ${d.reason}.`;
  const v = `${fr(d.value, 1)}${NB}%`;
  const drift = `${signedInt(d.drift)}${NB}bpm`;
  const hot = heat ? " Il faisait chaud : la sortie ne compte pas dans la tendance." : "";
  if (d.reading === "artefact") return `Découplage ${v} : probablement un artefact (échauffement compté, capteur).${hot}`;
  if (d.reading === "bon") return `Découplage ${v} (${drift} sur la seconde moitié) : à allure égale, le cœur est resté stable jusqu’au bout. L’endurance tient sur cette durée.${hot}`;
  if (d.reading === "correct") return `Découplage ${v} (${drift} sur la seconde moitié) : correct, cette durée est à ta limite actuelle.${hot}`;
  return `Découplage ${v} (${drift} sur la seconde moitié) : le cœur a dérivé, au-delà de ${DECOUPLING_BANDS.fair}${NB}%. Durée au-delà de l’endurance du moment, chaleur, manque d’eau ou fatigue.${hot}`;
}

/** Le facteur d'efficacité en une phrase, comparé à la médiane des sorties faciles d'avant si elle existe. */
export function efText(ef: number | null, ref: number | null): string | null {
  if (ef == null) return null;
  const base = `Efficacité ${fr(ef, 2)} : les mètres par minute que tu parcours pour chaque battement de cœur.`;
  if (ref == null || !ref) return `${base} Elle monte à mesure que l’endurance vient.`;
  const pct = ((ef - ref) / ref) * 100;
  if (Math.abs(pct) < 2) return `${base} Comme tes dernières sorties faciles.`;
  return `${base} ${signedInt(pct)}${NB}% par rapport à tes dernières sorties faciles${pct > 0 ? "." : " (chaleur, fatigue ou terrain ?)."}`;
}

/** La part facile (sous les zones, Z1, Z2) du temps de course d'une sortie, null sans FC. */
export function easyShareOf(seiler: { easy: number; moderate: number; hard: number }): number | null {
  const tot = seiler.easy + seiler.moderate + seiler.hard;
  return tot ? seiler.easy / tot : null;
}

/** La répartition est-elle assez facile (≥ 80 % sur 4 semaines) ? */
export const easyEnough = (share: number | null) => share == null || share >= EASY_SHARE_MIN;

/** Une série de FC réduite à `max` points au plus : moyenne par tranche de temps égale (trous gardés). */
export function downsample(points: [number, number][], max = 300): [number, number][] {
  if (points.length <= max) return points;
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const step = (t1 - t0) / max;
  const out: [number, number][] = [];
  let k = 0;
  for (let i = 0; i < max; i++) {
    const end = i === max - 1 ? Infinity : t0 + (i + 1) * step;
    let sum = 0;
    let n = 0;
    let ts = 0;
    while (k < points.length && points[k][0] < end) {
      sum += points[k][1];
      ts += points[k][0];
      n++;
      k++;
    }
    if (n) out.push([Math.round(ts / n), Math.round(sum / n)]);
  }
  return out;
}

/** La sortie la plus récente des 2 derniers jours sans ressenti noté : on le demande. */
export function feedbackDue<T extends { date: string }>(runs: T[], noted: Set<string>, today: string): T | null {
  const last = [...runs].filter((r) => r.date <= today && daysBetween(r.date, today) <= 2).sort((a, b) => a.date.localeCompare(b.date)).pop();
  return last && !noted.has(last.date) ? last : null;
}

/** Le titre court d'une sortie dans la liste (le type prévu, sinon « Course »). */
export const runTitle = (kind: string | null | undefined) => (kind && kind in KIND_LABEL ? KIND_LABEL[kind as SessionKind] : "Course");
