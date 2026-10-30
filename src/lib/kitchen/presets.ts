// Cuisine d'un foyer, décrite pas à pas (mise en route, /bienvenue) et traduite en équipement
// pour le planificateur : foyers, four, récipients, appareils et ce qui va sur quoi.
// Les ids des récipients sont des rôles stables (les recettes les citent : poele-28, cocotte,
// faitout, casserole-14/16/18, plat-grand, plat-moyen, plat-four, air-fryer) ; leurs vraies
// dimensions sont dans dims_json. Un récipient absent est remplacé par le planificateur quand
// la recette a une alternative (equipmentAlt), sinon il le signale.
// « Je ne sais pas » est toujours possible : la valeur courante est gardée et la question notée
// dans `unsure` (à vérifier plus tard). Module pur (tests/foyer.test.ts, tests/cuisine.test.ts).
import type { InferInsertModel } from "drizzle-orm";
import type { equipment, equipmentFit } from "@/lib/db/schema";

export type HobType = "induction" | "gaz" | "vitroceramique" | "electrique";
export type PanMaterial = "inox" | "fonte" | "antiadhesive";

export interface Pan {
  material: PanMaterial;
  /** Diamètre du haut, en cm. */
  cm: number;
}
export interface Casserole {
  /** Diamètre du fond, en cm. */
  cm: number;
  /** Contenance en litres ; null = je ne sais pas (estimée d'après le diamètre). */
  liters: number | null;
}
export interface Pot {
  liters: number;
  /** Passe au four (poignées en métal, couvercle compris). */
  ovenSafe: boolean;
}

/** Les questions du parcours guidé, pour noter celles restées sans réponse sûre. */
export type KitchenQuestion = "hobType" | "hobSizes" | "levels" | "oven" | "pans" | "casseroles" | "pots" | "plats" | "airFryer" | "mixers" | "extras";

export interface KitchenConfig {
  hobType: HobType;
  /** Diamètre de chaque foyer en cm, du plus grand au plus petit (1 à 6 foyers). */
  hobSizes: number[];
  /** Niveaux de puissance de la plaque (9 en induction, 6 à 9 ailleurs ; 0 = repères « doux, moyen, vif »). */
  levels: number;
  oven: boolean;
  /** Gradins du four (niveaux de grille). */
  ovenLevels: number;
  /** Chaleur tournante : deux plats cuisent ensemble à deux niveaux. */
  ovenFan: boolean;
  /** 0 à 3 poêles. La plus grande en inox ou en fonte devient la poêle de saisie (poele-28). */
  pans: Pan[];
  /** Viande par fournée dans la poêle de saisie, en grammes ; null = d'après son diamètre. */
  poeleMaxG: number | null;
  /** 0 à 3 casseroles. */
  casseroles: Casserole[];
  faitout: Pot | null;
  /** Cocotte en fonte : au four si elle y passe. */
  cocotte: Pot | null;
  /** 0 à 3 plats à four (grand, moyen, petit). */
  plats: number;
  /** Contenance du panier de l'air fryer en litres ; 0 = pas d'air fryer. */
  airFryerL: number;
  mixers: { plongeant: boolean; blender: boolean; hachoir: boolean };
  extras: { microOndes: boolean; congelateur: boolean; autocuiseur: boolean; cuiseurRiz: boolean; robot: boolean; balance: boolean };
  /** Seconde planche et second grand couteau : pour cuisiner à deux. */
  duo: boolean;
  /** Questions répondues « je ne sais pas » : la valeur par défaut sert, à vérifier un jour. */
  unsure: KitchenQuestion[];
}

