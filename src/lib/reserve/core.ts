// La réserve d'une marmite cuite : qui mange combien de portions, et les grammes de chaque groupe
// (plat, riz, haricots verts) d'une portion. Module pur (tests/reserve.test.ts).
//
// Ce qui est fixe, c'est le nombre de portions de chacun ; le jour où on les mange est libre. Une
// portion vise le repère de la personne comme une boîte (boxes/core.ts), généralisé à N groupes :
// - la taille de la portion vise les kcal de la part de la Semaine (eaters/core.ts, portionUnits) ;
// - le plat (`main`) porte les protéines ; les féculents (`starch`) suivent la proportion de la
//   marmite tant que les protéines atteignent le bas du repère ; sinon moins de féculent, plus de plat
//   (jusqu'à la moitié de la proportion), jamais plus que la proportion de la marmite (sideRatio) ;
//   les légumes et le reste suivent le plat dans la proportion de la marmite ;
// - tout ce qui reste dans le grand récipient est réparti entre les portions restantes : un manque
//   rapetisse tout le monde ; un surplus grossit chacun jusqu'au haut de son repère ; au-delà de 3 %,
//   ce qui dépasse reste « pour qui veut » ;
// - une portion mangée retire ses grammes du récipient, et les portions restantes se recalculent sur
//   ce qui reste ; une portion rangée dans une boîte a ses grammes figés ;
// - nouvelle pesée d'un groupe : elle remplace ce qui reste, les kcal restantes ne changent pas (le
//   plat perd de l'eau, ou la tare était fausse) ;
// - sans kcal connues : la proportion simple, selon la part de base de chacun.
import { fillUp, GRAM_STEP, KCAL_OVER_MAX, MARGIN_MIN_SHARE, sideRatio, type SplitMode } from "@/lib/boxes/core";
import { baseShares, linkBases } from "./bases";
import type { GroupKind } from "./groups";

/** Un groupe de la réserve, avec sa dernière pesée. */
export interface ReserveGroup {
  key: string;
  label: string;
  kind: GroupKind;
  /** Grammes dans le grand récipient à la pesée `at`. */
  g: number;
  /** Instant ISO de la pesée : ce qui sort du récipient ensuite s'en retire. */
  at: string;
  /** kcal et protéines par gramme (null : inconnues). */
  kcalG: number | null;
  proteinG: number | null;
  /** Pas pesé : estimé d'après les grammes crus. */
  estimated?: boolean;
  /** Une base du foyer (bases.ts : « riz ») : elle est dans son récipient, pas dans la marmite. */
  base?: string;
  /** Grammes de base par gramme de plat (la proportion de la marmite) : ce qui revient au plat. */
  ratio?: number;
  /** Grammes de base par kcal de plat : une nouvelle pesée du plat (il perd de l'eau) ne change pas la part de base. */
  perKcal?: number;
}

/** Ce qui sert à viser la portion d'une personne. */
export interface Target {
  id: string;
  name: string;
  /** Part de base (unités) : le poids relatif sans kcal connues. */
  units: number;
  /** kcal visées d'une portion (part de la Semaine × kcal d'une unité), null si inconnues. */
  kcal: number | null;
  /** Haut du repère en kcal (null : sans plafond). */
  kcalMax: number | null;
  /** Milieu et bas du repère en protéines (null : sans repère). */
  protein: number | null;
  proteinMin: number | null;
}

export type Grams = Record<string, number>;

export interface PortionCalc {
  grams: Grams;
  kcal: number | null;
  protein: number | null;
  mode: SplitMode;
}

export interface Split {
  /** Une portion de chacun (ceux qui en ont au moins une), dans le grand récipient. */
  portions: Record<string, PortionCalc>;
  /** Ce qui dépasse le haut des repères de tous, pour qui veut. */
  rest: { grams: Grams; kcal: number | null } | null;
  /** < 1 : le récipient ne couvre pas les portions visées, chacune est plus petite. */
  fill: number;
}

/** Sous 25 g par groupe, le récipient est vide (les arrondis à 5 g laissent quelques grammes). */
export const CRUMBS_G = 25;

