// Cuisine d'un foyer, décrite en quelques choix (mise en route, /bienvenue) et traduite en
// équipement pour le planificateur : foyers, four, récipients et ce qui va sur quoi.
// Les ids des récipients sont stables (les recettes les citent : poele-28, cocotte, faitout,
// casserole-14/16/18, plat-grand, plat-moyen, plat-four) ; un récipient absent est remplacé
// par le planificateur quand la recette a une alternative (equipmentAlt), sinon il le signale.
// Module pur (tests/kitchen.test.ts).
import type { InferInsertModel } from "drizzle-orm";
import type { equipment, equipmentFit } from "@/lib/db/schema";

export type HobType = "induction" | "gaz" | "vitroceramique" | "electrique";

export interface KitchenConfig {
  hobType: HobType;
  /** Nombre de foyers utilisables en même temps (1 à 5). */
  hobs: number;
  /** Niveaux de puissance de la plaque (9 en induction, 6 à 9 ailleurs ; 0 = repères « doux, moyen, vif »). */
  levels: number;
  oven: boolean;
  /** Niveaux de grille du four. */
  ovenLevels: number;
  vessels: {
    poele: boolean;
    /** Viande par fournée dans la poêle, en grammes. */
    poeleMaxG: number;
    cocotte: boolean;
    faitout: boolean;
    /** 0 à 3 casseroles (petite, moyenne, grande). */
    casseroles: number;
    /** 0 à 3 plats à four (grand, moyen, plat à four). */
    plats: number;
  };
  extras: { microOndes: boolean; congelateur: boolean; mixeur: boolean };
  /** Seconde planche et second grand couteau : pour cuisiner à deux. */
  duo: boolean;
}

export const DEFAULT_KITCHEN: KitchenConfig = {
  hobType: "induction",
  hobs: 3,
  levels: 9,
  oven: true,
  ovenLevels: 5,
  vessels: { poele: true, poeleMaxG: 500, cocotte: true, faitout: true, casseroles: 3, plats: 3 },
  extras: { microOndes: true, congelateur: true, mixeur: false },
  duo: true,
};

export const HOB_LABEL: Record<HobType, string> = { induction: "à induction", gaz: "au gaz", vitroceramique: "vitrocéramique", electrique: "électrique" };

type Eq = InferInsertModel<typeof equipment>;
type Fit = InferInsertModel<typeof equipmentFit>;

// Foyers du plus grand au plus petit : les ids gardent le diamètre, les recettes et le planificateur
// ne citent jamais un foyer par son id.
const HOB_SIZES = [28, 21, 14.5, 18, 16];
const HOB_NAMES = ["Grand foyer", "Foyer moyen", "Petit foyer", "Foyer 4", "Foyer 5"];
const hobId = (cm: number) => `hob-${Math.floor(cm)}`;

