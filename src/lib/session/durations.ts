// Durées réelles (docs/vision.md §4.4 bis, « une durée réaliste ») : ce que le journal
// cook_events dit du temps passé sur chaque geste de prep et chaque étape, et comment ces
// mesures corrigent les estimations des sessions suivantes. Tout en code, pur (pas de
// base ici) : le même calcul sert au bilan de fin de session (écran) et aux corrections
// enregistrées (src/lib/session/store.ts, table duration_samples).
//
// Mesurer (measureSession) :
// - Étape : de step_start à step_done (reduce(), qui gère les annulations). Avec un
//   minuteur, la fin est l'heure où il sonne (prolongations comprises) si on l'arrête plus
//   tard : un minuteur arrêté en retard ne rallonge pas l'étape.
// - Geste de prep : il n'y a pas d'événement de début. Un geste dure de la marque
//   précédente de la même personne à son « fait ». Seul ou la veille, une marque est un
//   geste coché ou un bol coché ; à deux, c'est le « Fait » de la personne (geste, fin du
//   temps actif d'une étape). Le premier intervalle d'une phase n'est mesuré que si la
//   phase a un vrai départ (« Reprendre », « On démarre ») : à l'ouverture de la session,
//   on ne sait pas quand tu as commencé.
// - Bol coché sans que ses gestes l'aient été : l'intervalle se partage entre ses gestes
//   pas encore mesurés et sa pesée, au prorata des estimations (mesure « partagée », de
//   poids égal à sa part).
//
// Corriger (learn) — prudent :
// - seule une session vraiment cuisinée apprend (cookedEnough : au moins une étape de cuisson
//   lancée puis faite) ; terminée dès la prep ou abandonnée, elle n'apprend rien, et ses
//   mesures déjà enregistrées sont ignorées à la lecture ;
// - fenêtre : les WINDOW dernières sessions terminées qui apprennent ; une mesure par session
//   et par clé (gestes au même aliment additionnés) ;
// - une mesure invraisemblable est écartée (implausible) : hors de [¼, 4] fois la référence
//   (oubli de toucher, pause), cochée en passant (moins de 15 s), ou plus de 4 h ;
//   à partir de 3 mesures, celles à plus d'un facteur 2 de la médiane aussi ; une mesure
//   seule à plus de 75 % de la référence, que rien ne confirme, ne change rien ;
// - facteur = moyenne géométrique pondérée des rapports réel / référence, avec la
//   référence comptée comme PRIOR mesures à 1 (1 mesure : un tiers de l'écart, 2 : la
//   moitié…), plafonné (gestes ×0,6 à ×1,6 ; étapes ×0,75 à ×1,35), ignoré sous 3 %.
// - chaque correction garde ses mesures (session, rapport, poids) et ses écarts.
import { STEP_LABELS } from "@/lib/recipes/format";
import { parseGesture, WEIGH_MIN } from "./gestures";
import { gestureKey, modeOf, stepKey, type DurationInput, type PrepTask, type SessionPlan } from "./planner";
import { reduce, type SessionEvent } from "./state";

export type SampleKind = "gesture" | "weigh" | "step";

export interface DurationSample {
  kind: SampleKind;
  key: string; // cut:oignon, other:<slug>-2, weigh, step:<slug>#4
  ref: string; // tâche, bol (pesée) ou étape mesurée
  label: string;
  grams: number | null;
  units: number | null;
  estMin: number; // référence, avant correction (c'est elle que le rapport corrige)
  plannedMin: number; // ce que le plan annonçait
  realMin: number;
  weight: number; // 1 = mesure nette ; < 1 = part d'un bol coché
  via: string | null; // « bol B » : la mesure vient d'un bol coché
  at: string;
}

export const WINDOW = 5;
export const BOUNDS: [number, number] = [0.25, 4];
export const PRIOR = 2;
export const CAPS: Record<SampleKind, [number, number]> = { gesture: [0.6, 1.6], weigh: [0.6, 1.6], step: [0.75, 1.35] };
const LONE = Math.log(1.75);
const NEAR = Math.log(1.5);
const FAR = Math.log(2);

