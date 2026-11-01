// L'attention que demande chaque moment d'une étape. Module pur (tests/attention.test.ts).
//
// - « mains » : la personne y est tout entière (saisir, égrener, peser, mettre en boîtes, ajouter un
//   bol) ; deux moments « mains » ne se chevauchent jamais pour une même personne, et à deux, une étape
//   reste à une seule personne ;
// - « surveille » : on peut faire autre chose mais il faut revenir (un mijoté qu'on remue toutes les
//   5 min, des oignons « de temps en temps », de l'eau qu'on porte à ébullition) : un rappel le dit ;
// - « libre » : attente pure (le four, l'eau qui chauffe couverte, le riz qui repose sans ouvrir).
//
// Les sous-étapes de la fiche (`phases`) donnent la chronologie. Le temps actif de la fiche
// (`activeMin`) borne le temps « mains » : une sous-étape longue sans attente (« porte à ébullition »,
// 4 min) n'occupe les mains qu'au début, le reste est « surveille ».

export type Attention = "mains" | "surveille" | "libre";

/** Rappel pendant un moment « surveille » : toutes les `everyMin` minutes, de `fromMin` à `untilMin` (depuis le début de l'étape). */
export interface Reminder {
  fromMin: number;
  untilMin: number;
  everyMin: number;
  text: string;
}

export interface TimedPhase {
  fromMin: number;
  toMin: number;
  attention: Attention;
  reminder?: { everyMin: number; text: string } | null;
}

export interface Timeline {
  /** Un moment par sous-étape (dans l'ordre de la fiche), plus la fin de l'étape si les sous-étapes ne la couvrent pas. */
  phases: TimedPhase[];
  /** Intervalles « mains », fusionnés, en minutes depuis le début de l'étape. */
  hands: [number, number][];
  /**
   * Pour chaque intervalle « mains » : de combien il peut glisser (avant, après), et la sous-étape qu'il est.
   * Un geste court entre deux attentes (« Inverse les plats », 30 s) peut avancer ou reculer de 2 min : les
   * attentes autour s'ajustent, la fin de l'étape ne bouge pas. Le dernier geste après une attente peut
   * reculer de 2 min (l'étape finit d'autant plus tard).
   */
  slack: { lo: number; hi: number; phase: number }[];
  reminders: Reminder[];
  /** Ce que demande l'étape dans l'ensemble : « mains » si les mains y sont presque tout le temps. */
  attention: Attention;
}

interface StepLike {
  kind: string;
  text: string;
  phases?: { text: string; min: number; wait?: boolean | null }[] | null;
}

const SOMETIMES = /de temps en temps|remue (?:souvent|régulièrement)|en remuant de temps/i;
/** Préchauffer un récipient vide : on le pose, on revient pour le test de la goutte. */
const PREHEAT = /\b(?:po[êe]le|cocotte|casserole|faitout) vide\b|\bpréchauffe\b/i;
const STIR = /\bremue|\bmélange|gratte le fond/i;
const PASTA = /\bp[âa]tes\b|orzo|risotto/i;
const SAUCE = /sauce|mijot|réduit|frémi|compote|dahl|curry/i;
const COVERED_LONG = /couvercle|couvert(?! à demi)|sans ouvrir/i;

