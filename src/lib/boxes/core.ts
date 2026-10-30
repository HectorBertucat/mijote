// La marmite pesée → les boîtes de chacun, et où elles se rangent. Module pur (tests/boxes.test.ts).
//
// Règles :
// - la part de chacun vise son repère comme la Semaine (eaters/core.ts, portionUnits) : on la
//   traduit ici en kcal visées, puis en grammes de la marmite réellement pesée ;
// - avec une garniture cuite à part (riz, semoule : lignes `side` de la fiche), deux poids, donc
//   deux inconnues par personne (grammes de plat, grammes de garniture) pour deux cibles (kcal du
//   repère, milieu des protéines). Le rapport garniture / plat reste entre la moitié et le double
//   de celui de la marmite : au-delà, on garde la borne et on vise les kcal seulement. Sans repère,
//   sans macros ou sans poids de garniture : la proportion simple de la marmite ;
// - nombre de boîtes : une par repas prévu dans la Semaine (pour qui, quel jour), puis la marge en
//   boîtes entières tour à tour, tant qu'il reste au moins 3/4 d'une part ; ce qui reste à la fin se
//   répartit sur toutes les boîtes, de même qu'un manque (la marmite est toujours vidée) ;
// - rangement : au frigo si le repas prévu tombe dans ses jours de conservation, sinon au
//   congélateur (si la recette s'y prête). La marge va au congélateur.
import { portionUnits, type MealRef } from "@/lib/eaters/core";

/** Ce qu'apporte une partie de la marmite entière (plat, ou garniture à part). */
export interface PotPart {
  kcal: number;
  protein: number;
}

export interface PotPerson {
  id: string;
  name: string;
  baseUnits: number;
  ref: MealRef | null;
  /** Repas prévus par la Semaine avec cette recette, à partir du jour de la cuisson. */
  planned: { date: string; meal: "lunch" | "dinner" }[];
}

/** Tout ce qu'il faut pour partager une marmite, sans la base (calculé côté serveur, partagé côté écran). */
export interface PotModel {
  recipeId: string;
  slug: string;
  name: string;
  /** Unités cuites (fiche × multiplicateur de la session) : la base de la proportion simple. */
  cookedUnits: number;
  /** null : macros inconnues, la proportion simple seulement. */
  dish: PotPart | null;
  side: (PotPart & { label: string }) | null;
  fridgeDays: number | null;
  freezerOk: boolean;
  /** Jour de la cuisson (YYYY-MM-DD), pour dire où vont les boîtes. */
  cookedOn?: string;
  people: PotPerson[];
}

export interface Weights {
  dishG: number | null;
  sideG?: number | null;
}

export interface BoxPlan {
  personId: string;
  dishG: number | null;
  sideG: number | null;
  kcal: number | null;
  protein: number | null;
  plannedFor: { date: string; meal: "lunch" | "dinner" } | null;
}

export interface PersonBoxes {
  personId: string;
  name: string;
  count: number;
  planned: number;
  dishG: number | null;
  sideG: number | null;
  kcal: number | null;
  protein: number | null;
}

export type SplitMode = "simple" | "cible" | "borne";

export interface PotSplit {
  boxes: BoxPlan[];
  byPerson: PersonBoxes[];
  /** Comment plat et garniture ont été réglés, par personne (une seule partie : « simple »). */
  modes: Record<string, SplitMode>;
  /** < 1 : la marmite ne couvre pas les repas prévus, chaque boîte est plus petite que la part visée. */
  fill: number;
}

/** Bornes du rapport garniture / plat d'une personne, autour de celui de la marmite. */
export const SIDE_RATIO_MIN = 0.5;
export const SIDE_RATIO_MAX = 2;
/** Une boîte de marge n'est faite que s'il reste au moins 3/4 d'une part. */
export const MARGIN_MIN_SHARE = 0.75;
/** Grammes arrondis à 5 g : la balance de cuisine ne fait pas mieux. */
export const GRAM_STEP = 5;
export const DEFAULT_FRIDGE_DAYS = 3;
/** Au congélateur : trois mois. Décongelée au frigo : à manger sous 24 h. */
export const FREEZER_DAYS = 90;
export const THAWED_DAYS = 1;