/** En dessous, l'intervalle ne mesure rien : on a coché en passant (pour sauter, pour finir). */
export const MIN_REAL_MIN = 0.25;
/** Au-delà, l'écran est resté ouvert sur un geste ou une étape oubliés. */
export const MAX_REAL_MIN = 240;

/** Pourquoi une mesure n'est pas vraisemblable, ou null. Pur : sert à la mesure, au bilan et à la lecture des mesures enregistrées. */
export function implausible(s: Pick<DurationSample, "estMin" | "realMin" | "weight">): string | null {
  if (!(s.estMin > 0) || !Number.isFinite(s.realMin) || !(s.realMin > 0)) return "mesure invalide";
  const r = s.realMin / s.estMin;
  if (r < BOUNDS[0] || r > BOUNDS[1]) return "hors bornes (oubli de toucher, pause ?)";
  // Part d'un bol coché : c'est l'intervalle entier (réel / part) qui dit si on a coché en passant.
  const span = s.weight > 0 && s.weight < 1 ? s.realMin / s.weight : s.realMin;
  if (span < MIN_REAL_MIN) return "coché en passant";
  if (s.realMin > MAX_REAL_MIN) return "trop long (oubli de toucher ?)";
  return null;
}

export const inBounds = (s: Pick<DurationSample, "estMin" | "realMin" | "weight">) => implausible(s) == null;

/**
 * La session a-t-elle été cuisinée ? Terminée (pas abandonnée, pas rouverte) avec au moins une étape
 * de cuisson lancée puis faite. Terminer dès la prep, c'est une fin anticipée : rien à apprendre,
 * les gestes cochés pour passer ne sont pas des durées.
 */
export function cookedEnough(plan: Pick<SessionPlan, "steps">, events: SessionEvent[]): boolean {
  const evs = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.seq ?? 0) - (b.seq ?? 0));
  const s = reduce("prep", evs);
  if (s.status !== "done") return false;
  return plan.steps.some((st) => {
    if (st.kind === "preheat" || !st.recipeSlug) return false;
    const t0 = s.started.get(st.id);
    const t1 = s.done.get(st.id);
    return t0 != null && t1 != null && t1 > t0;
  });
}


export function taskLabel(t: PrepTask): string {
  if (t.kind === "weigh") return "Pesées";
  if (t.kind === "other") return `${t.title} · ${(t.text ?? "").split(/[.,:;]/)[0].slice(0, 60)}`;
  return `${t.title} (${[...new Set(t.items.map((i) => i.gesture))].join(", ")})`;
}

function taskQty(t: PrepTask) {
  if (t.grams !== undefined || t.units !== undefined) return { grams: t.grams ?? null, units: t.units ?? null };
  const g = t.items.reduce((x, i) => x + (i.grams ?? 0), 0);
  return { grams: g || null, units: t.items.length && t.items.every((i) => i.units != null) ? t.items.reduce((x, i) => x + (i.units ?? 0), 0) : null };
}

/** Référence d'un geste : avant correction ; la pesée compte 0,5 min par ingrédient. */
const taskRef = (t: PrepTask) => (t.kind === "weigh" && t.units ? t.units * WEIGH_MIN : (t.refMinutes ?? t.minutes));