export const DEFAULT_KITCHEN: KitchenConfig = {
  hobType: "induction",
  hobSizes: [28, 21, 14.5],
  levels: 9,
  oven: true,
  ovenLevels: 5,
  ovenFan: true,
  pans: [{ material: "inox", cm: 28 }],
  poeleMaxG: null,
  casseroles: [
    { cm: 14, liters: null },
    { cm: 16, liters: null },
    { cm: 18, liters: null },
  ],
  faitout: { liters: 6, ovenSafe: false },
  cocotte: { liters: 6, ovenSafe: true },
  plats: 3,
  airFryerL: 0,
  mixers: { plongeant: false, blender: false, hachoir: false },
  extras: { microOndes: true, congelateur: true, autocuiseur: false, cuiseurRiz: false, robot: false, balance: true },
  duo: true,
  unsure: [],
};

/** Tout l'équipement standard : chaque id que peut citer une recette existe en base (clé étrangère). */
export const CATALOG_KITCHEN: KitchenConfig = {
  ...DEFAULT_KITCHEN,
  pans: [
    { material: "inox", cm: 28 },
    { material: "antiadhesive", cm: 24 },
    { material: "fonte", cm: 20 },
  ],
  airFryerL: 5,
  faitout: { liters: 6, ovenSafe: false },
  mixers: { plongeant: true, blender: true, hachoir: true },
  extras: { microOndes: true, congelateur: true, autocuiseur: true, cuiseurRiz: true, robot: true, balance: true },
};

export const HOB_LABEL: Record<HobType, string> = { induction: "à induction", gaz: "au gaz", vitroceramique: "vitrocéramique", electrique: "électrique" };
export const HOB_SHORT: Record<HobType, string> = { induction: "Induction", gaz: "Gaz", vitroceramique: "Vitrocéramique", electrique: "Électrique (fonte)" };
export const PAN_LABEL: Record<PanMaterial, string> = { inox: "inox", fonte: "fonte", antiadhesive: "antiadhésive" };

/** Plaques courantes : un choix en un geste, les diamètres se corrigent ensuite. */
export interface HobPreset {
  id: string;
  label: string;
  hint: string;
  sizes: number[];
}
export const HOB_PRESETS: HobPreset[] = [
  { id: "trois-28", label: "3 foyers, dont un grand", hint: "28, 21 et 14,5 cm : la plaque de 60 cm la plus courante", sizes: [28, 21, 14.5] },
  { id: "quatre", label: "4 foyers", hint: "21, 18, 18 et 14,5 cm", sizes: [21, 18, 18, 14.5] },
  { id: "deux", label: "2 foyers", hint: "21 et 16 cm : plaque domino ou studio", sizes: [21, 16] },
  { id: "cinq", label: "5 foyers", hint: "Grande plaque de 75 à 90 cm", sizes: [28, 21, 18, 18, 14.5] },
];
/** Au gaz, la taille utile d'un brûleur est celle de la casserole qu'il chauffe bien. */
const GAS_PRESETS: HobPreset[] = [
  { id: "gaz-quatre", label: "4 feux", hint: "un rapide, deux moyens, un petit", sizes: [26, 21, 21, 14] },
  { id: "gaz-trois", label: "3 feux", hint: "un rapide, un moyen, un petit", sizes: [26, 21, 14] },
  { id: "gaz-deux", label: "2 feux", hint: "un moyen, un petit", sizes: [21, 14] },
  { id: "gaz-cinq", label: "5 feux", hint: "avec un brûleur wok", sizes: [28, 26, 21, 21, 14] },
];
export const hobPresets = (t: HobType): HobPreset[] => (t === "gaz" ? GAS_PRESETS : HOB_PRESETS);
/** Niveaux de puissance habituels d'un type de plaque. */
export const typicalLevels = (t: HobType) => (t === "gaz" ? 0 : 9);

/** Le préréglage qui correspond exactement à ces foyers, s'il y en a un. */
export function matchHobPreset(t: HobType, sizes: number[]): HobPreset | null {
  const s = normSizes(sizes);
  return hobPresets(t).find((p) => p.sizes.length === s.length && p.sizes.every((x, i) => x === s[i])) ?? null;
}

type Eq = InferInsertModel<typeof equipment>;
type Fit = InferInsertModel<typeof equipmentFit>;