const roundG = (g: number) => Math.max(0, Math.round(g / GRAM_STEP) * GRAM_STEP);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Rapport garniture / plat (en grammes) qui vise à la fois les kcal et les protéines, borné. */
export function sideRatio(
  target: { kcal: number; protein: number },
  dish: { kcalG: number; proteinG: number },
  side: { kcalG: number; proteinG: number },
  potRatio: number
): { ratio: number; mode: SplitMode } {
  const lo = potRatio * SIDE_RATIO_MIN;
  const hi = potRatio * SIDE_RATIO_MAX;
  // Densités en protéines par kcal : celle du mélange glisse de la garniture au plat quand le rapport baisse.
  const q = target.protein / target.kcal;
  const qd = dish.proteinG / dish.kcalG;
  const qs = side.proteinG / side.kcalG;
  if (!Number.isFinite(q) || !Number.isFinite(qd) || !Number.isFinite(qs) || Math.abs(qd - qs) < 1e-6) return { ratio: potRatio, mode: "simple" };
  // q = (pd + t·ps) / (kd + t·ks)  ⇔  t = (pd − q·kd) / (q·ks − ps)
  const t = (dish.proteinG - q * dish.kcalG) / (q * side.kcalG - side.proteinG);
  // Hors d'atteinte (plus de protéines que le plat seul, ou moins que la garniture seule) : la borne du bon côté.
  if (!Number.isFinite(t) || t < 0) return { ratio: (q - qd) * (qd - qs) > 0 ? lo : hi, mode: "borne" };
  const bounded = clamp(t, lo, hi);
  return { ratio: bounded, mode: Math.abs(bounded - t) > 1e-9 ? "borne" : "cible" };
}

/** Partage la marmite pesée en boîtes. `weights.dishG` null : pas encore pesée (boîtes sans grammes). */
export function splitPot(m: PotModel, weights: Weights): PotSplit {
  const people = m.people;
  if (!people.length) return { boxes: [], byPerson: [], modes: {}, fill: 1 };
  const cooked = Math.max(0.5, m.cookedUnits);
  const totalKcal = m.dish ? m.dish.kcal + (m.side?.kcal ?? 0) : null;
  const kcalUnit = totalKcal != null && totalKcal > 0 ? totalKcal / cooked : null;
  const proteinUnit = m.dish && kcalUnit != null ? (m.dish.protein + (m.side?.protein ?? 0)) / cooked : null;

  // Part visée de chacun, en unités (la Semaine fait de même), donc en « poids » relatif.
  const units = new Map(people.map((p) => [p.id, portionUnits(p, { kcalUnit, proteinUnit })]));

  // Deux parties pesées : le rapport garniture / plat de chacun.
  const dishG = weights.dishG != null && weights.dishG > 0 ? weights.dishG : null;
  const sideG = m.side && weights.sideG != null && weights.sideG > 0 ? weights.sideG : null;
  const twoParts = dishG != null && sideG != null && m.dish != null && m.side != null && m.dish.kcal > 0 && m.side.kcal > 0;
  const potRatio = twoParts ? sideG! / dishG! : 0;
  const modes: Record<string, SplitMode> = {};
  // Par personne : grammes de plat et de garniture pour une part visée (avant mise à l'échelle de la marmite).
  const ideal = new Map<string, { d: number; s: number }>();
  for (const p of people) {
    const u = units.get(p.id)!;
    if (!twoParts) {
      modes[p.id] = "simple";
      ideal.set(p.id, { d: u, s: m.side ? u : 0 });
      continue;
    }
    const dish = { kcalG: m.dish!.kcal / dishG!, proteinG: m.dish!.protein / dishG! };
    const side = { kcalG: m.side!.kcal / sideG!, proteinG: m.side!.protein / sideG! };
    const kcal = u * kcalUnit!;
    const r = p.ref ? sideRatio({ kcal, protein: (p.ref.proteinMin + p.ref.proteinMax) / 2 }, dish, side, potRatio) : { ratio: potRatio, mode: "simple" as const };
    modes[p.id] = r.mode;
    const d = kcal / (dish.kcalG + r.ratio * side.kcalG);
    ideal.set(p.id, { d, s: r.ratio * d });
  }

  // Les boîtes : les repas prévus, puis la marge tour à tour.
  const boxes: { personId: string; plannedFor: BoxPlan["plannedFor"] }[] = [];
  for (const p of people) for (const slot of [...p.planned].sort((a, b) => a.date.localeCompare(b.date) || (a.meal === b.meal ? 0 : a.meal === "lunch" ? -1 : 1))) boxes.push({ personId: p.id, plannedFor: slot });
  let left = cooked - boxes.reduce((s, b) => s + units.get(b.personId)!, 0);
  for (let added = true; added; ) {
    added = false;
    for (const p of people) {
      const u = units.get(p.id)!;
      if (u > 0 && left >= u * MARGIN_MIN_SHARE) {
        boxes.push({ personId: p.id, plannedFor: null });
        left -= u;
        added = true;
      }
    }
  }
  if (!boxes.length) boxes.push({ personId: people[0].id, plannedFor: null });
  const usedUnits = boxes.reduce((s, b) => s + units.get(b.personId)!, 0);
  const fill = usedUnits > 0 ? Math.min(1, cooked / usedUnits) : 1;

  // Mise à l'échelle : la marmite (et la garniture) sont entièrement réparties.
  const sumD = boxes.reduce((s, b) => s + ideal.get(b.personId)!.d, 0);
  const sumS = boxes.reduce((s, b) => s + ideal.get(b.personId)!.s, 0);
  const fD = dishG != null && sumD > 0 ? dishG / sumD : null;
  const fS = sideG != null && sumS > 0 ? sideG / sumS : null;
  const per = new Map<string, { dishG: number | null; sideG: number | null; kcal: number | null; protein: number | null }>();
  for (const p of people) {
    const i = ideal.get(p.id)!;
    const d = fD != null ? roundG(i.d * fD) : null;
    const s = fS != null ? roundG(i.s * fS) : null;
    let kcal: number | null = null;
    let protein: number | null = null;
    if (m.dish && totalKcal != null && boxes.length) {
      // Macros de la boîte : sa part de chaque partie (en grammes si pesée, sinon en unités).
      const shareD = fD != null ? (d ?? 0) / dishG! : i.d / sumD;
      const shareS = m.side ? (fS != null ? (s ?? 0) / sideG! : sumS > 0 ? i.s / sumS : shareD) : 0;
      kcal = Math.round(m.dish.kcal * shareD + (m.side?.kcal ?? 0) * shareS);
      protein = Math.round(m.dish.protein * shareD + (m.side?.protein ?? 0) * shareS);
    }
    per.set(p.id, { dishG: d, sideG: m.side ? s : null, kcal, protein });
  }
  const out: BoxPlan[] = boxes.map((b) => ({ personId: b.personId, plannedFor: b.plannedFor, ...per.get(b.personId)! }));
  const byPerson: PersonBoxes[] = people
    .map((p) => ({ personId: p.id, name: p.name, count: out.filter((b) => b.personId === p.id).length, planned: p.planned.length, ...per.get(p.id)! }))
    .filter((x) => x.count > 0);
  return { boxes: out, byPerson, modes, fill };
}