/** Ce que demande une attente (sous-étape `wait`, ou la fin d'une étape sans sous-étape) ; l'écran la relit pour l'attente qui finit une étape. */
export function waitAttention(text: string, step: StepLike, onHob: boolean): Pick<TimedPhase, "attention" | "reminder"> {
  if (!onHob || step.kind === "bake" || step.kind === "rest" || step.kind === "cool") return { attention: "libre" };
  if (/sans ouvrir|l'eau chauffe|eau chauffe|hors du feu|repos/i.test(text)) return { attention: "libre" };
  if (step.kind === "boil" && PASTA.test(`${text} ${step.text}`) && !/couvert/i.test(text)) return { attention: "surveille", reminder: { everyMin: 3, text: "Remue, que ça n'attache pas" } };
  if (step.kind === "braise" || SAUCE.test(text) || STIR.test(text)) {
    if (PASTA.test(step.text)) return { attention: "surveille", reminder: { everyMin: 3, text: "Remue et gratte le fond : ça accroche" } };
    const sauce = /sauce/i.test(`${text} ${step.text}`);
    const every = COVERED_LONG.test(text) && !/à demi/i.test(text) ? 10 : 5;
    return { attention: "surveille", reminder: { everyMin: every, text: sauce ? "Remue la sauce, gratte le fond" : "Remue, gratte le fond" } };
  }
  return { attention: "libre" };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * La chronologie d'une étape de `dur` minutes dont `act` minutes d'action (la fiche). `onHob` : sur un
 * foyer (un mijoté au four ne se remue pas).
 */
export function stepTimeline(step: StepLike, dur: number, act: number, onHob: boolean): Timeline {
  const raw = (step.phases ?? []).filter((p) => p.min > 0);
  // `handsMin` : un moment « surveille » qui commence par un geste (on verse, puis on surveille).
  const phases: (TimedPhase & { handsMin?: number })[] = [];
  if (!raw.length) {
    // Pas de sous-étape : l'action au début, puis l'attente.
    const a = Math.min(dur, Math.max(0, act));
    if (a > 0) phases.push({ fromMin: 0, toMin: a, attention: "mains" });
    if (dur - a > 1e-6) phases.push({ fromMin: a, toMin: dur, ...waitAttention(step.text, step, onHob && step.kind !== "sear") });
  } else {
    const sum = raw.reduce((x, p) => x + p.min, 0);
    const waitSum = raw.filter((p) => p.wait).reduce((x, p) => x + p.min, 0);
    const busySum = sum - waitSum;
    // Les sous-étapes couvrent l'étape (à 15 % près) : les attentes s'étirent ou se tassent pour tomber juste.
    // Sinon elles n'en sont que le début : la fin suit la règle d'une attente.
    let kWait = 1;
    let kAll = 1;
    if (sum > dur * 1.15) kAll = dur / sum;
    else if (sum >= dur * 0.85 && waitSum > 0 && dur - busySum > 0) kWait = (dur - busySum) / waitSum;
    else if (sum >= dur * 0.85) kAll = dur / sum;
    // Temps « mains » des sous-étapes sans attente, borné par le temps actif de la fiche : les courtes
    // (une minute au plus) gardent tout, les longues se partagent le reste (30 s au moins chacune).
    const busy = raw.map((p, i) => ({ p, i })).filter(({ p }) => !p.wait);
    const sometimes = (t: string) => SOMETIMES.test(t);
    const budget = Math.max(act, 0);
    const shortSum = busy.filter(({ p }) => p.min * kAll <= 1 || sometimes(p.text)).reduce((x, { p }) => x + (sometimes(p.text) ? Math.min(1, p.min * kAll) : p.min * kAll), 0);
    const longs = busy.filter(({ p }) => p.min * kAll > 1 && !sometimes(p.text));
    const longSum = longs.reduce((x, { p }) => x + p.min * kAll, 0);
    const kLong = longSum > 0 ? Math.min(1, Math.max(0, budget - shortSum) / longSum) : 1;
    let t = 0;
    raw.forEach((p) => {
      const len = p.min * kAll * (p.wait ? kWait : 1);
      const from = t;
      const to = t + len;
      t = to;
      if (p.wait) {
        phases.push({ fromMin: from, toMin: to, ...waitAttention(p.text, step, onHob) });
        return;
      }
      // Un récipient vide qui chauffe : on le pose (30 s), puis on surveille.
      if (PREHEAT.test(p.text) && !/huile \+|\bbol [A-Z]/i.test(p.text) && len > 1) {
        phases.push({ fromMin: from, toMin: to, attention: "surveille", handsMin: 0.5 });
        return;
      }
      // « Remue de temps en temps » : la première minute aux mains (on verse), puis on surveille.
      if (sometimes(p.text)) {
        phases.push({ fromMin: from, toMin: to, attention: "surveille", reminder: { everyMin: 2, text: "Remue" }, handsMin: Math.min(1, len) });
        return;
      }
      const hands = len <= 1 ? len : Math.max(Math.min(len, 0.5), len * kLong);
      phases.push(hands >= len - 1e-6 ? { fromMin: from, toMin: to, attention: "mains" } : { fromMin: from, toMin: to, attention: "surveille", handsMin: hands });
    });
    if (dur - t > 0.25) phases.push({ fromMin: t, toMin: dur, ...waitAttention(step.text, step, onHob && step.kind !== "sear") });
  }
  // Intervalles « mains » : les moments « mains » entiers, et le début de ceux qui n'occupent les mains qu'un temps.
  const hands: [number, number][] = [];
  const slack: { lo: number; hi: number; phase: number }[] = [];
  phases.forEach((p, i) => {
    const to = p.attention === "mains" ? p.toMin : p.handsMin != null ? p.fromMin + p.handsMin : null;
    if (to == null || to - p.fromMin <= 1e-6) return;
    const last = hands[hands.length - 1];
    if (last && p.fromMin <= last[1] + 1e-6) {
      last[1] = Math.max(last[1], to);
      slack[slack.length - 1] = { lo: 0, hi: 0, phase: -1 };
      return;
    }
    hands.push([p.fromMin, to]);
    // Un geste court (2 min au plus) entre deux attentes d'au moins 4 min glisse de 2 min au plus.
    const before = phases[i - 1];
    const after = phases[i + 1];
    const waits = (x: TimedPhase | undefined) => Boolean(x && x.attention !== "mains" && !(x as { handsMin?: number }).handsMin && x.toMin - x.fromMin >= 4);
    const flex = to - p.fromMin <= 2 + 1e-6 && waits(before) && waits(after);
    // Le dernier geste après une attente (sortir le plat, égrener le riz, la crème hors du feu) peut attendre
    // 2 min : l'étape finit d'autant plus tard. Jamais pour égoutter (ça cuirait trop).
    const end = i === phases.length - 1 && to - p.fromMin <= 1 + 1e-6 && waits(before) && !/égoutt/i.test(raw[i]?.text ?? "") && (step.kind !== "boil" || /égrèn|repos|hors du feu/i.test(`${raw[i]?.text ?? ""} ${raw[i - 1]?.text ?? ""}`));
    slack.push(flex ? { lo: -Math.min(2, before!.toMin - before!.fromMin - 2), hi: Math.min(2, after!.toMin - after!.fromMin - 2), phase: i } : end ? { lo: 0, hi: 2, phase: i } : { lo: 0, hi: 0, phase: i });
  });
  const reminders: Reminder[] = phases
    .filter((p) => p.attention === "surveille" && p.reminder && p.toMin - p.fromMin >= p.reminder.everyMin)
    .map((p) => ({ fromMin: round(p.fromMin), untilMin: round(p.toMin), everyMin: p.reminder!.everyMin, text: p.reminder!.text }));
  const handsMin = hands.reduce((x, [a, b]) => x + b - a, 0);
  const attention: Attention = handsMin >= dur * 0.7 - 1e-6 && handsMin > 0 ? "mains" : phases.some((p) => p.attention === "surveille") ? "surveille" : "libre";
  return {
    phases: phases.map(({ fromMin, toMin, attention: a, reminder }) => ({ fromMin: round(fromMin), toMin: round(toMin), attention: a, ...(reminder ? { reminder } : {}) })),
    hands: hands.map(([a, b]) => [round(a), round(b)] as [number, number]),
    slack,
    reminders,
    attention,
  };
}

/** Deux listes d'intervalles se chevauchent-elles ? */
export function intervalsOverlap(a: [number, number][], b: [number, number][], eps = 1e-6): boolean {
  return a.some(([a0, a1]) => b.some(([b0, b1]) => a0 < b1 - eps && b0 < a1 - eps));
}

export const ATTENTION_LABELS: Record<Attention, string> = { mains: "Mains prises", surveille: "À surveiller", libre: "Libre" };
