// Les bols de prep, les vrais : combien il en faut, lesquels, et quand ils se libèrent. Module pur
// (tests/contenants.test.ts).
//
// Les lettres du plan (bol A, bol B…) restent celles des fiches : ce sont des groupes d'ingrédients.
// Ici, chaque groupe trouve où attendre :
// - « moment » : rien à préparer, on pèse et on verse au moment de l'étape (une boîte de pulpe, la
//   crème, le riz qu'on rince dans la passoire, les épices d'une sauce qui mijote) ;
// - « bol » ou « boîte » : un contenant de l'inventaire de la cuisine (Réglages › Cuisine), le plus
//   petit qui convient, réutilisé dès qu'il est libre (rincé, 1 min) ;
// - « assiette » : faute de bol, des légumes coupés attendent sur une assiette.
// Deux groupes de la même recette qui entrent ensemble dans le récipient partagent un bol. Si
// l'inventaire ne suffit pas, un groupe à peser attend le moment, un autre se remplit quand un bol se
// libère (`fillAfter`), et sinon le plan le dit.
import { DEFAULT_KITCHEN, kitchenEquipment } from "@/lib/kitchen/presets";
import { BOWL_FILL } from "./capacity";

export type Holder = "moment" | "bol" | "boite" | "assiette";

/** Un contenant de l'inventaire (une ligne : `count` exemplaires de `liters` litres). */
export interface ContainerKind {
  id: string;
  kind: "bol" | "boite";
  label: string; // « Grand bol »
  liters: number;
  count: number;
}

export interface BowlNeed {
  letter: string;
  recipeSlug: string;
  liters: number;
  /** Minute où il faut le remplir (−∞ : avant la cuisson). */
  fillAt: number;
  /** Minute où son contenu part dans le récipient (le bol se libère). */
  releaseAt: number;
  /** Ce qu'il contient : un mélange ou de la viande crue (un vrai bol), des légumes coupés, ou seulement des choses à peser. */
  content: "mix" | "meat" | "cut" | "weigh";
  /** Peut attendre le moment (pesé et versé à l'étape) sans rien perdre. */
  moment: boolean;
  /** Même clé = entrent ensemble dans le même récipient au même moment : un seul bol. */
  together?: string | null;
  /** Prep la veille : passe la nuit au frigo (une boîte fermée de préférence). */
  fridge?: boolean;
}

export interface BowlPlace {
  holder: Holder;
  /** Id du contenant (« bol-grand#2 »), son nom. */
  container: string | null;
  label: string | null;
  /** Lettres qui partagent ce contenant au même moment. */
  with?: string[];
  /** Se remplit quand le contenant d'un autre groupe se libère (lettre), pas avant la cuisson. */
  fillAfter?: string;
  /** Plus plein que le remplissage conseillé (le plus grand contenant ne suffit pas). */
  tight?: boolean;
  /** Partagé en deux contenants (`container` : « bol-moyen#1+bol-moyen#2 »). */
  split?: boolean;
}

export interface Allocation {
  places: Map<string, BowlPlace>;
  /** Contenants occupés en même temps, au plus fort. */
  peak: number;
  /** Contenants différents sortis (après réutilisation). */
  used: number;
  /** Groupes sans contenant malgré tout. */
  missing: string[];
}

export const RINSE_MIN = 1;

const MOMENT_FOOD = /^(pulpe_tomate|passata|tomate|lait_coco|creme|lait|bouillon|vin|riz|pates|orzo|semoule|quinoa|boulgour|sauce_soja|nuoc_mam|miel|sucre|moutarde|concentre_tomate|farine|maizena|huile|beurre|zero|epinards|oeuf|parmesan|emmental|mozzarella|colombo|curry|eau|lentilles|pois_casses)/;
const MEAT = /poulet|porc|boeuf|dinde|veau|agneau|merguez|saucisse|chorizo|lardons|poisson|saumon|crevette|echine|filet_mignon/;

/**
 * Ce que contient un groupe, et s'il peut attendre le moment. `gestures` : un geste de découpe par
 * ingrédient (null = juste peser) ; `mixText` : le texte de prep du bol (« mélangé », « délayée ») ;
 * `liquidL` : liquide ajouté au bol (bouillon délayé) ; `kinds` : les étapes qui l'utilisent.
 */