const clamp = (n: unknown, lo: number, hi: number, dflt = lo) => {
  const x = typeof n === "number" && Number.isFinite(n) ? n : dflt;
  return Math.max(lo, Math.min(hi, Math.round(x)));
};
const half = (n: number) => Math.round(n * 2) / 2;
const round50 = (g: number) => Math.round(g / 50) * 50;
const normSizes = (s: number[]) => s.map((x) => Math.max(10, Math.min(36, half(x)))).sort((a, b) => b - a).slice(0, 6);

/** Contenance estimée d'une casserole (hauteur ≈ 0,55 × diamètre), en litres arrondis au demi. */
export const casseroleLiters = (cm: number) => Math.max(0.5, half((Math.PI / 4) * cm * cm * 0.55 * cm / 1000));
/** Diamètre estimé d'un faitout (hauteur ≈ 0,8 × diamètre) ou d'une cocotte (≈ 0,45) d'après sa contenance. */
const potCm = (liters: number, ratio: number) => Math.round(Math.cbrt((liters * 1000) / ((Math.PI / 4) * ratio)));
/** Viande par fournée d'une poêle : 500 g pour 28 cm, à proportion de la surface. */
export const panMaxG = (cm: number) => Math.max(200, round50(500 * (cm / 28) ** 2));
/** Ce que l'air fryer cuit en une fournée, en une couche : environ 150 g par litre de panier. */
export const airFryerMaxG = (liters: number) => Math.max(300, round50(liters * 150));

/**
 * Un récipient de `cm` va-t-il sur un foyer de `hob` cm ? Poêle : le foyer pas plus grand que le fond
 * (+2) et pas trop petit (−8) ; cocotte : à 4 cm près (elle doit chauffer partout pour saisir) ;
 * casserole et faitout : tout foyer pas trop large (un petit fond sur un grand foyer chauffe mal).
 */
export function vesselFitsHob(kind: "poele" | "cocotte" | "casserole" | "faitout", cm: number, hob: number): boolean {
  if (kind === "poele") return hob >= cm - 8 && hob <= cm + 2;
  if (kind === "cocotte") return hob >= cm - 4 && hob <= cm + 4;
  if (kind === "faitout") return hob <= cm + 10;
  return hob <= cm + 6;
}

// Ids des casseroles : un rôle par taille (les recettes citent la grande pour le riz).
const CASSEROLE_SLOTS = [
  { id: "casserole-14", cm: 14, name: "Petite casserole" },
  { id: "casserole-16", cm: 16, name: "Casserole moyenne" },
  { id: "casserole-18", cm: 18, name: "Grande casserole" },
];
/** Casseroles rangées par taille sur les rôles les plus proches (une seule de 20 cm = la grande). */
export function casseroleSlots(list: Casserole[]): { id: string; name: string; c: Casserole }[] {
  const cs = [...list].sort((a, b) => a.cm - b.cm).slice(0, 3);
  let best: number[] = [];
  let cost = Infinity;
  const pick = (from: number, acc: number[]) => {
    if (acc.length === cs.length) {
      const c = acc.reduce((s, slot, i) => s + Math.abs(CASSEROLE_SLOTS[slot].cm - cs[i].cm), 0);
      if (c < cost) [best, cost] = [acc, c];
      return;
    }
    for (let k = from; k < CASSEROLE_SLOTS.length; k++) pick(k + 1, [...acc, k]);
  };
  pick(0, []);
  return cs.map((c, i) => ({ id: CASSEROLE_SLOTS[best[i]].id, name: CASSEROLE_SLOTS[best[i]].name, c }));
}

/** La poêle de saisie : la plus grande en inox ou en fonte (l'antiadhésive saisit mal), sinon la plus grande. */
export function panRoles(pans: Pan[]): { id: string; pan: Pan }[] {
  const sorted = [...pans].slice(0, 3).sort((a, b) => Number(a.material === "antiadhesive") - Number(b.material === "antiadhesive") || b.cm - a.cm);
  return sorted.map((pan, i) => ({ id: i === 0 ? "poele-28" : `poele-${i + 1}`, pan }));
}

