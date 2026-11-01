// Ce que lisent les pages du module Course (/sante/course, une sortie, la vue d'ensemble de Santé, l'accueil) :
// la base et le plan recalculé (store.ts), mis en forme par les modules purs (view.ts, trends.ts). Aucun calcul
// ici qui ne soit déjà testé ailleurs : on assemble.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { healthSamples, people, runFeedback, runProfiles, runSessions, workoutDetails } from "@/lib/db/schema";
import { currentReview } from "@/lib/health/store";
import { todayParis } from "@/lib/health/store";
import { TREND_WEEKS } from "./constants";
import { addDays, daysBetween, median, mondayOfDay } from "./dates";
import { decodeHr } from "./details";
import { longestBefore, longestRatio } from "./load";
import { getRunProfile, runningData, sessionIdOf, syncPlan, type AnalyzedRun, type RunningData } from "./store";
import { intensityShare, regularity, weeklyVolume, type RunPoint } from "./trends";
import {
  downsample,
  durText,
  easyShareOf,
  efficiencyTrend,
  feedbackDue,
  formWords,
  fuelAdvice,
  phaseTrack,
  pickSession,
  readableBlocks,
  sessionProfile,
  watchState,
  weekDays,
  weekSentence,
  whyLine,
  OTHER_LABEL,
  type OtherKind,
  type PlannedRow,
} from "./view";
import type { RunGoal } from "./plan";
import type { SessionKind } from "./workout";

const OTHER_KINDS = new Set<string>(["natation", "kettlebell", "renfo", "velo", "marche"]);
const otherKind = (k: string): OtherKind => (OTHER_KINDS.has(k) ? (k as OtherKind) : "autre");

/** Une ligne de run_sessions sous la forme lue par l'interface. */
const asRow = (r: RunningData["rows"][number]): PlannedRow => ({ ...r, status: r.status, session: r.session as unknown as PlannedRow["session"] });

/** Une sortie dans la liste : ce qui se lit d'un coup d'œil. */
export interface RunItem {
  sampleId: string;
  date: string;
  start: string;
  movingMin: number;
  km: number | null;
  pace: number | null;
  load: number;
  /** Secondes de course par zone (0 = sous les zones … 5). */
  zoneSec: number[];
  easyShare: number | null;
  kind: SessionKind | null;
  effort: number | null;
  pain: number | null;
  heat: boolean;
  hasHr: boolean;
}

const itemOf = (r: AnalyzedRun, rows: Map<string, RunningData["rows"][number]>): RunItem => {
  const a = r.analysis;
  return {
    sampleId: r.sampleId,
    date: r.date,
    start: r.start,
    movingMin: a.movingMin || r.minutes,
    km: a.distanceKm,
    pace: a.pace,
    load: Math.round(a.load),
    zoneSec: a.zoneSec,
    easyShare: easyShareOf(a.seiler),
    kind: r.plannedId ? ((rows.get(r.plannedId)?.kind as SessionKind | undefined) ?? null) : null,
    effort: r.feedback?.effort ?? (a.effort != null ? Math.round(a.effort) : null),
    pain: r.feedback?.pain ?? null,
    heat: a.heat,
    hasHr: a.hrCoverage > 0,
  };
};

const pointOf = (r: AnalyzedRun): RunPoint => ({ date: r.date, minutes: r.analysis.movingMin || r.minutes, km: r.distanceKm, seiler: r.analysis.hrCoverage > 0 ? r.analysis.seiler : null });

