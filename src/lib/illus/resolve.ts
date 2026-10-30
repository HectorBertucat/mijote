// Quel dessin pour quel aliment ou quelle étape : pur et testé (tests/illus.test.ts).
// Garantie : chaque appel rend un dessin existant. Un aliment inconnu tombe sur le générique de
// sa catégorie (devinée au nom), puis sur _ingredient ; une étape inconnue, sur le geste de son type.
import { ACTIONS, FOODS, type ActionId, type FoodArtId, type FoodCategory } from "./art";

export interface Resolved<T extends string> {
  id: T;
  /** false : un générique a servi, il manque un dessin propre (voir pnpm illus:coverage). */
  exact: boolean;
}

// Aliments de la table nutritionnelle (src/lib/nutrition/foods.ts) sans dessin à leur nom.
const FOOD_ALIAS: Record<string, FoodArtId> = {};

// Nom de l'ingrédient → dessin. Testé dans l'ordre : le premier qui correspond gagne.
const NAME_RULES: [RegExp, FoodArtId][] = [
  [/\bsel\b/, "sel"],
  [/poivron/, "poivron"],
  [/poivre/, "poivre"],
  [/thym/, "thym"],
  [/laurier/, "laurier"],
  [/origan|herbes de provence/, "origan"],
  [/persil|coriandre|ciboulette|basilic|aneth/, "persil"],
  [/paprika/, "paprika"],
  [/piment|chili/, "piment"],
  [/fenouil \(graines|graines de fenouil|cumin|carvi|sésame|sesame/, "fenouil"],
  [/colombo|curry|curcuma|garam|ras el hanout|épices|cannelle/, "colombo"],
  [/\beau\b/, "eau"],
  [/échine|echine/, "echine_porc"],
  [/sauté de porc|saute de porc/, "saute_porc"],
  [/filet mignon/, "filet_mignon_porc"],
  [/poitrine|lardons|bacon/, "poitrine_porc"],
  [/saucisse|chipolata|merguez/, "saucisse_toulouse"],
  [/porc|jambon|côte|cote/, "porc"],
  [/haut de cuisse|haut-de-cuisse/, "haut_cuisse_poulet"],
  [/cuisse.*dinde/, "cuisse_dinde"],
  [/cuisse|pilon/, "cuisse_poulet"],
  [/poulet entier/, "poulet_entier"],
  [/poulet|dinde|volaille/, "filet_poulet"],
  [/(^|[^b])(œuf|oeuf)/, "oeuf"],
  [/riz/, "riz_basmati"],
  [/pâtes|pates|rigatoni|penne|tagliatelle|spaghetti|fusilli|coquillettes/, "pates"],
  [/pomme de terre|pommes de terre|patate/, "pomme_de_terre"],
  [/pois chiche|lentille|haricots? (rouge|blanc)/, "pois_chiches"],
  [/farine/, "farine"],
  [/flocons|avoine|porridge/, "flocons_avoine"],
  [/pain complet|pain aux céréales/, "pain_complet"],
  [/\bpain\b|baguette|tartine/, "pain"],
  [/banane/, "banane"],
  [/\bpommes?\b/, "pomme"],
  [/whey|protéine en poudre|proteine en poudre/, "whey"],
  [/confiture/, "confiture"],
  [/amande/, "amandes"],
  [/maïzena|maizena|fécule|fecule/, "maizena"],
  [/échalote|echalote/, "echalote"],
  [/oignon/, "oignon"],
  [/\bail\b|gousse/, "ail"],
  [/gingembre/, "gingembre"],
  [/champignon/, "champignon"],
  [/courgette/, "courgette"],
  [/carotte/, "carotte"],
  [/haricots? verts?/, "haricots_verts"],
  [/concentré|concentre/, "concentre_tomate"],
  [/pulpe|tomates? concass|coulis|passata/, "pulpe_tomate"],
  [/tomate/, "tomate"],
  [/citron/, "citron_vert"],
  [/yaourt|yogourt/, "yaourt"],
  [/ricotta|mascarpone|fromage blanc|skyr/, "ricotta"],
  [/râpé|rape|emmental|parmesan|gruyère|comté|mozzarella/, "emmental_rape"],
  [/crème|creme/, "creme_legere"],
  [/beurre/, "beurre"],
  [/huile/, "huile"],
  [/sucre/, "sucre"],
  [/miel|sirop d'érable/, "miel"],
  [/nuoc|sauce poisson/, "nuoc_mam"],
  [/soja|soy/, "sauce_soja"],
  [/moutarde/, "moutarde"],
  [/bouillon|fond de/, "bouillon_cube"],
  [/vin\b/, "vin_blanc_cuit"],
];

// Catégorie devinée au nom, quand aucun dessin propre ne correspond.
const CATEGORY_RULES: [RegExp, FoodCategory][] = [
  [/bœuf|boeuf|veau|agneau|viande|steak|haché|hache|canard|lapin/, "viande"],
  [/poulet|dinde|volaille|pintade/, "volaille"],
  [/poisson|saumon|cabillaud|thon|crevette|moule|colin|merlu/, "poisson"],
  [/semoule|boulgour|quinoa|pain|nouilles|polenta|gnocchi|lentille|haricot/, "feculent"],
  [/salade|épinard|epinard|brocoli|chou|poireau|aubergine|céleri|celeri|navet|petits pois|légume|legume|potiron|courge|betterave|fenouil/, "legume"],
  [/pomme|poire|banane|orange|ananas|mangue|raisin|fruit|abricot/, "fruit"],
  [/coriandre|menthe|basilic|ciboulette|estragon|romarin|sauge|herbe/, "herbe"],
  [/lait|fromage|feta|chèvre|chevre/, "laitier"],
  [/graisse|saindoux/, "gras"],
  [/cannelle|muscade|clou|cardamome|badiane|anis|épice|epice|sel /, "epice"],
  [/sauce|ketchup|vinaigre|pesto|tahin|harissa|cornichon|câpre|capre|olive/, "condiment"],
  [/chocolat|confiture|sirop|cassonade/, "sucre"],
  [/bière|biere|jus|lait de coco|cidre|alcool|rhum|cognac/, "liquide"],
  [/boîte|boite|conserve/, "conserve"],
];

const norm = (s: string) => s.toLowerCase().normalize("NFC");

/** Le dessin d'un ingrédient : son aliment de la table d'abord, puis son nom, puis sa catégorie. */
export function foodArt(food: string | null | undefined, item: string): Resolved<FoodArtId> {
  if (food && food !== "zero") {
    if (food in FOODS && !food.startsWith("_")) return { id: food as FoodArtId, exact: true };
    if (food in FOOD_ALIAS) return { id: FOOD_ALIAS[food], exact: true };
  }
  // Le nom avant la virgule décrit l'aliment (« Ail, haché ») ; le reste, la découpe.
  const name = norm(item);
  const head = name.split(/[,(:]/)[0];
  for (const text of [head, name]) for (const [re, id] of NAME_RULES) if (re.test(text)) return { id, exact: true };
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return { id: `_${cat}` as FoodArtId, exact: false };
  return { id: "_ingredient", exact: false };
}

export const foodCategory = (id: FoodArtId): FoodCategory => FOODS[id].category;

// ─── Gestes ───

const STEP_KIND_DEFAULT: Record<string, ActionId> = {
  prep: "chop",
  sear: "sear",
  braise: "simmer",
  boil: "boil",
  bake: "bake",
  rest: "rest",
  cool: "cool",
  preheat: "bake",
};

// Texte de l'étape ou de la sous-étape → geste. Le verbe qui vient en premier dans la première
// phrase gagne (« Coupe l'échine… puis marine » = couper) ; à égalité, l'ordre de la liste.
const ACTION_RULES: [RegExp, ActionId][] = [
  [/déglace|deglace|vin blanc|gratte le fond/, "deglaze"],
  [/égoutte|egoutte|passe sous l'eau froide/, "drain"],
  [/\bpyrex\b[^.]*:|montage|couches|par-dessus/, "assemble"],
  [/râpe|râpé|rape\b/, "grate"],
  [/marin/, "marinate"],
  [/portion|répartis|repartis|pèse le total|pese le total/, "portion"],
  [/refroidi|frigo|filme/, "cool"],
  [/repos|laisse reposer|sous alu/, "rest"],
  [/(poêle|poele)[^.,]*vide|test de la goutte|goutte :|préchauffe la poêle|prechauffe la poestel/, "preheat"],
  [/cocotte[^.]*(vide|préchauff)/, "simmer"],
  [/four à|four a |enfourne|au four|chaleur tournante/, "bake"],
  [/sors la cocotte|braisage/, "braise_oven"],
  [/ne touche pas|sans toucher|saisi|dore|colore|retourne|fournée|fournee/, "sear"],
  [/^riz|^pâtes|^haricots verts|ébullition|ebullition|eau salée|eau salee|faitout d'eau|casserole d'eau|frémissement|fremissement/, "boil"],
  [/mijot|réduis|reduis|réduit|couvercle|à couvert|a couvert/, "simmer"],
  [/remu|fais revenir|faire revenir|émiette|emiette|\bsaute\b|arrose/, "stir"],
  [/éminc|eminc|coupe|hach|cisèle|cisele|tranche|lanières|lanieres|médaillons|cubes de/, "chop"],
  [/mélange|melange|fouette|\bbats\b|battus|incorpore/, "mix"],
  [/assaisonne|goûte|goute/, "season"],
];

// Ces types d'étape gardent leur geste, sauf ces exceptions précises.
const KIND_LOCK: Record<string, ActionId[]> = {
  boil: ["drain"],
  bake: ["assemble", "grate"],
  preheat: [],
  rest: [],
  cool: ["portion"],
};

function firstMatch(text: string): ActionId | null {
  let best: { at: number; rank: number; id: ActionId } | null = null;
  ACTION_RULES.forEach(([re, id], rank) => {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at || (m.index === best.at && rank < best.rank))) best = { at: m.index, rank, id };
  });
  return (best as { id: ActionId } | null)?.id ?? null;
}

/** Le geste d'une étape (ou d'une sous-étape) : d'après son texte, sinon d'après son type. */
export function actionArt(kind: string, text: string): Resolved<ActionId> {
  // « Pendant le braisage, champignons… » : le début dit quand, pas quoi.
  const t = norm(text).replace(/^(pendant|dès que|des que|à \d+ h de)[^,]*,\s*/, "");
  const head = t.split(/\.\s/)[0];
  const found = firstMatch(head) ?? firstMatch(t);
  const lock = KIND_LOCK[kind];
  if (lock) return found && lock.includes(found) ? { id: found, exact: true } : { id: STEP_KIND_DEFAULT[kind], exact: true };
  // Dans une cocotte, « porte à ébullition » reste un mijotage.
  if (found === "boil" && kind === "braise") return { id: "simmer", exact: true };
  if (found) return { id: found, exact: true };
  return { id: STEP_KIND_DEFAULT[kind] ?? "wait", exact: false };
}

export const actionLabel = (id: ActionId) => ACTIONS[id].label;