const PLATS: { id: string; name: string; dims: Record<string, string | number>; capacityL: number }[] = [
  { id: "plat-grand", name: "Grand plat à four", dims: { innerCm: "28x21", depthCm: 6.5 }, capacityL: 2.4 },
  { id: "plat-moyen", name: "Plat à four moyen", dims: { innerCm: "28x15", depthCm: 7 }, capacityL: 2 },
  { id: "plat-four", name: "Petit plat à four", dims: { cm: "24x18" }, capacityL: 1.5 },
];

const fmtCm = (n: number) => String(n).replace(".", ",");

/** Foyers d'une cuisine : ids gardant le diamètre (hob-28, hob-18, hob-18b…), nommés par rang. */
export function kitchenHobs(sizes: number[]): { id: string; cm: number; name: string }[] {
  const s = normSizes(sizes.length ? sizes : DEFAULT_KITCHEN.hobSizes);
  const seen = new Map<number, number>();
  return s.map((cm, i) => {
    const base = Math.floor(cm);
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    const name = s.length === 1 ? "Foyer" : i === 0 ? "Grand foyer" : i === s.length - 1 && s.length >= 3 ? "Petit foyer" : i === 1 ? "Foyer moyen" : `Foyer ${i + 1}`;
    return { id: `hob-${base}${k ? String.fromCharCode(97 + k) : ""}`, cm, name };
  });
}