const roundG = (g: number) => Math.max(0, Math.round(g / GRAM_STEP) * GRAM_STEP);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** kcal et protéines d'une portion (grammes par groupe), null si un groupe servi a des kcal inconnues. */
export function macrosOf(groups: Pick<ReserveGroup, "key" | "kcalG" | "proteinG">[], grams: Grams): { kcal: number | null; protein: number | null } {
  let kcal = 0;
  let protein = 0;
  for (const g of groups) {
    const x = grams[g.key] ?? 0;
    if (x <= 0) continue;
    if (g.kcalG == null || g.proteinG == null) return { kcal: null, protein: null };
    kcal += x * g.kcalG;
    protein += x * g.proteinG;
  }
  return { kcal: Math.round(kcal), protein: Math.round(protein) };
}

/**
 * Partage ce qui reste dans le grand récipient (`left` : grammes par groupe) entre les portions
 * restantes de chacun (`counts`), selon leur repère (voir l'en-tête).
 */
export function splitGroups(groups: Pick<ReserveGroup, "key" | "kind" | "kcalG" | "proteinG">[], left: Grams, people: Target[], counts: Record<string, number>): Split {
  const eaters = people.filter((p) => (counts[p.id] ?? 0) > 0);
  const active = groups.filter((g) => (left[g.key] ?? 0) > 0);
  if (!eaters.length || !active.length) return { portions: {}, rest: null, fill: 1 };
  const n = (p: Target) => counts[p.id];
  const G = (k: string) => left[k] ?? 0;
  const known = active.every((g) => g.kcalG != null && g.proteinG != null && g.kcalG >= 0) && eaters.every((p) => p.kcal != null && p.kcal > 0);

  // Sans kcal : la proportion simple, selon la part de base.
  if (!known) {
    const w = sum(eaters.map((p) => n(p) * Math.max(0.5, p.units)));
    const portions: Record<string, PortionCalc> = {};
    for (const p of eaters) {
      const share = Math.max(0.5, p.units) / w;
      const grams = Object.fromEntries(active.map((g) => [g.key, roundG(G(g.key) * share)]));
      portions[p.id] = { grams, ...macrosOf(groups, grams), mode: "simple" };
    }
    return { portions, rest: null, fill: 1 };
  }

  const kc = (g: (typeof active)[number]) => g.kcalG!;
  const pr = (g: (typeof active)[number]) => g.proteinG!;
  // La composition d'une portion, en grammes par groupe pour 1 kcal, par personne.
  const main = active.find((g) => g.kind === "main") ?? [...active].sort((a, b) => pr(b) / Math.max(kc(b), 1e-9) - pr(a) / Math.max(kc(a), 1e-9))[0];
  const starch = active.filter((g) => g !== main && g.kind === "starch");
  const others = active.filter((g) => g !== main && g.kind !== "starch");
  const rho = (g: (typeof active)[number]) => G(g.key) / G(main.key);
  // Le plat et ce qui le suit (légumes…), par gramme de plat ; les féculents, par gramme de plat aussi.
  const dW = 1 + sum(others.map(rho));
  const dK = kc(main) + sum(others.map((g) => rho(g) * kc(g)));
  const dP = pr(main) + sum(others.map((g) => rho(g) * pr(g)));
  const sW = sum(starch.map(rho));
  const sK = sum(starch.map((g) => rho(g) * kc(g)));
  const sP = sum(starch.map((g) => rho(g) * pr(g)));
  const modes: Record<string, SplitMode> = {};
  const per = new Map<string, Grams>();
  for (const p of eaters) {
    let t = 1;
    modes[p.id] = "simple";
    if (sW > 0 && dK > 0 && sK > 0 && p.protein != null && p.proteinMin != null) {
      const r = sideRatio({ kcal: p.kcal!, protein: p.protein, proteinMin: p.proteinMin }, { kcalG: dK / dW, proteinG: dP / dW }, { kcalG: sK / sW, proteinG: sP / sW }, sW / dW);
      t = r.ratio / (sW / dW);
      modes[p.id] = r.mode;
    }
    const K = dK + t * sK;
    const c: Grams = {};
    for (const g of active) c[g.key] = (g === main ? 1 : starch.includes(g) ? t * rho(g) : rho(g)) / (K > 0 ? K : 1);
    per.set(p.id, c);
  }

  // Les kcal de chaque portion : visées, puis le manque ou le surplus (boxes/core.ts, fillUp).
  const A = sum(active.map((g) => G(g.key) * kc(g)));
  const need = sum(eaters.map((p) => n(p) * p.kcal!));
  let kcalOf = new Map(eaters.map((p) => [p.id, p.kcal!]));
  let restKcal = 0;
  let fill = 1;
  if (A < need) {
    fill = A / need;
    kcalOf = new Map(eaters.map((p) => [p.id, p.kcal! * fill]));
  } else {
    const parts = eaters.map((p) => ({ units: n(p) * p.kcal!, cap: n(p) * Math.max(p.kcal!, p.kcalMax ?? Infinity) }));
    const up = fillUp(parts, A - need);
    const room = sum(up.units);
    let units = up.units;
    if (up.over > room * KCAL_OVER_MAX) restKcal = up.over;
    else if (up.over > 0) units = units.map((u) => u * (1 + up.over / room));
    kcalOf = new Map(eaters.map((p, i) => [p.id, units[i] / n(p)]));
  }

  // Les grammes : la composition × les kcal, puis chaque groupe juste réparti (le récipient est vidé).
  const restG: Grams = Object.fromEntries(active.map((g) => [g.key, A > 0 ? (restKcal * G(g.key)) / A : 0]));
  const ideal = new Map(eaters.map((p) => [p.id, Object.fromEntries(active.map((g) => [g.key, per.get(p.id)![g.key] * kcalOf.get(p.id)!]))]));
  const f: Grams = {};
  for (const g of active) {
    const tot = sum(eaters.map((p) => n(p) * ideal.get(p.id)![g.key]));
    f[g.key] = tot > 0 ? (G(g.key) - restG[g.key]) / tot : 0;
  }
  const portions: Record<string, PortionCalc> = {};
  for (const p of eaters) {
    const grams = Object.fromEntries(active.map((g) => [g.key, roundG(ideal.get(p.id)![g.key] * f[g.key])]));
    portions[p.id] = { grams, ...macrosOf(groups, grams), mode: modes[p.id] };
  }
  const rest = restKcal > 0 ? { grams: Object.fromEntries(active.map((g) => [g.key, roundG(restG[g.key])])), kcal: Math.round(restKcal) } : null;
  return { portions, rest, fill };
}