/** Tout ce que montre /sante/course pour une personne, ou null si le module n'est pas activé. */
export function courseView(db: Db, personId: string, now = new Date()) {
  const state = syncPlan(db, personId, now);
  if (!state) return null;
  const { data, plan } = state;
  const today = data.today;
  const profile = getRunProfile(db, personId)!;
  const monday = mondayOfDay(today);
  // Les séances passées de la semaine que le plan n'a pas rangées (page pas ouverte ces jours-là : seul ce qui
  // est à venir s'écrit) : reprises du plan, faites s'il y a une course ce jour-là, sinon manquées.
  const stored = new Set(state.sessions.map((r) => r.id));
  const ranOn = new Map(data.runs.map((r) => [r.date, r.sampleId]));
  const missing: PlannedRow[] = plan.sessions
    .filter((s) => s.weekStart === monday && s.date < today && !s.cancelled && !stored.has(sessionIdOf(personId, s.weekStart, s.role)))
    .map((s) => ({ id: sessionIdOf(personId, s.weekStart, s.role), date: s.date, time: s.time, kind: s.kind, minutes: s.minutes, status: ranOn.has(s.date) ? "faite" : "manquee", session: s.session, version: 1, watchVersion: null, watchError: null, sampleId: ranOn.get(s.date) ?? null }));
  const rows = [...missing, ...state.sessions.map(asRow)].sort((a, b) => a.date.localeCompare(b.date));
  const byId = new Map(data.rows.map((r) => [r.id, r]));

  // En tête : la séance du jour, sinon la prochaine.
  const pick = pickSession(rows, today);
  const f = data.fitness[data.fitness.length - 1];
  const tsbPct = f?.tsbPct ?? null;
  const thisWeek = plan.weeks.find((w) => w.weekStart === monday) ?? null;
  const prevWeek = plan.weeks.find((w) => w.weekStart === addDays(monday, -7)) ?? null;
  const person = db.select().from(people).where(eq(people.id, personId)).get()!;
  const review = currentReview(db, person, now);
  const deficit = review ? -review.targets.dailyDeltaKcal : null;
  const weekRunMin = (thisWeek?.volume ?? 0) + 10 * (thisWeek?.runs ?? 0);
  const head = pick.row
    ? (() => {
        const row = pick.row;
        const week = plan.weeks.find((w) => w.weekStart === mondayOfDay(row.date)) ?? thisWeek;
        return {
          row,
          when: pick.when!,
          blocks: readableBlocks(row.session, data.zones),
          profile: sessionProfile(row.session, data.zones),
          watch: watchState(row, profile.watch ? { supported: profile.watch.supported, authorized: profile.watch.authorized } : null),
          why: whyLine({
            phase: week?.phase ?? plan.phase,
            level: week?.level ?? plan.level,
            weekInPhase: week?.weekInPhase ?? plan.weekInPhase,
            week,
            prevVolume: week === thisWeek ? (prevWeek?.volume ?? null) : (thisWeek?.volume ?? null),
            kind: row.kind as SessionKind,
            signals: data.morning.signals.map((s) => s.kind),
            tsbPct,
            adapted: /remplacée|Raccourcie|Chaleur/.test(row.session.notes),
          }),
          fuel: fuelAdvice({ minutes: row.minutes, hot: data.morning.heat, deficitKcal: deficit, weekRunMin }),
        };
      })()
    : null;

  // La semaine en cours, jour par jour, avec la natation et le renforcement autour.
  const weekRows = rows.filter((r) => r.date >= monday && r.date < addDays(monday, 7));
  const week = weekDays(
    today,
    weekRows,
    data.runs.filter((r) => r.date >= monday).map((r) => ({ sampleId: r.sampleId, date: r.date, minutes: r.analysis.movingMin || r.minutes, km: r.distanceKm, plannedId: r.plannedId ?? missing.find((x) => x.sampleId === r.sampleId)?.id ?? null })),
    data.others.filter((o) => o.date >= monday).map((o) => ({ date: o.date, kind: otherKind(o.kind), minutes: o.minutes })),
    data.fixed.map((x) => ({ weekday: x.weekday, kind: x.kind }))
  );

  // Tendances : volume sur 12 semaines, régularité, forme sur 3 mois, allure à FC égale, répartition.
  const points = data.runs.map(pointOf);
  const volume = weeklyVolume(points, today, 12);
  const reg = regularity(points, today);
  const past = data.rows.filter((r) => r.date < today && r.date >= addDays(today, -56) && (r.status === "faite" || r.status === "manquee"));
  const fitness = data.fitness.slice(-91);
  const efficiency = efficiencyTrend(
    data.runs.filter((r) => daysBetween(r.date, today) <= 182).map((r) => ({ date: r.date, z2Speed: r.analysis.z2Speed, excluded: r.analysis.heat || r.analysis.doubtful })),
    today
  );
  const intensity = intensityShare(points, today);

  // Signaux de prudence : pause, douleur récente, signaux du matin ; sinon les repères du matin, discrets.
  const painRecent = data.feedback.filter((x) => (x.pain ?? 0) >= 3 && x.date <= today && daysBetween(x.date, today) <= 7).pop() ?? null;
  const m = data.morning;
  const lastNight = m.shortSleep;

  // Toutes les activités des 12 dernières semaines, par jour (calendrier de régularité).
  const since = addDays(today, -7 * 12);
  const activity = new Map<string, number>();
  const otherByDay = new Map<string, string[]>();
  for (const r of data.runs) if (r.date > since) activity.set(r.date, (activity.get(r.date) ?? 0) + (r.analysis.movingMin || r.minutes));
  for (const o of data.others) {
    if (o.date <= since) continue;
    activity.set(o.date, (activity.get(o.date) ?? 0) + o.minutes);
    otherByDay.set(o.date, [...(otherByDay.get(o.date) ?? []), `${OTHER_LABEL[otherKind(o.kind)].toLowerCase()}${o.minutes ? ` ${durText(o.minutes * 60)}` : ""}`]);
  }

  const items = data.runs.map((r) => ({ ...itemOf(r, byId), kind: itemOf(r, byId).kind ?? ((missing.find((x) => x.sampleId === r.sampleId)?.kind as SessionKind | undefined) ?? null) })).reverse();
  const noted = new Set(db.select({ date: runFeedback.date }).from(runFeedback).where(eq(runFeedback.personId, personId)).all().map((x) => x.date));
  const due = feedbackDue(items, noted, today);

  return {
    today,
    personName: data.personName,
    profile,
    zones: data.zones,
    ageKnown: data.ageKnown,
    observed: data.observed,
    plan: { phase: plan.phase, level: plan.level, weekInPhase: plan.weekInPhase, paused: plan.paused, messages: plan.messages, next: plan.next, track: phaseTrack(plan.phase, profile.goal as RunGoal), weeks: plan.weeks.slice(-2) },
    head,
    doneToday: pick.doneToday ? { row: pick.doneToday, sampleId: pick.doneToday.sampleId } : null,
    cancelledToday: pick.cancelledToday,
    week,
    weekText: weekSentence(week),
    nextWeek: rows.filter((r) => r.date >= addDays(monday, 7)),
    form: formWords(data.fitness),
    fitness,
    volume,
    regularity: { ...reg, done: past.filter((r) => r.status === "faite").length, planned: past.length },
    efficiency,
    intensity,
    activity,
    otherByDay,
    caution: { painRecent, signals: m.signals, morning: { hrv: m.hrv, rest: m.rest, shortSleep: lastNight } },
    runs: items,
    feedbackDue: due,
    hasHr: data.runs.some((r) => r.analysis.hrCoverage > 0),
  };
}
export type CourseView = NonNullable<ReturnType<typeof courseView>>;

