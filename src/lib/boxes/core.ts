// La marmite pesée → les boîtes de chacun, et où elles se rangent. Module pur (tests/boxes.test.ts).
//
// Règles :
// - la part de chacun vise son repère comme la Semaine (eaters/core.ts, portionUnits) : on la
//   traduit ici en kcal visées, puis en grammes de la marmite réellement pesée ;
// - avec une garniture cuite à part (riz, semoule : lignes `side` de la fiche), deux poids, donc
//   deux inconnues par personne (grammes de plat, grammes de garniture) pour deux cibles (kcal du
//   repère, protéines). Les kcal d'abord : c'est la taille de la boîte qui les vise. Le rapport
//   garniture / plat est celui de la marmite tant que les protéines atteignent le bas du repère ;
//   s'il en manque, moins de garniture et plus de plat (jusqu'à la moitié du rapport de la marmite).
//   Jamais plus de garniture que la marmite : un surplus de protéines ne se compense pas par du
//   féculent : une petite part n'a plus de riz qu'une grande que si la grande manque de protéines (la
//   phrase de splitNote le dit). Sans repère, sans macros ou sans poids de garniture : la proportion
//   simple de la marmite ;
// - nombre de boîtes : une par repas prévu dans la Semaine (pour qui, quel jour), puis la marge en
//   boîtes entières tour à tour, tant qu'il reste au moins 3/4 d'une part ; ce qui reste à la fin
//   grossit les boîtes, chacune jusqu'au haut de son repère (sans repère : sans limite). Si tout le
//   monde y est et qu'il reste plus de 3 % : une petite boîte de reste, pour qui veut, plutôt que
//   des boîtes au-dessus du repère. Un manque rapetisse toutes les boîtes (la marmite est toujours vidée) ;
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
  /** null : la boîte de reste, pour qui veut. */
  personId: string | null;
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
  /** La petite boîte de reste (aussi dans `boxes`) : chacun est au haut de son repère. */
  rest: BoxPlan | null;
  /** Comment plat et garniture ont été réglés, par personne (une seule partie : « simple »). */
  modes: Record<string, SplitMode>;
  /** < 1 : la marmite ne couvre pas les repas prévus, chaque boîte est plus petite que la part visée. */
  fill: number;
}

/** Garniture / plat d'une personne : entre la moitié du rapport de la marmite et ce rapport. */
export const SIDE_RATIO_MIN = 0.5;
/** Une boîte de marge n'est faite que s'il reste au moins 3/4 d'une part. */
export const MARGIN_MIN_SHARE = 0.75;
/** Au-delà de 3 % au-dessus des repères, le surplus fait une boîte de reste. */
export const KCAL_OVER_MAX = 0.03;
/** Grammes arrondis à 5 g : la balance de cuisine ne fait pas mieux. */
export const GRAM_STEP = 5;
export const DEFAULT_FRIDGE_DAYS = 3;
/** Au congélateur : trois mois. Décongelée au frigo : à manger sous 24 h. */
export const FREEZER_DAYS = 90;
export const THAWED_DAYS = 1;

const roundG = (g: number) => Math.max(0, Math.round(g / GRAM_STEP) * GRAM_STEP);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Une base cuite pour plusieurs recettes (le riz de deux recettes dans le même faitout), pesée en une
 * fois : la part de chacune au prorata de ce qu'elle a mis cru (`share`), à 5 g près, la somme juste.
 */
export function splitShared<K extends string>(totalG: number, shares: { key: K; share: number }[]): Record<K, number> {
  const sum = shares.reduce((x, s) => x + Math.max(0, s.share), 0) || 1;
  const steps = Math.round(Math.max(0, totalG) / GRAM_STEP);
  const raw = shares.map((s) => (steps * Math.max(0, s.share)) / sum);
  const out = raw.map(Math.floor);
  // Le reste aux plus grandes parts décimales (la somme retombe sur le total pesé).
  const order = raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f);
  const left = steps - out.reduce((x, y) => x + y, 0);
  for (let k = 0; k < left; k++) out[order[k % order.length].i]++;
  return Object.fromEntries(shares.map((s, i) => [s.key, out[i] * GRAM_STEP])) as Record<K, number>;
}