/**
 * Le nombre de portions de chacun au rangement : les repas prévus par la Semaine, puis la marge en
 * portions entières tour à tour tant qu'il reste au moins 3/4 d'une part (comme les boîtes). `total` :
 * kcal de la marmite (ou unités cuites sans kcal), `share` : la part de chacun dans la même unité.
 */
export function initialCounts(people: { id: string; planned: number; share: number }[], total: number): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(people.map((p) => [p.id, p.planned]));
  let left = total - sum(people.map((p) => p.planned * p.share));
  for (let added = true; added; ) {
    added = false;
    for (const p of people) {
      if (p.share > 0 && left >= p.share * MARGIN_MIN_SHARE) {
        counts[p.id]++;
        left -= p.share;
        added = true;
      }
    }
  }
  if (people.length && !Object.values(counts).some((c) => c > 0)) counts[people[0].id] = 1;
  return counts;
}

// ─── L'état d'une réserve ───

export interface ServingIn {
  id: string;
  personId: string;
  at: string;
  source: "recipient" | "boite";
  boxId: string | null;
  grams: Grams;
}

export interface BoxIn {
  id: string;
  personId: string | null;
  status: "stock" | "eaten" | "thrown";
  place: "fridge" | "freezer";
  thawed: boolean;
  limit: string;
  createdAt: string;
  grams: Grams;
}