/** Les mesures d'une session (terminée ou non), déduites du plan et du journal. */
export function measureSession(plan: SessionPlan, events: SessionEvent[], startedAt: string | null): DurationSample[] {
  const evs = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.seq ?? 0) - (b.seq ?? 0));
  const out: DurationSample[] = [];
  const mode = modeOf(plan);
  const veille = mode === "veille";
  const dayDuo = Boolean(plan.eve);
  const pureDuo = mode === "duo" && !plan.eve;
  const allTasks = [...(plan.eve?.tasks ?? []), ...plan.prep.tasks];
  const taskById = new Map(allTasks.map((t) => [t.id, t]));
  const eveSet = veille ? plan.prep.tasks.filter((t) => t.eve) : (plan.eve?.tasks ?? []);
  const daySet = veille ? plan.prep.tasks.filter((t) => !t.eve) : plan.prep.tasks;
  const weighFactor = plan.durations?.applied.find((a) => a.key === "weigh")?.factor ?? 1;

  type Mark = { at: number; explicit: boolean } | "busy";
  let seg: { kind: "solo" | "duo"; tasks: Set<string> } | null = null;
  let eveDone = false;
  const last = new Map<string, Mark>();
  const consumed = new Set<string>();
  const bowlsSeen = new Set<string>();
  const undoneTasks = new Set<string>();
  const undoneBowls = new Set<string>();
  const openSolo = (tasks: PrepTask[], at: number, explicit: boolean) => {
    seg = { kind: "solo", tasks: new Set(tasks.map((t) => t.id)) };
    last.clear();
    last.set("A", { at, explicit });
  };
  const sample = (t: PrepTask, real: number, weight: number, via: string | null, at: string): DurationSample => ({
    kind: t.kind === "weigh" ? "weigh" : "gesture",
    key: gestureKey(t.id),
    ref: t.id,
    label: taskLabel(t),
    ...taskQty(t),
    estMin: taskRef(t),
    plannedMin: t.minutes,
    realMin: real,
    weight,
    via,
    at,
  });

  const t0 = startedAt ? Date.parse(startedAt) : evs.length ? Date.parse(evs[0].at) : 0;
  if (!pureDuo) openSolo(veille || dayDuo ? eveSet : plan.prep.tasks, t0, false);

  for (const e of evs) {
    const at = Date.parse(e.at);
    const p = e.payload ?? {};
    const who = typeof p.person === "string" ? p.person : null;
    if (e.kind === "note" && typeof p.status === "string") {
      const st = p.status;
      if (st === "fridge") {
        seg = null;
        eveDone = true;
      } else if (st === "prep") {
        if (p.resume === true) {
          eveDone = true;
          seg = null;
          if (!dayDuo) openSolo(daySet, at, true);
        } else if (!pureDuo && !(dayDuo && eveDone)) openSolo(eveDone ? daySet : veille || dayDuo ? eveSet : plan.prep.tasks, at, false);
      } else if (st === "cooking" && (pureDuo || (dayDuo && eveDone))) {
        if (seg?.kind !== "duo") {
          seg = { kind: "duo", tasks: new Set(plan.prep.tasks.map((t) => t.id)) };
          last.clear();
          for (const x of plan.persons ?? ["A", "B"]) last.set(x, { at, explicit: who == null });
        }
      } else seg = null;
      continue;
    }
    if (e.kind === "step_done" && e.ref?.startsWith("prep:") && p.undo === true) undoneTasks.add(e.ref.slice(5));
    if (e.kind === "bowl_ready" && e.ref && p.ready === false) undoneBowls.add(e.ref);
    const s = seg as { kind: "solo" | "duo"; tasks: Set<string> } | null;
    if (!s) continue;

    if (s.kind === "solo") {
      const isTask = e.kind === "step_done" && Boolean(e.ref?.startsWith("prep:")) && p.undo !== true;
      const isBowl = e.kind === "bowl_ready" && Boolean(e.ref) && p.ready !== false && who == null;
      if (!isTask && !isBowl) continue;
      const l = last.get("A");
      const prev = l && l !== "busy" ? l : null;
      last.set("A", { at, explicit: true });
      const real = prev ? (at - prev.at) / 60000 : 0;
      const measured = Boolean(prev?.explicit) && real > 0;
      if (isTask) {
        const t = taskById.get(e.ref!.slice(5));
        if (!t || consumed.has(t.id) || !s.tasks.has(t.id)) continue;
        consumed.add(t.id);
        if (measured) out.push(sample(t, real, 1, null, e.at));
        continue;
      }
      const letter = e.ref!;
      const bowl = plan.bowls.find((b) => b.letter === letter);
      if (!bowl || bowlsSeen.has(letter)) continue;
      bowlsSeen.add(letter);
      const feeding = [...s.tasks].map((id) => taskById.get(id)!).filter((t) => t && !consumed.has(t.id) && t.kind === "cut" && t.items.some((i) => i.bowl === letter));
      feeding.forEach((t) => consumed.add(t.id));
      const nWeigh = bowl.items.filter((i) => !parseGesture(i.item).gesture).length;
      const parts: { t: PrepTask; e: number }[] = feeding.map((t) => ({ t, e: taskRef(t) }));
      const weighTask: PrepTask = { id: `weigh-${letter}`, title: `Bol ${letter}`, total: null, minutes: nWeigh * WEIGH_MIN * weighFactor, items: [], kind: "weigh", units: nWeigh, bowls: [letter], recipeSlug: bowl.recipeSlug };
      if (nWeigh) parts.push({ t: weighTask, e: nWeigh * WEIGH_MIN });
      const sum = parts.reduce((x, c) => x + c.e, 0);
      if (!measured || sum <= 0) continue;
      for (const c of parts) out.push(sample(c.t, (real * c.e) / sum, parts.length === 1 ? 1 : c.e / sum, `bol ${letter}`, e.at));
      continue;
    }

    // À deux : chaque personne a sa marque.
    const person = who ?? "A";
    if (e.kind === "step_done" && e.ref?.startsWith("prep:")) {
      if (p.undo === true) continue;
      const l = last.get(person);
      const prev = l && l !== "busy" ? l : null;
      last.set(person, { at, explicit: true });
      const t = taskById.get(e.ref.slice(5));
      if (!t || consumed.has(t.id) || !s.tasks.has(t.id)) continue;
      consumed.add(t.id);
      if (prev?.explicit && at > prev.at) out.push(sample(t, (at - prev.at) / 60000, 1, null, e.at));
    } else if (e.kind === "step_start" && e.ref && p.undo !== true && who) {
      const st = plan.steps.find((x) => x.id === e.ref);
      if (st && st.activeMin > 0) last.set(person, "busy");
    } else if ((e.kind === "step_done" || e.kind === "timer_start") && who) {
      last.set(person, { at, explicit: true });
    }
  }

  const prepSamples = out.filter((x) => !undoneTasks.has(x.ref) && !(x.via && undoneBowls.has(x.via.slice(4))));

  // Étapes.
  const state = reduce("prep", evs);
  const name = (slug: string | null) => plan.recipes.find((r) => r.slug === slug)?.name ?? "";
  const steps: DurationSample[] = [];
  for (const st of plan.steps) {
    // Close d'avance par l'étape suivante (« le four est chaud ? enfourne ») : on n'a pas attendu sa fin, rien à apprendre.
    if (st.kind === "preheat" || !st.recipeSlug || state.early.has(st.id)) continue;
    const s0 = state.started.get(st.id);
    const s1 = state.done.get(st.id);
    // Seul, gestes glissés dans la cuisson : un geste par sous-étape, mesuré de la fin de la
    // précédente (ou du lancement de l'étape) à sa fin.
    if (st.tasks) {
      let from = s0 ?? null;
      st.tasks.forEach((t, n) => {
        const end = evs.find((e) => e.kind === "step_done" && e.ref === `phase:${n}:${st.id}` && e.payload?.undo !== true);
        const at = end ? Date.parse(end.at) : n === st.tasks!.length - 1 && s1 != null ? s1 : null;
        if (from != null && at != null && at > from) steps.push(sample(t, (at - from) / 60000, 1, null, new Date(at).toISOString()));
        from = at;
      });
      continue;
    }
    const est = st.refDurationMin ?? st.durationMin;
    if (s0 == null || s1 == null || s1 <= s0 || est < 2) continue;
    const timer = [...state.timers.values()].filter((t) => t.stepId === st.id).sort((a, b) => b.endsAt - a.endsAt)[0];
    const end = timer && timer.endsAt > s0 ? Math.min(s1, timer.endsAt) : s1;
    steps.push({
      kind: "step",
      key: stepKey(st.recipeSlug, st.order),
      ref: st.id,
      label: `${name(st.recipeSlug)} · étape ${st.order} · ${STEP_LABELS[st.kind as keyof typeof STEP_LABELS] ?? st.kind}`,
      grams: null,
      units: null,
      estMin: est,
      plannedMin: st.durationMin,
      realMin: (end - s0) / 60000,
      weight: 1,
      via: null,
      at: new Date(s1).toISOString(),
    });
  }
  return [...prepSamples, ...steps];
}