export function classifyBowl(items: { food: string | null; item: string; gesture: string | null }[], opts: { mixText?: string; liquidL?: number; kinds: string[] }): Pick<BowlNeed, "content" | "moment"> {
  const meat = items.some((i) => MEAT.test(i.food ?? "") && !/bouillon/.test(i.food ?? ""));
  const cut = items.some((i) => i.gesture);
  const mixed = /m[ée]lang|d[ée]lay|fouett|marin|battu|émulsion/i.test(opts.mixText ?? "") || (items.length > 1 && items.some((i) => /skyr|yaourt|ricotta|oeuf/.test(i.food ?? "")));
  const content: BowlNeed["content"] = meat ? "meat" : mixed || (opts.liquidL ?? 0) > 0 ? "mix" : cut ? "cut" : "weigh";
  // Au moment : rien à couper ni à mélanger, des choses qui se versent ou se pèsent ; à plusieurs, seulement
  // dans une étape qui laisse le temps (mijoté, eau, four), pas dans une saisie.
  const pourable = items.every((i) => MOMENT_FOOD.test(i.food ?? "") || /surgel|en boîte|égoutt/i.test(i.item));
  const slow = opts.kinds.every((k) => k === "braise" || k === "boil" || k === "bake");
  const moment = content === "weigh" && pourable && (items.length === 1 || slow);
  return { content, moment };
}

/** L'inventaire en exemplaires, du plus petit au plus grand. */
function unitsOf(kinds: ContainerKind[]) {
  return kinds
    .flatMap((k) => Array.from({ length: Math.max(0, k.count) }, (_, i) => ({ id: `${k.id}#${i + 1}`, kind: k.kind, label: k.label, liters: k.liters, freeAt: -Infinity })))
    .sort((a, b) => a.liters - b.liters);
}