// ─── Rangement et dates limites ───

export type Place = "fridge" | "freezer";

const addDays = (date: string, n: number) => {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** Frigo si le repas prévu tombe dans les jours de conservation, sinon congélateur (s'il se congèle). */
export function placeFor(cookedOn: string, plannedFor: string | null, fridgeDays: number | null, freezerOk: boolean): Place {
  if (!freezerOk) return "fridge";
  if (plannedFor == null) return "freezer";
  return daysBetween(cookedOn, plannedFor) <= (fridgeDays ?? DEFAULT_FRIDGE_DAYS) ? "fridge" : "freezer";
}

export interface StoredBox {
  place: Place;
  cookedOn: string;
  fridgeDays: number;
  frozenOn: string | null;
  thawedOn: string | null;
}

/** Date limite d'une boîte : cuisson + jours au frigo ; congelée : trois mois ; décongelée : le lendemain. */
export function limitOf(b: StoredBox): string {
  if (b.place === "freezer") return addDays(b.frozenOn ?? b.cookedOn, FREEZER_DAYS);
  const fridge = addDays(b.cookedOn, b.fridgeDays);
  if (b.thawedOn) return addDays(b.thawedOn, THAWED_DAYS);
  return fridge;
}

/** « ok », « bientôt » (aujourd'hui ou demain), « passée ». */
export function freshness(limit: string, today: string): "ok" | "soon" | "past" {
  const d = daysBetween(today, limit);
  return d < 0 ? "past" : d <= 1 ? "soon" : "ok";
}

/** Le repas du journal où ranger une boîte mangée maintenant (heure de Paris). */
export function mealAt(hour: number): "lunch" | "dinner" | "snack" {
  if (hour >= 10 && hour < 16) return "lunch";
  if (hour >= 17) return "dinner";
  return "snack";
}

/** « 480 g », « 1,2 kg ». */
export const gramsLabel = (g: number) => (g >= 1000 ? `${(Math.round(g / 100) / 10).toLocaleString("fr-FR")} kg` : `${Math.round(g)} g`);