// ─── Corrections ───

export interface StoredSample extends DurationSample {
  sessionId: string;
}

export interface Measure {
  sessionId: string;
  ratio: number;
  weight: number;
  realMin: number;
  estMin: number;
}

export interface Correction {
  key: string;
  kind: SampleKind;
  label: string;
  factor: number; // 1 = pas de correction
  n: number;
  sessions: string[];
  used: Measure[];
  ignored: (Measure & { why: string })[];
}

/** Corrections par clé, à partir des mesures des dernières sessions terminées (déjà filtrées sur la fenêtre). */
export function learn(samples: StoredSample[]): Map<string, Correction> {
  const byKey = new Map<string, StoredSample[]>();
  for (const s of samples) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
  const out = new Map<string, Correction>();
  for (const [key, list] of byKey) {
    const kind = list[0].kind;
    const label = [...list].sort((a, b) => b.at.localeCompare(a.at))[0].label;
    const ignored: Correction["ignored"] = [];
    // Une mesure par session : les gestes du même aliment (veille et jour J, deux bols) s'additionnent.
    const perSession = new Map<string, { real: number; est: number; w: number }>();
    for (const s of list) {
      const m: Measure = { sessionId: s.sessionId, ratio: s.realMin / s.estMin, weight: s.weight, realMin: s.realMin, estMin: s.estMin };
      const why = implausible(s);
      if (why) {
        ignored.push({ ...m, why });
        continue;
      }
      const a = perSession.get(s.sessionId) ?? { real: 0, est: 0, w: 0 };
      a.real += s.realMin;
      a.est += s.estMin;
      a.w += s.weight * s.estMin;
      perSession.set(s.sessionId, a);
    }
    let ms: Measure[] = [...perSession.entries()].map(([sessionId, a]) => ({ sessionId, ratio: a.real / a.est, weight: Math.min(1, a.w / a.est), realMin: a.real, estMin: a.est }));
    if (ms.length >= 3) {
      const logs = ms.map((m) => Math.log(m.ratio)).sort((a, b) => a - b);
      const med = logs.length % 2 ? logs[(logs.length - 1) / 2] : (logs[logs.length / 2 - 1] + logs[logs.length / 2]) / 2;
      ms = ms.filter((m) => {
        const keep = Math.abs(Math.log(m.ratio) - med) <= FAR;
        if (!keep) ignored.push({ ...m, why: "loin des autres mesures" });
        return keep;
      });
    }
    ms = ms.filter((m) => {
      const lr = Math.log(m.ratio);
      const confirmed = ms.some((o) => o !== m && Math.abs(Math.log(o.ratio) - lr) <= NEAR);
      const keep = Math.abs(lr) <= LONE || confirmed;
      if (!keep) ignored.push({ ...m, why: "mesure seule, trop loin de la référence" });
      return keep;
    });
    const wsum = ms.reduce((x, m) => x + m.weight, 0);
    const raw = Math.exp(ms.reduce((x, m) => x + m.weight * Math.log(m.ratio), 0) / (PRIOR + wsum));
    const [lo, hi] = CAPS[kind];
    let factor = Math.round(Math.min(hi, Math.max(lo, raw)) * 100) / 100;
    if (Math.abs(factor - 1) < 0.03) factor = 1;
    out.set(key, { key, kind, label, factor, n: ms.length, sessions: [...new Set(ms.map((m) => m.sessionId))], used: ms, ignored });
  }
  return out;
}