export interface ShareState {
  personId: string;
  name: string;
  total: number;
  eaten: number;
  left: number;
  inBoxes: number;
  /** Portions restantes à prendre dans le grand récipient. */
  loose: number;
  portion: PortionCalc | null;
  next: { source: "recipient"; grams: Grams; kcal: number | null; protein: number | null } | { source: "boite"; boxId: string; grams: Grams; kcal: number | null; protein: number | null } | null;
}

export interface ReserveState {
  /** Grammes restants dans le grand récipient, par groupe. */
  left: Grams;
  shares: ShareState[];
  rest: Split["rest"];
  fill: number;
  /** Plus rien : récipient vide, aucune boîte, aucune portion restante. */
  empty: boolean;
}

/** Ce qui reste dans le récipient : la dernière pesée de chaque groupe − ce qui en est sorti depuis. */
export function leftInPot(groups: Pick<ReserveGroup, "key" | "g" | "at">[], servings: Pick<ServingIn, "at" | "source" | "grams">[], boxes: Pick<BoxIn, "createdAt" | "grams">[]): Grams {
  return Object.fromEntries(
    groups.map((g) => {
      // Une boîte faite à l'instant de la pesée en sort (le rangement) ; une portion mangée à cet instant-là était déjà sortie.
      const out = sum(servings.filter((s) => s.source === "recipient" && s.at > g.at).map((s) => s.grams[g.key] ?? 0)) + sum(boxes.filter((b) => b.createdAt >= g.at).map((b) => b.grams[g.key] ?? 0));
      return [g.key, Math.max(0, g.g - out)];
    })
  );
}

/** L'état d'une réserve : ce qui reste, et pour chacun ses portions et la prochaine à se servir. */
export function reserveState(groups: ReserveGroup[], counts: Record<string, number>, people: Target[], servings: ServingIn[], boxes: BoxIn[]): ReserveState {
  // Une base est dans son récipient : au plat revient sa proportion de ce qui reste du plat.
  const left = baseShares(groups, leftInPot(groups, servings, boxes));
  const stock = boxes.filter((b) => b.status === "stock");
  const ids = [...new Set([...people.map((p) => p.id), ...Object.keys(counts)])];
  const byId = new Map(people.map((p) => [p.id, p]));
  const rows = ids.map((id) => {
    const eaten = servings.filter((s) => s.personId === id).length;
    const total = Math.max(counts[id] ?? 0, eaten);
    const left = total - eaten;
    const inBoxes = Math.min(left, stock.filter((b) => b.personId === id).length);
    return { id, total, eaten, left, inBoxes, loose: left - inBoxes };
  });
  const anyLeft = groups.some((g) => !g.base && (left[g.key] ?? 0) > 0);
  const looseCounts = Object.fromEntries(rows.map((r) => [r.id, r.loose]));
  const split = splitGroups(groups, left, people.filter((p) => looseCounts[p.id] > 0), looseCounts);
  const boxOrder = (a: BoxIn, b: BoxIn) => (a.place === b.place ? 0 : a.place === "fridge" ? -1 : 1) || a.limit.localeCompare(b.limit);
  const shares: ShareState[] = rows
    .filter((r) => byId.has(r.id))
    .map((r) => {
      const portion = r.loose > 0 && anyLeft ? (split.portions[r.id] ?? null) : null;
      const mine = stock.filter((b) => b.personId === r.id).sort(boxOrder);
      const box = mine[0];
      // Le grand récipient d'abord ; sinon sa boîte du frigo la plus pressée, puis celle du congélo.
      const next: ShareState["next"] = r.left <= 0 ? null : portion ? { source: "recipient", grams: portion.grams, kcal: portion.kcal, protein: portion.protein } : box ? { source: "boite", boxId: box.id, grams: box.grams, ...macrosOf(groups, box.grams) } : null;
      return { personId: r.id, name: byId.get(r.id)!.name, total: r.total, eaten: r.eaten, left: r.left, inBoxes: r.inBoxes, loose: r.loose, portion, next };
    });
  const empty = !groups.some((g) => !g.base && (left[g.key] ?? 0) > CRUMBS_G) && !stock.length && shares.every((s) => s.left <= 0);
  return { left, shares, rest: split.rest, fill: split.fill, empty };
}