/** Équipement et compatibilités d'une cuisine. */
export function kitchenEquipment(raw: KitchenConfig): { equipment: Eq[]; fits: Fit[] } {
  const c = normalizeKitchen(raw);
  const eq: Eq[] = [];
  const fits: Fit[] = [];
  const hobs = kitchenHobs(c.hobSizes);
  for (const h of hobs) eq.push({ id: h.id, kind: "hob", name: h.name, dimsJson: { diameterCm: h.cm, ...(c.levels ? { levels: c.levels } : {}), type: c.hobType } });
  if (c.oven) eq.push({ id: "oven", kind: "oven", name: "Four", dimsJson: { levels: c.ovenLevels, top: "1 = le plus haut", fan: c.ovenFan ? 1 : 0 } });

  // Les foyers où va un récipient ; les plus proches de sa taille sont idéaux, les autres « possibles ».
  // Sans foyer dans la fourchette (petite plaque), tous les foyers font l'affaire.
  const fitHobs = (id: string, kind: Parameters<typeof vesselFitsHob>[0], cm: number) => {
    const ok = hobs.filter((h) => vesselFitsHob(kind, cm, h.cm));
    const list = ok.length ? ok : hobs;
    const gap = Math.min(...list.map((h) => Math.abs(h.cm - cm)));
    for (const h of list) fits.push({ equipmentId: id, hobId: h.id, preferred: Math.abs(h.cm - cm) <= gap + 4 });
  };

  for (const { id, pan } of panRoles(c.pans)) {
    const main = id === "poele-28";
    eq.push({
      id,
      kind: "pan",
      name: `Poêle ${PAN_LABEL[pan.material]} ${fmtCm(pan.cm)} cm`,
      dimsJson: { diameterCm: pan.cm, material: pan.material },
      maxBatchG: main && c.poeleMaxG != null ? clamp(c.poeleMaxG, 200, 1500) : panMaxG(pan.cm),
      ...(main ? { notes: "La poêle de saisie : une fournée de viande à la fois." } : {}),
    });
    fitHobs(id, "poele", pan.cm);
  }
  if (c.cocotte) {
    const cm = potCm(c.cocotte.liters, 0.45);
    eq.push({ id: "cocotte", kind: "pot", name: "Cocotte en fonte", dimsJson: { diameterCm: cm, ovenSafe: c.cocotte.ovenSafe ? 1 : 0 }, capacityL: c.cocotte.liters });
    fitHobs("cocotte", "cocotte", cm);
    if (c.oven && c.cocotte.ovenSafe) fits.push({ equipmentId: "cocotte", hobId: "oven", preferred: true });
  }
  if (c.faitout) {
    const cm = potCm(c.faitout.liters, 0.8);
    eq.push({ id: "faitout", kind: "pot", name: "Faitout", dimsJson: { baseCm: cm, ovenSafe: c.faitout.ovenSafe ? 1 : 0 }, capacityL: c.faitout.liters });
    fitHobs("faitout", "faitout", cm);
    if (c.oven && c.faitout.ovenSafe) fits.push({ equipmentId: "faitout", hobId: "oven", preferred: false });
  }
  for (const k of casseroleSlots(c.casseroles)) {
    const liters = k.c.liters ?? casseroleLiters(k.c.cm);
    eq.push({ id: k.id, kind: "pot", name: `${k.name} ${fmtCm(k.c.cm)} cm`, dimsJson: { baseCm: k.c.cm, heightCm: Math.round(k.c.cm * 0.55) }, capacityL: liters });
    fitHobs(k.id, "casserole", k.c.cm);
  }
  if (c.oven)
    for (const p of PLATS.slice(0, c.plats)) {
      eq.push({ id: p.id, kind: "dish", name: p.name, dimsJson: p.dims, capacityL: p.capacityL });
      fits.push({ equipmentId: p.id, hobId: "oven", preferred: true });
    }

  // Air fryer : un récipient à part entière pour le planificateur (une recette à la fois, sa propre
  // température), sans foyer ni four.
  if (c.airFryerL > 0)
    eq.push({
      id: "air-fryer",
      kind: "appliance",
      name: `Air fryer ${fmtCm(c.airFryerL)} L`,
      capacityL: c.airFryerL,
      maxBatchG: airFryerMaxG(c.airFryerL),
      notes: "Un petit four ventilé : environ 20 °C et 20 % de temps de moins qu'au four, une couche à la fois, panier secoué à mi-cuisson.",
    });
  if (c.mixers.plongeant) eq.push({ id: "mixeur", kind: "appliance", name: "Mixeur plongeant", notes: "Mixe une soupe ou une sauce dans son récipient." });
  if (c.mixers.blender) eq.push({ id: "blender", kind: "appliance", name: "Blender", notes: "Bol haut : sauces lisses, soupes (à tiédir avant)." });
  if (c.mixers.hachoir) eq.push({ id: "hachoir", kind: "appliance", name: "Petit hachoir", notes: "Ail, oignon, herbes. Pas pour la viande crue, qui chauffe et fait une pâte." });
  const x = c.extras;
  if (x.microOndes) eq.push({ id: "micro-ondes", kind: "appliance", name: "Micro-ondes" });
  if (x.congelateur) eq.push({ id: "congelateur", kind: "appliance", name: "Congélateur" });
  if (x.autocuiseur) eq.push({ id: "autocuiseur", kind: "appliance", name: "Autocuiseur" });
  if (x.cuiseurRiz) eq.push({ id: "cuiseur-riz", kind: "appliance", name: "Cuiseur à riz" });
  if (x.robot) eq.push({ id: "robot", kind: "appliance", name: "Robot multifonction" });
  if (x.balance) eq.push({ id: "balance", kind: "utensil", name: "Balance de cuisine" });

  // Ustensiles de prep : ressources du planificateur, à deux surtout.
  eq.push({ id: "grand-couteau", kind: "utensil", name: "Grand couteau", count: c.duo ? 2 : 1, notes: "Légumes et viande. Chaque geste de prep en prend un." });
  eq.push({ id: "petit-couteau", kind: "utensil", name: "Petit couteau", count: 2 });
  eq.push({ id: "planche-principale", kind: "utensil", name: "Planche principale", notes: "La planche par défaut." });
  if (c.duo) eq.push({ id: "planche-2", kind: "utensil", name: "Seconde planche", dimsJson: { duoOnly: 1 }, notes: "Sortie seulement quand on cuisine à deux." });
  return { equipment: eq, fits };
}