/**
 * Rapport garniture / plat (en grammes) d'une boîte qui vise `target.kcal` : celui de la marmite si les
 * protéines atteignent `proteinMin`, sinon moins de garniture pour viser `protein` (le milieu), borné.
 */
export function sideRatio(
  target: { kcal: number; protein: number; proteinMin: number },
  dish: { kcalG: number; proteinG: number },
  side: { kcalG: number; proteinG: number },
  potRatio: number
): { ratio: number; mode: SplitMode } {
  const lo = potRatio * SIDE_RATIO_MIN;
  // Densités en protéines par kcal : celle du mélange glisse de la garniture au plat quand le rapport baisse.
  const q = target.protein / target.kcal;
  const qd = dish.proteinG / dish.kcalG;
  const qs = side.proteinG / side.kcalG;
  if (!Number.isFinite(q) || !Number.isFinite(qd) || !Number.isFinite(qs) || !(potRatio > 0)) return { ratio: potRatio, mode: "simple" };
  const proteinAt = (t: number) => (target.kcal * (dish.proteinG + t * side.proteinG)) / (dish.kcalG + t * side.kcalG);
  // Assez de protéines avec la proportion de la marmite, ou un plat pas plus protéiné que la garniture : on n'y touche pas.
  if (proteinAt(potRatio) >= target.proteinMin || qd <= qs + 1e-6) return { ratio: potRatio, mode: "simple" };
  // q = (pd + t·ps) / (kd + t·ks)  ⇔  t = (pd − q·kd) / (q·ks − ps)
  const t = (dish.proteinG - q * dish.kcalG) / (q * side.kcalG - side.proteinG);
  // Plus de protéines que le plat seul n'en donne : le moins de garniture permis.
  if (!Number.isFinite(t) || t < 0) return { ratio: lo, mode: "borne" };
  const bounded = clamp(t, lo, potRatio);
  return { ratio: bounded, mode: Math.abs(bounded - t) > 1e-9 ? "borne" : "cible" };
}

/**
 * Ce qui reste une fois les boîtes à leur part visée (`left` unités) : chacune grossit d'autant (même
 * facteur), sans dépasser son plafond ; une boîte au plafond laisse le reste aux autres. Renvoie les
 * unités de chaque boîte et ce qui ne tient nulle part.
 */
export function fillUp(parts: { units: number; cap: number }[], left: number): { units: number[]; over: number } {
  const units = parts.map((p) => p.units);
  const full = parts.map((p) => p.units >= p.cap);
  for (let guard = 0; guard <= parts.length; guard++) {
    const free = parts.reduce((s, p, i) => s + (full[i] ? 0 : p.units), 0);
    const room = parts.reduce((s, p, i) => s + (full[i] ? Math.max(p.cap, p.units) : 0), 0);
    const total = parts.reduce((s, p) => s + p.units, 0) + left;
    if (free <= 0) return { units: parts.map((p) => Math.max(p.cap, p.units)), over: Math.max(0, total - room) };
    const f = (total - room) / free;
    const capped = parts.map((p, i) => !full[i] && p.units * f > p.cap);
    if (!capped.some(Boolean)) return { units: parts.map((p, i) => (full[i] ? Math.max(p.cap, p.units) : p.units * f)), over: 0 };
    capped.forEach((c, i) => c && (full[i] = true));
  }
  return { units, over: left };
}