/** Ce que le planificateur reçoit (planSession, option durations). */
export function plannerInput(corrections: Map<string, Correction>, windowSessions: number): DurationInput {
  const factors: DurationInput["factors"] = {};
  for (const c of corrections.values()) if (c.factor !== 1) factors[c.key] = { factor: c.factor, n: c.n, sessions: c.sessions, label: c.label };
  return { factors, sessions: windowSessions };
}

/** « d'après tes 2 dernières sessions » (origine des durées d'un plan). */
export function durationsOrigin(plan: Pick<SessionPlan, "durations">): { text: string; detail: string[] } {
  const d = plan.durations;
  if (!d) return { text: "Durées de référence.", detail: [] };
  if (d.window === 0) return { text: "Durées de référence : pas encore de session terminée pour les corriger.", detail: [] };
  if (!d.applied.length || d.sessions === 0)
    return { text: `Durées de référence : ${d.window > 1 ? `tes ${d.window} dernières sessions ne disent rien` : "ta dernière session ne dit rien"} de ces gestes et étapes.`, detail: [] };
  const pct = (f: number) => `${f > 1 ? "+" : "−"}${Math.round(Math.abs(f - 1) * 100)} %`;
  const fmt = (m: number) => `${String(Math.round(m * 2) / 2).replace(".", ",")} min`;
  const detail = [...d.applied]
    .sort((a, b) => Math.abs(b.min - b.refMin) - Math.abs(a.min - a.refMin))
    .map((a) => `${a.label} : ${fmt(a.refMin)} → ${fmt(a.min)} (${pct(a.factor)}, ${a.n} mesure${a.n > 1 ? "s" : ""})`);
  return { text: `Durées corrigées d'après ${d.sessions > 1 ? `tes ${d.sessions} dernières sessions` : "ta dernière session"}`, detail };
}