/** Range les groupes dans les contenants (voir en tête). */
export function allocateBowls(needs: BowlNeed[], kinds: ContainerKind[]): Allocation {
  const places = new Map<string, BowlPlace>();
  const missing: string[] = [];
  for (const n of needs) if (n.moment) places.set(n.letter, { holder: "moment", container: null, label: null });

  // Groupes qui entrent ensemble : un seul contenant s'ils y tiennent (jamais avec de la viande crue).
  const units = unitsOf(kinds);
  const biggest = units.length ? Math.max(...units.map((u) => u.liters)) : 0;
  const lots: BowlNeed[][] = [];
  const byKey = new Map<string, BowlNeed[]>();
  for (const n of needs) {
    if (n.moment) continue;
    const lot = n.together ? byKey.get(n.together) : undefined;
    const sum = (lot ?? []).reduce((x, m) => x + m.liters, n.liters);
    if (lot && n.content !== "meat" && lot.every((m) => m.content !== "meat") && sum / BOWL_FILL <= biggest + 1e-6) {
      lot.push(n);
      continue;
    }
    const fresh = [n];
    lots.push(fresh);
    if (n.together && !lot) byKey.set(n.together, fresh);
  }
  const RANK = { meat: 0, mix: 1, cut: 2, weigh: 3 } as const;
  // Dans l'ordre où on les remplit ; à égalité, ce qui a le plus besoin d'un vrai bol d'abord.
  const order = lots
    .map((lot) => ({
      lot,
      liters: lot.reduce((x, m) => x + m.liters, 0),
      fillAt: Math.min(...lot.map((m) => m.fillAt)),
      releaseAt: Math.max(...lot.map((m) => m.releaseAt)),
      fridge: lot.some((m) => m.fridge),
      rank: Math.min(...lot.map((m) => RANK[m.content])),
    }))
    .sort((a, b) => a.fillAt - b.fillAt || a.rank - b.rank || b.liters - a.liters);
  const spans: [number, number][] = [];
  const put = (lot: BowlNeed[], u: (typeof units)[number], from: number, to: number, extra: Partial<BowlPlace>) => {
    u.freeAt = to;
    spans.push([from, to]);
    const letters = lot.map((m) => m.letter);
    for (const m of lot) places.set(m.letter, { holder: u.kind, container: u.id, label: u.label, ...(letters.length > 1 ? { with: letters.filter((l) => l !== m.letter) } : {}), ...extra });
  };
  /** En deux contenants libres (la moitié du poulet dans chacun), les plus petits qui suffisent ensemble. */
  const putPair = (o: (typeof order)[number]) => {
    const free = units.filter((x) => x.freeAt + RINSE_MIN <= o.fillAt + 1e-6);
    let pair: [(typeof units)[number], (typeof units)[number]] | null = null;
    for (let i = 0; i < free.length; i++)
      for (let j = i + 1; j < free.length; j++)
        if ((free[i].liters + free[j].liters) * BOWL_FILL + 1e-6 >= o.liters && (!pair || free[i].liters + free[j].liters < pair[0].liters + pair[1].liters)) pair = [free[i], free[j]];
    if (!pair) return false;
    for (const x of pair) {
      x.freeAt = o.releaseAt;
      spans.push([o.fillAt, o.releaseAt]);
    }
    const label = pair[0].label === pair[1].label ? `2 × ${pair[0].label.toLowerCase()}` : `${pair[0].label} + ${pair[1].label.toLowerCase()}`;
    for (const m of o.lot) places.set(m.letter, { holder: pair[0].kind, container: `${pair[0].id}+${pair[1].id}`, label, split: true });
    return true;
  };
  const late: typeof order = [];
  for (const o of order) {
    const free = units.filter((u) => u.freeAt + RINSE_MIN <= o.fillAt + 1e-6);
    const pref = (u: (typeof units)[number]) => (o.fridge ? (u.kind === "boite" ? 0 : 1) : u.kind === "bol" ? 0 : 1);
    const fit = free.filter((u) => u.liters * BOWL_FILL + 1e-6 >= o.liters).sort((a, b) => pref(a) - pref(b) || a.liters - b.liters)[0];
    if (fit) put(o.lot, fit, o.fillAt, o.releaseAt, {});
    else if (!putPair(o)) late.push(o);
  }
  // Pas de contenant libre : peser au moment, une assiette pour des légumes coupés, ou remplir plus tard.
  for (const o of late) {
    const content = o.lot.map((m) => m.content);
    if (content.every((c) => c === "weigh")) {
      for (const m of o.lot) places.set(m.letter, { holder: "moment", container: null, label: null });
      continue;
    }
    if (content.every((c) => c === "weigh" || c === "cut")) {
      for (const m of o.lot) places.set(m.letter, { holder: "assiette", container: null, label: "Assiette" });
      continue;
    }
    // Un contenant qui se libère assez tôt (rincé, puis 2 min pour le remplir avant qu'on en ait besoin).
    const u = units
      .filter((x) => x.liters * BOWL_FILL + 1e-6 >= o.liters && Number.isFinite(x.freeAt) && x.freeAt + RINSE_MIN + 2 <= o.releaseAt + 1e-6)
      .sort((a, b) => a.freeAt - b.freeAt || a.liters - b.liters)[0];
    if (u) {
      const after = [...places.entries()].filter(([, p]) => p.container === u.id).map(([l]) => l).pop();
      put(o.lot, u, u.freeAt, o.releaseAt, after ? { fillAfter: after } : {});
      continue;
    }
    // Le plus grand contenant libre, bien plein, plutôt que rien.
    const big = units.filter((x) => x.freeAt + RINSE_MIN <= o.fillAt + 1e-6).pop();
    if (big && o.liters <= big.liters * 1.05) {
      put(o.lot, big, o.fillAt, o.releaseAt, { tight: true });
      continue;
    }
    for (const m of o.lot) {
      places.set(m.letter, { holder: "bol", container: null, label: null });
      missing.push(m.letter);
    }
  }
  let peak = 0;
  for (const [a] of spans) peak = Math.max(peak, spans.filter(([x, y]) => x <= a + 1e-6 && y > a + 1e-6).length);
  return { places, peak: peak + missing.length, used: units.filter((u) => u.freeAt !== -Infinity).length + missing.length, missing };
}

/** L'inventaire de prep d'une cuisine : ses bols et boîtes de prep (lignes « container »), sinon celui par défaut. */
export function inventoryOf(equipment: { id: string; kind: string; name: string; capacityL?: number | null; count?: number | null; dimsJson?: Record<string, number | string> | null }[]): ContainerKind[] {
  const rows = equipment.filter((e) => e.kind === "container");
  const src = rows.length ? rows : kitchenEquipment(DEFAULT_KITCHEN).equipment.filter((e) => e.kind === "container").map((e) => ({ ...e, capacityL: e.capacityL ?? null, count: e.count ?? 1, dimsJson: e.dimsJson ?? null }));
  return src
    .filter((e) => e.dimsJson?.role === "bol" || e.dimsJson?.role === "prep")
    .map((e) => ({ id: e.id, kind: e.dimsJson?.role === "prep" ? ("boite" as const) : ("bol" as const), label: String(e.dimsJson?.label ?? e.name), liters: e.capacityL ?? 1, count: Math.max(0, e.count ?? 1) }));
}