/** Partage la marmite pesée en boîtes. `weights.dishG` null : pas encore pesée (boîtes sans grammes). */
export function splitPot(m: PotModel, weights: Weights): PotSplit {
  const people = m.people;
  if (!people.length) return { boxes: [], byPerson: [], rest: null, modes: {}, fill: 1 };
  const cooked = Math.max(0.5, m.cookedUnits);
  const totalKcal = m.dish ? m.dish.kcal + (m.side?.kcal ?? 0) : null;
  const kcalUnit = totalKcal != null && totalKcal > 0 ? totalKcal / cooked : null;
  const proteinUnit = m.dish && kcalUnit != null ? (m.dish.protein + (m.side?.protein ?? 0)) / cooked : null;

  // Part visée de chacun, en unités (la Semaine fait de même), donc en « poids » relatif.
  const units = new Map(people.map((p) => [p.id, portionUnits(p, { kcalUnit, proteinUnit })]));
  // Plafond d'une boîte : le haut du repère (sans repère ou sans macros : aucun).
  const capOf = (p: PotPerson) => (p.ref && kcalUnit != null ? Math.max(units.get(p.id)!, p.ref.kcalMax / kcalUnit) : Infinity);

  // Deux parties pesées : le rapport garniture / plat de chacun.
  const dishG = weights.dishG != null && weights.dishG > 0 ? weights.dishG : null;
  const sideG = m.side && weights.sideG != null && weights.sideG > 0 ? weights.sideG : null;
  const twoParts = dishG != null && sideG != null && m.dish != null && m.side != null && m.dish.kcal > 0 && m.side.kcal > 0;
  const potRatio = twoParts ? sideG! / dishG! : 0;
  const dishD = twoParts ? { kcalG: m.dish!.kcal / dishG!, proteinG: m.dish!.protein / dishG! } : null;
  const sideD = twoParts ? { kcalG: m.side!.kcal / sideG!, proteinG: m.side!.protein / sideG! } : null;
  const modes: Record<string, SplitMode> = {};
  // Grammes de plat et de garniture d'une unité (avant mise à l'échelle de la marmite), par personne.
  const perUnit = (ratio: number) => (twoParts ? { d: kcalUnit! / (dishD!.kcalG + ratio * sideD!.kcalG), s: (ratio * kcalUnit!) / (dishD!.kcalG + ratio * sideD!.kcalG) } : { d: 1, s: m.side ? 1 : 0 });
  const ideal = new Map<string, { d: number; s: number }>();
  for (const p of people) {
    const u = units.get(p.id)!;
    if (!twoParts) {
      modes[p.id] = "simple";
      ideal.set(p.id, perUnit(0));
      continue;
    }
    const r = p.ref ? sideRatio({ kcal: u * kcalUnit!, protein: (p.ref.proteinMin + p.ref.proteinMax) / 2, proteinMin: p.ref.proteinMin }, dishD!, sideD!, potRatio) : { ratio: potRatio, mode: "simple" as const };
    modes[p.id] = r.mode;
    ideal.set(p.id, perUnit(r.ratio));
  }

  // Les boîtes : les repas prévus, puis la marge tour à tour.
  const boxes: { personId: string | null; plannedFor: BoxPlan["plannedFor"] }[] = [];
  for (const p of people) for (const slot of [...p.planned].sort((a, b) => a.date.localeCompare(b.date) || (a.meal === b.meal ? 0 : a.meal === "lunch" ? -1 : 1))) boxes.push({ personId: p.id, plannedFor: slot });
  let left = cooked - boxes.reduce((s, b) => s + units.get(b.personId!)!, 0);
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
  const byId = new Map(people.map((p) => [p.id, p]));
  const usedUnits = boxes.reduce((s, b) => s + units.get(b.personId!)!, 0);
  const fill = usedUnits > 0 ? Math.min(1, cooked / usedUnits) : 1;

  // Unités de chaque boîte : un manque rapetisse tout ; un surplus grossit chacune jusqu'à son plafond,
  // puis, s'il dépasse les plafonds de plus de 3 %, fait une boîte de reste à la proportion de la marmite.
  let final: number[];
  let restUnits = 0;
  if (fill < 1) final = boxes.map((b) => units.get(b.personId!)! * fill);
  else {
    const caps = boxes.map((b) => capOf(byId.get(b.personId!)!));
    const up = fillUp(
      boxes.map((b, i) => ({ units: units.get(b.personId!)!, cap: caps[i] })),
      Math.max(0, left)
    );
    final = up.units;
    const room = final.reduce((s, u) => s + u, 0);
    if (up.over > room * KCAL_OVER_MAX) restUnits = up.over;
    else if (up.over > 0) final = final.map((u) => u * (1 + up.over / room));
  }
  const all: { personId: string | null; plannedFor: BoxPlan["plannedFor"]; d: number; s: number }[] = boxes.map((b, i) => {
    const i0 = ideal.get(b.personId!)!;
    return { ...b, d: i0.d * final[i], s: i0.s * final[i] };
  });
  if (restUnits > 0) {
    const i0 = perUnit(potRatio);
    all.push({ personId: null, plannedFor: null, d: i0.d * restUnits, s: i0.s * restUnits });
  }

  // Mise à l'échelle : la marmite (et la garniture) sont entièrement réparties.
  const sumD = all.reduce((s, b) => s + b.d, 0);
  const sumS = all.reduce((s, b) => s + b.s, 0);
  const fD = dishG != null && sumD > 0 ? dishG / sumD : null;
  const fS = sideG != null && sumS > 0 ? sideG / sumS : null;
  const out: BoxPlan[] = all.map((b) => {
    const d = fD != null ? roundG(b.d * fD) : null;
    const s = fS != null ? roundG(b.s * fS) : null;
    let kcal: number | null = null;
    let protein: number | null = null;
    if (m.dish && totalKcal != null) {
      // Macros de la boîte : sa part de chaque partie (en grammes si pesée, sinon en unités).
      const shareD = fD != null ? (d ?? 0) / dishG! : b.d / sumD;
      const shareS = m.side ? (fS != null ? (s ?? 0) / sideG! : sumS > 0 ? b.s / sumS : shareD) : 0;
      kcal = Math.round(m.dish.kcal * shareD + (m.side?.kcal ?? 0) * shareS);
      protein = Math.round(m.dish.protein * shareD + (m.side?.protein ?? 0) * shareS);
    }
    return { personId: b.personId, plannedFor: b.plannedFor, dishG: d, sideG: m.side ? s : null, kcal, protein };
  });
  const byPerson: PersonBoxes[] = people.flatMap((p) => {
    const mine = out.filter((b) => b.personId === p.id);
    if (!mine.length) return [];
    const { dishG: dg, sideG: sg, kcal, protein } = mine[0];
    return [{ personId: p.id, name: p.name, count: mine.length, planned: p.planned.length, dishG: dg, sideG: sg, kcal, protein }];
  });
  return { boxes: out, byPerson, rest: out.find((b) => b.personId == null) ?? null, modes, fill };
}

