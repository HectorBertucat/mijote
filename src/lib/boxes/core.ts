// La marmite pesée → les boîtes de chacun, et où elles se rangent. Module pur (tests/boxes.test.ts).
//
// Règles :
// - la part de chacun vise son repère comme la Semaine (eaters/core.ts, portionUnits) : on la
//   traduit ici en kcal visées, puis en grammes de la marmite réellement pesée ;
// - avec une garniture cuite à part (riz, semoule : lignes `side` de la fiche), la boîte de chacun
//   a la composition prévue par la Semaine (eaters/core.ts, compose) : même taille de part, même
//   rapport garniture / plat (plus de riz et moins de plat pour qui trouve la recette trop protéinée,
//   entre la moitié et une fois et demie la fiche). La marmite et la garniture pesées sont ensuite
//   réparties entièrement, au prorata de ces parts. Sans repère ou sans macros : la proportion
//   simple de la marmite ;
// - nombre de boîtes : une par repas prévu dans la Semaine (pour qui, quel jour), puis la marge en
//   boîtes entières tour à tour, tant qu'il reste au moins 3/4 d'une part ; ce qui reste à la fin
//   grossit les boîtes, chacune jusqu'au haut de son repère (sans repère : sans limite). Si tout le
//   monde y est et qu'il reste plus de 3 % : une petite boîte de reste, pour qui veut, plutôt que
//   des boîtes au-dessus du repère. Un manque rapetisse toutes les boîtes (la marmite est toujours vidée) ;
// - rangement : au frigo si le repas prévu tombe dans ses jours de conservation, sinon au
//   congélateur (si la recette s'y prête). La marge va au congélateur.
import { compose, SIDE_RATIO_MAX, SIDE_RATIO_MIN, unitMacros, type Composition, type MealRef, type RecipeMacros } from "@/lib/eaters/core";

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
  /** Garniture réellement cuite (dosée selon les parts : src/lib/week/store.ts, cookUnits). */
  side: (PotPart & { label: string }) | null;
  /** Garniture cuite ÷ celle de la fiche multipliée (1 = la fiche). */
  sideScale?: number;
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
  /** Rapport garniture / plat de chacun, relatif à la fiche (1 = la fiche). */
  sideRatios: Record<string, number>;
  /** Pourquoi, quand le rapport quitte la fiche (eaters/core.ts, compose). */
  sideWhy: Record<string, NonNullable<Composition["why"]>>;
  /** < 1 : la marmite ne couvre pas les repas prévus, chaque boîte est plus petite que la part visée. */
  fill: number;
}

/** Garniture / plat d'une personne : entre la moitié du rapport de la marmite et ce rapport. */
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
  if (!people.length) return { boxes: [], byPerson: [], rest: null, modes: {}, sideRatios: {}, sideWhy: {}, fill: 1 };
  const cooked = Math.max(0.5, m.cookedUnits);
  const totalKcal = m.dish ? m.dish.kcal + (m.side?.kcal ?? 0) : null;
  // La recette à la fiche (garniture ramenée à la fiche) : ce que compose la Semaine, par unité de plat.
  const sideScale = m.side && (m.sideScale ?? 1) > 0 ? (m.sideScale ?? 1) : 1;
  const ficheSide = m.dish && m.side && m.side.kcal > 0 ? { kcalUnit: m.side.kcal / sideScale / cooked, proteinUnit: m.side.protein / sideScale / cooked } : null;
  const macros: RecipeMacros = m.dish
    ? { kcalUnit: (m.dish.kcal + (ficheSide?.kcalUnit ?? 0) * cooked) / cooked, proteinUnit: (m.dish.protein + (ficheSide?.proteinUnit ?? 0) * cooked) / cooked, side: ficheSide }
    : { kcalUnit: null, proteinUnit: null };
  const kcalUnit = macros.kcalUnit != null && macros.kcalUnit > 0 ? macros.kcalUnit : null;

  // Part visée de chacun (la Semaine fait de même) : unités de plat et rapport de garniture.
  const comp = new Map(people.map((p) => [p.id, compose(p, macros)]));
  const units = new Map(people.map((p) => [p.id, comp.get(p.id)!.units]));
  // Plafond d'une boîte : le haut du repère (sans repère ou sans macros : aucun).
  const capOf = (p: PotPerson) => {
    const k = unitMacros(macros, comp.get(p.id)!.sideRatio)?.kcal;
    return p.ref && kcalUnit != null && k ? Math.max(units.get(p.id)!, p.ref.kcalMax / k) : Infinity;
  };

  const dishG = weights.dishG != null && weights.dishG > 0 ? weights.dishG : null;
  const sideG = m.side && weights.sideG != null && weights.sideG > 0 ? weights.sideG : null;
  const modes: Record<string, SplitMode> = {};
  // Par unité de plat : 1 de plat, et de la garniture en « unités de marmite » (toute la garniture = cooked).
  const ideal = new Map<string, { d: number; s: number }>();
  for (const p of people) {
    const r = comp.get(p.id)!.sideRatio;
    modes[p.id] = !m.side || Math.abs(r - 1) < 1e-9 ? "simple" : r <= SIDE_RATIO_MIN + 1e-9 || r >= SIDE_RATIO_MAX - 1e-9 ? "borne" : "cible";
    ideal.set(p.id, { d: 1, s: m.side ? r / sideScale : 0 });
  }
  const potUnit = { d: 1, s: m.side ? 1 : 0 };

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
    const i0 = potUnit;
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
  const sideRatios = Object.fromEntries(people.map((p) => [p.id, comp.get(p.id)!.sideRatio]));
  const sideWhy = Object.fromEntries(people.flatMap((p) => (comp.get(p.id)!.why ? [[p.id, comp.get(p.id)!.why!]] : [])));
  return { boxes: out, byPerson, rest: out.find((b) => b.personId == null) ?? null, modes, sideRatios, sideWhy, fill };
}

/**
 * La phrase qui explique une boîte qui ne suit pas la proportion de la fiche : plus de garniture et
 * moins de plat pour qui trouve la recette trop protéinée, l'inverse pour qui en manque. null sinon.
 */
export function splitNote(m: PotModel, split: PotSplit): string | null {
  if (!m.side) return null;
  // « plus de riz », « plus d'orge », « plus de lentilles » (sans article partitif après « plus »).
  const label = /^[aeiouyéèh]/i.test(m.side.label) ? `d'${m.side.label}` : `de ${m.side.label}`;
  const parts = split.byPerson.flatMap((p) => {
    const why = split.sideWhy[p.personId];
    // Un ajustement de quelques kcal ne mérite pas une phrase ; un écart de protéines, si.
    if (why !== "proteines-hautes" && why !== "proteines-basses") return [];
    return why === "proteines-hautes" ? [`plus ${label} et moins de plat pour ${p.name}, pour qui la recette est trop protéinée`] : [`moins ${label} et plus de plat pour ${p.name}, à qui il faut plus de protéines`];
  });
  if (!parts.length) return null;
  const text = parts.join(" ; ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

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
