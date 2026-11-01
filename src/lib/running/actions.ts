// Ce que l'IA peut proposer pour la course (docs/course.md § 6) et ce que le code vérifie. L'IA lit un
// instantané calculé ici (`RunContext`, `runContextText`) et propose des actions typées ; `checkRunningAction`
// les revérifie contre les invariants (rien n'augmente sous un signal ou après une douleur, rien pendant une
// suspension, règle des 30 jours et une sortie record par 7 jours, types permis dans la phase, dates futures
// dans l'horizon, bornes de séance), puis la personne confirme et le code applique (store.ts), avec les mêmes
// fonctions que la page. Les chiffres de la carte viennent du code. Pur.
import { z } from "zod";
import { LONGEST_RATIO, RECORD_EVERY_DAYS, SESSION_BOUNDS } from "./constants";
import { addDays, daysBetween, dayLabel, isYmd, mondayOfDay, weekday, WEEKDAY_LABEL } from "./dates";
import { PHASE_LABEL, type Phase } from "./plan";
import { checkSession, DIFFICULTY, KIND_LABEL, kindAllowed, QUALITY, SESSION_KINDS, sessionMinutes, sessionOf, shorten, type RunSession, type SessionKind } from "./workout";
import { zoneRange, type Zones } from "./zones";

const why = z.string().describe("En une phrase courte : pourquoi cette action");
const sessionId = z.string().describe("id exact d'une séance prévue de la liste");

export const RUN_ACTIONS = {
  course_decaler: {
    description: "Proposer de déplacer une séance de course prévue à un autre jour disponible de la semaine en cours ou de la suivante. L'appli vérifie les règles de placement.",
    schema: z.object({ sessionId, date: z.string().describe("nouveau jour, AAAA-MM-JJ"), why }),
  },
  course_raccourcir: {
    description: "Proposer de raccourcir une séance de course prévue (durée totale en minutes, échauffement compris). Toujours permis : alléger est sûr.",
    schema: z.object({ sessionId, minutes: z.number().describe("nouvelle durée totale, plus courte que l'actuelle"), why }),
  },
  course_remplacer: {
    description: "Proposer de remplacer une séance de course prévue par un type plus facile (footing au lieu d'une qualité, marche-course au lieu d'un footing…). L'appli compose la séance.",
    schema: z.object({ sessionId, type: z.enum(SESSION_KINDS).describe("type de la nouvelle séance"), minutes: z.number().describe("durée totale visée, pas plus longue que l'actuelle"), why }),
  },
  course_sorties: {
    description: "Proposer de changer le nombre de sorties de course par semaine (2 à 4). Le plan est recalculé par l'appli.",
    schema: z.object({ perWeek: z.number().describe("sorties par semaine, 2 à 4"), why }),
  },
  course_decharge: {
    description: "Proposer une semaine de décharge (volume × 0,70, sortie longue × 0,80, sans qualité) pour la semaine en cours ou la suivante.",
    schema: z.object({ weekStart: z.string().describe("lundi de la semaine, AAAA-MM-JJ"), why }),
  },
  course_fc: {
    description: "Proposer d'enregistrer une FC max, une FC au repos ou une FC au seuil que la personne a donnée elle-même (test, course à fond). Jamais une valeur devinée.",
    schema: z.object({ hrMax: z.number().optional(), hrRest: z.number().optional(), hrThreshold: z.number().optional(), why }),
  },
} as const;

export type RunActionKind = keyof typeof RUN_ACTIONS;
export const RUN_ACTION_KINDS = Object.keys(RUN_ACTIONS) as RunActionKind[];
export type RunActionInput<K extends RunActionKind = RunActionKind> = { [P in K]: { kind: P } & z.infer<(typeof RUN_ACTIONS)[P]["schema"]> }[K];
export const RUN_ACTION_LABEL: Record<RunActionKind, string> = {
  course_decaler: "Déplacer une séance",
  course_raccourcir: "Raccourcir une séance",
  course_remplacer: "Remplacer une séance",
  course_sorties: "Changer le nombre de sorties",
  course_decharge: "Semaine de décharge",
  course_fc: "Régler une fréquence cardiaque",
};
export const isRunAction = (name: string): name is RunActionKind => (RUN_ACTION_KINDS as string[]).includes(name);

/** Bornes des réglages (§ 6, run.zones.set ; nombre de sorties visé). */
export const HR_BOUNDS = { max: [120, 230], rest: [30, 100] } as const;
export const PER_WEEK_BOUNDS = [2, 4] as const;
/** Écart avec les observations au-delà duquel la personne doit confirmer. */
export const HR_CONFIRM_GAP = 15;