/**
 * Une nouvelle pesée d'un groupe : elle devient ce qui reste ; ses kcal par gramme sont refaites pour
 * que les kcal restantes ne changent pas (sans rien de connu qui reste : celles d'avant).
 */
export function reweigh(g: ReserveGroup, leftNow: number, grams: number, at: string): ReserveGroup {
  const k = leftNow > 0 && grams > 0 ? leftNow / grams : 1;
  return { ...g, g: grams, at, estimated: false, kcalG: g.kcalG != null ? g.kcalG * k : null, proteinG: g.proteinG != null ? g.proteinG * k : null };
}

/** La ligne du journal : « Poulet teriyaki (plat 180 g, riz 150 g) ». */
export function servingLabel(name: string, groups: Pick<ReserveGroup, "key" | "label">[], grams: Grams): string {
  const parts = groups.filter((g) => (grams[g.key] ?? 0) > 0).map((g) => `${g.label} ${Math.round(grams[g.key])} g`);
  return parts.length ? `${name} (${parts.join(", ")})` : name;
}

// ─── Le calculateur de fin de session ───

/** Une marmite à peser : ses groupes (macros de la marmite entière, poids cuit estimé) et le foyer. */
export interface CalcModel {
  recipeId: string;
  slug: string;
  name: string;
  cookedUnits: number;
  /** kcal et protéines d'une unité de la marmite (null : inconnues). */
  kcalUnit: number | null;
  proteinUnit: number | null;
  fridgeDays: number;
  freezerOk: boolean;
  cookedOn: string;
  groups: { key: string; label: string; kind: GroupKind; kcal: number | null; protein: number | null; estG: number; /** Une base du foyer : elle va dans son récipient (bases.ts). */ base?: string }[];
  /** `planned` : repas prévus par la Semaine ; `late` : dont au-delà des jours de frigo. */
  people: (Target & { planned: number; late: number })[];
}

/** Les groupes pesés (ou estimés, sans poids) à l'instant `at`. */
export function weighedGroups(m: CalcModel, weights: Record<string, number | null | undefined>, at: string): ReserveGroup[] {
  const groups = m.groups.map((g) => {
    const w = weights[g.key];
    const weighed = w != null && Number.isFinite(w) && w > 0;
    const grams = weighed ? w : g.estG;
    return {
      key: g.key,
      label: g.label,
      kind: g.kind,
      g: Math.round(grams),
      at,
      kcalG: g.kcal != null && grams > 0 ? g.kcal / grams : null,
      proteinG: g.protein != null && grams > 0 ? g.protein / grams : null,
      ...(weighed ? {} : { estimated: true }),
    };
  });
  return linkBases(groups, Object.fromEntries(m.groups.filter((g) => g.base).map((g) => [g.key, g.base!])));
}

/** Portions de chacun par défaut : les repas prévus, puis la marge (initialCounts), en kcal si connues. */
export function defaultCounts(m: CalcModel): Record<string, number> {
  const kcal = m.groups.every((g) => g.kcal != null) ? sum(m.groups.map((g) => g.kcal!)) : null;
  const known = kcal != null && kcal > 0 && m.people.every((p) => p.kcal != null && p.kcal > 0);
  return initialCounts(
    m.people.map((p) => ({ id: p.id, planned: p.planned, share: known ? p.kcal! : p.units })),
    known ? kcal! : m.cookedUnits
  );
}

/**
 * Combien de portions de chacun vont au congélo, en boîtes : les repas prévus au-delà des jours de
 * frigo et la marge (ce qui dépasse les repas prévus). Rien si le plat ne se congèle pas.
 */
export function defaultFreezer(m: CalcModel, counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(m.people.map((p) => [p.id, m.freezerOk ? Math.min(counts[p.id] ?? 0, p.late + Math.max(0, (counts[p.id] ?? 0) - p.planned)) : 0]));
}