const QUESTIONS: KitchenQuestion[] = ["hobType", "hobSizes", "levels", "oven", "pans", "casseroles", "pots", "plats", "airFryer", "mixers", "extras"];
const HOB_TYPES = Object.keys(HOB_LABEL) as HobType[];
const MATERIALS = Object.keys(PAN_LABEL) as PanMaterial[];
const LEGACY_SIZES = [28, 21, 14.5, 18, 16];

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose => (v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : {});
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, half(v))) : d);
const pot = (v: unknown, d: Pot | null, dfltL: number, dfltOven: boolean): Pot | null => {
  if (v === null || v === false) return null;
  if (v === true) return { liters: dfltL, ovenSafe: dfltOven };
  if (v === undefined) return d;
  const o = obj(v);
  return { liters: num(o.liters, 1, 20, dfltL), ovenSafe: bool(o.ovenSafe, dfltOven) };
};

/**
 * Cuisine relue avec tolérance : ce qui manque prend la valeur par défaut, les valeurs absurdes sont
 * bornées, et l'ancien format (nombre de foyers, cases à cocher des récipients) est traduit.
 */
export function normalizeKitchen(raw: unknown): KitchenConfig {
  const x = obj(raw);
  const d = DEFAULT_KITCHEN;
  const legacy = obj(x.vessels);
  const isLegacy = !("pans" in x) && "vessels" in x;

  const hobType = HOB_TYPES.includes(x.hobType as HobType) ? (x.hobType as HobType) : d.hobType;
  let hobSizes = Array.isArray(x.hobSizes) ? (x.hobSizes as unknown[]).filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
  if (!hobSizes.length) hobSizes = typeof x.hobs === "number" ? LEGACY_SIZES.slice(0, clamp(x.hobs, 1, 5)) : d.hobSizes;

  const pans = Array.isArray(x.pans)
    ? (x.pans as unknown[]).slice(0, 3).map((p) => {
        const o = obj(p);
        return { material: MATERIALS.includes(o.material as PanMaterial) ? (o.material as PanMaterial) : "inox", cm: num(o.cm, 14, 36, 28) };
      })
    : isLegacy
      ? legacy.poele === false ? [] : d.pans
      : d.pans;
  const casseroles = Array.isArray(x.casseroles)
    ? (x.casseroles as unknown[]).slice(0, 3).map((k) => {
        const o = obj(k);
        return { cm: num(o.cm, 10, 28, 16), liters: o.liters == null ? null : num(o.liters, 0.5, 8, 1.5) };
      })
    : isLegacy
      ? d.casseroles.slice(0, clamp(legacy.casseroles, 0, 3, 3))
      : d.casseroles;
  const mixers = obj(x.mixers);
  const extras = obj(x.extras);
  const poeleMaxG = x.poeleMaxG ?? legacy.poeleMaxG;

  return {
    hobType,
    hobSizes: normSizes(hobSizes),
    levels: clamp(x.levels, 0, 12, d.levels),
    oven: bool(x.oven, d.oven),
    ovenLevels: clamp(x.ovenLevels, 1, 7, d.ovenLevels),
    ovenFan: bool(x.ovenFan, d.ovenFan),
    pans,
    poeleMaxG: typeof poeleMaxG === "number" && Number.isFinite(poeleMaxG) ? clamp(poeleMaxG, 200, 1500) : null,
    casseroles,
    faitout: pot(isLegacy ? legacy.faitout : x.faitout, d.faitout, 6, false),
    cocotte: pot(isLegacy ? legacy.cocotte : x.cocotte, d.cocotte, 6, true),
    plats: clamp(x.plats ?? legacy.plats, 0, 3, d.plats),
    airFryerL: typeof x.airFryerL === "number" && x.airFryerL > 0 ? num(x.airFryerL, 1, 15, 5) : 0,
    mixers: {
      plongeant: bool(mixers.plongeant, bool(extras.mixeur, d.mixers.plongeant)),
      blender: bool(mixers.blender, d.mixers.blender),
      hachoir: bool(mixers.hachoir, d.mixers.hachoir),
    },
    extras: {
      microOndes: bool(extras.microOndes, d.extras.microOndes),
      congelateur: bool(extras.congelateur, d.extras.congelateur),
      autocuiseur: bool(extras.autocuiseur, d.extras.autocuiseur),
      cuiseurRiz: bool(extras.cuiseurRiz, d.extras.cuiseurRiz),
      robot: bool(extras.robot, d.extras.robot),
      balance: bool(extras.balance, d.extras.balance),
    },
    duo: bool(x.duo, d.duo),
    unsure: Array.isArray(x.unsure) ? QUESTIONS.filter((q) => (x.unsure as unknown[]).includes(q)) : [],
  };
}