const CASSEROLES: { id: string; name: string; dims: Record<string, string | number>; cm: number }[] = [
  { id: "casserole-14", name: "Casserole 1 (petite)", dims: { baseCm: 14, heightCm: 8 }, cm: 14 },
  { id: "casserole-16", name: "Casserole 2 (moyenne)", dims: { baseCm: 16, heightCm: 9 }, cm: 16 },
  { id: "casserole-18", name: "Casserole 3 (grande)", dims: { baseCm: 18, heightCm: 10 }, cm: 18 },
];
const PLATS: { id: string; name: string; dims: Record<string, string | number>; capacityL: number }[] = [
  { id: "plat-grand", name: "Grand plat à four", dims: { innerCm: "28x21", depthCm: 6.5 }, capacityL: 2.4 },
  { id: "plat-moyen", name: "Plat à four moyen", dims: { innerCm: "28x15", depthCm: 7 }, capacityL: 2 },
  { id: "plat-four", name: "Petit plat à four", dims: { cm: "24x18" }, capacityL: 1.5 },
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Équipement et compatibilités d'une cuisine. */
export function kitchenEquipment(c: KitchenConfig): { equipment: Eq[]; fits: Fit[] } {
  const eq: Eq[] = [];
  const fits: Fit[] = [];
  const nHobs = clamp(c.hobs, 1, 5);
  const levels = clamp(c.levels, 0, 12);
  const hobs = HOB_SIZES.slice(0, nHobs).map((cm, i) => ({ id: hobId(cm), cm, name: HOB_NAMES[i] }));
  for (const h of hobs) eq.push({ id: h.id, kind: "hob", name: h.name, dimsJson: { diameterCm: h.cm, ...(levels ? { levels } : {}), type: c.hobType } });
  if (c.oven) eq.push({ id: "oven", kind: "oven", name: "Four", dimsJson: { levels: clamp(c.ovenLevels, 1, 7), top: "1 = le plus haut" } });

  // Un récipient va sur les foyers dont le diamètre tient entre `lo` et `hi` cm (un petit fond sur un grand
  // foyer chauffe mal, une grande cocotte déborde d'un petit) ; `only` : seul ce foyer est idéal, les autres
  // sont « possibles ». Sans foyer dans la fourchette (petite plaque), tous les foyers font l'affaire.
  const fitHobs = (id: string, lo: number, hi: number, only?: number) => {
    const ok = hobs.filter((h) => h.cm >= lo && h.cm <= hi);
    for (const h of ok.length ? ok : hobs) fits.push({ equipmentId: id, hobId: h.id, preferred: only == null || h.cm === only });
  };

  const v = c.vessels;
  if (v.poele) {
    eq.push({ id: "poele-28", kind: "pan", name: "Poêle 28 cm (inox ou fonte)", dimsJson: { diameterCm: 28 }, maxBatchG: clamp(v.poeleMaxG, 200, 1500), notes: "La poêle de saisie : une fournée de viande à la fois." });
    fitHobs("poele-28", 20, 30, 28);
  }
  if (v.cocotte) {
    eq.push({ id: "cocotte", kind: "pot", name: "Cocotte en fonte", dimsJson: { lengthCm: 30 }, capacityL: 6 });
    fitHobs("cocotte", 26, 32);
    if (c.oven) fits.push({ equipmentId: "cocotte", hobId: "oven", preferred: true });
  }
  if (v.faitout) {
    eq.push({ id: "faitout", kind: "pot", name: "Faitout", dimsJson: { baseCm: 18, topCm: 23, heightCm: 20 } });
    fitHobs("faitout", 0, 30);
  }
  for (const k of CASSEROLES.slice(0, clamp(v.casseroles, 0, 3))) {
    eq.push({ id: k.id, kind: "pot", name: k.name, dimsJson: k.dims });
    fitHobs(k.id, 0, k.cm + 6);
  }
  if (c.oven)
    for (const p of PLATS.slice(0, clamp(v.plats, 0, 3))) {
      eq.push({ id: p.id, kind: "dish", name: p.name, dimsJson: p.dims, capacityL: p.capacityL });
      fits.push({ equipmentId: p.id, hobId: "oven", preferred: true });
    }

  if (c.extras.microOndes) eq.push({ id: "micro-ondes", kind: "appliance", name: "Micro-ondes" });
  if (c.extras.congelateur) eq.push({ id: "congelateur", kind: "appliance", name: "Congélateur" });
  if (c.extras.mixeur) eq.push({ id: "mixeur", kind: "appliance", name: "Mixeur" });

  // Ustensiles de prep : ressources du planificateur, à deux surtout.
  eq.push({ id: "grand-couteau", kind: "utensil", name: "Grand couteau", count: c.duo ? 2 : 1, notes: "Légumes et viande. Chaque geste de prep en prend un." });
  eq.push({ id: "petit-couteau", kind: "utensil", name: "Petit couteau", count: 2 });
  eq.push({ id: "planche-principale", kind: "utensil", name: "Planche principale", notes: "La planche par défaut." });
  if (c.duo) eq.push({ id: "planche-2", kind: "utensil", name: "Seconde planche", dimsJson: { duoOnly: 1 }, notes: "Sortie seulement quand on cuisine à deux." });
  return { equipment: eq, fits };
}

/** Lecture tolérante d'une cuisine enregistrée (réglage JSON) : ce qui manque prend la valeur par défaut. */
export function parseKitchen(raw: string | null): KitchenConfig {
  if (!raw) return DEFAULT_KITCHEN;
  try {
    const x = JSON.parse(raw) as Partial<KitchenConfig>;
    return {
      ...DEFAULT_KITCHEN,
      ...x,
      vessels: { ...DEFAULT_KITCHEN.vessels, ...(x.vessels ?? {}) },
      extras: { ...DEFAULT_KITCHEN.extras, ...(x.extras ?? {}) },
    };
  } catch {
    return DEFAULT_KITCHEN;
  }
}