/** Une sortie en détail : l'analyse, la série de FC réduite pour le dessin, la séance prévue, le ressenti. */
export function runView(db: Db, personId: string, sampleId: string, now = new Date()) {
  const today = todayParis(now);
  const data = runningData(db, personId, today);
  if (!data) return null;
  const i = data.runs.findIndex((r) => r.sampleId === sampleId);
  if (i < 0) return null;
  const run = data.runs[i];
  const a = run.analysis;
  const byId = new Map(data.rows.map((r) => [r.id, r]));
  const planned = run.plannedId ? byId.get(run.plannedId) : null;
  const sample = db.select().from(healthSamples).where(and(eq(healthSamples.id, sampleId), eq(healthSamples.personId, personId))).get();
  const det = db.select().from(workoutDetails).where(eq(workoutDetails.sampleId, sampleId)).get();
  const meta = (sample?.meta ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const extra = (det?.data ?? {}) as Record<string, unknown>;
  const hr = det?.hrPoints ? downsample(decodeHr(det.hr), 320) : [];

  // L'efficacité des sorties faciles des 6 semaines d'avant (référence de la phrase).
  const refEf = median(
    data.runs.filter((r) => r.date < run.date && daysBetween(r.date, run.date) <= 7 * TREND_WEEKS && r.analysis.ef != null && !r.analysis.heat && !r.analysis.doubtful).map((r) => r.analysis.ef!)
  );
  const minutesOf = (r: AnalyzedRun) => r.analysis.movingMin || r.minutes;
  const longest = longestBefore(data.runs.map((r) => ({ date: r.date, value: r.distanceKm ?? minutesOf(r) })), run.date);
  const fb = db.select().from(runFeedback).where(and(eq(runFeedback.personId, personId), eq(runFeedback.date, run.date))).get() ?? null;

  return {
    today,
    run,
    analysis: a,
    zones: data.zones,
    hr,
    hrMax: num(meta.hrMax),
    hrAvg: num(meta.hrAvg),
    kcal: num(meta.kcal),
    cadence: num(extra.cadenceAvg),
    strideM: num(extra.strideM),
    elevGainM: num(extra.elevGainM),
    elevLossM: num(extra.elevLossM),
    source: typeof (extra.source as { name?: unknown } | undefined)?.name === "string" ? String((extra.source as { name: string }).name) : null,
    indoor: det?.indoor ?? null,
    humidity: det?.humidityPct ?? null,
    planned: planned ? { ...asRow(planned), kind: planned.kind as SessionKind } : null,
    refEf,
    longest: longestRatio(run.distanceKm ?? minutesOf(run), longest),
    feedback: fb,
    prev: data.runs[i - 1]?.sampleId ?? null,
    next: data.runs[i + 1]?.sampleId ?? null,
  };
}
export type RunView = NonNullable<ReturnType<typeof runView>>;

/** La séance de course du jour pour l'accueil : une lecture de run_sessions, sans recalcul du plan. */
export function todayRun(db: Db, personId: string | null, today: string): { title: string; minutes: number; done: boolean } | null {
  if (!personId) return null;
  const p = db.select({ enabled: runProfiles.enabled }).from(runProfiles).where(eq(runProfiles.personId, personId)).get();
  if (!p?.enabled) return null;
  const r = db
    .select()
    .from(runSessions)
    .where(and(eq(runSessions.personId, personId), eq(runSessions.date, today), inArray(runSessions.status, ["prevue", "programmee", "faite"])))
    .orderBy(asc(runSessions.time))
    .get();
  if (!r) return null;
  return { title: (r.session as { title?: string }).title ?? "Course", minutes: r.minutes, done: r.status === "faite" };
}