/** Une séance prévue, telle que l'IA et la vérification la voient. */
export interface ContextSession {
  id: string;
  weekStart: string;
  date: string;
  time: string | null;
  kind: SessionKind;
  minutes: number;
  title: string;
  status: "prevue" | "programmee" | "faite" | "manquee" | "annulee";
  session: RunSession;
}

/** L'instantané Course d'une personne (calculé par store.ts). */
export interface RunContext {
  today: string;
  personId: string;
  name: string;
  phase: Phase;
  level: number | null;
  weekInPhase: number;
  zones: Zones;
  /** Repères observés (pour la cohérence d'une FC saisie). */
  observed: { max: number | null; rest: number | null };
  days: number[];
  perWeek: number;
  /** Jours de renforcement (qui chargent les jambes). */
  heavyDays: number[];
  paused: { reason: string } | null;
  /** Signaux d'adaptation actifs (§ 4.8), en clair. */
  signals: string[];
  /** Douleur ≥ 3 dans les 7 derniers jours. */
  painRecent: boolean;
  /** La plus longue course des 30 derniers jours (min). */
  longest30: number | null;
  /** Jours des courses faites des 14 derniers jours, et des sorties longues faites. */
  ranOn: string[];
  longOn: string[];
  sessions: ContextSession[];
  weeks: { weekStart: string; volume: number; long: number; deload: boolean }[];
  messages: string[];
  load: { ctl: number; atl: number; tsbPct: number | null } | null;
  lastRuns: { date: string; minutes: number; km: number | null; effort: number | null; pain: number | null; zones: string | null; decoupling: number | null; heat: boolean }[];
}

export interface RunCard {
  title: string;
  lines: { label: string; value: string }[];
  notes: string[];
}
export type RunChecked = ({ ok: true } & RunCard) | { ok: false; reason: string };

const live = (s: ContextSession) => s.status === "prevue" || s.status === "programmee";
const restrained = (c: RunContext) => c.signals.length > 0 || c.painRecent;

/** Une séance modifiable : prévue, à venir. */
function editable(c: RunContext, id: string): ContextSession | string {
  const s = c.sessions.find((x) => x.id === id);
  if (!s) return "Séance introuvable dans le plan.";
  if (!live(s)) return "Cette séance n'est plus prévue.";
  if (s.date < c.today) return "Cette séance est passée.";
  return s;
}

/** Les règles de placement (§ 4.11) d'une séance au jour `date` ; null si tout va. */
export function placementError(c: RunContext, s: Pick<ContextSession, "id" | "kind" | "minutes">, date: string): string | null {
  const others = c.sessions.filter((x) => x.id !== s.id && live(x));
  if (others.some((x) => x.date === date) || c.ranOn.includes(date)) return "Il y a déjà une course ce jour-là.";
  const near = (d: string) => [...others.filter((x) => Math.abs(daysBetween(x.date, d)) === 1).map((x) => ({ kind: x.kind, minutes: x.minutes })), ...c.ranOn.filter((r) => Math.abs(daysBetween(r, d)) === 1).map(() => ({ kind: "footing" as SessionKind, minutes: 999 }))];
  const shortEasy = (x: { kind: SessionKind; minutes: number }) => x.kind === "footing" && x.minutes <= 40;
  for (const n of near(date)) {
    if (c.phase <= 1) return "Pas deux jours de course de suite en début de plan.";
    if (!shortEasy(n) && !shortEasy(s)) return "Deux jours de suite seulement si l'un est un footing court.";
  }
  const hard = (k: SessionKind) => QUALITY.has(k) || k === "sortie_longue";
  if (hard(s.kind)) {
    for (const x of others) if ((QUALITY.has(s.kind) || QUALITY.has(x.kind)) && hard(x.kind) && Math.abs(daysBetween(x.date, date)) < 2) return "Une séance de qualité doit rester à 48 h de la sortie longue.";
    if (c.heavyDays.includes(weekday(addDays(date, -1)))) return "La veille, il y a du renforcement qui charge les jambes.";
  }
  if (s.kind === "sortie_longue") {
    const longs = [...c.longOn, ...others.filter((x) => x.kind === "sortie_longue").map((x) => x.date)];
    if (longs.some((d) => Math.abs(daysBetween(d, date)) < RECORD_EVERY_DAYS)) return "Une seule sortie longue (la sortie « record ») par période de 7 jours.";
  }
  return null;
}