/** Lecture tolérante d'une cuisine enregistrée (réglage JSON). */
export function parseKitchen(raw: string | null): KitchenConfig {
  if (!raw) return DEFAULT_KITCHEN;
  try {
    return normalizeKitchen(JSON.parse(raw));
  } catch {
    return DEFAULT_KITCHEN;
  }
}

/** Résumé d'une cuisine en une ligne par rubrique (récapitulatif du parcours, Réglages). */
export function kitchenSummary(raw: KitchenConfig): { label: string; text: string; unsure: boolean }[] {
  const c = normalizeKitchen(raw);
  const u = (q: KitchenQuestion) => c.unsure.includes(q);
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "aucun");
  const plats = ["un plat à four", "deux plats à four", "trois plats à four"][c.plats - 1];
  return [
    { label: "Plaque", text: `${HOB_SHORT[c.hobType]}, ${c.hobSizes.length} foyer${c.hobSizes.length > 1 ? "s" : ""} (${c.hobSizes.map(fmtCm).join(", ")} cm)${c.levels ? `, ${c.levels} niveaux` : ""}`, unsure: u("hobType") || u("hobSizes") || u("levels") },
    { label: "Four", text: c.oven ? `${c.ovenLevels} gradins${c.ovenFan ? ", chaleur tournante" : ""}` : "pas de four", unsure: u("oven") },
    { label: "Poêles", text: list(panRoles(c.pans).map(({ pan }) => `${PAN_LABEL[pan.material]} ${fmtCm(pan.cm)} cm`)), unsure: u("pans") },
    { label: "Casseroles", text: list(casseroleSlots(c.casseroles).map((k) => `${fmtCm(k.c.cm)} cm (${fmtCm(k.c.liters ?? casseroleLiters(k.c.cm))} L)`)), unsure: u("casseroles") },
    {
      label: "Cocotte, faitout, plats",
      text: list([
        ...(c.cocotte ? [`cocotte ${fmtCm(c.cocotte.liters)} L${c.cocotte.ovenSafe ? " (va au four)" : ""}`] : []),
        ...(c.faitout ? [`faitout ${fmtCm(c.faitout.liters)} L`] : []),
        ...(c.oven && plats ? [plats] : []),
      ]),
      unsure: u("pots") || u("plats"),
    },
    {
      label: "Appareils",
      text: list([
        ...(c.airFryerL ? [`air fryer ${fmtCm(c.airFryerL)} L`] : []),
        ...(c.mixers.plongeant ? ["mixeur plongeant"] : []),
        ...(c.mixers.blender ? ["blender"] : []),
        ...(c.mixers.hachoir ? ["petit hachoir"] : []),
        ...(c.extras.robot ? ["robot"] : []),
        ...(c.extras.autocuiseur ? ["autocuiseur"] : []),
        ...(c.extras.cuiseurRiz ? ["cuiseur à riz"] : []),
        ...(c.extras.microOndes ? ["micro-ondes"] : []),
        ...(c.extras.balance ? ["balance"] : []),
        ...(c.extras.congelateur ? ["congélateur"] : []),
      ]),
      unsure: u("airFryer") || u("mixers") || u("extras"),
    },
  ];
}