// ─── Bilan prévu / réel ───

export interface ReportRow {
  ref: string;
  label: string;
  phase: "veille" | "jour" | null;
  plannedMin: number;
  realMin: number | null;
  shared: boolean; // mesuré au prorata d'un bol
  kept: boolean; // compte pour les corrections (dans les bornes)
  perKg: number | null;
}

export function sessionReport(plan: SessionPlan, samples: DurationSample[]) {
  const by = new Map<string, DurationSample[]>();
  for (const s of samples) by.set(s.ref, [...(by.get(s.ref) ?? []), s]);
  const evening = new Set((plan.eve?.tasks ?? plan.prep.tasks.filter((t) => t.eve)).map((t) => t.id));
  const veilleLike = modeOf(plan) === "veille" || Boolean(plan.eve);
  const row = (ref: string, label: string, planned: number, list: DurationSample[] | undefined, grams: number | null, phase: ReportRow["phase"]): ReportRow => {
    const real = list?.length ? list.reduce((x, s) => x + s.realMin, 0) : null;
    return {
      ref,
      label,
      phase,
      plannedMin: planned,
      realMin: real,
      shared: Boolean(list?.some((s) => s.weight < 1)),
      kept: Boolean(list?.every((s) => inBounds(s))),
      perKg: real != null && grams ? real / (grams / 1000) : null,
    };
  };
  const tasks = [...(plan.eve?.tasks ?? []), ...plan.prep.tasks, ...plan.steps.flatMap((s) => s.tasks ?? [])].filter((t) => t.kind !== "weigh");
  const gestures = tasks.map((t) => row(t.id, taskLabel(t), t.minutes, by.get(t.id), taskQty(t).grams, veilleLike ? (evening.has(t.id) ? "veille" : "jour") : null));
  const weigh = samples.filter((s) => s.kind === "weigh");
  const weighPlanned =
    modeOf(plan) === "duo"
      ? plan.prep.tasks.filter((t) => t.kind === "weigh").reduce((x, t) => x + t.minutes, 0)
      : plan.bowls.reduce((x, b) => x + b.items.filter((i) => !parseGesture(i.item).gesture).length, 0) * WEIGH_MIN * (plan.durations?.applied.find((a) => a.key === "weigh")?.factor ?? 1);
  if (weighPlanned > 0) {
    const r = row("weigh", "Pesées (bols mesurés)", weighPlanned, weigh.length ? weigh : undefined, null, null);
    // Le prévu ne couvre que les bols mesurés, pour comparer ce qui se compare.
    if (weigh.length) r.plannedMin = weigh.reduce((x, s) => x + s.plannedMin, 0);
    gestures.push(r);
  }
  const steps = plan.steps
    .filter((s) => s.kind !== "preheat" && !s.tasks)
    .map((s) => row(s.id, `${s.no}. ${plan.recipes.find((r) => r.slug === s.recipeSlug)?.name ?? ""} · ${STEP_LABELS[s.kind as keyof typeof STEP_LABELS] ?? s.kind}`, s.durationMin, by.get(s.id), null, null));
  return { gestures, steps };
}