const minutesLabel = (m: number) => `${Math.round(m)} min`;
const sessionLine = (s: Pick<ContextSession, "title" | "date">) => `${s.title}, ${dayLabel(s.date)}`;

/** Vérifie une action proposée sur l'instantané : refus motivé, ou carte chiffrée par le code. */
export function checkRunningAction(a: RunActionInput, c: RunContext | null): RunChecked {
  if (!c) return { ok: false, reason: "Le module Course n'est pas activé pour cette personne." };
  if (c.paused && a.kind !== "course_fc") return { ok: false, reason: c.paused.reason === "douleur" ? "La course est suspendue pour une douleur : seule la personne rouvre le plan." : "Le plan est en pause." };
  switch (a.kind) {
    case "course_decaler": {
      const s = editable(c, a.sessionId);
      if (typeof s === "string") return { ok: false, reason: s };
      if (!isYmd(a.date)) return { ok: false, reason: "Date illisible." };
      if (a.date === s.date) return { ok: false, reason: "La séance est déjà ce jour-là." };
      if (a.date < c.today) return { ok: false, reason: "On ne déplace pas une séance dans le passé." };
      const week = mondayOfDay(c.today);
      if (a.date < week || a.date >= addDays(week, 14)) return { ok: false, reason: "Seulement dans la semaine en cours ou la suivante." };
      if (!c.days.includes(weekday(a.date))) return { ok: false, reason: `Le ${WEEKDAY_LABEL[weekday(a.date)]} n'est pas un jour disponible pour courir.` };
      const err = placementError(c, s, a.date);
      if (err) return { ok: false, reason: err };
      return { ok: true, title: `Déplacer : ${s.title}`, lines: [{ label: "Jour", value: `${dayLabel(s.date)} → ${dayLabel(a.date)}` }], notes: [] };
    }
    case "course_raccourcir": {
      const s = editable(c, a.sessionId);
      if (typeof s === "string") return { ok: false, reason: s };
      const m = Math.round(a.minutes);
      if (!(m >= SESSION_BOUNDS.totalMin)) return { ok: false, reason: `Une séance dure au moins ${SESSION_BOUNDS.totalMin} min.` };
      if (m >= s.minutes) return { ok: false, reason: "Ce n'est pas plus court." };
      const next = shorten(s.session, m, c.zones);
      const errs = checkSession(next, c.zones);
      if (errs.length) return { ok: false, reason: `Séance invalide : ${errs.join(", ")}.` };
      return { ok: true, title: `Raccourcir : ${sessionLine(s)}`, lines: [{ label: "Durée", value: `${minutesLabel(s.minutes)} → ${minutesLabel(sessionMinutes(next))}` }, { label: "Séance", value: next.title }], notes: [] };
    }
    case "course_remplacer": {
      const s = editable(c, a.sessionId);
      if (typeof s === "string") return { ok: false, reason: s };
      if (!kindAllowed(a.type, c.phase)) return { ok: false, reason: `${KIND_LABEL[a.type]} n'est pas permis en phase ${c.phase} (${PHASE_LABEL[c.phase]}).` };
      if (DIFFICULTY[a.type] > DIFFICULTY[s.kind]) return { ok: false, reason: "On ne remplace que par une séance plus facile." };
      const m = Math.round(a.minutes);
      if (m > s.minutes) return { ok: false, reason: "Pas plus longue que la séance prévue." };
      const next = sessionOf(a.type, Math.max(SESSION_BOUNDS.totalMin, m), c.zones, c.level ?? 1);
      if (sessionMinutes(next) > s.minutes) return { ok: false, reason: "La séance composée serait plus longue que la prévue." };
      if (c.longest30 != null && sessionMinutes(next) > Math.floor(c.longest30 * LONGEST_RATIO)) return { ok: false, reason: "Plus longue que 1,10 × la plus longue des 30 jours." };
      if (restrained(c) && (QUALITY.has(a.type) || a.type === "test_aerobie")) return { ok: false, reason: "Pas de séance de qualité tant qu'un signal d'adaptation est actif." };
      const errs = checkSession(next, c.zones);
      if (errs.length) return { ok: false, reason: `Séance invalide : ${errs.join(", ")}.` };
      return { ok: true, title: `Remplacer : ${sessionLine(s)}`, lines: [{ label: "Par", value: next.title }, { label: "Durée", value: `${minutesLabel(s.minutes)} → ${minutesLabel(sessionMinutes(next))}` }], notes: [] };
    }
    case "course_sorties": {
      const n = Math.round(a.perWeek);
      if (n < PER_WEEK_BOUNDS[0] || n > PER_WEEK_BOUNDS[1]) return { ok: false, reason: `Entre ${PER_WEEK_BOUNDS[0]} et ${PER_WEEK_BOUNDS[1]} sorties par semaine.` };
      if (n === c.perWeek) return { ok: false, reason: "C'est déjà le réglage." };
      if (n > c.days.length) return { ok: false, reason: `Seulement ${c.days.length} jour${c.days.length > 1 ? "s" : ""} disponible${c.days.length > 1 ? "s" : ""} : ajoute des jours d'abord.` };
      if (n > c.perWeek && restrained(c)) return { ok: false, reason: "Pas d'augmentation tant qu'un signal d'adaptation ou une douleur récente est là." };
      const notes = c.phase === 0 && n > 3 ? ["En marche-course, le plan garde 3 séances au plus."] : c.phase <= 1 && n > 3 ? ["Jusqu'à la phase 2, le plan garde 3 sorties au plus."] : [];
      return { ok: true, title: "Changer le nombre de sorties", lines: [{ label: "Par semaine", value: `${c.perWeek} → ${n}` }], notes: [...notes, "Le plan est recalculé par l'appli à partir de la semaine prochaine."] };
    }
    case "course_decharge": {
      const week = mondayOfDay(c.today);
      if (a.weekStart !== week && a.weekStart !== addDays(week, 7)) return { ok: false, reason: "Seulement la semaine en cours ou la suivante (donner son lundi)." };
      if (c.phase === 0) return { ok: false, reason: "Pas de décharge en marche-course : les niveaux suffisent." };
      const w = c.weeks.find((x) => x.weekStart === a.weekStart);
      if (w?.deload) return { ok: false, reason: "C'est déjà une semaine de décharge." };
      return { ok: true, title: `Semaine de décharge à partir du ${dayLabel(a.weekStart)}`, lines: w ? [{ label: "Volume prévu", value: `${minutesLabel(w.volume)} → environ ${minutesLabel(w.volume * 0.7)}` }] : [], notes: ["Sortie longue × 0,80, pas de qualité ; la semaine d'après repart d'avant la décharge."] };
    }
    case "course_fc": {
      const max = a.hrMax != null ? Math.round(a.hrMax) : null;
      const rest = a.hrRest != null ? Math.round(a.hrRest) : null;
      const thr = a.hrThreshold != null ? Math.round(a.hrThreshold) : null;
      if (max == null && rest == null && thr == null) return { ok: false, reason: "Aucune valeur." };
      if (max != null && (max < HR_BOUNDS.max[0] || max > HR_BOUNDS.max[1])) return { ok: false, reason: `FC max entre ${HR_BOUNDS.max[0]} et ${HR_BOUNDS.max[1]} bpm.` };
      if (rest != null && (rest < HR_BOUNDS.rest[0] || rest > HR_BOUNDS.rest[1])) return { ok: false, reason: `FC au repos entre ${HR_BOUNDS.rest[0]} et ${HR_BOUNDS.rest[1]} bpm.` };
      const M = max ?? c.zones.max;
      const R = rest ?? c.zones.rest;
      if (M - R < 40) return { ok: false, reason: "FC max et FC au repos trop proches." };
      if (thr != null && !(thr > R + 20 && thr < M)) return { ok: false, reason: `La FC au seuil doit être entre ${R + 21} et ${M - 1} bpm.` };
      const notes: string[] = [];
      if (max != null && c.observed.max != null && Math.abs(max - c.observed.max) > HR_CONFIRM_GAP) notes.push(`Tes courses donnent une FC max de ${c.observed.max} bpm : confirme seulement si ${max} vient d'un test ou d'une course à fond.`);
      if (rest != null && c.observed.rest != null && Math.abs(rest - c.observed.rest) > HR_CONFIRM_GAP) notes.push(`La montre mesure une FC au repos vers ${c.observed.rest} bpm : confirme seulement si ${rest} est juste.`);
      const lines = [
        ...(max != null ? [{ label: "FC max", value: `${c.zones.max} → ${max} bpm` }] : []),
        ...(rest != null ? [{ label: "FC au repos", value: `${c.zones.rest} → ${rest} bpm` }] : []),
        ...(thr != null ? [{ label: "FC au seuil", value: `${c.zones.threshold} → ${thr} bpm` }] : []),
      ];
      return { ok: true, title: "Régler les fréquences cardiaques", lines, notes: [...notes, "Les zones et les alertes de la montre sont recalculées."] };
    }
  }
}