/**
 * La phrase qui explique un partage surprenant : une plus petite boîte avec plus de garniture qu'une
 * plus grande (seul cas : la grande manque de protéines). null quand rien ne surprend.
 */
export function splitNote(m: PotModel, split: PotSplit): string | null {
  if (!m.side) return null;
  const label = m.side.label;
  const of = (w: string) => (/^[aeiouyéèh]/i.test(w) ? `d'${w}` : `de ${w}`);
  for (const big of split.byPerson) {
    const ref = m.people.find((p) => p.id === big.personId)?.ref;
    if (!ref || split.modes[big.personId] === "simple" || big.kcal == null || big.sideG == null) continue;
    const small = split.byPerson.find((x) => x.kcal != null && x.sideG != null && x.kcal < big.kcal! && x.sideG > big.sideG!);
    if (small) return `Plus ${of(label)} pour ${small.name} que pour ${big.name} : la boîte ${of(big.name)} vise ${Math.round((ref.proteinMin + ref.proteinMax) / 2)} g de protéines, il y faut plus de plat.`;
  }
  return null;
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

/**
 * Les mots de l'accompagnement, accordés : « le riz cuit », « la semoule cuite », « les pâtes cuites ». Le libellé
 * vient du premier mot des ingrédients (sideLabelOf) ; deux accompagnements (« riz et lentilles ») font un pluriel.
 */
const SIDE_FEM = /^(semoule|polenta|purée|pâte|patate|pomme|lentille|frite)/;
export function sideWords(label: string): { the: string; of: string; cooked: string; it: string; stays: string } {
  const plural = / et /.test(label) || /s$|x$/.test(label.split(" ")[0]);
  const fem = !/ et /.test(label) && SIDE_FEM.test(label);
  if (plural) return { the: `les ${label}`, of: `des ${label}`, cooked: fem ? "cuites" : "cuits", it: fem ? "elles se partagent" : "ils se partagent", stays: "restent" };
  if (fem) return { the: `la ${label}`, of: `de la ${label}`, cooked: "cuite", it: "elle se partage", stays: "reste" };
  return { the: `le ${label}`, of: `du ${label}`, cooked: "cuit", it: "il se partage", stays: "reste" };
}
