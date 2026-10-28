// Données de départ d'une instance neuve : une cuisine standard (modifiable dans la mise en route,
// /bienvenue) et des règles de cuisine générales. Aucune personne : le foyer se crée à la mise en route.
// Ids stables : le seed peut tourner autant de fois qu'on veut.
import type { InferInsertModel } from "drizzle-orm";
import type { preferences } from "@/lib/db/schema";
import { DEFAULT_KITCHEN, kitchenEquipment } from "@/lib/kitchen/presets";

const kitchen = kitchenEquipment(DEFAULT_KITCHEN);
export const EQUIPMENT = kitchen.equipment;
export const EQUIPMENT_FIT = kitchen.fits;

type Pref = Omit<InferInsertModel<typeof preferences>, "id">;
const P = (personId: string | null, kind: Pref["kind"], text: string, tags: string[] = []): Pref => ({ personId, kind, text, tags });

// Règles de la maison, valables pour tous (leçons de cuisine courantes) : chacun les garde, les
// retire ou en ajoute dans la mise en route. Les goûts de chacun se règlent par personne.
const PREFS: Pref[] = [
  P(null, "avoid_task", "Effilocher, désosser, dégraisser après cuisson (cuisses de poulet entières). Préférer hauts de cuisse désossés, filets, échine en cubes, sauté, cuisse de dinde (un seul os)", ["viande", "prep"]),
  P(null, "rule", "Échine de porc : braiser environ 1 h 30 à petit frémissement, ou au four à 160 °C. 45 à 60 min, elle reste dure", ["cuisson", "porc"]),
  P(null, "rule", "Oignons fondants : 10 à 12 min à feu moyen (8 min, c'est trop court)", ["cuisson"]),
  P(null, "rule", "Moutarde hors du feu, pour garder son piquant", ["cuisson"]),
  P(null, "rule", "Cocotte en fonte : la préchauffer vide 3 min à feu vif", ["cuisson", "cocotte"]),
  P(null, "rule", "Saisie : poêle préchauffée à vide, test de la goutte (elle glisse comme une bille), baisser d'un cran, viande bien sèche, pas trop par fournée. Ne rien toucher avant que la viande se décolle seule. Déglacer les sucs bruns", ["cuisson", "maillard"]),
  P(null, "rule", "Toute saisie donne le niveau du foyer, la durée et un signe visuel ou sonore", ["recette"]),
  P(null, "rule", "Prep en bols lettrés, puis cuisson qui dit « bol C ». Four et plaques en parallèle. Une seule session de batch", ["organisation"]),
  P(null, "rule", "Riz et pâtes gardés à part", ["conservation"]),
  P(null, "rule", "Au frigo : J+3 à J+4, J+5 au maximum. Refroidir en moins de 2 h (plat large, riz étalé)", ["conservation"]),
  P(null, "rule", "Congélateur seulement au-delà d'environ J+4, et pour la viande crue qui doit attendre", ["conservation"]),
];

export const PREFERENCES: InferInsertModel<typeof preferences>[] = PREFS.map((p, i) => ({ id: `pref-${String(i + 1).padStart(3, "0")}`, ...p }));