/** Ce qu'une action confirmée change à une séance (rejoué à chaque calcul du plan). */
export interface SessionEdit {
  date?: string;
  minutes?: number;
  kind?: SessionKind;
}

/** Applique un changement à une séance (même fonction pour la page et pour une action confirmée). */
export function applyEdit<T extends { date: string; kind: SessionKind; minutes: number; session: RunSession }>(p: T, e: SessionEdit, zones: Zones, level: number | null): T {
  let s = p.session;
  if (e.kind) s = sessionOf(e.kind, Math.max(SESSION_BOUNDS.totalMin, e.minutes ?? p.minutes), zones, s.level ?? level ?? 1);
  else if (e.minutes != null && e.minutes < sessionMinutes(s)) s = shorten(s, e.minutes, zones);
  return { ...p, date: e.date ?? p.date, session: s, kind: s.kind, minutes: sessionMinutes(s) };
}

// ─── Contexte pour l'assistant ───

const fmtPace = (secPerKm: number) => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}/km`;

const SOURCE = { saisie: "saisie", observee: "d'après ses courses", age: "d'après l'âge", mesuree: "mesurée", defaut: "par défaut", test: "test", estimee: "estimée" } as const;

/** L'instantané en texte compact (pas de calcul côté IA : tout vient d'ici). */
export function runContextText(c: RunContext): string {
  const L: string[] = [`## Course : ${c.name} (personId ${c.personId}), plan de course à pied calculé par l'appli`];
  L.push(`Phase ${c.phase} (${PHASE_LABEL[c.phase]})${c.level ? `, niveau ${c.level} de marche-course` : ""}, semaine ${c.weekInPhase} de la phase ; ${c.perWeek} sorties visées ; jours disponibles : ${c.days.map((d) => WEEKDAY_LABEL[d]).join(", ") || "aucun"}.`);
  const z = c.zones;
  L.push(`Zones (${z.method === "friel" ? "seuil mesuré" : "réserve cardiaque"}) : FC max ${z.max} (${SOURCE[z.maxSource]}), repos ${z.rest} (${SOURCE[z.restSource]}), seuil ${z.threshold} (${SOURCE[z.thresholdSource]}) ; Z2 ${zoneRange(z, 2).join("–")} bpm.`);
  if (c.paused) L.push(`PLAN EN PAUSE (${c.paused.reason}) : aucune séance, ne propose rien qui la lève.`);
  if (c.signals.length) L.push(`Signaux actifs : ${c.signals.join(" ; ")}. Rien ne doit augmenter.`);
  if (c.painRecent) L.push("Douleur ≥ 3 dans les 7 derniers jours : rien ne doit augmenter.");
  if (c.load) L.push(`Charge : condition ${Math.round(c.load.ctl)}, fatigue ${Math.round(c.load.atl)}${c.load.tsbPct != null ? `, fraîcheur ${Math.round(c.load.tsbPct)} %` : ""}.`);
  if (c.longest30 != null) L.push(`Plus longue course des 30 jours : ${Math.round(c.longest30)} min.`);
  if (c.lastRuns.length) {
    L.push("Dernières courses :");
    for (const r of c.lastRuns) L.push(`- ${dayLabel(r.date)} : ${Math.round(r.minutes)} min${r.km ? `, ${r.km.toFixed(1)} km (${fmtPace((r.minutes * 60) / r.km)})` : ""}${r.effort != null ? `, effort ${r.effort}` : ""}${r.pain ? `, douleur ${r.pain}` : ""}${r.zones ? `, ${r.zones}` : ""}${r.decoupling != null ? `, découplage ${r.decoupling} %` : ""}${r.heat ? ", chaleur" : ""}`);
  }
  L.push("Séances prévues (id, jour, séance, statut) :");
  for (const s of c.sessions.filter((x) => x.date >= c.today)) L.push(`- ${s.id} : ${dayLabel(s.date)}${s.time ? ` ${s.time}` : ""}, ${s.title} (${s.kind}, ${s.minutes} min), ${s.status}`);
  if (c.phase > 0) for (const w of c.weeks) L.push(`Semaine du ${dayLabel(w.weekStart)} : ${w.volume} min de course prévues, sortie longue ${w.long} min${w.deload ? ", décharge" : ""}.`);
  for (const m of c.messages) L.push(`Message de l'appli : ${m}`);
  return L.join("\n");
}

