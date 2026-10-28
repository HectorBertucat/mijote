// La cuisine du foyer en base : réglage (app_settings « kitchen ») et équipement du planificateur.
// Tous les récipients standard existent toujours (les recettes les citent, clé étrangère) ;
// ceux que le foyer n'a pas sont marqués owned = false.
import { inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { equipment, equipmentFit } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { kitchenEquipment, parseKitchen, type KitchenConfig } from "./presets";

export const KITCHEN_SETTING = "kitchen";

/** Tous les récipients standard, pour que n'importe quelle recette s'importe. */
const FULL: KitchenConfig = {
  hobType: "induction",
  hobs: 5,
  levels: 9,
  oven: true,
  ovenLevels: 5,
  vessels: { poele: true, poeleMaxG: 500, cocotte: true, faitout: true, casseroles: 3, plats: 3 },
  extras: { microOndes: true, congelateur: true, mixeur: true },
  duo: true,
};

export const loadKitchen = (db: Db) => parseKitchen(getSetting(db, KITCHEN_SETTING));

/** Ajoute les récipients standard manquants (non possédés) : au démarrage, avant l'import des recettes. */
export function ensureCatalog(db: Db) {
  for (const e of kitchenEquipment(FULL).equipment) db.insert(equipment).values({ ...e, owned: false }).onConflictDoNothing().run();
}

/** Enregistre la cuisine et la traduit en équipement possédé et en compatibilités. */
export function applyKitchen(db: Db, c: KitchenConfig) {
  const { equipment: rows, fits } = kitchenEquipment(c);
  const catalogIds = kitchenEquipment(FULL).equipment.map((e) => e.id);
  db.transaction((tx) => {
    for (const e of kitchenEquipment(FULL).equipment) tx.insert(equipment).values({ ...e, owned: false }).onConflictDoNothing().run();
    // Seuls les récipients standard suivent la cuisine réglée ; un équipement ajouté à la main
    // (appareil sous-vide, deuxième four…) n'est pas touché.
    tx.update(equipment).set({ owned: false }).where(inArray(equipment.id, catalogIds)).run();
    // Un récipient déjà là garde le nom et les notes qu'on lui a donnés (« Poêle inox de grand-mère ») ;
    // seuls ses dimensions, sa capacité et sa limite par fournée suivent la cuisine réglée.
    for (const e of rows) {
      const { name: _n, notes: _o, ...shape } = e;
      tx.insert(equipment).values({ ...e, owned: true }).onConflictDoUpdate({ target: equipment.id, set: { ...shape, id: undefined, owned: true } }).run();
    }
    tx.delete(equipmentFit).run();
    if (fits.length) tx.insert(equipmentFit).values(fits).run();
  });
  setSetting(db, KITCHEN_SETTING, JSON.stringify(c));
}
