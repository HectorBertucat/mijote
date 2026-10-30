// La cuisine du foyer en base : réglage (app_settings « kitchen ») et équipement du planificateur.
// Tous les récipients standard existent toujours (les recettes les citent, clé étrangère) ;
// ceux que le foyer n'a pas sont marqués owned = false.
import { inArray, like, or } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { equipment, equipmentFit } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { CATALOG_KITCHEN, kitchenEquipment, normalizeKitchen, parseKitchen, type KitchenConfig } from "./presets";

export const KITCHEN_SETTING = "kitchen";

/** Noms donnés par les versions précédentes de la mise en route (remplacés par la description détaillée). */
const LEGACY_NAMES = new Set(["Poêle 28 cm (inox ou fonte)", "Casserole 1 (petite)", "Casserole 2 (moyenne)", "Casserole 3 (grande)", "Mixeur"]);

export const loadKitchen = (db: Db) => parseKitchen(getSetting(db, KITCHEN_SETTING));

/** Ajoute les récipients standard manquants (non possédés) : au démarrage, avant l'import des recettes. */
export function ensureCatalog(db: Db) {
  for (const e of kitchenEquipment(CATALOG_KITCHEN).equipment) db.insert(equipment).values({ ...e, owned: false }).onConflictDoNothing().run();
}

/** Enregistre la cuisine et la traduit en équipement possédé et en compatibilités. */
export function applyKitchen(db: Db, raw: KitchenConfig) {
  const c = normalizeKitchen(raw);
  const { equipment: rows, fits } = kitchenEquipment(c);
  const before = new Map(kitchenEquipment(loadKitchen(db)).equipment.map((e) => [e.id, e.name]));
  const catalogIds = kitchenEquipment(CATALOG_KITCHEN).equipment.map((e) => e.id);
  db.transaction((tx) => {
    for (const e of kitchenEquipment(CATALOG_KITCHEN).equipment) tx.insert(equipment).values({ ...e, owned: false }).onConflictDoNothing().run();
    // Seuls les récipients standard suivent la cuisine réglée ; un équipement ajouté à la main
    // (appareil sous-vide, deuxième four…) n'est pas touché.
    // Les foyers gardent leur diamètre dans l'id (hob-18, hob-18b) : tous suivent la plaque réglée.
    tx.update(equipment).set({ owned: false }).where(or(inArray(equipment.id, catalogIds), like(equipment.id, "hob-%"))).run();
    // Un récipient déjà là garde le nom et les notes qu'on lui a donnés (« Poêle inox de grand-mère ») ;
    // seuls ses dimensions, sa capacité et sa limite par fournée suivent la cuisine réglée. Un nom
    // jamais retouché (celui qu'avait donné la cuisine précédente) suit la nouvelle description.
    const named = new Map(tx.select({ id: equipment.id, name: equipment.name }).from(equipment).where(inArray(equipment.id, rows.map((e) => e.id))).all().map((e) => [e.id, e.name]));
    for (const e of rows) {
      const { name, notes: _o, ...shape } = e;
      const cur = named.get(e.id);
      const rename = cur != null && (cur === before.get(e.id) || LEGACY_NAMES.has(cur));
      tx.insert(equipment).values({ ...e, owned: true }).onConflictDoUpdate({ target: equipment.id, set: { ...shape, ...(rename ? { name } : {}), id: undefined, owned: true } }).run();
    }
    tx.delete(equipmentFit).run();
    if (fits.length) tx.insert(equipmentFit).values(fits).run();
  });
  setSetting(db, KITCHEN_SETTING, JSON.stringify(c));
}
